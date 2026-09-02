import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getAdvisorSnapshot } from "../src/advisor";
import { buildOverviewModel } from "../src/overview";
import { markRecommendationDone, isRecommendationCompleted } from "../src/actionRecords";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { demoState, demoStateFor } from "../src/demoData";
import { migrateState } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);
const demo = (): WealthState => migrateState(JSON.parse(JSON.stringify(demoState)));

/**
 * Step 25 closes the OBSERVE → UNDERSTAND → PRIORITIZE → ACT → TRACK loop.
 * These tests pin the facts the new controls depend on: the Dashboard priority
 * is actionable with the SAME record the Advisor uses, and every recommendation
 * knows where its work happens.
 */

test("flow: the Dashboard priority carries everything needed to act on it", () => {
  const model = buildOverviewModel(demo(), NOW);
  const priority = model.priorityAction;
  assert.ok(priority, "there is a priority action");
  // WHY, WHAT TO DO, WHERE, and a stable id to record against.
  assert.ok(priority.explanation.length > 0, "why it matters");
  assert.ok(priority.actionLabel.length > 0, "what to do");
  assert.ok(priority.destination.length > 0, "where to do it");
  assert.ok(priority.recommendationId.length > 0, "a stable id to record");
});

test("flow: acting from the Dashboard records against the canonical priority", () => {
  // The Dashboard button and the Advisor button must resolve to one record,
  // never two, because they address the same recommendation id.
  const state = demo();
  const priority = getAdvisorSnapshot(state).priority!;
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.priorityAction!.recommendationId, priority.id, "the two surfaces disagree on priority");

  const afterDashboard: WealthState = {
    ...state,
    actionRecords: markRecommendationDone(state.actionRecords, {
      id: "a1", recommendationId: model.priorityAction!.recommendationId, action: priority.action, now: 1000,
    }),
  };
  assert.equal(afterDashboard.actionRecords.length, 1);
  assert.equal(isRecommendationCompleted(afterDashboard, priority.id), true);

  // Acting again from the Advisor page produces no second record.
  const afterAdvisor: WealthState = {
    ...afterDashboard,
    actionRecords: markRecommendationDone(afterDashboard.actionRecords, {
      id: "a2", recommendationId: priority.id, action: priority.action, now: 2000,
    }),
  };
  assert.equal(afterAdvisor.actionRecords.length, 1, "the two surfaces created duplicate records");
  assert.equal(afterAdvisor.actionRecords[0]!.completedAt, 1000, "the timestamp moved");
});

test("flow: completing the priority does not advance or change the priority", () => {
  // The user must not be silently handed a different top action just because
  // they recorded the current one — ranking stays canonical.
  const base = demo();
  const priority = getAdvisorSnapshot(base).priority!;
  const after: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: priority.id, action: priority.action, now: 1000,
    }),
  };
  const model = buildOverviewModel(after, NOW);
  assert.equal(model.priorityAction!.recommendationId, priority.id, "priority advanced after completion");
  assert.equal(getAdvisorSnapshot(after).priority?.id, priority.id);
  assert.deepEqual(
    getAdvisorSnapshot(after).recommendations.map((r) => r.id),
    getAdvisorSnapshot(base).recommendations.map((r) => r.id),
  );
});

test("flow: every recommendation names a destination the app can navigate to", () => {
  // The Advisor cards now surface recommendation.destination. Every value must
  // be a real page id, or the card would offer a dead link.
  const pages = new Set([
    "dashboard", "portfolio", "market", "ledger", "buckets", "goals",
    "money-leaks", "advisor", "review", "rules", "tvm", "calculator", "settings",
  ]);
  const snapshot = getAdvisorSnapshot(demo());
  for (const recommendation of [...snapshot.recommendations, ...snapshot.leakRecommendations]) {
    assert.ok(recommendation.destination, `${recommendation.id} has no destination`);
    assert.ok(pages.has(recommendation.destination), `${recommendation.id} points at unknown page "${recommendation.destination}"`);
  }
});

test("flow: an empty state is genuinely empty rather than misleading", () => {
  // The Goals page renders an explanation only when there is nothing to show.
  const withGoals = demo();
  assert.ok(withGoals.goals.length > 0);
  assert.ok(getGoalsSnapshot(withGoals).ordered.length > 0);

  const withoutGoals = migrateState({ deviceId: "s25", goals: [] });
  assert.equal(withoutGoals.goals.length, 0);
  assert.deepEqual(getGoalsSnapshot(withoutGoals).ordered, []);
  // The contract is an explicit null — "no featured goal", not a missing field.
  assert.equal(getGoalsSnapshot(withoutGoals).featured, null);
  assert.equal(getGoalsSnapshot(withoutGoals).activeCount, 0);
  assert.equal(getGoalsSnapshot(withoutGoals).totalTarget, 0);
});

test("flow: none of the navigation work moved a financial figure", () => {
  const base = demo();
  const priority = getAdvisorSnapshot(base).priority!;
  const after: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: priority.id, action: priority.action, now: 1000,
    }),
  };
  const before = buildOverviewModel(base, NOW);
  const model = buildOverviewModel(after, NOW);

  assert.equal(model.netWorth.toFixed(2), "7564.23"); // was 2823 pre-Step-26: net worth now folds in portfolio value (cost basis fallback)
  assert.equal(model.cashFlow.income, 2300);
  assert.equal(model.cashFlow.expenses, 249);
  assert.equal(model.cashFlow.surplus, 2051);
  assert.equal(model.budget.plannedSurplus, 1100);
  assert.equal(model.portfolio.totalInvestedMyr.toFixed(2), "4741.23");
  assert.deepEqual(model.wealthHealth, before.wealthHealth);
  assert.deepEqual(getFinancialHealthSnapshot(after, NOW), getFinancialHealthSnapshot(base, NOW));
  assert.deepEqual(detectMoneyLeakFindings(after), detectMoneyLeakFindings(base));
  assert.equal(detectMoneyLeakFindings(after).leaks.length, 5);
});

