import assert from "node:assert/strict";
import { test } from "./testHarness";
import { demoState } from "../src/demoData";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { getAdvisorSnapshot } from "../src/advisor";
import { buildOverviewModel } from "../src/overview";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { markRecommendationDone, completeActionRecord, createActionRecord } from "../src/actionRecords";
import { migrateState, CURRENT_VERSION } from "../src/state";
import type { WealthState } from "../src/models";

/**
 * Step 19 regression baseline.
 *
 * Steps 1-18 moved almost every financial fact behind a canonical read model.
 * This file pins what the finished system actually produces for the demo state,
 * so a future change that silently alters a number fails here rather than in
 * production. The figures below were captured from the completed Step 18 build.
 *
 * `now` is fixed: the demo fixture has static dates, so a pinned date makes the
 * whole baseline deterministic. Without it "this month" drifts with the clock.
 */
const NOW = new Date(2026, 7, 15, 12, 0, 0);

function demo(): WealthState {
  return structuredClone(demoState);
}

// --- The headline figures --------------------------------------------------

test("baseline: dashboard headline figures", () => {
  // Net Worth now folds in the portfolio's value: live price when available,
  // cost basis otherwise (never omitted, never zero). With no market prices
  // supplied here it falls back to cost basis (MYR 4,741.23), so Net Worth and
  // Total Assets moved up from the pre-Step-26 figures by exactly that amount.
  const model = buildOverviewModel(demo(), NOW);
  assert.equal(model.netWorth.toFixed(2), "7564.23");
  assert.equal(model.totalAssets.toFixed(2), "20414.23");
  assert.equal(model.totalLiabilities, 12850);
  assert.equal(model.netWorth, model.totalAssets - model.totalLiabilities);
  assert.equal(model.snapshot.portfolioValueMyr.toFixed(2), model.portfolio.totalInvestedMyr.toFixed(2),
    "with no live price, portfolio value must equal cost basis");
  assert.equal(model.snapshot.portfolioValueIsLive, false);
  assert.equal(model.cashFlow.income, 2300);
  assert.equal(model.cashFlow.expenses, 249);
  assert.equal(model.cashFlow.surplus, 2051);
  assert.equal(model.wealthHealth.status, "action");
  assert.equal(model.planStatus.label, "Partially funded");
  assert.equal(model.priorityAction?.recommendationId, "advisor:allocation-drift");
});

test("baseline: portfolio facts, with valuation still unknown", () => {
  // The ringgit figures below carry the demo's five currency conversions: the
  // dollars they cover are translated at the rate the user actually converted
  // at, the rest at the rate each trade row implies. The dollar facts —
  // totalInvestedUsd, units, average cost, fees — are identical either way,
  // which is the point: a conversion record changes the translation, never the
  // trade.
  const portfolio = getPortfolioSnapshot(demo());
  assert.equal(portfolio.totalUnits.toFixed(6), "4.006747");
  assert.equal(portfolio.totalInvestedMyr.toFixed(2), "4741.23");
  assert.equal(portfolio.totalInvestedUsd.toFixed(2), "1066.93");
  assert.equal(portfolio.maxAbsoluteDrift.toFixed(6), "0.096721");
  assert.equal(portfolio.realizedPnlMyr, 0);
  assert.equal(portfolio.totalFeesMyr.toFixed(2), "28.89");
  // The Step 18 fix depends on these staying null rather than becoming 0.
  assert.equal(portfolio.totalInvestmentValueMyr, null);
  assert.equal(portfolio.unrealizedPnlMyr, null);

  const expected = [
    { ticker: "VOO", units: "1.261434", avg: "547.12", target: 0.55, drift: "0.096721" },
    { ticker: "QQQM", units: "1.295536", avg: "222.54", target: 0.25, drift: "0.020147" },
    { ticker: "VXUS", units: "1.449778", avg: "61.02", target: 0.1, drift: "-0.016868" },
  ];
  assert.equal(portfolio.holdings.length, expected.length);
  for (const want of expected) {
    const holding = portfolio.holdings.find((h) => h.ticker === want.ticker);
    assert.ok(holding, `${want.ticker} missing`);
    assert.equal(holding.units.toFixed(6), want.units, `${want.ticker} units`);
    assert.equal(holding.averageCostUsd.toFixed(2), want.avg, `${want.ticker} average cost`);
    assert.equal(holding.targetAllocation, want.target, `${want.ticker} target`);
    assert.equal(holding.drift.toFixed(6), want.drift, `${want.ticker} drift`);
  }
});

