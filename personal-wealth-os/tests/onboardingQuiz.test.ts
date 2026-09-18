import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { WealthState } from "../src/models";
import { CURRENT_VERSION, emptyState, migrateState } from "../src/state";
import { getFinancialRule, getFinancialRulesOfKind } from "../src/financialRules";
import { buildOnboardingChecklist } from "../src/onboarding";
import {
  applyOnboardingAnswers,
  buildOnboardingPlan,
  goalSentence,
  normalizeOnboardingAnswers,
  shouldShowOnboardingQuiz,
  skipOnboardingQuiz,
  type OnboardingAnswers,
} from "../src/onboardingQuiz";

const OPTIONS = { goalId: "goal-quiz", today: "2026-09-19" };

/** The demo's example answers: RM1,700 left over, buffer short, a Japan trip. */
const ANSWERS: Omit<OnboardingAnswers, "answeredAt"> = {
  primaryGoal: "save",
  monthlyIncome: 4500,
  monthlySpending: 2800,
  cashInBank: 3000,
  invests: false,
  goalName: "Japan trip",
  goalAmount: 6000,
};

const bankBalance = (state: WealthState) => state.ledgerAccounts.find((account) => account.id === "account-bank")?.openingBalance;

// --- schema ------------------------------------------------------------------

test("onboardingQuiz: v26 carries the answers, and a new state has none", () => {
  assert.ok(CURRENT_VERSION >= 26);
  assert.equal(emptyState().onboardingAnswers, null);
});

test("onboardingQuiz: data from before v26 migrates to no answers", () => {
  const legacy = { ...structuredClone(emptyState()), version: 25 } as Partial<WealthState> & Record<string, unknown>;
  delete legacy.onboardingAnswers;
  assert.equal(migrateState(legacy).onboardingAnswers, null);
});

test("onboardingQuiz: stored answers survive a migration; unusable ones read as skipped", () => {
  const stored = { ...emptyState(), onboardingAnswers: {
    answeredAt: "2026-09-19", primaryGoal: "save", monthlyIncome: 4500,
    monthlySpending: -20, cashInBank: "lots", invests: "yes", goalName: "  Japan trip  ", goalAmount: 0,
  } } as unknown as WealthState;
  assert.deepEqual(migrateState(stored).onboardingAnswers, {
    answeredAt: "2026-09-19", primaryGoal: "save", monthlyIncome: 4500, goalName: "Japan trip",
  });
  assert.equal(normalizeOnboardingAnswers(null), null);
  assert.equal(normalizeOnboardingAnswers([1, 2]), null);
});

// --- the plan ----------------------------------------------------------------

test("onboardingQuiz: plan while the buffer is short puts it first (50/30/20)", () => {
  const plan = buildOnboardingPlan({ ...ANSWERS, answeredAt: "" });
  assert.equal(plan.leftover, 1700);
  assert.equal(plan.bufferTarget, 8400);
  assert.ok(Math.abs((plan.monthsCovered ?? 0) - 3000 / 2800) < 1e-9);
  assert.equal(plan.bufferFull, false);
  assert.deepEqual(plan.split, { buffer: 850, goal: 510, invest: 340 });
  assert.equal(plan.monthsToBufferFull, 7, "RM5,400 short at RM850 a month");
  assert.equal(plan.monthsToGoal, 12, "RM6,000 at RM510 a month");
});

test("onboardingQuiz: once the buffer is full, the goal and investing share everything (60/40)", () => {
  const plan = buildOnboardingPlan({ ...ANSWERS, cashInBank: 10000, answeredAt: "" });
  assert.equal(plan.bufferFull, true);
  assert.deepEqual(plan.split, { buffer: 0, goal: 1020, invest: 680 });
  assert.equal(plan.monthsToBufferFull, 0);
  assert.equal(plan.monthsToGoal, 6);
});

