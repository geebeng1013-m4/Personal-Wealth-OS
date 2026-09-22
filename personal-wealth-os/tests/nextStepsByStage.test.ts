import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { WealthState } from "../src/models";
import { emptyState } from "../src/state";
import { buildNextSteps } from "../src/onboarding";
import { classifyStage } from "../src/moneyStage";
import { applyOnboardingAnswers, type OnboardingAnswers } from "../src/onboardingQuiz";

const quiz = (answers: Omit<OnboardingAnswers, "answeredAt">): WealthState =>
  applyOnboardingAnswers(emptyState(), answers, { goalId: "goal-quiz", today: "2026-09-22" });
const ids = (state: WealthState) => buildNextSteps(state).steps.map((step) => step.id);
const step = (state: WealthState, id: string) => buildNextSteps(state).steps.find((item) => item.id === id);
const card = { id: "l1", name: "Card", balance: 3000, annualRate: 18, minimumPayment: 100 };

test("steps by stage: building the buffer puts moving money in it right after pay", () => {
  const state = quiz({ primaryGoal: "save", monthlyIncome: 4500, monthlySpending: 2800, cashInBank: 3000, goalName: "Japan trip", goalAmount: 6000 });
  assert.equal(classifyStage(state).id, "buffer");
  assert.deepEqual(ids(state), ["record-pay", "move-to-buffer", "log-spending"]);
});

test("steps by stage: overspending looks for a cost to cut, and that never holds the card open", () => {
  const state = quiz({ primaryGoal: "buffer", monthlyIncome: 2000, monthlySpending: 2500, cashInBank: 500 });
  assert.equal(classifyStage(state).basis, "overspending");
  assert.deepEqual(ids(state).slice(0, 3), ["record-pay", "log-spending", "cut-cost"]);
  assert.equal(step(state, "cut-cost")?.optional, true);
});

test("steps by stage: a base with nothing measured keeps the plain order and no cost-cutting step", () => {
  const state = quiz({ primaryGoal: "save" });
  assert.equal(classifyStage(state).basis, "unmeasured");
  assert.ok(!ids(state).includes("cut-cost"));
  assert.deepEqual(ids(state), ["record-pay", "balances", "safety-buffer", "log-spending", "goal"]);
});

test("steps by stage: a full buffer asks for a monthly amount to invest, done once one is set", () => {
  const state = quiz({ primaryGoal: "invest", monthlyIncome: 5000, monthlySpending: 2000, cashInBank: 9000, invests: false });
  assert.equal(classifyStage(state).id, "ready");
  assert.deepEqual(ids(state), ["record-pay", "log-spending", "invest-monthly", "investment", "goal"]);
  assert.equal(step(state, "invest-monthly")?.done, false);
  assert.equal(step({ ...state, dca: { ...state.dca, monthly: 500 } }, "invest-monthly")?.done, true);
  assert.equal(step(state, "investment")?.optional, true);
});

test("steps by stage: debt first — write it down, then pay a fixed amount", () => {
  const state = quiz({ primaryGoal: "debt", monthlyIncome: 4000, monthlySpending: 2500, cashInBank: 1000, goalName: "Card", goalAmount: 3000 });
  assert.equal(classifyStage(state).id, "debt");
  assert.deepEqual(ids(state).slice(0, 4), ["record-pay", "debt-add", "debt-pay", "log-spending"]);
  const add = step(state, "debt-add");
  assert.equal(add?.done, false);
  assert.match(add?.because ?? "", /Card is about MYR 3,000/);
  const pay = step(state, "debt-pay");
  assert.equal(pay?.action, "confirm");
  assert.ok((pay?.amount ?? 0) > 0);
  assert.equal(pay?.done, false);
});

test("steps by stage: writing the debt down ticks it; paying below what was said ticks the payment", () => {
  const state = quiz({ primaryGoal: "debt", monthlyIncome: 4000, monthlySpending: 2500, cashInBank: 1000, goalName: "Card", goalAmount: 3000 });
  const written = { ...state, liabilities: [card] };
  assert.equal(step(written, "debt-add")?.done, true);
  assert.equal(step(written, "debt-pay")?.done, false, "the full amount still owed is no payment yet");
  const paid = { ...state, liabilities: [{ ...card, balance: 2700 }] };
  assert.equal(step(paid, "debt-pay")?.done, true);
});

test("steps by stage: no monthly amount for the debt, no payment step", () => {
  // Spending above income leaves nothing for the debt each month.
  const state = quiz({ primaryGoal: "debt", monthlyIncome: 2000, monthlySpending: 2500, goalName: "Card", goalAmount: 3000 });
  assert.ok(ids(state).includes("debt-add"));
  assert.ok(!ids(state).includes("debt-pay"));
});

test("steps by stage: a cleared debt leaves the debt track and its steps", () => {
  const state = quiz({ primaryGoal: "debt", monthlyIncome: 4000, monthlySpending: 2000, cashInBank: 7000, goalName: "Card", goalAmount: 3000 });
  const cleared = { ...state, liabilities: [{ ...card, balance: 0 }] };
  assert.notEqual(classifyStage(cleared).id, "debt");
  assert.ok(!ids(cleared).includes("debt-add"));
  assert.ok(!ids(cleared).includes("debt-pay"));
});
