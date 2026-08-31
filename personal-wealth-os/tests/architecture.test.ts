import assert from "node:assert/strict";
import { test } from "./testHarness";
import { buildOverviewModel } from "../src/overview";
import { getAdvisorSnapshot, advisorRecommendations, prioritizeRecommendations } from "../src/advisor";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { markRecommendationDone } from "../src/actionRecords";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);

/**
 * These tests guard architectural boundaries rather than behaviour. Behavioural
 * equivalence is already covered by each layer's own suite; what is asserted
 * here is that the layers cannot quietly start depending on each other.
 *
 * The test harness bundles sources into a data: URL, so file-level import
 * checks are not available at runtime. Each boundary is therefore expressed as
 * an observable behaviour: a layer that must not depend on another is exercised
 * in isolation and must still work.
 */

// --- Layering: lower layers build without upper layers ----------------------

test("arch: every canonical read model builds standalone", () => {
  // If any of these had crept a dependency on the Advisor, the UI or
  // persistence, building it in isolation from a plain state would break.
  const state = cloneDefaultState();
  assert.doesNotThrow(() => getLedgerSnapshot(state, NOW), "LedgerSnapshot");
  assert.doesNotThrow(() => getFinancialSnapshot(state, NOW), "FinancialSnapshot");
  assert.doesNotThrow(() => getPortfolioSnapshot(state), "PortfolioSnapshot");
  assert.doesNotThrow(() => getGoalsSnapshot(state), "GoalSnapshot");
  assert.doesNotThrow(() => getBudgetSnapshot(state, NOW), "BudgetSnapshot");
  assert.doesNotThrow(() => detectMoneyLeakFindings(state), "MoneyLeak findings");
});

test("arch: FinancialHealth does not depend on the Advisor", () => {
  const state = cloneDefaultState();
  // Buildable with no Advisor input at all.
  assert.doesNotThrow(() => getFinancialHealthSnapshot(state));
  // The urgency signal is injected, and only escalates the overall status —
  // it can never reach into the factors themselves.
  const without = getFinancialHealthSnapshot(state, NOW, {});
  const with_ = getFinancialHealthSnapshot(state, NOW, { hasUrgentAdvice: true });
  assert.deepEqual(with_.factors, without.factors);
  assert.deepEqual(with_.supportingFacts, without.supportingFacts);
});

test("arch: Money Leaks detection needs no Advisor and emits no advice", () => {
  const state = migrateState({
    deviceId: "arch",
    liabilities: [{ id: "card", name: "Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
  });
  const findings = detectMoneyLeakFindings(state);
  assert.ok(findings.leaks.length > 0, "the detector stands alone");
  const serialized = JSON.stringify(findings);
  for (const advisory of ["why", "recommendation", "primaryAction", "actionLabel", "destination", "impact", "ruleId"]) {
    assert.equal(serialized.includes(`"${advisory}"`), false, `${advisory} is Advisor territory`);
  }
});

// --- OverviewModel is the Dashboard composition root ------------------------

test("arch: OverviewModel exposes every canonical snapshot the Dashboard needs", () => {
  // The Dashboard must be able to render from the model alone. If a snapshot
  // were missing here, the template would have to rebuild it itself.
  const model = buildOverviewModel(cloneDefaultState(), NOW);
  for (const key of ["snapshot", "portfolio", "goals", "budget", "advisor",
                     "wealthHealth", "planStatus", "priorityAction",
                     "trackedWealth", "cashFlow", "briefing", "emergencyRatio"]) {
    assert.ok(key in model, `OverviewModel is missing ${key}`);
  }
});

test("arch: the model's snapshots are the canonical ones, not parallel copies", () => {
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  assert.deepEqual(model.snapshot, getFinancialSnapshot(state, NOW));
  assert.deepEqual(model.portfolio, getPortfolioSnapshot(state));
  assert.deepEqual(model.goals, getGoalsSnapshot(state));
  assert.deepEqual(model.budget, getBudgetSnapshot(state, NOW));
  assert.deepEqual(model.advisor, getAdvisorSnapshot(state, { now: NOW }));
});

test("arch: the Dashboard cannot need a second ranking — the model already ranks", () => {
  const state = migrateState({
    deviceId: "arch",
    cashflow: { allowance: 100, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
    dca: { monthly: 500, targets: { VOO: 0.99, QQQM: 0.01 } },
  });
  const model = buildOverviewModel(state, NOW);
  const advisor = getAdvisorSnapshot(state);
  assert.deepEqual(model.advisor.recommendations.map((r) => r.id), advisor.recommendations.map((r) => r.id));
  assert.equal(model.priorityAction!.recommendationId, advisor.recommendations[0].id);
});

// --- ActionRecord direction -------------------------------------------------

test("arch: ActionRecords never influence Advisor ranking or priority", () => {
  const base = cloneDefaultState();
  const before = getAdvisorSnapshot(base);
  const withRecords: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: before.priority!.id, action: before.priority!.action, now: 1,
    }),
  };
  const after = getAdvisorSnapshot(withRecords);
  assert.deepEqual(after.recommendations.map((r) => r.id), before.recommendations.map((r) => r.id));
  assert.equal(after.priority!.id, before.priority!.id);
  assert.deepEqual(
    prioritizeRecommendations(advisorRecommendations(withRecords)).map((r) => r.id),
    prioritizeRecommendations(advisorRecommendations(base)).map((r) => r.id),
  );
});

