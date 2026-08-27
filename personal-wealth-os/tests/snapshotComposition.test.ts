import assert from "node:assert/strict";
import { test } from "./testHarness";
import { buildOverviewModel } from "../src/overview";
import { getAdvisorSnapshot, advisorRecommendations, ADVISOR_RECOMMENDATION_IDS } from "../src/advisor";
import { getFinancialHealthSnapshot, getPlanExecution } from "../src/financialHealthSummary";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { cloneDefaultState, migrateState } from "../src/state";

const NOW = new Date(2026, 7, 15, 12, 0, 0);

/**
 * Step 16 guards: the Overview builds each canonical snapshot once and threads
 * it downstream. Reuse is only safe because these builders are pure — so what
 * is asserted here is that injecting a snapshot produces exactly the same
 * result as letting the callee build it, and that the injected value is really
 * consumed (otherwise the "reuse" would be a lie and the second build would
 * still be happening).
 */

// --- Injection is transparent: same answer either way --------------------

test("composition: FinancialSnapshot is identical with and without an injected ledger", () => {
  const state = cloneDefaultState();
  const ledger = getLedgerSnapshot(state, NOW);
  assert.deepEqual(getFinancialSnapshot(state, NOW, ledger), getFinancialSnapshot(state, NOW));
});

test("composition: BudgetSnapshot is identical with and without an injected ledger", () => {
  const state = cloneDefaultState();
  const ledger = getLedgerSnapshot(state, NOW);
  assert.deepEqual(getBudgetSnapshot(state, NOW, ledger), getBudgetSnapshot(state, NOW));
});

test("composition: HealthSnapshot is identical with and without injected inputs", () => {
  const state = cloneDefaultState();
  const snapshot = getFinancialSnapshot(state, NOW);
  const plan = getPlanExecution(state, NOW);
  for (const signals of [{}, { hasUrgentAdvice: true }]) {
    assert.deepEqual(
      getFinancialHealthSnapshot(state, NOW, signals, { snapshot, plan }),
      getFinancialHealthSnapshot(state, NOW, signals),
    );
  }
});

test("composition: Advisor is identical with and without injected canonical facts", () => {
  for (const state of [cloneDefaultState(), volatileState()]) {
    const inputs = {
      snapshot: getFinancialSnapshot(state),
      portfolio: getPortfolioSnapshot(state),
      budget: getBudgetSnapshot(state),
    };
    assert.deepEqual(advisorRecommendations(state, inputs), advisorRecommendations(state));
    assert.deepEqual(getAdvisorSnapshot(state, inputs), getAdvisorSnapshot(state));
    // Omitted inputs must behave exactly like no inputs at all.
    assert.deepEqual(advisorRecommendations(state, {}), advisorRecommendations(state));
  }
});

// --- Injection is actually consumed, so the rebuild is genuinely skipped ---
//
// If a builder ignored the injected snapshot and silently rebuilt its own, the
// tests above would still pass. These prove the injected value reaches the
// calculation — which is what makes the call-count reduction real.

test("composition: an injected budget is what the cashflow rule reads", () => {
  const state = cloneDefaultState();
  const budget = { ...getBudgetSnapshot(state), plannedSurplus: -99999 };
  const recommendation = advisorRecommendations(state, { budget })
    .find((r) => r.id === ADVISOR_RECOMMENDATION_IDS.cashflowDiscipline);
  assert.ok(recommendation, "cashflow recommendation is present");
  assert.equal(recommendation.severity, "action", "the injected surplus drove the verdict");
  assert.ok(recommendation.fact.includes("99,999"), `injected surplus not used: ${recommendation.fact}`);
});

test("composition: an injected portfolio is what the drift rule reads", () => {
  const state = cloneDefaultState();
  const portfolio = { ...getPortfolioSnapshot(state), maxAbsoluteDrift: 0.99 };
  const recommendation = advisorRecommendations(state, { portfolio })
    .find((r) => r.id === ADVISOR_RECOMMENDATION_IDS.allocationDrift);
  assert.ok(recommendation, "drift recommendation is present");
  assert.equal(recommendation.severity, "action", "the injected drift drove the verdict");
});

test("composition: an injected ledger is what the financial snapshot reads", () => {
  // totalAssets is ledger balance PLUS the portfolio's contribution, so the
  // ledger's share of a doctored value must be isolated from the portfolio's.
  const state = cloneDefaultState();
  const ledger = getLedgerSnapshot(state, NOW);
  const doctored = { ...ledger, totalPositiveBalance: 123456 };
  const snapshot = getFinancialSnapshot(state, NOW, doctored);
  assert.equal(snapshot.totalAssets, 123456 + snapshot.portfolioValueMyr);
});

test("composition: an injected plan is what the health factor reads", () => {
  const state = cloneDefaultState();
  const plan = { plannedAmount: 500, actualAmount: 0, progress: 0, onTrack: false, hasActual: false };
  const health = getFinancialHealthSnapshot(state, NOW, {}, { plan });
  assert.equal(health.supportingFacts.actualContribution, 0);
  assert.equal(health.supportingFacts.plannedContribution, 500);
});