test("baseline: goals, their order and the featured goal", () => {
  const goals = getGoalsSnapshot(demo());
  assert.deepEqual(goals.ordered.map((g) => g.id), ["travel", "wishlist", "learning", "giving", "emergency"]);
  assert.equal(goals.featured?.id, "travel");

  const expected: Record<string, [number, number, number, number, number | null, boolean]> = {
    // id: current, target, remaining, monthlyContribution, estimatedMonths, complete
    travel: [680, 2500, 1820, 150, 13, false],
    wishlist: [2100, 4500, 2400, 200, 12, false],
    learning: [180, 500, 320, 50, 7, false],
    giving: [120, 300, 180, 20, 9, false],
    emergency: [4800, 4800, 0, 0, null, true],
  };
  for (const goal of goals.ordered) {
    const [current, target, remaining, contribution, months, complete] = expected[goal.id]!;
    assert.equal(goal.currentAmount, current, `${goal.id} current`);
    assert.equal(goal.targetAmount, target, `${goal.id} target`);
    assert.equal(goal.remainingAmount, remaining, `${goal.id} remaining`);
    assert.equal(goal.monthlyContribution, contribution, `${goal.id} contribution`);
    assert.equal(goal.estimatedMonthsToTarget, months, `${goal.id} months`);
    assert.equal(goal.isComplete, complete, `${goal.id} completion`);
    assert.equal(goal.progress, target > 0 ? Math.min(current / target, 1) : 0, `${goal.id} progress`);
  }
});

test("baseline: budget keeps plan and actual apart", () => {
  const budget = getBudgetSnapshot(demo(), NOW);
  assert.equal(budget.plannedAllowance, 1800);
  assert.equal(budget.plannedIncome, 2300);
  assert.equal(budget.plannedSpending, 1200);
  assert.equal(budget.plannedSurplus, 1100);
  assert.equal(budget.plannedDcaAmount, 300);
  assert.equal(budget.actualIncome, 2300);
  assert.equal(budget.actualSpending, 249);
  assert.equal(budget.actualSurplus, 2051);
  assert.equal(budget.planCoversDca, true);
  // Planned surplus and actual surplus are different facts on this fixture.
  assert.notEqual(budget.plannedSurplus, budget.actualSurplus);
});

test("baseline: health factors and their thresholds", () => {
  const state = demo();
  const advisor = getAdvisorSnapshot(state);
  const health = getFinancialHealthSnapshot(state, NOW, {
    hasUrgentAdvice: advisor.recommendations.some((r) => r.severity === "action"),
  });
  assert.equal(health.status, "action");
  const byId = Object.fromEntries(health.factors.map((f) => [f.id, f]));
  assert.equal(byId.safetyBuffer!.status, "healthy");
  assert.equal(byId.safetyBuffer!.value, 1);
  assert.equal(byId.cashFlow!.status, "healthy");
  assert.equal(byId.cashFlow!.value, 2051);
  assert.equal(byId.planExecution!.status, "watch");
  assert.equal(byId.planExecution!.target, 300);
  assert.equal(byId.debtLoad!.status, "watch");
  assert.equal(byId.debtLoad!.value, 12850);
});

test("baseline: advisor recommendations, their order and priority", () => {
  const advisor = getAdvisorSnapshot(demo());
  assert.deepEqual(advisor.recommendations.map((r) => `${r.id}[${r.severity}]`), [
    "advisor:allocation-drift[action]",
    "advisor:opportunity-reserve[watch]",
    "advisor:emergency-fund[positive]",
    "advisor:dca-mandate[positive]",
    "advisor:cashflow-discipline[positive]",
    "advisor:spending-limit[positive]",
  ]);
  assert.equal(advisor.priority?.id, "advisor:allocation-drift");
  assert.deepEqual(advisor.actions.map((a) => a.recommendationId), advisor.recommendations.map((r) => r.id));
});

test("baseline: money leak count is unchanged", () => {
  assert.equal(detectMoneyLeakFindings(demo()).leaks.length, 5);
});

// --- Cross-model consistency (§3) ------------------------------------------

