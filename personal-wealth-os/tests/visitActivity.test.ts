import assert from "node:assert/strict";
import { test } from "./testHarness";
import { CURRENT_VERSION, emptyState, loadState, migrateState, saveState } from "../src/state";
import { dismissReturnReminder, EMPTY_VISIT_ACTIVITY, normalizeVisitActivity, recordVisitActivity, returningVisitDays } from "../src/visitActivity";

const day = (date: string) => new Date(`${date}T12:00:00`);
const visited = (on: string) => recordVisitActivity(emptyState(), day(on));

test("visits: legacy accounts retain their finances and start without a reminder", () => {
  const { visitActivity: _activity, ...legacy } = { ...emptyState(), version: 33 };
  const state = migrateState(legacy);
  assert.equal(state.version, CURRENT_VERSION);
  assert.deepEqual(state.visitActivity, EMPTY_VISIT_ACTIVITY);
  assert.deepEqual(state.ledgerAccounts, legacy.ledgerAccounts);
  assert.equal(returningVisitDays(state, day("2026-10-15")), null);
});

test("visits: first use records today without inventing an absence", () => {
  const original = emptyState();
  const state = recordVisitActivity(original, day("2026-10-15"));
  assert.equal(state.visitActivity.lastActiveOn, "2026-10-15");
  assert.equal(original.visitActivity.lastActiveOn, "");
  assert.equal(returningVisitDays(state, day("2026-10-15")), null);
  assert.strictEqual(state.ledgerTransactions, original.ledgerTransactions);
});

test("visits: repeated visits today do not trigger another save", () => {
  const state = visited("2026-10-15");
  assert.strictEqual(recordVisitActivity(state, new Date(2026, 9, 15, 23, 59)), state);
});

test("visits: the next calendar day updates once without a reminder", () => {
  const state = recordVisitActivity(visited("2026-10-15"), day("2026-10-16"));
  assert.equal(state.visitActivity.lastActiveOn, "2026-10-16");
  assert.equal(returningVisitDays(state, day("2026-10-16")), null);
});

test("visits: exactly seven days stays quiet, eight days shows the gap", () => {
  const initial = visited("2026-10-01");
  assert.equal(returningVisitDays(recordVisitActivity(initial, day("2026-10-08")), day("2026-10-08")), null);
  const returning = recordVisitActivity(initial, day("2026-10-09"));
  assert.equal(returningVisitDays(returning, day("2026-10-09")), 8);
  assert.equal(returning.visitActivity.previousActiveOn, "2026-10-01");
});

test("visits: month and year boundaries use calendar days", () => {
  for (const [from, to, expected] of [["2026-09-28", "2026-10-07", 9], ["2025-12-29", "2026-01-09", 11], ["2024-02-25", "2024-03-05", 9]] as const) {
    assert.equal(returningVisitDays(recordVisitActivity(visited(from), day(to)), day(to)), expected);
  }
});

test("visits: dismissal survives reload and never reopens the hidden daily action card", () => {
  const initial = { ...visited("2026-10-01"), homeActionDismissed: true };
  const returned = recordVisitActivity(initial, day("2026-10-15"));
  const dismissed = dismissReturnReminder(returned, day("2026-10-15"));
  const reloaded = migrateState(JSON.parse(JSON.stringify(dismissed)));
  assert.equal(returningVisitDays(reloaded, day("2026-10-15")), null);
  assert.equal(returningVisitDays(recordVisitActivity(reloaded, day("2026-10-16")), day("2026-10-16")), null);
  assert.equal(reloaded.homeActionDismissed, true);
  assert.equal(returningVisitDays(returned, day("2026-10-15")), 14, "dismissal did not mutate the previous state");
});

test("visits: a later long absence gets a fresh reminder", () => {
  const dismissed = dismissReturnReminder(recordVisitActivity(visited("2026-10-01"), day("2026-10-15")), day("2026-10-15"));
  assert.equal(returningVisitDays(recordVisitActivity(dismissed, day("2026-10-24")), day("2026-10-24")), 9);
});

test("visits: invalid imported dates are normalized without touching other state", () => {
  for (const lastActiveOn of ["2026-02-30", "not-a-date", 42, null, "2026-13-01"]) {
    assert.equal(normalizeVisitActivity({ lastActiveOn }).lastActiveOn, "");
  }
  const state = visited("2026-10-15");
  assert.strictEqual(recordVisitActivity(state, new Date("invalid")), state);
  assert.strictEqual(recordVisitActivity(state, day("2026-10-14")), state);
  assert.deepEqual(normalizeVisitActivity(null), EMPTY_VISIT_ACTIVITY);
});

test("visits: refreshed pending reminders keep the original absence length", () => {
  const returned = recordVisitActivity(visited("2026-10-01"), day("2026-10-15"));
  const reloaded = migrateState(JSON.parse(JSON.stringify(returned)));
  assert.equal(returningVisitDays(reloaded, day("2026-10-15")), 14);
  const tomorrow = recordVisitActivity(reloaded, day("2026-10-16"));
  assert.equal(returningVisitDays(tomorrow, day("2026-10-16")), 14);
});

test("visits: persisted history stays isolated by account", () => {
  const returning = recordVisitActivity(visited("2026-10-01"), day("2026-10-15"));
  saveState(returning, "visit-test-a");
  saveState(visited("2026-10-15"), "visit-test-b");
  assert.equal(returningVisitDays(loadState("visit-test-a"), day("2026-10-15")), 14);
  assert.equal(returningVisitDays(loadState("visit-test-b"), day("2026-10-15")), null);
  localStorage.removeItem("personal-wealth-os-state-visit-test-a");
  localStorage.removeItem("personal-wealth-os-state-visit-test-b");
});
