import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  saveSnapshot,
  loadSnapshots,
  clearSnapshots,
  loadStateFromCloud,
  migrateState,
  trimToByteBudget,
  CURRENT_VERSION,
} from "../src/state";
import type { Snapshot } from "../src/state";
import type { WealthState } from "../src/models";
import { reset, signIn, setCloudDocument, saved } from "test:firebase-stub";

const UID = "snapshot-budget-test-user";

/**
 * A state carrying one identifiable trade, optionally padded in ruleNotes so
 * its serialised size is predictable.
 *
 * The padding stays small on purpose. The byte-budget policy is exercised by
 * handing trimToByteBudget a small budget rather than by allocating enough
 * data to cross the real 2MB one — a test that needs megabytes to prove a
 * size rule is slow, memory-hungry and environment-sensitive for no gain.
 */
function stateWith(tradeId: string, junkBytes = 0): WealthState {
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
  return junkBytes > 0 ? { ...base, ruleNotes: "x".repeat(junkBytes) } : base;
}

function tradeIdsOf(snapshot: Snapshot): string[] {
  return snapshot.state.trades.map((trade) => trade.id);
}

function makeSnapshot(tradeId: string, timestamp: number, junkBytes = 0): Snapshot {
  return { id: `snap-${tradeId}`, timestamp, label: `label-${tradeId}`, state: stateWith(tradeId, junkBytes) };
}

function byteSize(snapshots: Snapshot[]): number {
  return new TextEncoder().encode(JSON.stringify(snapshots)).length;
}

function startClean(): void {
  reset();
  localStorage.clear();
  clearSnapshots(UID);
}

// --- the eviction policy, exercised against a small injected budget --------

test("trimToByteBudget: drops the oldest snapshots until the list fits the budget", () => {
  // Newest-first, as saveSnapshot keeps them.
  const snapshots = [
    makeSnapshot("newest", 4_000),
    makeSnapshot("middle", 3_000),
    makeSnapshot("older", 2_000),
    makeSnapshot("oldest", 1_000),
  ];
  // Self-calibrating: a budget that exactly fits the first two, whatever a
  // WealthState happens to serialise to. Hard-coding a byte figure here would
  // only encode today's default-state size and break the day it changes.
  const budget = byteSize(snapshots.slice(0, 2));

  const trimmed = trimToByteBudget(snapshots, budget);

  assert.equal(trimmed.length, 2, "the two that fit are kept, the two that do not are dropped");
  assert.deepEqual(trimmed.map(tradeIdsOf).flat(), ["newest", "middle"], "eviction takes from the oldest end");
  assert.ok(byteSize(trimmed) <= budget, "result must fit the budget");
});

test("trimToByteBudget: a single snapshot over budget on its own is still kept", () => {
  const snapshots = [makeSnapshot("only-one", 1_000, 8_000)];
  const trimmed = trimToByteBudget(snapshots, 5_000);
  assert.equal(trimmed.length, 1, "an oversized state is still worth one restore point");
  assert.deepEqual(tradeIdsOf(trimmed[0]), ["only-one"]);
});

test("trimToByteBudget: a list already under budget is returned untouched", () => {
  const snapshots = [
    makeSnapshot("c", 3_000),
    makeSnapshot("b", 2_000),
    makeSnapshot("a", 1_000),
  ];
  const trimmed = trimToByteBudget(snapshots, 2 * 1024 * 1024);
  assert.equal(trimmed.length, 3);
  assert.deepEqual(trimmed.map(tradeIdsOf).flat(), ["c", "b", "a"]);
});

test("trimToByteBudget: never returns an empty list, even with an impossible budget", () => {
  const snapshots = [makeSnapshot("b", 2_000), makeSnapshot("a", 1_000)];
  assert.equal(trimToByteBudget(snapshots, 1).length, 1);
});

// --- saveSnapshot wiring and failure handling ------------------------------

test("saveSnapshot: ordinary saves are kept, not evicted by the real budget", () => {
  startClean();
  // Seeded with explicit timestamps: saveSnapshot collapses saves landing
  // within 1 second of each other, so a tight loop of real calls would
  // silently collapse to one entry and prove nothing.
  localStorage.setItem(`personal-wealth-os-snapshots-${UID}`, JSON.stringify([
    makeSnapshot("d", 4_000),
    makeSnapshot("c", 3_000),
    makeSnapshot("b", 2_000),
    makeSnapshot("a", 1_000),
  ]));

  saveSnapshot(stateWith("e"), "save e", UID);

  assert.equal(loadSnapshots(UID).length, 5, "five ordinary snapshots are nowhere near the 2MB budget");
});

test("saveSnapshot: a localStorage write failure is swallowed, not thrown", () => {
  startClean();
  const original = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error("QuotaExceededError (simulated)");
  };
  try {
    assert.doesNotThrow(() => saveSnapshot(stateWith("whatever"), "label", UID));
  } finally {
    localStorage.setItem = original;
  }
  assert.deepEqual(loadSnapshots(UID), [], "a failed write must not leave a partial entry behind");
});

test("cloud sync integration: a snapshot write failure never blocks the cloud state from being cached locally", async () => {
  // The regression loadStateFromCloud was exposed to: saveSnapshot's own
  // localStorage.setItem had no try/catch, so a quota failure while
  // snapshotting the outgoing local copy would throw straight through and
  // skip the very next line — the one that persists a cloud document that
  // had already been fetched successfully.
  startClean();
  signIn(UID);

  const stale = migrateState({ version: CURRENT_VERSION, deviceId: "test-device", updatedAt: 1_000, trades: [{ id: "stale-local", date: "2026-08-01", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23.5, priceUsd: 620, units: 0.0379, feeMyr: 1.2 }] } as Partial<WealthState>);
  localStorage.setItem(`personal-wealth-os-state-${UID}`, JSON.stringify(stale));

  setCloudDocument(migrateState({ version: CURRENT_VERSION, deviceId: "test-device", updatedAt: 5_000, trades: [{ id: "fresh-cloud", date: "2026-08-01", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23.5, priceUsd: 620, units: 0.0379, feeMyr: 1.2 }] } as Partial<WealthState>));

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
