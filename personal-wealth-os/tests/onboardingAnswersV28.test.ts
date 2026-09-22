import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { WealthState } from "../src/models";
import { CURRENT_VERSION, emptyState, migrateState } from "../src/state";
import { buildNextSteps } from "../src/onboarding";
import { classifyStage } from "../src/moneyStage";
import {
  answeredCash,
  applyOnboardingAnswers,
  bufferMonthsFor,
  buildOnboardingPlan,
  goalSentence,
  incomeRangesFor,
  normalizeOnboardingAnswers,
} from "../src/onboardingQuiz";

const OPTIONS = { goalId: "goal-quiz", today: "2026-09-22" };
const NOW = new Date(2026, 8, 22);
const bankBalance = (state: WealthState) => state.ledgerAccounts.find((account) => account.id === "account-bank")?.openingBalance;

// --- schema ------------------------------------------------------------------

test("answers v28: the schema is v28", () => {
  assert.equal(CURRENT_VERSION, 28);
});

test("answers v28: a v27 answer set migrates unchanged, the new answers unanswered", () => {
  const v27 = { ...emptyState(), version: 27, onboardingAnswers: {
    answeredAt: "2026-09-19", primaryGoal: "save", monthlyIncome: 4500, monthlySpending: 2800, cashInBank: 3000, invests: false,
  } } as unknown as WealthState;
  const migrated = migrateState(v27);
  assert.equal(migrated.version, 28);
  assert.deepEqual(migrated.onboardingAnswers, v27.onboardingAnswers);
});

test("answers v28: the new answers survive a save and reload", () => {
  const answers = {
    answeredAt: "2026-09-22", lifeStage: "self-employed", incomeRange: "4000-6000", monthlyIncome: 5000,
    bufferMonthsHave: "1-2", cashKeptIn: "money-market", longTermGoals: ["retirement", "home"],
  };
  const reloaded = migrateState(JSON.parse(JSON.stringify({ ...emptyState(), onboardingAnswers: answers })));
  assert.deepEqual(reloaded.onboardingAnswers, answers);
});

test("answers v28: an unknown value reads as skipped, and never takes the other answers with it", () => {
  const tidy = normalizeOnboardingAnswers({
    answeredAt: "2026-09-22", monthlyIncome: 4500, lifeStage: "astronaut", incomeRange: "a lot",
    bufferMonthsHave: "12", cashKeptIn: "mattress", longTermGoals: ["home", "yacht", "home", 7],
  });
  assert.deepEqual(tidy, { answeredAt: "2026-09-22", monthlyIncome: 4500, longTermGoals: ["home"] });
  // "Not sure yet" with others picked means not sure.
  assert.deepEqual(normalizeOnboardingAnswers({ answeredAt: "", longTermGoals: ["travel", "not-sure"] })?.longTermGoals, ["not-sure"]);
  assert.equal(normalizeOnboardingAnswers({ answeredAt: "", longTermGoals: "home" })?.longTermGoals, undefined);
});

// --- what the new answers mean ---------------------------------------------------

test("answers v28: a student picks from allowance-sized bands", () => {
  assert.equal(incomeRangesFor("student")[0].id, "under-500");
  assert.equal(incomeRangesFor("working")[0].id, "under-2500");
  assert.equal(incomeRangesFor(undefined)[0].id, "under-2500");
});

test("answers v28: savings as months of spending become an amount; a typed figure wins", () => {
  assert.equal(answeredCash({ bufferMonthsHave: "1-2", monthlySpending: 2000 }), 3000);
  assert.equal(answeredCash({ bufferMonthsHave: "none", monthlySpending: 2000 }), 0);
  assert.equal(answeredCash({ bufferMonthsHave: "1-2" }), null, "no spending, nothing to multiply");
  assert.equal(answeredCash({ cashInBank: 800, bufferMonthsHave: "6-plus", monthlySpending: 2000 }), 800);
});

test("answers v28: self-employed aims for 6 months, everyone else 3", () => {
  assert.equal(bufferMonthsFor({ lifeStage: "self-employed" }), 6);
  assert.equal(bufferMonthsFor({ lifeStage: "student" }), 3);
  assert.equal(bufferMonthsFor(null), 3);
  const plan = buildOnboardingPlan({ answeredAt: "", lifeStage: "self-employed", monthlyIncome: 5000, monthlySpending: 2000, bufferMonthsHave: "1-2" });
  assert.equal(plan.bufferTarget, 12000);
  assert.equal(plan.monthsCovered, 1.5);
  assert.equal(plan.bufferFull, false);
  assert.equal(goalSentence({ answeredAt: "", primaryGoal: "buffer", lifeStage: "self-employed", monthlySpending: 2000 }), "A 6-month safety buffer of RM12,000.");
});

test("answers v28: months saved set the buffer, but no account balance is invented", () => {
  const state = applyOnboardingAnswers(emptyState(), {
    lifeStage: "self-employed", incomeRange: "4000-6000", monthlyIncome: 5000, monthlySpending: 2000, bufferMonthsHave: "1-2", cashKeptIn: "money-market",
  }, OPTIONS);
  assert.equal(state.emergency.current, 3000);
  assert.equal(state.emergency.target, 12000);
  assert.equal(bankBalance(state), 0);
  // So the balances step still asks for the real figures.
  assert.ok(buildNextSteps(state).steps.some((step) => step.id === "balances"));
  // And the stage measures the 6-month target.
  assert.equal(classifyStage(state, NOW).reason, "About 1.5 of 6 months of spending saved.");
});

test("answers v28: an estimate never overwrites a buffer that is already there", () => {
  const before = emptyState();
  const state = applyOnboardingAnswers({ ...before, emergency: { ...before.emergency, current: 500 } }, {
    monthlySpending: 2000, bufferMonthsHave: "3-5",
  }, OPTIONS);
  assert.equal(state.emergency.current, 500);
});

test("answers v28: the buffer step measures from the months answer", () => {
  const state = applyOnboardingAnswers(emptyState(), {
    monthlyIncome: 4500, monthlySpending: 2000, bufferMonthsHave: "1-2",
  }, OPTIONS);
  const move = buildNextSteps(state).steps.find((step) => step.id === "move-to-buffer");
  assert.ok(move, "a buffer short of target gets the move-money step");
  assert.equal(move?.because, "Your buffer is MYR 3,000 short of MYR 6,000.");
  assert.equal(move?.done, false, "the estimate itself is not a top-up");
});

test("answers v28: with no target set, the stage uses 6 months for the self-employed", () => {
  const base = emptyState();
  const state: WealthState = {
    ...base,
    onboardingAnswers: { answeredAt: "", lifeStage: "self-employed" },
    cashflow: { ...base.cashflow, otherFixed: 2000 },
    emergency: { ...base.emergency, current: 8000, target: 0 },
  };
  assert.equal(classifyStage(state, NOW).id, "buffer");
  assert.equal(classifyStage({ ...state, onboardingAnswers: null }, NOW).id, "ready");
});
