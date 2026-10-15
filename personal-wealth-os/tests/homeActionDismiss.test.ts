import assert from "node:assert/strict";
import { test } from "./testHarness";
import { cloneDefaultState, CURRENT_VERSION, emptyState, migrateState } from "../src/state";

test("home action: new and legacy accounts start with the card visible", () => {
  assert.equal(emptyState().homeActionDismissed, false);
  assert.equal(cloneDefaultState().homeActionDismissed, false);
  const legacy = { ...emptyState(), version: 32 };
  const { homeActionDismissed: _dismissed, ...withoutFlag } = legacy;
  const migrated = migrateState(withoutFlag);
  assert.equal(migrated.homeActionDismissed, false);
  assert.equal(migrated.version, CURRENT_VERSION);
  assert.deepEqual(migrated.ledgerAccounts, legacy.ledgerAccounts);
});

test("home action: dismissal survives JSON reload without completing onboarding", () => {
  const state = { ...emptyState(), homeActionDismissed: true };
  const reloaded = migrateState(JSON.parse(JSON.stringify(state)));
  assert.equal(reloaded.homeActionDismissed, true);
  assert.equal(reloaded.onboardingDone, false);
  assert.deepEqual(reloaded.ledgerTransactions, state.ledgerTransactions);
  assert.equal(emptyState().homeActionDismissed, false, "another account retains its own default");
});

test("home action: imported dismissal accepts only a boolean true", () => {
  for (const value of ["true", 1, null, {}, false]) {
    assert.equal(migrateState({ ...emptyState(), homeActionDismissed: value } as unknown as Parameters<typeof migrateState>[0]).homeActionDismissed, false);
  }
});
