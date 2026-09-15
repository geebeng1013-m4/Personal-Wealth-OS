import assert from "node:assert/strict";
import { test } from "./testHarness";
import { DEFAULT_EMERGENCY_MONTHS, suggestedEmergencyTarget } from "../src/rules";
import { emptyState } from "../src/state";
import type { WealthState } from "../src/models";

function withCashflow(cashflow: Partial<WealthState["cashflow"]>): WealthState {
  const base = emptyState();
  return { ...base, cashflow: { ...base.cashflow, ...cashflow } };
}

test("emergency suggestion: six months of essential spending by default", () => {
  assert.equal(DEFAULT_EMERGENCY_MONTHS, 6);
  const suggestion = suggestedEmergencyTarget(withCashflow({ transport: 200, food: 450, otherFixed: 100 }));
  assert.deepEqual(suggestion, { monthlyEssential: 750, months: 6, target: 4500 });
});

test("emergency suggestion: only needs count — allowance and irregular income are not spending", () => {
  const suggestion = suggestedEmergencyTarget(withCashflow({ allowance: 3000, irregularIncome: 800, food: 500 }));
  assert.equal(suggestion?.monthlyEssential, 500);
  assert.equal(suggestion?.target, 3000);
});

test("emergency suggestion: nothing entered means no suggestion rather than MYR 0", () => {
  assert.equal(suggestedEmergencyTarget(emptyState()), null);
});

test("emergency suggestion: bad values are ignored, not added", () => {
  const suggestion = suggestedEmergencyTarget(withCashflow({ food: 400, transport: -50, otherFixed: Number.NaN }));
  assert.equal(suggestion?.monthlyEssential, 400);
});

test("emergency suggestion: a different month count is honoured and rounded to whole ringgit", () => {
  const suggestion = suggestedEmergencyTarget(withCashflow({ food: 333.33 }), 3);
  assert.equal(suggestion?.target, 1000);
});

test("reset target: the blank state Reset now loads has no sample data", () => {
  const blank = emptyState();
  assert.equal(blank.goals.length, 0, "no sample goals");
  assert.equal(blank.emergency.target, 0);
  assert.equal(blank.financialGoal, "");
});
