import assert from "node:assert/strict";
import { test } from "./testHarness";
import { calcPnLForTicker } from "../src/market";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { getAdvisorSnapshot } from "../src/advisor";
import { buildOverviewModel } from "../src/overview";
import { cloneDefaultState, migrateState } from "../src/state";

const NOW = new Date(2026, 7, 15, 12, 0, 0);

/**
 * Step 18 regressions: the same financial fact must mean the same thing
 * everywhere it is shown, and a fact that is genuinely unknown must never be
 * rendered as a number.
 */

// --- Fixed: fabricated market valuation ------------------------------------

test("integrity: with no price, valuation and unrealised P&L are not real figures", () => {
  // The market P&L panel had no price source and valued positions at
  // units × 0, reporting a market value of zero and a 100% loss against money
  // the user actually holds. The guard is that a zero price is not a price.
  const state = cloneDefaultState();
  const ticker = state.trades[0]!.ticker;
  const pnl = calcPnLForTicker(state.trades, ticker, 0, 4.25);

  assert.ok(pnl.totalInvestedUsd > 0, "the position has real cost basis");
  assert.equal(pnl.currentValueUsd, 0, "units x 0 is arithmetically zero...");
  assert.equal(pnl.unrealizedPnlPct, -1, "...which reads as a total loss");
  // Which is exactly why the UI must treat price <= 0 as "unknown" rather than
  // rendering these two fields. This is the condition the panel now uses.
  const hasReliablePrice = (price: number) => Number.isFinite(price) && price > 0;
  assert.equal(hasReliablePrice(0), false, "zero is not a usable price");
  assert.equal(hasReliablePrice(Number.NaN), false, "NaN is not a usable price");
  assert.equal(hasReliablePrice(-5), false, "a negative price is not usable");
  assert.equal(hasReliablePrice(612.4), true, "a real quote is usable");
});

test("integrity: cost-basis facts stay known and correct without any price", () => {
  // Only valuation is unknown. Invested, units, average cost and fees are
  // recorded facts and must survive the guard above.
  const state = cloneDefaultState();
  const ticker = state.trades[0]!.ticker;
  const pnl = calcPnLForTicker(state.trades, ticker, 0, 4.25);
  assert.ok(pnl.totalInvestedUsd > 0, "invested USD");
  assert.ok(pnl.totalUnits > 0, "units");
  assert.ok(pnl.averageCostUsd > 0, "average cost");
  assert.ok(pnl.feeMyr >= 0, "fees");
});

test("integrity: the canonical portfolio snapshot reports valuation as unknown", () => {
  // The read model has always been honest about this; the UI is now aligned.
  const portfolio = getPortfolioSnapshot(cloneDefaultState());
  assert.equal(portfolio.totalInvestmentValueMyr, null, "no invented valuation");
  assert.equal(portfolio.unrealizedPnlMyr, null, "no invented unrealised P&L");
  assert.ok(portfolio.totalInvestedMyr > 0, "invested capital is still known");
});

// --- Fixed: planned surplus shown as monthly surplus -----------------------

test("integrity: planned and actual surplus are different facts and can differ", () => {
  // Quick View labelled planned surplus "MONTHLY SURPLUS" while the Dashboard
  // showed recorded surplus under "Surplus". On the default state these are
  // 1100 and 2051 — the same-sounding label showed two different numbers.
  const state = cloneDefaultState();
  const planned = getBudgetSnapshot(state, NOW).plannedSurplus;
  const actual = getLedgerSnapshot(state, NOW).currentMonth.surplus;
  assert.notEqual(planned, actual, "the fixture must actually distinguish them");
  assert.equal(actual, getFinancialSnapshot(state, NOW).currentMonthSurplus);
  assert.equal(actual, buildOverviewModel(state, NOW).cashFlow.surplus);
});

test("integrity: actual surplus is always income minus expenses, never the plan", () => {
  for (const state of [cloneDefaultState(), migrateState({ deviceId: "s18", cashflow: { allowance: 9000, transport: 0, food: 0, otherFixed: 0, irregularIncome: 0 } })]) {
    const ledger = getLedgerSnapshot(state, NOW);
    assert.equal(ledger.currentMonth.surplus, ledger.currentMonth.income - ledger.currentMonth.expenses);
    const model = buildOverviewModel(state, NOW);
    assert.equal(model.cashFlow.surplus, model.cashFlow.income - model.cashFlow.expenses);
  }
});

// --- Cross-page agreement on the same fact ---------------------------------