test("arch: ActionRecords never influence any other read model", () => {
  const base = cloneDefaultState();
  const withRecords: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: "advisor:dca-mandate", action: "x", now: 1,
    }),
  };
  assert.deepEqual(getLedgerSnapshot(withRecords, NOW), getLedgerSnapshot(base, NOW));
  assert.deepEqual(getFinancialSnapshot(withRecords, NOW), getFinancialSnapshot(base, NOW));
  assert.deepEqual(getPortfolioSnapshot(withRecords), getPortfolioSnapshot(base));
  assert.deepEqual(getGoalsSnapshot(withRecords), getGoalsSnapshot(base));
  assert.deepEqual(getBudgetSnapshot(withRecords, NOW), getBudgetSnapshot(base, NOW));
  assert.deepEqual(getFinancialHealthSnapshot(withRecords, NOW), getFinancialHealthSnapshot(base, NOW));
  assert.deepEqual(detectMoneyLeakFindings(withRecords), detectMoneyLeakFindings(base));
});

test("arch: an ActionRecord stores execution state, never a copy of the advice", () => {
  const base = cloneDefaultState();
  const priority = getAdvisorSnapshot(base).priority!;
  const records = markRecommendationDone([], {
    id: "a1", recommendationId: priority.id, action: priority.action, now: 1,
  });
  assert.deepEqual(Object.keys(records[0]).sort(),
    ["action", "completedAt", "createdAt", "id", "recommendationId", "status"].sort());
  const serialized = JSON.stringify(records[0]);
  for (const owned of ["title", "severity", "impact", "destination", "ruleId", "fact", "evidence"]) {
    assert.equal(serialized.includes(`"${owned}"`), false, `${owned} belongs to the Advisor`);
  }
});

// --- Read models are pure, unpersisted and side-effect free -----------------

test("arch: no read model mutates the state or adds persisted fields", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  const keysBefore = Object.keys(state);

  getLedgerSnapshot(state, NOW);
  getFinancialSnapshot(state, NOW);
  getPortfolioSnapshot(state);
  getGoalsSnapshot(state);
  getBudgetSnapshot(state, NOW);
  getFinancialHealthSnapshot(state, NOW);
  getAdvisorSnapshot(state);
  detectMoneyLeakFindings(state);
  buildOverviewModel(state, NOW);

  assert.equal(JSON.stringify(state), before, "state was mutated");
  assert.deepEqual(Object.keys(state), keysBefore, "a field was added to the state");
});

test("arch: no read model leaks persistence or AI state", () => {
  const state = cloneDefaultState();
  const serialized = JSON.stringify({
    overview: buildOverviewModel(state, NOW),
    health: getFinancialHealthSnapshot(state, NOW),
    advisor: getAdvisorSnapshot(state),
  });
  for (const forbidden of ["dismissed", "snoozed", "firebase", "uid", "prompt", "completion", "apiKey"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} must not appear in a read model`);
  }
});

// --- Persisted schema -------------------------------------------------------

test("arch: every earlier persisted state migrates to the current version", () => {
  for (const version of [3, 10, 11, 15, 16, 17, 18]) {
    const migrated = migrateState({ version, deviceId: `v${version}` });
    assert.equal(migrated.version, CURRENT_VERSION, `v${version} did not migrate`);
    assert.ok(Array.isArray(migrated.actionRecords), `v${version} missing actionRecords`);
    assert.ok(Array.isArray(migrated.financialRules), `v${version} missing financialRules`);
  }
});

test("arch: a state carrying malformed records still migrates cleanly", () => {
  const migrated = migrateState({
    version: 16,
    deviceId: "d",
    actionRecords: [null, { id: "x" }, 42] as never,
    financialRules: [null, "nope"] as never,
    trades: [{ id: "keep", date: "2026-01-02", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23, priceUsd: 500, feeMyr: 2 }],
  });
  assert.deepEqual(migrated.actionRecords, []);
  assert.deepEqual(migrated.financialRules, []);
  assert.equal(migrated.trades.length, 1, "real data survives malformed neighbours");
});

// --- Nothing broke ----------------------------------------------------------

test("arch: canonical figures are unchanged for the default state", () => {
  // A regression net over the whole pipeline: if any layer quietly changed a
  // formula during cleanup, one of these would move.
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  const financial = getFinancialSnapshot(state, NOW);
  const ledger = getLedgerSnapshot(state, NOW);

  assert.equal(model.netWorth, financial.netWorth);
  assert.equal(model.netWorth, financial.totalAssets - financial.totalLiabilities);
  assert.equal(model.cashFlow.income, ledger.currentMonth.income);
  assert.equal(model.cashFlow.expenses, ledger.currentMonth.expenses);
  assert.equal(model.cashFlow.surplus, ledger.currentMonth.surplus);
  assert.equal(model.trackedWealth.total,
    model.trackedWealth.invested + model.trackedWealth.safety + model.trackedWealth.reserve);
});

test("arch: every layer survives an empty state", () => {
  const state = emptyState();
  assert.doesNotThrow(() => {
    getLedgerSnapshot(state, NOW);
    getFinancialSnapshot(state, NOW);
    getPortfolioSnapshot(state);
    getGoalsSnapshot(state);
    getBudgetSnapshot(state, NOW);
    getFinancialHealthSnapshot(state, NOW);
    getAdvisorSnapshot(state);
    detectMoneyLeakFindings(state);
    buildOverviewModel(state, NOW);
  });
});