test("flow: a brand-new user is not told their allocation is broken", () => {
  // A fresh state carries default DCA targets but no trades. Drift used to be
  // reported as 0 - target (70%), making "Allocation drift is visible" the top
  // priority for someone who had not bought anything yet — above an unfunded
  // emergency fund.
  const fresh = migrateState({ deviceId: "s25-new" });
  const portfolio = getPortfolioSnapshot(fresh);
  assert.equal(portfolio.totalInvestedMyr, 0, "nothing is invested");
  assert.ok(Object.keys(fresh.dca.targets).length > 0, "targets are configured");
  assert.equal(portfolio.maxAbsoluteDrift, 0, "drift cannot exist before anything is bought");
  for (const holding of portfolio.holdings) {
    assert.equal(holding.drift, 0, `${holding.ticker} reported drift with no position`);
  }

  const priority = getAdvisorSnapshot(fresh).priority;
  assert.notEqual(priority?.id, "advisor:allocation-drift", "drift is still the top advice for a new user");
  const drift = getAdvisorSnapshot(fresh).recommendations.find((r) => r.id === "advisor:allocation-drift");
  assert.equal(drift?.severity, "positive", "drift should not be an action item with no holdings");
});

test("flow: real drift is still detected once money is actually invested", () => {
  // The guard must not mask genuine drift.
  const invested = migrateState({
    deviceId: "s25-drift",
    dca: { monthly: 100, targets: { VOO: 0.9, QQQM: 0.1 } },
    trades: [{
      id: "t1", date: "2026-01-05", platform: "moomoo", ticker: "QQQM", type: "DCA",
      amountMyr: 1000, amountUsd: 220, priceUsd: 220, feeMyr: 0,
    }],
  });
  const portfolio = getPortfolioSnapshot(invested);
  assert.ok(portfolio.totalInvestedMyr > 0);
  assert.ok(portfolio.maxAbsoluteDrift > 0.5, `expected real drift, got ${portfolio.maxAbsoluteDrift}`);
  const drift = getAdvisorSnapshot(invested).recommendations.find((r) => r.id === "advisor:allocation-drift");
  assert.equal(drift?.severity, "action", "genuine drift must still be flagged");
});

test("flow: the demo baseline still sees its real drift", () => {
  const portfolio = getPortfolioSnapshot(demo());
  assert.equal(portfolio.maxAbsoluteDrift.toFixed(6), "0.096721", "demo drift changed");
});

test("flow: the demo fixture follows the calendar instead of emptying out", () => {
  // Anchored to 2026-08. Read in a later month the unshifted fixture would
  // report no income and no spending "this month", which looks like a broken app.
  const anchor = new Date(2026, 7, 15, 12, 0, 0);
  const anchored = migrateState(demoStateFor(anchor));
  const atAnchor = getLedgerSnapshot(anchored, anchor);
  assert.equal(atAnchor.currentMonth.income, 2300);
  assert.equal(atAnchor.currentMonth.expenses, 249);

  // Three months later the same figures must appear in THAT month.
  const later = new Date(2026, 10, 15, 12, 0, 0);
  const shifted = migrateState(demoStateFor(later));
  const atLater = getLedgerSnapshot(shifted, later);
  assert.equal(atLater.currentMonth.income, 2300, "income vanished after the calendar moved");
  assert.equal(atLater.currentMonth.expenses, 249, "spending vanished after the calendar moved");
  assert.equal(atLater.currentMonth.surplus, 2051);

  // And a year later, including a February to catch day-clamping bugs.
  const nextYear = new Date(2027, 1, 15, 12, 0, 0);
  const far = migrateState(demoStateFor(nextYear));
  const atFar = getLedgerSnapshot(far, nextYear);
  assert.equal(atFar.currentMonth.income, 2300);
  assert.equal(atFar.currentMonth.expenses, 249);
  for (const transaction of far.ledgerTransactions) {
    assert.ok(Number.isFinite(new Date(transaction.date).getTime()), `invalid date ${transaction.date}`);
  }
});

test("flow: shifting the demo moves dates without changing any other fact", () => {
  const later = new Date(2027, 3, 10, 12, 0, 0);
  const anchored = migrateState(demoStateFor(new Date(2026, 7, 15)));
  const shifted = migrateState(demoStateFor(later));

  // Same records, same money, same portfolio — only the dates moved.
  assert.equal(shifted.ledgerTransactions.length, anchored.ledgerTransactions.length);
  assert.equal(shifted.trades.length, anchored.trades.length);
  assert.equal(shifted.goals.length, anchored.goals.length);
  assert.deepEqual(
    shifted.ledgerTransactions.map((t) => t.amount),
    anchored.ledgerTransactions.map((t) => t.amount),
  );
  assert.equal(getPortfolioSnapshot(shifted).totalInvestedMyr, getPortfolioSnapshot(anchored).totalInvestedMyr);
  assert.equal(getPortfolioSnapshot(shifted).maxAbsoluteDrift, getPortfolioSnapshot(anchored).maxAbsoluteDrift);
});