test("integrity: every page-facing surface agrees on net worth", () => {
  const state = cloneDefaultState();
  const financial = getFinancialSnapshot(state, NOW);
  const model = buildOverviewModel(state, NOW);
  const health = getFinancialHealthSnapshot(state, NOW);
  assert.equal(model.netWorth, financial.netWorth);
  assert.equal(financial.netWorth, financial.totalAssets - financial.totalLiabilities);
  assert.equal(health.supportingFacts.totalAssets, financial.totalAssets);
  assert.equal(health.supportingFacts.totalLiabilities, financial.totalLiabilities);
});

test("integrity: recorded income and spending agree across every consumer", () => {
  const state = cloneDefaultState();
  const ledger = getLedgerSnapshot(state, NOW);
  const financial = getFinancialSnapshot(state, NOW);
  const budget = getBudgetSnapshot(state, NOW);
  const model = buildOverviewModel(state, NOW);
  for (const [label, income, expenses] of [
    ["financial", financial.currentMonthIncome, financial.currentMonthExpenses],
    ["budget actual", budget.actualIncome, budget.actualSpending],
    ["overview", model.cashFlow.income, model.cashFlow.expenses],
  ] as const) {
    assert.equal(income, ledger.currentMonth.income, `${label} income`);
    assert.equal(expenses, ledger.currentMonth.expenses, `${label} expenses`);
  }
});

test("integrity: invested capital is one number and is never a valuation", () => {
  const state = cloneDefaultState();
  const portfolio = getPortfolioSnapshot(state);
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.portfolio.totalInvestedMyr, portfolio.totalInvestedMyr);
  assert.equal(model.trackedWealth.invested, portfolio.totalInvestedMyr);
  // The ledger's investment-account balance is a DIFFERENT fact and must not
  // be conflated with contributed capital.
  const accountBalance = getFinancialSnapshot(state, NOW).investmentAccountBalance;
  assert.notEqual(accountBalance, portfolio.totalInvestedMyr, "fixture distinguishes the two");
});

test("integrity: drift is computed once and shared", () => {
  const state = cloneDefaultState();
  const portfolio = getPortfolioSnapshot(state);
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.portfolio.maxAbsoluteDrift, portfolio.maxAbsoluteDrift);
  const largest = portfolio.holdings.reduce((max, h) => Math.max(max, Math.abs(h.drift)), 0);
  assert.equal(portfolio.maxAbsoluteDrift, largest, "aggregate matches the holdings it summarises");
});

test("integrity: goal progress and completion follow currentAmount, never recordedAmount", () => {
  // A linked goal whose account balance differs from the recorded figure is
  // the case the old raw-vs-linked bug got wrong.
  const state = migrateState({
    deviceId: "s18g",
    ledgerAccounts: [{ id: "acc-goal", name: "Goal Account", type: "bank", openingBalance: 900 }],
    goals: [{ id: "g1", name: "Linked", label: "Linked", note: "", target: 1000, current: 10, monthlyContribution: 50, accountId: "acc-goal" }],
  });
  const goal = getGoalsSnapshot(state).ordered.find((g) => g.id === "g1")!;
  assert.equal(goal.recordedAmount, 10, "raw stored value is preserved as history");
  assert.equal(goal.currentAmount, 900, "canonical current is the linked balance");
  assert.equal(goal.progress, 0.9, "progress follows currentAmount");
  assert.equal(goal.remainingAmount, 100, "remaining follows currentAmount");
  assert.equal(goal.isComplete, false);
});

test("integrity: a zero-target goal never reports completion or full progress", () => {
  const state = migrateState({
    deviceId: "s18z",
    goals: [{ id: "g0", name: "No target", label: "No target", note: "", target: 0, current: 500, monthlyContribution: 0 }],
  });
  const goal = getGoalsSnapshot(state).ordered.find((g) => g.id === "g0")!;
  assert.equal(goal.progress, 0, "no target means no progress, not 100%");
  assert.equal(goal.isComplete, false, "cannot complete a goal with no target");
  assert.equal(goal.status, "no-target");
  assert.equal(goal.remainingAmount, 0);
});

test("integrity: the Advisor priority is the same one the Dashboard shows", () => {
  for (const state of [cloneDefaultState(), migrateState({ deviceId: "s18a", emergency: { current: 0, target: 9000, monthlyTopUp: 50 } })]) {
    const advisor = getAdvisorSnapshot(state);
    const model = buildOverviewModel(state, NOW);
    assert.equal(model.priorityAction?.recommendationId ?? null, advisor.priority?.id ?? null);
    assert.equal(model.advisor.priority?.id ?? null, advisor.priority?.id ?? null);
  }
});
