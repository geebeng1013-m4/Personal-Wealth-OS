import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { WealthState } from "../src/models";
import { emptyState } from "../src/state";
import { classifyStage } from "../src/moneyStage";
import { applyOnboardingAnswers } from "../src/onboardingQuiz";

const NOW = new Date(2026, 8, 22);
type Tx = WealthState["ledgerTransactions"][number];
const tx = (type: "income" | "expense", amount: number, date: string): Tx =>
  ({ id: `${type}-${amount}-${date}`, type, amount, date, accountId: "account-bank", categoryId: type === "income" ? "income-salary" : "food" }) as Tx;

/** Planned spending of 2,000 a month and a buffer as given. */
function withBuffer(current: number, target: number, extra: Partial<WealthState> = {}): WealthState {
  const base = emptyState();
  return {
    ...base,
    cashflow: { ...base.cashflow, transport: 0, food: 0, otherFixed: 2000, allowance: 4000 },
    emergency: { ...base.emergency, current, target },
    ...extra,
  };
}
const trade = { id: "t1" } as WealthState["trades"][number];

test("stage: a brand-new account with no spending figure is told what to add", () => {
  const stage = classifyStage(emptyState(), NOW);
  assert.equal(stage.id, "base");
  assert.equal(stage.step, 1);
  assert.equal(stage.reason, "Add your monthly spending to measure your safety buffer.");
  assert.equal(stage.basis, "unmeasured");
});

test("stage: under a month of spending saved is getting a base", () => {
  const stage = classifyStage(withBuffer(1500, 6000), NOW);
  assert.equal(stage.id, "base");
  assert.equal(stage.reason, "Your savings cover less than a month of spending.");
});

test("stage: exactly one month is building the buffer, measured in months of the target", () => {
  assert.deepEqual(classifyStage(withBuffer(2000, 6000), NOW), {
    id: "buffer", step: 2, title: "Building your buffer", reason: "About 1 of 3 months of spending saved.", basis: "savings",
  });
  assert.equal(classifyStage(withBuffer(2900, 12000), NOW).reason, "About 1.5 of 6 months of spending saved.");
});

test("stage: a full buffer without trades is ready to invest; with one it is growing", () => {
  assert.equal(classifyStage(withBuffer(6000, 6000), NOW).id, "ready");
  assert.equal(classifyStage(withBuffer(6000, 6000, { trades: [trade] }), NOW).id, "growing");
  // Investing with a buffer not yet full stays on the buffer: it comes first.
  assert.equal(classifyStage(withBuffer(2000, 6000, { trades: [trade] }), NOW).id, "buffer");
});

test("stage: with no target set, three months of spending counts as full", () => {
  assert.equal(classifyStage(withBuffer(6000, 0), NOW).id, "ready");
  assert.equal(classifyStage(withBuffer(5000, 0), NOW).id, "buffer");
});

test("stage: last month spending more than came in is getting a base, whatever the buffer", () => {
  const state = withBuffer(9000, 6000, { ledgerTransactions: [tx("income", 3000, "2026-08-25"), tx("expense", 3200, "2026-08-28")] });
  const stage = classifyStage(state, NOW);
  assert.equal(stage.id, "base");
  assert.match(stage.reason, /at or above income/);
});

test("stage: a month in progress does not count as overspending; last full month does", () => {
  // September so far: all spending, no pay yet. August was fine.
  const state = withBuffer(2000, 6000, { ledgerTransactions: [
    tx("income", 4000, "2026-08-25"), tx("expense", 1800, "2026-08-28"), tx("expense", 900, "2026-09-03"),
  ] });
  assert.equal(classifyStage(state, NOW).id, "buffer");
});

test("stage: without last month's income, planned spending at or above planned income is a base", () => {
  const state = withBuffer(4000, 6000);
  assert.equal(classifyStage({ ...state, cashflow: { ...state.cashflow, allowance: 2000 } }, NOW).id, "base");
  assert.equal(classifyStage({ ...state, cashflow: { ...state.cashflow, allowance: 0 } }, NOW).id, "buffer");
});

test("stage: a target but no spending figure is measured as a share of the target", () => {
  const base = emptyState();
  const state = { ...base, emergency: { ...base.emergency, current: 900, target: 3000 } };
  assert.deepEqual(classifyStage(state, NOW), { id: "buffer", step: 2, title: "Building your buffer", reason: "30% of your MYR 3,000 buffer saved.", basis: "savings" });
});

test("stage: the debt track holds until recorded debts are paid off", () => {
  const quiz = applyOnboardingAnswers(emptyState(), { primaryGoal: "debt", monthlyIncome: 4000, monthlySpending: 2000, cashInBank: 8000 }, { goalId: "g", today: "2026-09-22" });
  assert.equal(classifyStage(quiz, NOW).id, "debt");
  assert.equal(classifyStage(quiz, NOW).step, null);
  const owing = { ...quiz, liabilities: [{ id: "l", name: "Card", balance: 3000, annualRate: 0.18, minimumPayment: 100 }] };
  assert.match(classifyStage(owing, NOW).reason, /3,000.* still owed/);
  const cleared = { ...quiz, liabilities: [{ ...owing.liabilities[0], balance: 0 }] };
  assert.equal(classifyStage(cleared, NOW).id, "ready", "8,000 covers 3 months of 2,000 once the debt is gone");
});