test("regression: OverviewModel carries the canonical snapshots, not copies", () => {
  const state = demo();
  const model = buildOverviewModel(state, NOW);
  assert.deepEqual(model.snapshot, getFinancialSnapshot(state, NOW));
  assert.deepEqual(model.portfolio, getPortfolioSnapshot(state));
  assert.deepEqual(model.goals, getGoalsSnapshot(state));
  assert.deepEqual(model.budget, getBudgetSnapshot(state, NOW));
  assert.deepEqual(model.advisor, getAdvisorSnapshot(state, { now: NOW }));
  assert.deepEqual(model.wealthHealth, getFinancialHealthSnapshot(state, NOW, {
    hasUrgentAdvice: model.advisor.recommendations.some((r) => r.severity === "action"),
  }));
  // Composed fields must trace to a snapshot rather than a second calculation.
  assert.equal(model.netWorth, model.snapshot.netWorth);
  assert.equal(model.cashFlow.surplus, getLedgerSnapshot(state, NOW).currentMonth.surplus);
  assert.equal(model.emergencyRatio, model.wealthHealth.supportingFacts.emergencyRatio);
  assert.equal(model.trackedWealth.invested, model.portfolio.totalInvestedMyr);
});

// --- Plan / actual independence (§8) ---------------------------------------

test("regression: changing the plan never moves a recorded figure", () => {
  const base = demo();
  const before = getBudgetSnapshot(base, NOW);
  const replanned: WealthState = {
    ...base,
    cashflow: { ...base.cashflow, allowance: 9999, food: 1, transport: 1, otherFixed: 1 },
    dca: { ...base.dca, monthly: 5000 },
  };
  const after = getBudgetSnapshot(replanned, NOW);

  assert.notEqual(after.plannedSurplus, before.plannedSurplus, "the plan really changed");
  assert.equal(after.actualIncome, before.actualIncome, "actual income moved");
  assert.equal(after.actualSpending, before.actualSpending, "actual spending moved");
  assert.equal(after.actualSurplus, before.actualSurplus, "actual surplus moved");
  assert.equal(
    getLedgerSnapshot(replanned, NOW).currentMonth.surplus,
    getLedgerSnapshot(base, NOW).currentMonth.surplus,
  );
});

test("regression: recording a transaction never moves a planned figure", () => {
  const base = demo();
  const before = getBudgetSnapshot(base, NOW);
  const withSpending: WealthState = {
    ...base,
    ledgerTransactions: [
      ...base.ledgerTransactions,
      {
        id: "s19-extra", date: "2026-08-12T00:00:00.000Z", amount: 500, type: "expense",
        accountId: base.ledgerAccounts[0]!.id, categoryId: "expense-food",
      },
    ],
  };
  const after = getBudgetSnapshot(withSpending, NOW);

  assert.equal(after.actualSpending, before.actualSpending + 500, "actual spending did not record");
  assert.equal(after.plannedAllowance, before.plannedAllowance, "planned allowance moved");
  assert.equal(after.plannedSpending, before.plannedSpending, "planned spending moved");
  assert.equal(after.plannedSurplus, before.plannedSurplus, "planned surplus moved");
  assert.equal(after.plannedDcaAmount, before.plannedDcaAmount, "planned DCA moved");
});

// --- Persistence round trip across every snapshot (§14) --------------------

test("regression: persist, reload and migrate preserves every canonical fact", () => {
  // Real persistence is load -> migrate -> save -> load -> migrate, so the
  // baseline is the already-migrated state. Comparing against the raw fixture
  // would only re-detect migration's date normalisation, which is a display
  // string rather than a financial fact (pinned separately below).
  const original = migrateState(JSON.parse(JSON.stringify(demoState)));
  const reloaded = migrateState(JSON.parse(JSON.stringify(original)));

  assert.deepEqual(getLedgerSnapshot(reloaded, NOW), getLedgerSnapshot(original, NOW));
  assert.deepEqual(getFinancialSnapshot(reloaded, NOW), getFinancialSnapshot(original, NOW));
  assert.deepEqual(getPortfolioSnapshot(reloaded), getPortfolioSnapshot(original));
  assert.deepEqual(getGoalsSnapshot(reloaded), getGoalsSnapshot(original));
  assert.deepEqual(getBudgetSnapshot(reloaded, NOW), getBudgetSnapshot(original, NOW));
  assert.deepEqual(getFinancialHealthSnapshot(reloaded, NOW), getFinancialHealthSnapshot(original, NOW));
  assert.deepEqual(getAdvisorSnapshot(reloaded), getAdvisorSnapshot(original));
  assert.deepEqual(buildOverviewModel(reloaded, NOW), buildOverviewModel(original, NOW));
  assert.deepEqual(detectMoneyLeakFindings(reloaded), detectMoneyLeakFindings(original));
});

