import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { WealthState } from "../src/models";
import { emptyState } from "../src/state";
import { buildNextSteps, debtPaymentThisMonth } from "../src/onboarding";
import { classifyStage } from "../src/moneyStage";
import { applyOnboardingAnswers, buildOnboardingPlan, type OnboardingAnswers } from "../src/onboardingQuiz";
import { monthsToClear } from "../src/debtPriority";

const quiz = (answers: Omit<OnboardingAnswers, "answeredAt">): WealthState =>
  applyOnboardingAnswers(emptyState(), answers, { goalId: "goal-quiz", today: "2026-09-22" });
const step = (state: WealthState, id: string) => buildNextSteps(state).steps.find((item) => item.id === id);
/** RM1,500 left over each month, a month's spending RM2,500, an 18% card of RM3,000. */
const CARD: Omit<OnboardingAnswers, "answeredAt"> = {
  primaryGoal: "debt", monthlyIncome: 4000, monthlySpending: 2500, cashInBank: 1000,
  goalName: "Credit card", goalAmount: 3000, debtKind: "credit-card", debtRate: 0.18, debtPaidInFull: false,
};
const withSaved = (state: WealthState, current: number): WealthState => ({ ...state, emergency: { ...state.emergency, current } });

test("months to clear: interest counted; never when the payment only covers interest", () => {
  assert.equal(monthsToClear(3000, 0, 750), 4);
  assert.equal(monthsToClear(3000, 0.18, 750), 5);
  assert.equal(monthsToClear(3000, 0.18, 45), null, "45 a month is exactly the interest");
  assert.equal(monthsToClear(0, 0.18, 100), 0);
  assert.equal(monthsToClear(3000, 0.18, 0), null);
});

test("L-3 steps: setting a month's spending aside comes before paying the debt down", () => {
  const state = quiz(CARD);
  const aside = step(state, "move-to-buffer");
  assert.equal(aside?.title, "Keep MYR 2,500 aside for emergencies");
  assert.match(aside?.because ?? "", /MYR 1,500 to go/);
  assert.equal(aside?.done, false);
  // Once it is there, the step is ticked and the buffer waits.
  assert.equal(step(withSaved(state, 2500), "move-to-buffer")?.done, true);
});

test("L-3 steps: the highest rate first, with this month's amount and its interest", () => {
  const state = quiz(CARD);
  const pay = step(state, "debt-pay");
  assert.equal(pay?.title, "Highest rate first: Credit card 18%");
  assert.equal(pay?.amount, 750, "half of the 1,500 while setting the month aside");
  assert.equal(pay?.because, "Pay MYR 750 this month, on top of the minimum. It costs about MYR 45 in interest a month.");
  assert.equal(step(withSaved(state, 2500), "debt-pay")?.amount, 1500, "then all of it");
});

test("L-3 steps: with several debts the step names the dearest one", () => {
  const state = quiz(CARD);
  const both = { ...state, liabilities: [...state.liabilities, { id: "pl", name: "Personal loan", balance: 8000, annualRate: 0.11, minimumPayment: 200 }] };
  assert.equal(step(both, "debt-pay")?.title, "Highest rate first: Credit card 18%");
  const loanFirst = { ...both, liabilities: both.liabilities.map((item) => item.id === "pl" ? { ...item, annualRate: 0.2 } : item) };
  assert.equal(step(loanFirst, "debt-pay")?.title, "Highest rate first: Personal loan 20%");
});

test("L-3 payment: never more than the debt still owed, 0 off the debt track", () => {
  const state = withSaved(quiz(CARD), 2500);
  const nearlyDone = { ...state, liabilities: [{ ...state.liabilities[0], balance: 400 }] };
  assert.equal(debtPaymentThisMonth(nearlyDone), 400);
  assert.equal(debtPaymentThisMonth(quiz({ ...CARD, primaryGoal: "save" })), 0);
});

test("L-3 AKPK: flagged when spending is at or above income on the debt track", () => {
  const tight = quiz({ ...CARD, monthlyIncome: 2500, monthlySpending: 2500 });
  assert.equal(classifyStage(tight).debt?.tight, true);
  assert.equal(step(tight, "debt-pay"), undefined, "nothing left over to pay with");
  assert.equal(classifyStage(quiz(CARD)).debt?.tight, false);
});

test("L-3 plan card: cleared date with interest, and the interest a month", () => {
  const plan = buildNextSteps(quiz(CARD)).plan;
  assert.equal(plan?.goalKind, "debt");
  assert.equal(plan?.goalMonths, monthsToClear(3000, 0.18, 750));
  assert.equal(plan?.debtInterest, 45);
  assert.equal(plan?.bufferHold, 2500, "the buffer fills to a month's spending for now");
  // A card cleared every month costs nothing.
  const paidInFull = buildNextSteps(quiz({ ...CARD, debtPaidInFull: true })).plan;
  assert.equal(paidInFull?.debtInterest, 0);
});

test("L-3 plan card: a cheap loan is cleared on its own schedule", () => {
  const ptptn = quiz({ ...CARD, goalName: "PTPTN", goalAmount: 12000, debtKind: "ptptn", debtRate: 0.01, debtMonthsLeft: 120, debtPaidInFull: undefined });
  assert.notEqual(classifyStage(ptptn).id, "debt");
  const plan = buildNextSteps(ptptn).plan;
  assert.ok(plan?.goalMonths !== null && plan?.goalMonths !== undefined && plan.goalMonths >= 119 && plan.goalMonths <= 120, String(plan?.goalMonths));
  assert.equal(plan?.debtInterest, 10);
});

// --- L-5: the quiz and the Overview give one payoff month ---------------------

/** The walkthrough's answers: RM216 left over, a full buffer, an 18% card of RM3,000. */
const WALKTHROUGH: Omit<OnboardingAnswers, "answeredAt"> = {
  ...CARD, monthlyIncome: 880, monthlySpending: 664, cashInBank: 1992,
};

test("L-5: the plan screen counts interest, and agrees with the Overview", () => {
  const plan = buildOnboardingPlan({ ...WALKTHROUGH, answeredAt: "" });
  assert.equal(plan.split.goal, 216);
  assert.equal(plan.monthsToGoal, 16, "not 3,000 / 216 = 14");
  assert.equal(buildNextSteps(quiz(WALKTHROUGH)).plan?.goalMonths, plan.monthsToGoal);
});

test("L-5: a savings goal's date is still a plain division", () => {
  const plan = buildOnboardingPlan({ ...WALKTHROUGH, primaryGoal: "save", goalName: "Trip", answeredAt: "" });
  assert.equal(plan.monthsToGoal, plan.split.goal > 0 ? Math.ceil(3000 / plan.split.goal) : null);
});

test("L-5: no date when what goes to the debt only covers its interest", () => {
  // RM40 left over, half to the debt while setting a month aside: RM20, under the RM45 interest.
  const plan = buildOnboardingPlan({ ...CARD, monthlyIncome: 2540, monthlySpending: 2500, answeredAt: "" });
  assert.equal(plan.split.goal, 20);
  assert.equal(plan.monthsToGoal, null);
});

test("L-5: a buffer already full is shown as it is, not as a month's emergency money", () => {
  assert.equal(buildNextSteps(quiz(WALKTHROUGH)).plan?.bufferHold, null);
  assert.equal(buildNextSteps(quiz(CARD)).plan?.bufferHold, 2500, "still short: a month's spending for now");
});
