import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  saveState, reconcileCloudSnapshot, recordCloudSyncPoint, loadStateFromCloud,
  adoptRemoteState, hasUnsyncedLocalEdits, loadSnapshots,
  loadState, migrateState, clearSnapshots, STORAGE_KEY, CURRENT_VERSION,
} from "../src/state";
import type { WealthState } from "../src/models";
import { reset, signIn, setCloudDocument, saved } from "test:firebase-stub";

const UID = "two-device-user";
const KEY = `${STORAGE_KEY}-${UID}`;

function trade(id: string) {
  return { id, date: "2026-08-01", platform: "moomoo", ticker: "VOO", type: "DCA",
    amountMyr: 100, amountUsd: 23.5, priceUsd: 620, units: 0.0379, feeMyr: 1.2 };
}

function deviceState(deviceId: string): WealthState {
  return migrateState({ version: CURRENT_VERSION, deviceId,
    updatedAt: 1_000, lastSyncedAt: 1_000, trades: [] } as Partial<WealthState>);
}

/**
 * The bug this pins, end to end: a trade entered on one device never showed up
 * on the other, not even after a reload. Each unit below already passed on its
 * own — the break was in the handoff, where the app kept its pre-save state
 * object and so never matched the server's echo of its own write.
 */
test("two devices: a trade typed on the PC reaches the phone on its next load", async () => {
  reset(); localStorage.clear(); clearSnapshots(UID); signIn(UID);

  // --- PC: signed in and clean, the user types one trade --------------------
  let pc = deviceState("pc");
  localStorage.setItem(KEY, JSON.stringify(pc));

  // setState(...), as main.ts does it: adopt what saveState actually wrote.
  pc = saveState({ ...pc, trades: [trade("typed-on-pc")] } as WealthState, UID) ?? pc;

  // The server echoes that write back through onSnapshot, server-confirmed.
  const echo = saved.at(-1)!.state;
  assert.equal(
    reconcileCloudSnapshot(pc, { updatedAt: echo.updatedAt, hasPendingWrites: false, fromCache: false }),
    "record-sync-point",
    "the PC must recognise the server confirming its own write",
  );
  pc = recordCloudSyncPoint(UID, pc.updatedAt) ?? pc;
  assert.equal(pc.lastSyncedAt, pc.updatedAt, "and end the round trip clean");

  // --- Phone: its own storage, last synced before the PC's edit -------------
  setCloudDocument(echo);
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify(deviceState("phone")));

  const result = await loadStateFromCloud();

  assert.equal(result.outcome, "cloud-applied", "the phone must accept the PC's copy");
  assert.deepEqual(result.state!.trades.map((t) => t.id), ["typed-on-pc"]);
  assert.deepEqual(loadState(UID).trades.map((t) => t.id), ["typed-on-pc"], "and still hold it after a reload");

  reset(); clearSnapshots(UID); localStorage.clear();
});

test("two devices: the phone shows the PC's trade without a reload", async () => {
  reset(); localStorage.clear(); clearSnapshots(UID); signIn(UID);

  // The PC's confirmed write, as the phone's live subscription delivers it.
  let pc = deviceState("pc");
  localStorage.setItem(KEY, JSON.stringify(pc));
  pc = saveState({ ...pc, trades: [trade("typed-on-pc")] } as WealthState, UID) ?? pc;
  const echo = migrateState(saved.at(-1)!.state as Partial<WealthState>);

  // Phone: clean, so the snapshot resolves to apply-remote rather than a push.
  localStorage.clear();
  const phone = deviceState("phone");
  localStorage.setItem(KEY, JSON.stringify(phone));

  assert.equal(
    reconcileCloudSnapshot(phone, { updatedAt: echo.updatedAt, hasPendingWrites: false, fromCache: false }),
    "apply-remote",
  );

  const adopted = adoptRemoteState(UID, echo);

  assert.deepEqual(adopted.trades.map((t) => t.id), ["typed-on-pc"], "on screen straight away");
  assert.deepEqual(loadState(UID).trades.map((t) => t.id), ["typed-on-pc"], "and in storage, so a reload agrees");
  assert.equal(hasUnsyncedLocalEdits(adopted), false, "adopting leaves the phone clean, not dirty");
  assert.equal(saved.length, 1, "adopting must not write back to Firestore — that would loop");
  assert.equal(loadSnapshots(UID).length, 0, "a clean device had nothing to lose, so no snapshot slot is burnt");

  reset(); clearSnapshots(UID); localStorage.clear();
});

test("two devices: an edit made on a stale screen lands on top of the remote copy", async () => {
  // The screen can lag behind `state` while the user is typing. What they save
  // must still be added to the remote copy, not to the one they can see.
  reset(); localStorage.clear(); clearSnapshots(UID); signIn(UID);

  localStorage.setItem(KEY, JSON.stringify(deviceState("phone")));
  const fromPc = migrateState({ version: CURRENT_VERSION, deviceId: "pc",
    updatedAt: 2_000, lastSyncedAt: 2_000, trades: [trade("typed-on-pc")] } as Partial<WealthState>);

  let phone = adoptRemoteState(UID, fromPc);
  // The user, still looking at the old screen, saves their own transaction.
  phone = saveState({ ...phone, trades: [...phone.trades, trade("typed-on-phone")] } as WealthState, UID) ?? phone;

  assert.deepEqual(phone.trades.map((t) => t.id), ["typed-on-pc", "typed-on-phone"], "both survive");
  assert.deepEqual(saved.at(-1)!.state.trades.map((t: { id: string }) => t.id), ["typed-on-pc", "typed-on-phone"]);

  reset(); clearSnapshots(UID); localStorage.clear();
});
