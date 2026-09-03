import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  cloudCopyWins,
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
function stateWith(updatedAt: number, tradeId: string): WealthState {
  return migrateState({
    version: CURRENT_VERSION,
    deviceId: "test-device",
    updatedAt,
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

test("cloudCopyWins: a newer cloud copy replaces the local one", () => {
  assert.equal(cloudCopyWins(1_000, 2_000), true);
});

test("cloudCopyWins: a newer local copy is kept", () => {
  assert.equal(cloudCopyWins(2_000, 1_000), false);
});

test("cloudCopyWins: equal timestamps are the same save, so the cloud is taken", () => {
  assert.equal(cloudCopyWins(1_000, 1_000), true);
});

test("cloudCopyWins: two untimestamped copies fall back to the cloud", () => {
  // Legacy states carry updatedAt 0. Preferring the cloud keeps the old
  // behaviour for data that predates the timestamp.
  assert.equal(cloudCopyWins(0, 0), true);
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
