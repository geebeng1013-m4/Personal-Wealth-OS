import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  cloudCopyWins,
  hasUnsyncedLocalEdits,
  reconcileCloudSnapshot,
  recordCloudSyncPoint,
  loadStateFromCloud,
  migrateState,
  loadSnapshots,
  clearSnapshots,
  STORAGE_KEY,
  CURRENT_VERSION,
} from "../src/state";
import type { WealthState } from "../src/models";
// The firebase module state.ts imports is stubbed by _test.mjs; this is the
// same instance, addressed by name, so a test can say who is signed in and
// what Firestore holds.
import { reset, signIn, setCloudDocument, saved } from "test:firebase-stub";

const UID = "user-under-test";
const KEY = `${STORAGE_KEY}-${UID}`;

/** A state carrying one identifiable trade, stamped with a known save time. */
function stateWith(updatedAt: number, tradeId: string, lastSyncedAt = 0): WealthState {
  return migrateState({
    version: CURRENT_VERSION,
    deviceId: "test-device",
    updatedAt,
    lastSyncedAt,
    trades: [{
      id: tradeId,
      date: "2026-08-01",
      platform: "moomoo",
      ticker: "VOO",
      type: "DCA",
      amountMyr: 100,
      amountUsd: 23.5,
      priceUsd: 620,
      units: 0.0379,
      feeMyr: 1.2,
    }],
  } as Partial<WealthState>);
}

function tradeIds(state: WealthState): string[] {
  return state.trades.map((trade) => trade.id);
}

function localTradeIds(): string[] {
  const raw = localStorage.getItem(KEY);
  return raw ? tradeIds(JSON.parse(raw) as WealthState) : [];
}

function startClean(): void {
  reset();
  localStorage.clear();
  clearSnapshots(UID);
  signIn(UID);
}

// --- the decision itself ----------------------------------------------------

// Pre-sync-point fallback: a local copy with lastSyncedAt 0 (pre-v20 data on
// its first load after the upgrade) still uses the old updatedAt comparison.

test("cloudCopyWins: with no sync point, a newer cloud copy replaces local", () => {
  assert.equal(cloudCopyWins({ updatedAt: 1_000, lastSyncedAt: 0 }, { updatedAt: 2_000, lastSyncedAt: 0 }), true);
});

test("cloudCopyWins: with no sync point, a newer local copy is kept", () => {
  assert.equal(cloudCopyWins({ updatedAt: 2_000, lastSyncedAt: 0 }, { updatedAt: 1_000, lastSyncedAt: 0 }), false);
});

test("cloudCopyWins: with no local copy at all, the cloud is taken", () => {
  assert.equal(cloudCopyWins(null, { updatedAt: 1_000, lastSyncedAt: 0 }), true);
});

// Once a sync point exists, the decision is skew-proof: it only asks whether
// local has edits the server has not confirmed, never which clock is bigger.

test("cloudCopyWins: a clean local copy yields to the cloud even if its clock is behind", () => {
  // Local was confirmed on the server at updatedAt 9000; the cloud doc a
  // remote device wrote claims updatedAt 1000. Old logic kept local; the new
  // logic takes the cloud, because local has nothing unsynced to lose.
  assert.equal(cloudCopyWins({ updatedAt: 9_000, lastSyncedAt: 9_000 }, { updatedAt: 1_000, lastSyncedAt: 1_000 }), true);
});

test("cloudCopyWins: a dirty local copy is kept even if the cloud clock is ahead", () => {
  // Local edited to updatedAt 2000 since its last confirmed sync at 1000; the
  // cloud claims updatedAt 9000 (a fast-clocked device). Local is kept.
  assert.equal(cloudCopyWins({ updatedAt: 2_000, lastSyncedAt: 1_000 }, { updatedAt: 9_000, lastSyncedAt: 9_000 }), false);
});

// --- dirty flag -----------------------------------------------------------