test("onboardingQuiz: with no goal, the goal's share is invested", () => {
  const plan = buildOnboardingPlan({ ...ANSWERS, goalName: undefined, goalAmount: undefined, answeredAt: "" });
  assert.deepEqual(plan.split, { buffer: 850, goal: 0, invest: 850 });
  assert.equal(plan.monthsToGoal, null);
});

test("onboardingQuiz: the split always adds up to the leftover in whole ringgit", () => {
  const plan = buildOnboardingPlan({ ...ANSWERS, monthlyIncome: 3333.33, monthlySpending: 1000, answeredAt: "" });
  const { buffer, goal, invest } = plan.split;
  assert.equal(buffer + goal + invest, Math.round(3333.33 - 1000));
});

test("onboardingQuiz: spending more than comes in gives no split and no dates, without failing", () => {
  const plan = buildOnboardingPlan({ ...ANSWERS, monthlyIncome: 2000, monthlySpending: 2500, answeredAt: "" });
  assert.equal(plan.leftover, -500);
  assert.deepEqual(plan.split, { buffer: 0, goal: 0, invest: 0 });
  assert.equal(plan.monthsToBufferFull, null);
  assert.equal(plan.monthsToGoal, null);
});

test("onboardingQuiz: skipped money questions leave the plan's figures unknown", () => {
  const plan = buildOnboardingPlan({ answeredAt: "" });
  assert.equal(plan.leftover, null);
  assert.equal(plan.bufferTarget, null);
  assert.equal(plan.monthsCovered, null);
  assert.deepEqual(plan.split, { buffer: 0, goal: 0, invest: 0 });
});

test("onboardingQuiz: the goal sentence follows the answers", () => {
  assert.equal(goalSentence({ ...ANSWERS, answeredAt: "" }), "RM6,000 for Japan trip.");
  assert.equal(goalSentence({ ...ANSWERS, primaryGoal: "debt", goalName: "Credit card", goalAmount: 4200, answeredAt: "" }), "Clear RM4,200 of Credit card.");
  assert.equal(goalSentence({ primaryGoal: "buffer", monthlySpending: 2000, answeredAt: "" }), "A 3-month safety buffer of RM6,000.");
  assert.equal(goalSentence({ answeredAt: "" }), "");
});

// --- writing the answers -----------------------------------------------------

test("onboardingQuiz: Start my plan writes each answer where the app already reads it", () => {
  const next = applyOnboardingAnswers(emptyState(), ANSWERS, OPTIONS);
  assert.deepEqual(next.onboardingAnswers, { ...ANSWERS, answeredAt: "2026-09-19" });
  assert.equal(next.cashflow.allowance, 4500, "Q2 → planned income");
  assert.equal(next.cashflow.otherFixed, 2800, "Q3 → planned spending");
  assert.deepEqual(
    { enabled: getFinancialRule(next, "monthly-spending-limit")?.enabled, limit: getFinancialRule(next, "monthly-spending-limit")?.limitAmount },
    { enabled: true, limit: 2800 },
    "the spending limit the Health card and Advisor read",
  );
  assert.equal(next.emergency.target, 8400, "Q3 → 3 months of spending");
  assert.equal(getFinancialRule(next, "emergency-fund-minimum")?.targetAmount, 8400);
  assert.equal(next.emergency.monthlyTopUp, 850);
  assert.equal(bankBalance(next), 3000, "Q4 → the bank account");
  assert.equal(next.emergency.current, 3000, "Q4 → what the buffer holds");
  assert.deepEqual(next.goals, [{ id: "goal-quiz", name: "Japan trip", label: "Japan trip", current: 0, target: 6000, monthlyContribution: 510, note: "" }]);
  assert.equal(next.overviewGoalId, "goal-quiz");
  assert.deepEqual(getFinancialRulesOfKind(next, "goal-contribution").map((rule) => [rule.goalId, rule.monthlyAmount]), [["goal-quiz", 510]]);
  assert.equal(next.financialGoal, "RM6,000 for Japan trip.");
  assert.equal(next.onboardingDone, false, "the next-step card still has work to show");
});