// --- The Overview's own snapshots stay canonical --------------------------

test("composition: every snapshot on the model equals its canonical builder", () => {
  for (const state of [cloneDefaultState(), volatileState()]) {
    const model = buildOverviewModel(state, NOW);
    assert.deepEqual(model.snapshot, getFinancialSnapshot(state, NOW));
    assert.deepEqual(model.portfolio, getPortfolioSnapshot(state));
    assert.deepEqual(model.goals, getGoalsSnapshot(state));
    assert.deepEqual(model.budget, getBudgetSnapshot(state, NOW));
    assert.deepEqual(model.wealthHealth.factors, getFinancialHealthSnapshot(state, NOW, {
      hasUrgentAdvice: model.advisor.recommendations.some((r) => r.severity === "action"),
    }).factors);
  }
});

test("composition: the Advisor on the model equals the standalone Advisor", () => {
  // The Advisor page builds its own snapshot with no injected facts. It must
  // agree with the Dashboard's, or the two screens would disagree on priority.
  for (const state of [cloneDefaultState(), volatileState()]) {
    const model = buildOverviewModel(state, NOW);
    assert.deepEqual(model.advisor, getAdvisorSnapshot(state));
  }
});

test("composition: the model's plan status agrees with the canonical plan facts", () => {
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  const plan = getPlanExecution(state, NOW);
  assert.equal(model.planStatus.plannedAmount, plan.plannedAmount);
  assert.equal(model.planStatus.actualAmount, plan.actualAmount);
  assert.equal(model.planStatus.progress, plan.progress);
  assert.equal(model.planStatus.onTrack, plan.onTrack);
  assert.equal(model.wealthHealth.supportingFacts.actualContribution, plan.actualAmount);
});

// --- `now` reaches every layer -------------------------------------------

test("composition: one `now` governs the whole model, including the budget", () => {
  // The budget used to be built without `now`, so it silently read the real
  // clock while everything else honoured the caller's date.
  const state = cloneDefaultState();
  const earlier = new Date(2026, 0, 15, 12, 0, 0);
  const model = buildOverviewModel(state, earlier);
  assert.deepEqual(model.budget, getBudgetSnapshot(state, earlier));
  assert.deepEqual(model.snapshot, getFinancialSnapshot(state, earlier));
  assert.equal(model.cashFlow.income, getLedgerSnapshot(state, earlier).currentMonth.income);
});

// --- No caching, no stale data -------------------------------------------

test("composition: the model is rebuilt from state every time, never cached", () => {
  const state = cloneDefaultState();
  const before = buildOverviewModel(state, NOW);
  const changed = { ...state, emergency: { ...state.emergency, current: state.emergency.current + 5000 } };
  const after = buildOverviewModel(changed, NOW);
  assert.notDeepEqual(after.trackedWealth, before.trackedWealth, "a state change must be visible");
  assert.equal(after.trackedWealth.safety, before.trackedWealth.safety + 5000);
  // And rebuilding the original state returns the original answer.
  assert.deepEqual(buildOverviewModel(state, NOW), before);
});

test("composition: building the model twice gives the same answer and mutates nothing", () => {
  const state = cloneDefaultState();
  const serialized = JSON.stringify(state);
  const first = buildOverviewModel(state, NOW);
  const second = buildOverviewModel(state, NOW);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(state), serialized, "state was mutated");
});

// --- Money Leaks are untouched -------------------------------------------

test("composition: Money Leaks findings are unaffected by snapshot reuse", () => {
  for (const state of [cloneDefaultState(), volatileState()]) {
    const before = detectMoneyLeakFindings(state);
    buildOverviewModel(state, NOW);
    assert.deepEqual(detectMoneyLeakFindings(state), before);
    assert.deepEqual(getAdvisorSnapshot(state, {
      snapshot: getFinancialSnapshot(state),
      portfolio: getPortfolioSnapshot(state),
      budget: getBudgetSnapshot(state),
    }).leakRecommendations, getAdvisorSnapshot(state).leakRecommendations);
  }
});

/** A state that trips several rules, so the assertions are not all trivially equal. */
function volatileState() {
  return migrateState({
    deviceId: "step16",
    cashflow: { allowance: 300, transport: 200, food: 250, otherFixed: 100, irregularIncome: 0 },
    dca: { monthly: 800, targets: { VOO: 0.6, QQQM: 0.4 } },
    emergency: { current: 500, target: 6000, monthlyTopUp: 100 },
    liabilities: [{ id: "card", name: "Card", balance: 9000, annualRate: 0.18, minimumPayment: 250 }],
    trades: [
      { id: "t1", date: "2026-08-02", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 300, amountUsd: 70, priceUsd: 500, feeMyr: 3 },
    ],
  });
}
