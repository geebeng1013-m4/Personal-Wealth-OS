import assert from "node:assert/strict";
import { test } from "./testHarness";
import { validateGoalCompletion } from "../src/goalCompletion";
import { getGoalsSnapshot } from "../src/goalSummary";
import { migrateState } from "../src/state";
import { syncGoalContributionRules } from "../src/financialRules";

test("goal completion: records the user's amount and past date", () => {
  assert.deepEqual(validateGoalCompletion("3900.50", "2026-10-05", "2026-10-08"), {
    ok: true, values: { spentAt: "2026-10-05", spentAmount: 3900.5 },
  });
});

test("goal completion: empty, non-finite, negative, zero and sub-cent amounts are rejected", () => {
  for (const input of ["", " ", "NaN", "Infinity", "-900", "0", "1.001", "1e3", "9007199254740992"]) {
    assert.equal(validateGoalCompletion(input, "2026-10-05", "2026-10-08").ok, false, input);
  }
});

test("goal completion: rejects future, missing and impossible calendar dates", () => {
  for (const day of ["", "yesterday", "2026-02-30", "2026-02-29", "2026-13-01", "2026-10-09"]) {
    assert.equal(validateGoalCompletion("3900", day, "2026-10-08").ok, false, day);
  }
  assert.equal(validateGoalCompletion("3900", "2024-02-29", "2026-10-08").ok, true);
});

test("goal completion: buying first can be recorded without changing the remaining wallet balance", () => {
  const state = migrateState({
    deviceId: "completion-test",
    goals: [{ id: "laptop", name: "Laptop", label: "Gaming laptop", current: 0, target: 3900, monthlyContribution: 100, note: "", accountId: "wallet" }],
    ledgerAccounts: [{ id: "wallet", name: "MAE wallet", type: "wallet", openingBalance: 3928 }],
    ledgerCategories: [{ id: "purchase-category", label: "Purchase", icon: "", type: "expense" }],
    ledgerTransactions: [{ id: "purchase", date: "2026-10-05", type: "expense", categoryId: "purchase-category", accountId: "wallet", amount: 3900 }],
  });
  const original = JSON.stringify(state);
  const before = getGoalsSnapshot(state).goals[0];
  assert.equal(before.currentAmount, 28);
  assert.equal(before.isComplete, false);
  const parsed = validateGoalCompletion("3900", "2026-10-05", "2026-10-08");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error(parsed.error);
  const next = { ...state, goals: [{ ...state.goals[0], ...parsed.values }] };
  const completed = getGoalsSnapshot(next).goals[0];
  assert.equal(completed.currentAmount, 3900);
  assert.equal(completed.heldAmount, 28);
  assert.equal(completed.isComplete, true);
  assert.equal(completed.monthlyContribution, 0);
  assert.deepEqual(next.ledgerAccounts, state.ledgerAccounts);
  assert.deepEqual(next.ledgerTransactions, state.ledgerTransactions);
  assert.equal(JSON.stringify(state), original, "the original records are untouched");
  const reloaded = migrateState(JSON.parse(JSON.stringify(next)));
  assert.equal(getGoalsSnapshot(reloaded).goals[0].isSpent, true);
  assert.equal(reloaded.goals[0].spentAt, "2026-10-05");
  assert.equal(syncGoalContributionRules(next).some((rule) => rule.kind === "goal-contribution" && rule.goalId === "laptop"), false);
  const { spentAt: _day, spentAmount: _amount, ...undone } = next.goals[0];
  assert.equal(getGoalsSnapshot({ ...next, goals: [undone] }).goals[0].currentAmount, 28);
  assert.equal(getGoalsSnapshot({ ...next, goals: [undone] }).goals[0].isComplete, false);
});

test("goal completion: an emergency fund stays live after use unless explicitly marked done", () => {
  const state = migrateState({
    deviceId: "reserve-test",
    goals: [{ id: "emergency", name: "Emergency", label: "Emergency Fund", current: 4000, target: 4000, monthlyContribution: 100, note: "", accountId: "bank" }],
    ledgerAccounts: [{ id: "bank", name: "Savings", type: "bank", openingBalance: 4000 }],
    ledgerCategories: [{ id: "expense-category", label: "Expense", icon: "", type: "expense" }],
    ledgerTransactions: [{ id: "expense", date: "2026-10-05", type: "expense", categoryId: "expense-category", accountId: "bank", amount: 900 }],
  });
  const snapshot = getGoalsSnapshot(state).goals[0];
  assert.equal(snapshot.currentAmount, 3100);
  assert.equal(snapshot.progress, 0.775);
  assert.equal(snapshot.isSpent, false);
  assert.equal(snapshot.isComplete, false);
});
