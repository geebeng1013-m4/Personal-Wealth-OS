import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  saveSnapshot,
  loadSnapshots,
  clearSnapshots,
  loadStateFromCloud,
  migrateState,
  CURRENT_VERSION,
} from "../src/state";
import type { Snapshot } from "../src/state";
import type { WealthState } from "../src/models";
import { reset, signIn, setCloudDocument, saved } from "test:firebase-stub";

const UID = "snapshot-budget-test-user";
const MAX_SNAPSHOTS_BYTES = 2 * 1024 * 1024;

/**
 * A state carrying one identifiable trade, padded with `junkBytes` of ASCII
 * text in ruleNotes so its serialised size is predictable and cheap to
 * construct — no need to model thousands of realistic ledger transactions to
 * exercise the byte-budget trim.
 */
function bigState(tradeId: string, junkBytes: number): WealthState {
  const base = migrateState({
    version: CURRENT_VERSION,
    deviceId: "test-device",
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
  return { ...base, ruleNotes: "x".repeat(junkBytes) };
}

function tradeIdsOf(snapshot: Snapshot): string[] {
  return snapshot.state.trades.map((trade) => trade.id);
}

function startClean(): void {
  reset();
  localStorage.clear();
  clearSnapshots(UID);
}

const SNAPSHOTS_KEY_FOR_UID = `personal-wealth-os-snapshots-${UID}`;

/**
 * A snapshot with an explicit timestamp, for seeding localStorage directly.
 *
 * saveSnapshot collapses a new save into the existing newest one when they
 * land within 1 second of each other — real saves are always further apart
 * than that, but calling saveSnapshot several times in a tight test loop
 * lands well inside that window and silently collapses down to one entry,
 * which would make these tests pass without ever exercising the byte-budget
 * trim they exist to check. Seeding pre-spaced snapshots directly, then
 * making exactly one real saveSnapshot call, sidesteps that unrelated
 * mechanism entirely.
 */
function makeSnapshot(tradeId: string, timestamp: number, junkBytes: number): Snapshot {
  return { id: `snap-${tradeId}`, timestamp, label: `label-${tradeId}`, state: bigState(tradeId, junkBytes) };
}

function seedSnapshots(snapshots: Snapshot[]): void {
  localStorage.setItem(SNAPSHOTS_KEY_FOR_UID, JSON.stringify(snapshots));
}

test("saveSnapshot: the oldest snapshots are evicted once the combined size exceeds the byte budget", () => {
  startClean();
  // Three pre-existing ~600KB snapshots already total ~1.8MB. Saving a
  // fourth of similar size pushes the combined total over the 2MB budget,
  // and the oldest ("first-out") should be the one dropped to make room.
  seedSnapshots([
    makeSnapshot("third", 3_000, 600_000),
    makeSnapshot("second", 2_000, 600_000),
    makeSnapshot("first-out", 1_000, 600_000),
  ]);
  saveSnapshot(bigState("fourth", 600_000), "four", UID);

  const snapshots = loadSnapshots(UID);
  assert.ok(!snapshots.some((s) => tradeIdsOf(s).includes("first-out")), "the oldest, over-budget snapshot should have been evicted");
  assert.ok(snapshots.some((s) => tradeIdsOf(s).includes("fourth")), "the newest snapshot must survive");

  const storedSize = new TextEncoder().encode(JSON.stringify(snapshots)).length;
  assert.ok(storedSize <= MAX_SNAPSHOTS_BYTES, `stored payload (${storedSize} bytes) should respect the byte budget`);
});

test("saveSnapshot: a single snapshot larger than the byte budget on its own is still kept", () => {
  startClean();
  // 3MB alone, already over the 2MB budget — trimming must stop at one.
  saveSnapshot(bigState("only-one", 3_000_000), "huge", UID);

  const snapshots = loadSnapshots(UID);
  assert.equal(snapshots.length, 1, "an oversized state is still worth one restore point");
  assert.deepEqual(tradeIdsOf(snapshots[0]), ["only-one"]);
});

test("saveSnapshot: small snapshots well under budget are not evicted early", () => {
  startClean();
  seedSnapshots([
    makeSnapshot("d", 4_000, 100),
    makeSnapshot("c", 3_000, 100),
    makeSnapshot("b", 2_000, 100),
    makeSnapshot("a", 1_000, 100),
  ]);
  saveSnapshot(bigState("e", 100), "save e", UID);
  assert.equal(loadSnapshots(UID).length, 5, "five small snapshots are nowhere near the byte budget");
});

test("saveSnapshot: a localStorage write failure is swallowed, not thrown", () => {
  startClean();
  const original = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error("QuotaExceededError (simulated)");
  };
  try {
    assert.doesNotThrow(() => saveSnapshot(bigState("whatever", 100), "label", UID));
  } finally {
    localStorage.setItem = original;
  }
  // The failed write must not leave a corrupt or partial entry behind.
  assert.deepEqual(loadSnapshots(UID), []);
});

test("cloud sync integration: a snapshot write failure never blocks the cloud state from being cached locally", async () => {
  // This is the regression loadStateFromCloud was exposed to before this
  // fix: saveSnapshot's own localStorage.setItem had no try/catch, so a
  // quota failure while snapshotting the outgoing local copy would throw
  // straight through loadStateFromCloud and skip the line that actually
  // persists the cloud document — losing data that had already been
  // fetched successfully, over a failure that had nothing to do with it.
  reset();
  localStorage.clear();
  clearSnapshots(UID);
  signIn(UID);

  const localState = migrateState({
    version: CURRENT_VERSION,
    deviceId: "test-device",
    updatedAt: 1_000,
    trades: [{ id: "stale-local", date: "2026-08-01", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23.5, priceUsd: 620, units: 0.0379, feeMyr: 1.2 }],
  } as Partial<WealthState>);
  localStorage.setItem(`personal-wealth-os-state-${UID}`, JSON.stringify(localState));

  const cloudState = migrateState({
    version: CURRENT_VERSION,
    deviceId: "test-device",
    updatedAt: 5_000,
    trades: [{ id: "fresh-cloud", date: "2026-08-01", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23.5, priceUsd: 620, units: 0.0379, feeMyr: 1.2 }],
  } as Partial<WealthState>);
  setCloudDocument(cloudState);

  const original = localStorage.setItem;
  localStorage.setItem = (key: string, value: string) => {
    if (key.startsWith("personal-wealth-os-snapshots")) {
      throw new Error("QuotaExceededError (simulated)");
    }
    return original.call(localStorage, key, value);
  };

  try {
    const outcome = await loadStateFromCloud();
    assert.equal(outcome.outcome, "cloud-applied");
    assert.deepEqual(outcome.state!.trades.map((t) => t.id), ["fresh-cloud"]);

    const persisted = localStorage.getItem(`personal-wealth-os-state-${UID}`);
    assert.ok(persisted, "the cloud document must still have been cached locally");
    assert.deepEqual((JSON.parse(persisted!) as WealthState).trades.map((t) => t.id), ["fresh-cloud"]);
  } finally {
    localStorage.setItem = original;
  }
});

test("saveSnapshot budget: teardown", () => {
  reset();
  clearSnapshots(UID);
  localStorage.clear();
  assert.equal(loadSnapshots(UID).length, 0);
  assert.equal(saved.length, 0);
});
