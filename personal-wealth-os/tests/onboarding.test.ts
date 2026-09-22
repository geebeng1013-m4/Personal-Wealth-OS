import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { WealthState } from "../src/models";
import { CURRENT_VERSION, cloneDefaultState, emptyState, migrateState } from "../src/state";
import { buildOnboardingChecklist } from "../src/onboarding";

/** A brand-new account with every required step filled in. */
function setUpState(): WealthState {
  const state = emptyState();
  state.ledgerAccounts = state.ledgerAccounts.map((account, index) => index === 0 ? { ...account, openingBalance: 1200 } : account);
  state.ledgerTransactions = [{ id: "t1", date: "2026-09-01", type: "income", amount: 800, accountId: "account-bank", categoryId: "salary", note: "" } as WealthState["ledgerTransactions"][number]];
  state.goals = [{ id: "g1", name: "Laptop", target: 4000, current: 0 } as WealthState["goals"][number]];
  state.emergency = { ...state.emergency, target: 3000 };
  return state;
}

// --- the stored flag -------------------------------------------------------

test("onboarding: v25 is the schema that carries the done flag", () => {
  assert.ok(CURRENT_VERSION >= 25);
});

test("onboarding: a new or default state has not finished onboarding", () => {
  assert.equal(emptyState().onboardingDone, false);
  assert.equal(cloneDefaultState().onboardingDone, false);
});

test("onboarding: an untouched account from before v25 still gets the checklist", () => {
  const legacy = { ...structuredClone(emptyState()), version: 24 } as Partial<WealthState> & Record<string, unknown>;
  delete legacy.onboardingDone;
  const migrated = migrateState(legacy);
  assert.equal(migrated.onboardingDone, false);
  assert.equal(buildOnboardingChecklist(migrated).visible, true);
});

test("onboarding: an account from before v25 that already started arrives done", () => {
  const legacy = { ...structuredClone(emptyState()), version: 24, goals: setUpState().goals } as Partial<WealthState> & Record<string, unknown>;
  delete legacy.onboardingDone;
  assert.equal(migrateState(legacy).onboardingDone, true, "an early user must not be shown a beginner's card");
});

test("onboarding: current data is never marked done by migration alone", () => {
  const current = { ...structuredClone(emptyState()), goals: setUpState().goals };
  assert.equal(migrateState(current).onboardingDone, false, "a v25 user with one step done keeps the checklist");
});

test("onboarding: a stored done flag survives migration; anything but true reads as false", () => {
  assert.equal(migrateState({ ...emptyState(), onboardingDone: true }).onboardingDone, true);
  assert.equal(migrateState({ ...emptyState(), onboardingDone: "yes" as unknown as boolean }).onboardingDone, false);
});

// --- the checklist ---------------------------------------------------------

test("onboarding: a brand-new user sees the card with nothing ticked", () => {
  const checklist = buildOnboardingChecklist(emptyState());
  assert.equal(checklist.visible, true);
  assert.equal(checklist.complete, false);
  assert.equal(checklist.doneCount, 0);
  assert.deepEqual(checklist.steps.map((step) => step.id), ["balances", "first-entry", "goal", "safety-buffer", "investment"]);
});

test("onboarding: each step ticks from its own data only", () => {
  const cases: Array<[string, (state: WealthState) => void]> = [
    ["balances", (s) => { s.ledgerAccounts[1] = { ...s.ledgerAccounts[1], openingBalance: 50 }; }],
    ["first-entry", (s) => { s.ledgerTransactions = setUpState().ledgerTransactions; }],
    ["goal", (s) => { s.goals = setUpState().goals; }],
    ["safety-buffer", (s) => { s.emergency = { ...s.emergency, target: 1 }; }],
    ["investment", (s) => { s.trades = [{ id: "tr1" } as WealthState["trades"][number]]; }],
  ];
  for (const [id, fill] of cases) {
    const state = emptyState();
    fill(state);
    const done = buildOnboardingChecklist(state).steps.filter((step) => step.done).map((step) => step.id);
    assert.deepEqual(done, [id], `filling ${id} should tick ${id} alone`);
  }
});

test("onboarding: every step points at the page that holds its field", () => {
  const pages = Object.fromEntries(buildOnboardingChecklist(emptyState()).steps.map((step) => [step.id, step.page]));
  assert.deepEqual(pages, { balances: "ledger", "first-entry": "ledger", goal: "goals", "safety-buffer": "me", investment: "portfolio" });
});

test("onboarding: the four required steps complete it; the investment step is optional", () => {
  const checklist = buildOnboardingChecklist(setUpState());
  assert.equal(checklist.requiredCount, 4);
  assert.equal(checklist.requiredDoneCount, 4);
  assert.equal(checklist.complete, true, "a user who never invests must still be able to finish");
  assert.equal(checklist.visible, false);
  assert.equal(checklist.steps.find((step) => step.id === "investment")?.done, false);
});

test("onboarding: three of four required steps keeps the card up", () => {
  const state = setUpState();
  state.goals = [];
  const checklist = buildOnboardingChecklist(state);
  assert.equal(checklist.requiredDoneCount, 3);
  assert.equal(checklist.visible, true);
});

test("onboarding: once done for good, the card stays hidden even if the data empties again", () => {
  const state = emptyState();
  state.onboardingDone = true;
  const checklist = buildOnboardingChecklist(state);
  assert.equal(checklist.complete, false);
  assert.equal(checklist.visible, false);
});

test("onboarding: migration keeps the rest of older data intact", () => {
  const migrated = migrateState({ version: 24, deviceId: "old", ruleNotes: "keep me" });
  assert.equal(migrated.ruleNotes, "keep me");
});