test("onboardingQuiz: saying you invest writes no made-up trade", () => {
  const next = applyOnboardingAnswers(emptyState(), { ...ANSWERS, invests: true }, OPTIONS);
  assert.equal(next.onboardingAnswers?.invests, true);
  assert.deepEqual(next.trades, []);
});

test("onboardingQuiz: a skipped question writes nothing", () => {
  const before = emptyState();
  const next = applyOnboardingAnswers(before, {}, OPTIONS);
  assert.deepEqual(next.onboardingAnswers, { answeredAt: "2026-09-19" });
  assert.deepEqual({ ...next, onboardingAnswers: null }, before);
});

test("onboardingQuiz: never overwrites a value that is already there", () => {
  const before = emptyState();
  before.cashflow.allowance = 1800;
  before.cashflow.food = 500;
  before.emergency.target = 5000;
  before.emergency.current = 1200;
  before.ledgerAccounts = before.ledgerAccounts.map((account) => account.id === "account-bank" ? { ...account, openingBalance: 999 } : account);
  before.goals = [{ id: "g0", name: "Laptop", label: "Laptop", current: 0, target: 4000, monthlyContribution: 0, note: "" }];
  before.overviewGoalId = "g0";
  before.financialGoal = "My own words.";
  const next = applyOnboardingAnswers(before, ANSWERS, OPTIONS);
  assert.equal(next.cashflow.allowance, 1800);
  assert.equal(next.cashflow.otherFixed, 0);
  assert.equal(next.emergency.target, 5000);
  assert.equal(next.emergency.current, 1200);
  assert.equal(bankBalance(next), 999);
  assert.deepEqual(next.goals.map((goal) => goal.id), ["g0", "goal-quiz"], "the goal is added, not swapped in");
  assert.equal(next.overviewGoalId, before.overviewGoalId);
  assert.equal(next.financialGoal, "My own words.");
});

test("onboardingQuiz: afterwards the Get started list only asks for the first transaction", () => {
  const next = applyOnboardingAnswers(emptyState(), ANSWERS, OPTIONS);
  const open = buildOnboardingChecklist(next).steps.filter((step) => !step.done && !step.optional).map((step) => step.id);
  assert.deepEqual(open, ["first-entry"]);
});

// --- who sees the quiz -------------------------------------------------------

test("onboardingQuiz: only an untouched account that never took the quiz sees it", () => {
  const fresh = emptyState();
  assert.equal(shouldShowOnboardingQuiz(fresh), true);
  assert.equal(shouldShowOnboardingQuiz(applyOnboardingAnswers(fresh, ANSWERS, OPTIONS)), false, "answered");
  assert.equal(shouldShowOnboardingQuiz(skipOnboardingQuiz(fresh, "2026-09-19")), false, "skipped");
  assert.equal(shouldShowOnboardingQuiz({ ...fresh, onboardingDone: true }), false, "Get started already finished");
  assert.equal(shouldShowOnboardingQuiz({ ...fresh, goals: [{ id: "g", name: "x", label: "x", current: 0, target: 1, monthlyContribution: 0, note: "" }] }), false, "already has data");
});

test("onboardingQuiz: an account from before v26 sees it only if it was never used", () => {
  const untouched = { ...structuredClone(emptyState()), version: 25 } as Partial<WealthState> & Record<string, unknown>;
  delete untouched.onboardingAnswers;
  assert.equal(shouldShowOnboardingQuiz(migrateState(untouched)), true);

  const used = { ...structuredClone(untouched), ledgerTransactions: [{ id: "t1", date: "2026-09-01", type: "income", amount: 800, accountId: "account-bank", categoryId: "income-salary", note: "" }] } as Partial<WealthState> & Record<string, unknown>;
  assert.equal(shouldShowOnboardingQuiz(migrateState(used)), false, "an existing user must never be sent back to the quiz");
});