test("hasUnsyncedLocalEdits: true only once a real sync point disagrees with updatedAt", () => {
  assert.equal(hasUnsyncedLocalEdits({ updatedAt: 5_000, lastSyncedAt: 3_000 }), true);
  assert.equal(hasUnsyncedLocalEdits({ updatedAt: 5_000, lastSyncedAt: 5_000 }), false);
  // No sync point yet — "dirty" is unknown, not assumed.
  assert.equal(hasUnsyncedLocalEdits({ updatedAt: 5_000, lastSyncedAt: 0 }), false);
});

// --- reconcileCloudSnapshot --------------------------------------------------

const clean = { updatedAt: 5_000, lastSyncedAt: 5_000 };
const dirty = { updatedAt: 6_000, lastSyncedAt: 5_000 };

test("reconcile: a snapshot still carrying local pending writes is ignored", () => {
  assert.equal(reconcileCloudSnapshot(clean, { updatedAt: 9_000, hasPendingWrites: true, fromCache: false }), "ignore");
});

test("reconcile: a cache-only snapshot (not yet server-confirmed) is ignored", () => {
  assert.equal(reconcileCloudSnapshot(clean, { updatedAt: 9_000, hasPendingWrites: false, fromCache: true }), "ignore");
});

test("reconcile: the server confirming this device's own write records a sync point", () => {
  assert.equal(reconcileCloudSnapshot(clean, { updatedAt: 5_000, hasPendingWrites: false, fromCache: false }), "record-sync-point");
});

test("reconcile: a remote change while this device has unsynced edits re-pushes local", () => {
  assert.equal(reconcileCloudSnapshot(dirty, { updatedAt: 9_000, hasPendingWrites: false, fromCache: false }), "push-local");
});

test("reconcile: a remote change while this device is clean applies the remote copy", () => {
  assert.equal(reconcileCloudSnapshot(clean, { updatedAt: 9_000, hasPendingWrites: false, fromCache: false }), "apply-remote");
});

// --- recordCloudSyncPoint --------------------------------------------------

test("recordCloudSyncPoint: marks the stored copy clean when updatedAt still matches", () => {
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(7_000, "t")));
  const marked = recordCloudSyncPoint(UID, 7_000);
  assert.equal(marked?.lastSyncedAt, 7_000);
  assert.equal((JSON.parse(localStorage.getItem(KEY)!) as WealthState).lastSyncedAt, 7_000);
  assert.equal(saved.length, 0, "it must never write to Firestore");
});

test("recordCloudSyncPoint: no-op when a newer local edit has landed since the write", () => {
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(8_000, "t")));
  assert.equal(recordCloudSyncPoint(UID, 7_000), null);
  assert.equal((JSON.parse(localStorage.getItem(KEY)!) as WealthState).lastSyncedAt, 0);
});

test("recordCloudSyncPoint: no-op when there is no stored copy", () => {
  startClean();
  assert.equal(recordCloudSyncPoint(UID, 7_000), null);
});

// --- the round trip ---------------------------------------------------------

test("cloud sync: a newer cloud copy is applied and written to local storage", async () => {
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(1_000, "local-trade")));
  setCloudDocument(stateWith(5_000, "cloud-trade"));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "cloud-applied");
  assert.deepEqual(tradeIds(result.state!), ["cloud-trade"]);
  assert.deepEqual(localTradeIds(), ["cloud-trade"], "local storage should now hold the cloud copy");
});

test("cloud sync: an older cloud copy never overwrites newer local edits", async () => {
  // The regression this guards: edits made offline, or after a rejected write,
  // used to be replaced by whatever stale document the cloud still held.
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(9_000, "edited-offline")));
  setCloudDocument(stateWith(1_000, "stale-cloud-trade"));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "local-kept-newer");
  assert.deepEqual(tradeIds(result.state!), ["edited-offline"]);
  assert.deepEqual(localTradeIds(), ["edited-offline"], "local storage must be left untouched");
});

test("cloud sync: keeping local takes no snapshot, because nothing was overwritten", async () => {
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(9_000, "edited-offline")));
  setCloudDocument(stateWith(1_000, "stale-cloud-trade"));

  await loadStateFromCloud();

  assert.equal(loadSnapshots(UID).length, 0);
});

