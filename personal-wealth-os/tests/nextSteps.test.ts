import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { WealthState } from "../src/models";
import { emptyState } from "../src/state";
import { buildNextSteps } from "../src/onboarding";
import { applyOnboardingAnswers, skipOnboardingQuiz, type OnboardingAnswers } from "../src/onboardingQuiz";

const ANSWERS: Omit<OnboardingAnswers, "answeredAt"> = {
  primaryGoal: "save",
  monthlyIncome: 4500,
  monthlySpending: 2800,
  cashInBank: 3000,
  invests: false,
  goalName: "Japan trip",
  goalAmount: 6000,
};
const answered = (answers = ANSWERS) => applyOnboardingAnswers(emptyState(), answers, { goalId: "goal-quiz", today: "2026-09-19" });

type Tx = WealthState["ledgerTransactions"][number];
const tx = (type: "income" | "expense", amount: number): Tx =>
  ({ id: `${type}-${amount}`, type, amount, date: "2026-09-19", accountId: "account-bank", categoryId: type === "income" ? "income-salary" : "food", note: "" }) as Tx;
const ids = (state: WealthState) => buildNextSteps(state).steps.map((step) => step.id);

test("nextSteps: after the quiz, only what the answers left to do — each with its reason", () => {
  const next = buildNextSteps(answered());
  assert.deepEqual(next.steps.map((step) => step.id), ["record-pay", "move-to-buffer", "log-spending"]);
  const [pay, buffer, spending] = next.steps;
  assert.equal(pay.because, "You said about MYR 4,500 comes in each month.");
  assert.equal(buffer.title, "Move MYR 850 into your safety buffer");
  assert.equal(buffer.because, "Your buffer is MYR 5,400 short of MYR 8,400.");
  assert.equal(buffer.action, "confirm");
  assert.equal(buffer.amount, 850);
  assert.match(spending.because, /MYR 2,800 a month/);
  assert.equal(next.visible, true);
  assert.equal(next.complete, false);
});

test("nextSteps: the plan strip marks figures that still rest on answers", () => {
  const plan = buildNextSteps(answered()).plan;
  assert.deepEqual(plan, {
    bufferCurrent: 3000, bufferTarget: 8400, bufferEstimate: true,
    goalName: "Japan trip", goalKind: "save", goalCurrent: 0, goalTarget: 6000, goalMonths: 12, goalEstimate: true, debtInterest: null, bufferHold: null,
  });
});

test("nextSteps: recording pay ticks its step and makes the goal date real", () => {
  const state = { ...answered(), ledgerTransactions: [tx("income", 4500)] };
  const next = buildNextSteps(state);
  assert.equal(next.steps.find((step) => step.id === "record-pay")?.done, true);
  assert.equal(next.plan?.goalEstimate, false);
});

test("nextSteps: confirming the transfer ticks the buffer step", () => {
  const before = answered();
  const state = { ...before, emergency: { ...before.emergency, current: before.emergency.current + 850 } };
  const next = buildNextSteps(state);
  assert.equal(next.steps.find((step) => step.id === "move-to-buffer")?.done, true);
  assert.equal(next.plan?.bufferEstimate, false);
});

test("nextSteps: all three done retires the card", () => {
  const before = answered();
  const state = {
    ...before,
    ledgerTransactions: [tx("income", 4500), tx("expense", 86)],
    emergency: { ...before.emergency, current: 3850 },
  };
  const next = buildNextSteps(state);
  assert.equal(next.complete, true);
  assert.equal(next.visible, false);
});

test("nextSteps: a buffer that is already full asks for no transfer", () => {
  assert.equal(ids(answered({ ...ANSWERS, cashInBank: 10000 })).includes("move-to-buffer"), false);
});

test("nextSteps: skipped questions come back as their steps", () => {
  const skipped = applyOnboardingAnswers(emptyState(), { primaryGoal: "save" }, { goalId: "g", today: "2026-09-19" });
  assert.deepEqual(ids(skipped), ["record-pay", "balances", "safety-buffer", "log-spending", "goal"]);
  assert.equal(buildNextSteps(skipped).steps[0].because, "Your plan splits each payday. It starts with one.");
  assert.deepEqual(ids(skipOnboardingQuiz(emptyState(), "2026-09-19")), ["record-pay", "balances", "safety-buffer", "log-spending", "goal"]);
});

test("nextSteps: saying you invest adds an optional trade step that never holds the card open", () => {
  const before = answered({ ...ANSWERS, invests: true });
  const investment = buildNextSteps(before).steps.find((step) => step.id === "investment");
  assert.equal(investment?.optional, true);
  assert.equal(investment?.because, "You said you already invest. One trade and your real return starts counting.");
  const state = { ...before, ledgerTransactions: [tx("income", 4500), tx("expense", 86)], emergency: { ...before.emergency, current: 3850 } };
  assert.equal(buildNextSteps(state).complete, true);
});

test("nextSteps: an account that never took the quiz gets every step with a general reason, and no plan strip", () => {
  const next = buildNextSteps(emptyState());
  assert.deepEqual(next.steps.map((step) => step.id), ["record-pay", "balances", "safety-buffer", "log-spending", "goal", "investment"]);
  assert.equal(next.plan, null);
});

test("nextSteps: hidden for good stays hidden", () => {
  assert.equal(buildNextSteps({ ...answered(), onboardingDone: true }).visible, false);
});
