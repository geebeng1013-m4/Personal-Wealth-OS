import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  saveState,
  loadSnapshots,
  restoreSnapshot,
  clearSnapshots,
  migrateState,
  cloneDefaultState,
  STORAGE_KEY,
  CURRENT_VERSION,
} from "../src/state";
import type { WealthState } from "../src/models";
// saveState's uid parameter drives the snapshot logic directly; none of these
// tests need a signed-in firebase user, so the stub only needs resetting.
import { reset } from "test:firebase-stub";

const UID = "save-state-test-user";
const KEY = `${STORAGE_KEY}-${UID}`;

function stateWith(tradeId: string): WealthState {
  return migrateState({
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
}

// --- the mechanism the Reset button's fix depends on ------------------------

test("saveState: a changeLabel snapshots the previous state before overwriting", () => {
  startClean();
  saveState(stateWith("original-trade"), UID);
  saveState(stateWith("replacement-trade"), UID, "Before reset");

  assert.deepEqual(localTradeIds(), ["replacement-trade"], "the new state should be what's persisted");

  const snapshots = loadSnapshots(UID);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].label, "Before reset");
  assert.deepEqual(tradeIds(snapshots[0].state), ["original-trade"], "the OLD state should be what's recoverable");
});

test("saveState: no changeLabel means no snapshot, even though a previous copy exists", () => {
  startClean();
  saveState(stateWith("original-trade"), UID);
  saveState(stateWith("replacement-trade"), UID);

  assert.deepEqual(localTradeIds(), ["replacement-trade"]);
  assert.equal(loadSnapshots(UID).length, 0);
});

test("saveState: a changeLabel on the very first save has nothing to snapshot", () => {
  startClean();
  saveState(stateWith("first-ever-trade"), UID, "Before reset");

  assert.deepEqual(localTradeIds(), ["first-ever-trade"]);
  assert.equal(loadSnapshots(UID).length, 0, "there was no previous state to lose");
});

test("saveState: without a uid nothing is written, snapshot included", () => {
  startClean();
  saveState(stateWith("should-not-persist"), undefined, "Before reset");

  assert.equal(localStorage.getItem(KEY), null);
  assert.equal(loadSnapshots(UID).length, 0);
});

// --- the actual Reset scenario, end to end ----------------------------------

test("saveState: resetting to a blank state is recoverable from the snapshot it took", () => {
  startClean();
  saveState(stateWith("about-to-be-reset"), UID);

  const blank = cloneDefaultState();
  saveState(blank, UID, "Before reset");

  // The app now shows the blank state...
  assert.deepEqual(localTradeIds(), tradeIds(blank));

  // ...but the pre-reset data is one restore away.
  const [snapshot] = loadSnapshots(UID);
  const restored = restoreSnapshot(snapshot.id, UID);
  assert.deepEqual(tradeIds(restored!), ["about-to-be-reset"]);
});

test("saveState: teardown", () => {
  reset();
  clearSnapshots(UID);
  localStorage.clear();
  assert.equal(loadSnapshots(UID).length, 0);
});