test("cloud sync: overwriting local with a different cloud copy is snapshotted first", async () => {
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(1_000, "about-to-be-replaced")));
  setCloudDocument(stateWith(5_000, "cloud-trade"));

  await loadStateFromCloud();

  const snapshots = loadSnapshots(UID);
  assert.equal(snapshots.length, 1, "the replaced local copy should be recoverable");
  assert.deepEqual(tradeIds(snapshots[0].state), ["about-to-be-replaced"]);
});

test("cloud sync: reading back the same save takes no snapshot", async () => {
  // Signing in on the device that wrote the cloud document reads back exactly
  // what it wrote. Snapshotting that on every launch would push real history
  // out of the 20-slot budget.
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(4_242, "same-save")));
  setCloudDocument(stateWith(4_242, "same-save"));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "cloud-applied");
  assert.equal(loadSnapshots(UID).length, 0);
});

test("cloud sync: an empty cloud reports no document and leaves local alone", async () => {
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(1_000, "local-trade")));
  setCloudDocument(null);

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "no-cloud-document");
  assert.equal(result.state, null);
  assert.deepEqual(localTradeIds(), ["local-trade"]);
});

test("cloud sync: with no local copy at all the cloud is applied without a snapshot", async () => {
  startClean();
  setCloudDocument(stateWith(5_000, "cloud-trade"));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "cloud-applied");
  assert.deepEqual(localTradeIds(), ["cloud-trade"]);
  assert.equal(loadSnapshots(UID).length, 0, "there was nothing to lose");
});

test("cloud sync: an unreadable local copy does not block the cloud one", async () => {
  startClean();
  localStorage.setItem(KEY, "{ this is not json");
  setCloudDocument(stateWith(5_000, "cloud-trade"));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "cloud-applied");
  assert.deepEqual(localTradeIds(), ["cloud-trade"]);
});

// --- dirty flag through the full load path --------------------------------

test("cloud sync: a CLEAN local copy yields to an older-clock cloud, and is snapshotted", async () => {
  // Local was confirmed synced at updatedAt 9000; a remote device then wrote a
  // doc its own (slower) clock stamped 1000. Old rule kept local; new rule
  // takes the cloud, because local has nothing unsynced to lose.
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(9_000, "clean-local", 9_000)));
  setCloudDocument(stateWith(1_000, "remote-write", 1_000));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "cloud-applied");
  assert.deepEqual(tradeIds(result.state!), ["remote-write"]);
  assert.equal(result.state!.lastSyncedAt, result.state!.updatedAt, "the taken copy is stamped as a sync point");
  assert.equal(loadSnapshots(UID).length, 1, "the replaced local copy stays recoverable");
});

test("cloud sync: a DIRTY local copy is kept against a newer-clock cloud", async () => {
  // Local edited to 6000 since its last confirmed sync at 5000; a fast-clocked
  // remote device wrote a doc stamped 9000. Local is kept.
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(6_000, "edited-here", 5_000)));
  setCloudDocument(stateWith(9_000, "fast-clock-remote", 9_000));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "local-kept-newer");
  assert.deepEqual(tradeIds(result.state!), ["edited-here"]);
  assert.deepEqual(localTradeIds(), ["edited-here"]);
});

test("cloud sync: a signed-out user reads nothing", async () => {
  startClean();
  reset(); // signed out
  setCloudDocument(stateWith(5_000, "cloud-trade"));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "no-cloud-document");
  assert.equal(result.state, null);
});

test("cloud sync: resolving the conflict never writes to Firestore on its own", async () => {
  // loadStateFromCloud reads. Pushing the local copy up is the caller's call,
  // so a read must not quietly become a write.
  startClean();
  localStorage.setItem(KEY, JSON.stringify(stateWith(9_000, "edited-offline")));
  setCloudDocument(stateWith(1_000, "stale-cloud-trade"));

  await loadStateFromCloud();

  assert.equal(saved.length, 0);
});

// A snapshot written by this file must not leak into another suite's fixtures.
test("cloud sync: teardown", () => {
  reset();
  clearSnapshots(UID);
  localStorage.clear();
  assert.equal(loadSnapshots(UID).length, 0);
});