test("regression: ActionRecords survive a persist/reload byte for byte", () => {
  const state = migrateState(JSON.parse(JSON.stringify(demoState)));
  const withRecord: WealthState = {
    ...state,
    actionRecords: markRecommendationDone(state.actionRecords, {
      id: "a1", recommendationId: "advisor:allocation-drift", action: "Rebalance", now: 1_700_000_000_000,
    }),
  };
  const reloaded = migrateState(JSON.parse(JSON.stringify(withRecord)));
  assert.deepEqual(reloaded.actionRecords, withRecord.actionRecords);
  assert.equal(reloaded.actionRecords[0]!.status, "completed");
  assert.equal(reloaded.actionRecords[0]!.completedAt, 1_700_000_000_000);
  // And the record still changes nothing about the advice itself.
  assert.deepEqual(getAdvisorSnapshot(reloaded), getAdvisorSnapshot(state));
});

// --- ActionRecord lifecycle (§11) ------------------------------------------

test("regression: accepting twice keeps one record and does not move completedAt", () => {
  const first = createActionRecord([], { id: "a1", recommendationId: "advisor:dca-mandate", action: "Do it", now: 1000 });
  assert.equal(first.length, 1);
  assert.equal(first[0]!.status, "pending");
  assert.equal("completedAt" in first[0]!, false, "a pending record has no completion time");

  const second = createActionRecord(first, { id: "a2", recommendationId: "advisor:dca-mandate", action: "Do it again", now: 2000 });
  assert.equal(second.length, 1, "duplicate accept created a second record");
  assert.equal(second[0]!.id, "a1", "the original record was replaced");

  const done = completeActionRecord(second, "advisor:dca-mandate", 3000);
  assert.equal(done[0]!.status, "completed");
  assert.equal(done[0]!.completedAt, 3000);

  const doneAgain = completeActionRecord(done, "advisor:dca-mandate", 9999);
  assert.equal(doneAgain[0]!.completedAt, 3000, "completing twice moved the timestamp");
  assert.equal(doneAgain, done, "an unchanged list should not be rebuilt");
});

test("regression: malformed records are isolated from real financial state", () => {
  const state = migrateState({
    ...JSON.parse(JSON.stringify(demoState)),
    actionRecords: [null, 42, { id: "x" }, { recommendationId: "y" }, "nope"],
  });
  assert.deepEqual(state.actionRecords, [], "malformed records must be dropped");
  assert.equal(state.version, CURRENT_VERSION);
  // Everything else is untouched.
  const clean = migrateState(JSON.parse(JSON.stringify(demoState)));
  assert.deepEqual(buildOverviewModel(state, NOW), buildOverviewModel(clean, NOW));
});

test("regression: migration normalises stored dates without moving any figure", () => {
  // migrateState rewrites "2026-07-15" to a full ISO timestamp. That is a
  // storage-format change, and it must never move a financial fact. It does
  // reach one display string — Money Leaks evidence prints transaction.date
  // verbatim — which is recorded as tech debt, not a regression: every saved
  // state has always gone through this path.
  const raw = structuredClone(demoState);
  const migrated = migrateState(JSON.parse(JSON.stringify(raw)));

  assert.equal(raw.ledgerTransactions[0]!.date.length, 10, "fixture stores short dates");
  assert.ok(migrated.ledgerTransactions[0]!.date.endsWith("Z"), "migration stores ISO");
  assert.equal(migrated.ledgerTransactions.length, raw.ledgerTransactions.length);

  // Every figure is identical either side of the rewrite.
  assert.deepEqual(getLedgerSnapshot(migrated, NOW), getLedgerSnapshot(raw, NOW));
  assert.deepEqual(getFinancialSnapshot(migrated, NOW), getFinancialSnapshot(raw, NOW));
  assert.deepEqual(getBudgetSnapshot(migrated, NOW), getBudgetSnapshot(raw, NOW));
  assert.deepEqual(
    detectMoneyLeakFindings(migrated).leaks.map((l) => [l.id, l.category, l.severity, l.monthlyImpact]),
    detectMoneyLeakFindings(raw).leaks.map((l) => [l.id, l.category, l.severity, l.monthlyImpact]),
    "leak detection must not depend on the date format",
  );
});