test("stage: the quiz's own answers are enough to place a new user", () => {
  const quiz = applyOnboardingAnswers(emptyState(), { primaryGoal: "save", monthlyIncome: 4500, monthlySpending: 2800, cashInBank: 3000 }, { goalId: "g", today: "2026-09-22" });
  assert.deepEqual(classifyStage(quiz, NOW), { id: "buffer", step: 2, title: "Building your buffer", reason: "About 1.1 of 3 months of spending saved.", basis: "savings" });
});

test("stage: never NaN or Infinity in the reason, even with zero spending", () => {
  for (const state of [withBuffer(0, 0), withBuffer(0, 5000), { ...withBuffer(100, 0), cashflow: { ...emptyState().cashflow } }]) {
    const { reason } = classifyStage(state, NOW);
    assert.ok(!/NaN|Infinity|undefined/.test(reason), reason);
  }
});

// --- L-1: debt ranked by interest rate --------------------------------------

const liability = (name: string, balance: number, annualRate: number) => ({ id: name, name, balance, annualRate, minimumPayment: 50 });

test("stage (L-1): an 18% card comes first even when the Q&A did not say debt", () => {
  const stage = classifyStage(withBuffer(500, 6000, { liabilities: [liability("Credit card", 3000, 0.18)] }), NOW);
  assert.equal(stage.id, "debt");
  assert.equal(stage.debt?.phase, "starter");
  assert.equal(stage.debt?.starterTarget, 2000, "a month of the planned 2,000");
  assert.equal(stage.reason, "Credit card at 18% comes first. Keep MYR 2,000 aside for emergencies, then put the rest toward it.");
});

test("stage (L-1): once a month's spending is aside, everything goes to the debt", () => {
  const stage = classifyStage(withBuffer(2000, 6000, { liabilities: [liability("Credit card", 3000, 0.18)] }), NOW);
  assert.equal(stage.debt?.phase, "payoff", "exactly a month is enough");
  assert.equal(stage.reason, "MYR 3,000 still owed. Every spare ringgit goes to Credit card at 18%, the highest rate, first.");
  assert.equal(classifyStage(withBuffer(1999, 6000, { liabilities: [liability("Credit card", 3000, 0.18)] }), NOW).debt?.phase, "starter");
});

test("stage (L-1): without a spending figure the starter money is RM1,000", () => {
  const base = emptyState();
  const state = { ...base, emergency: { ...base.emergency, current: 1000 }, liabilities: [liability("Card", 3000, 0.18)] };
  assert.deepEqual(classifyStage(state, NOW).debt, { phase: "payoff", starterTarget: 1000, focus: state.liabilities[0] });
  assert.equal(classifyStage({ ...state, emergency: { ...state.emergency, current: 999 } }, NOW).debt?.phase, "starter");
});

test("stage (L-1): exactly 8% is high; just under is not", () => {
  assert.equal(classifyStage(withBuffer(500, 6000, { liabilities: [liability("Loan", 9000, 0.08)] }), NOW).id, "debt");
  assert.equal(classifyStage(withBuffer(500, 6000, { liabilities: [liability("Car", 9000, 0.0799)] }), NOW).id, "base");
});

test("stage (L-1): several debts, the highest rate is paid first", () => {
  const state = withBuffer(3000, 6000, { liabilities: [liability("PTPTN", 12000, 0.01), liability("Personal loan", 8000, 0.11), liability("Credit card", 3000, 0.18)] });
  const stage = classifyStage(state, NOW);
  assert.equal(stage.debt?.focus?.name, "Credit card");
  assert.match(stage.reason, /MYR 11,000 still owed/, "only the high-rate debts count, not PTPTN");
});

test("stage (L-1): high-rate debt paid off, back to building the buffer", () => {
  const state = withBuffer(3000, 6000, { liabilities: [liability("Credit card", 0, 0.18), liability("PTPTN", 12000, 0.01)] });
  assert.equal(classifyStage(state, NOW).id, "buffer");
});

test("stage (L-1): a cheap debt stays on the main road even when the Q&A put debt first, and says why", () => {
  const quiz = applyOnboardingAnswers(emptyState(), { primaryGoal: "debt", monthlyIncome: 4000, monthlySpending: 2000, cashInBank: 3000 }, { goalId: "g", today: "2026-09-22" });
  for (const rate of [0.01, 0.06]) {
    const stage = classifyStage({ ...quiz, liabilities: [liability("PTPTN", 12000, rate)] }, NOW);
    assert.equal(stage.id, "buffer", String(rate));
    assert.equal(stage.reason, "About 1.5 of 3 months of spending saved. Your debt's rate is under 8%, so pay it on schedule: the buffer comes first.");
  }
});

test("stage (L-1): a debt with no rate comes first only when the Q&A put debt first", () => {
  const noRate = [liability("Card", 3000, 0)];
  assert.equal(classifyStage(withBuffer(500, 6000, { liabilities: noRate }), NOW).id, "base");
  const quiz = applyOnboardingAnswers(emptyState(), { primaryGoal: "debt", monthlyIncome: 4000, monthlySpending: 2000, cashInBank: 500 }, { goalId: "g", today: "2026-09-22" });
  const stage = classifyStage({ ...quiz, liabilities: noRate }, NOW);
  assert.equal(stage.id, "debt");
  assert.equal(stage.reason, "MYR 3,000 still owed. Add its interest rate to see whether it should come first.");
  // Nothing recorded yet: the user's word is enough.
  assert.deepEqual(classifyStage(quiz, NOW).debt, { phase: "starter", starterTarget: 2000, focus: null });
});
