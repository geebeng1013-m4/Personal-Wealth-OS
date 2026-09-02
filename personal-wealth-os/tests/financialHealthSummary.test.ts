import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  getFinancialHealthSnapshot,
  getHealthFactor,
  getPlanExecution,
  worstStatus,
  type HealthFactorId,
} from "../src/financialHealthSummary";
import { getFinancialSnapshot } from "../src/financialHealth";
import { buildOverviewModel } from "../src/overview";
import { advisorRecommendations } from "../src/advisor";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { emergencyRatio } from "../src/rules";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { LedgerAccount, LedgerTransaction, Trade, WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0); // 2026-08-15 local
const STATUSES = new Set(["healthy", "watch", "action"]);
const FACTOR_IDS: HealthFactorId[] = ["safetyBuffer", "cashFlow", "budget", "planExecution", "debtLoad"];

function iso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0).toISOString();
}

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-health", ...overrides });
}

const accounts: LedgerAccount[] = [
  { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 5000 },
];

// --- A. construction --------------------------------------------------------

test("health/A: a snapshot builds from state with the expected shape", () => {
  const snapshot = getFinancialHealthSnapshot(cloneDefaultState(), NOW);
  assert.ok(STATUSES.has(snapshot.status));
  assert.ok(snapshot.label.length > 0);
  assert.ok(snapshot.summary.length > 0);
  assert.equal(snapshot.factors.length, 5);
  assert.deepEqual(snapshot.factors.map((f) => f.id), FACTOR_IDS, "ordered safety, cash flow, budget, plan, debt");
  for (const factor of snapshot.factors) {
    assert.ok(STATUSES.has(factor.status), `${factor.id} bad status`);
    assert.ok(factor.label.length > 0);
    assert.ok(factor.detail.length > 0);
  }
});

// --- B. overall status ------------------------------------------------------

test("health/B: overall status is the worst factor status", () => {
  const state = stateWith({
    emergency: { current: 0, target: 5000, annualYield: 0, monthlyTopUp: 0 }, // action
  });
  const snapshot = getFinancialHealthSnapshot(state, NOW);
  assert.equal(getHealthFactor(snapshot, "safetyBuffer")!.status, "action");
  assert.equal(snapshot.status, "action");
});

test("health/B: an urgent Advisor signal escalates the overall status", () => {
  // All five factors healthy on their own...
  const healthyState = stateWith({
    emergency: { current: 5000, target: 5000, annualYield: 0, monthlyTopUp: 0 },
    dca: { monthly: 0, targets: { VOO: 1 } },
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "i1", amount: 1000, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
    ] as LedgerTransaction[],
  });
  const without = getFinancialHealthSnapshot(healthyState, NOW, { hasUrgentAdvice: false });
  const with_ = getFinancialHealthSnapshot(healthyState, NOW, { hasUrgentAdvice: true });

  assert.equal(without.status, "healthy");
  assert.equal(with_.status, "action", "an Advisor action is itself a health signal");
  assert.deepEqual(with_.factors, without.factors, "the factors themselves are unaffected");
});

test("health/B: worstStatus follows action > watch > healthy", () => {
  assert.equal(worstStatus(["healthy", "healthy"]), "healthy");
  assert.equal(worstStatus(["healthy", "watch"]), "watch");
  assert.equal(worstStatus(["watch", "action", "healthy"]), "action");
  assert.equal(worstStatus([]), "healthy");
});

test("health/B: the summary matches the status", () => {
  const map = {
    healthy: "Every tracked area is within its target range.",
    watch: "Most areas are fine, but some need attention.",
    action: "One or more areas need action now.",
  };
  for (const state of [cloneDefaultState(), emptyState(), stateWith()]) {
    const snapshot = getFinancialHealthSnapshot(state, NOW);
    assert.equal(snapshot.summary, map[snapshot.status]);
  }
});

// --- C. safety buffer -------------------------------------------------------

test("health/C: safety buffer thresholds are 100% healthy, 50% watch, below action", () => {
  const cases: Array<[number, number, string]> = [
    [5000, 5000, "healthy"],
    [6000, 5000, "healthy"],
    [2500, 5000, "watch"],
    [4999, 5000, "watch"],
    [2499, 5000, "action"],
    [0, 5000, "action"],
  ];
  for (const [current, target, expected] of cases) {
    const state = stateWith({ emergency: { current, target, annualYield: 0, monthlyTopUp: 0 } });
    const factor = getHealthFactor(getFinancialHealthSnapshot(state, NOW), "safetyBuffer")!;
    assert.equal(factor.status, expected, `${current}/${target}`);
  }
});

test("health/C: safety buffer reports the ratio it is judged on", () => {
  const state = stateWith({ emergency: { current: 3000, target: 5000, annualYield: 0, monthlyTopUp: 0 } });
  const factor = getHealthFactor(getFinancialHealthSnapshot(state, NOW), "safetyBuffer")!;
  assert.equal(factor.value, emergencyRatio(state));
  assert.equal(factor.target, 1);
  assert.equal(factor.detail, "60% funded");
});

// --- D. cash flow -----------------------------------------------------------

test("health/D: cash flow status follows the recorded surplus sign", () => {
  const base = { ledgerAccounts: accounts };
  const positive = stateWith({
    ...base,
    ledgerTransactions: [
      { id: "i1", amount: 500, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
    ] as LedgerTransaction[],
  });
  const negative = stateWith({
    ...base,
    ledgerTransactions: [
      { id: "e1", amount: 500, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 3) },
    ] as LedgerTransaction[],
  });
  const zero = stateWith(base);

  assert.equal(getHealthFactor(getFinancialHealthSnapshot(positive, NOW), "cashFlow")!.status, "healthy");
  assert.equal(getHealthFactor(getFinancialHealthSnapshot(zero, NOW), "cashFlow")!.status, "watch");
  assert.equal(getHealthFactor(getFinancialHealthSnapshot(negative, NOW), "cashFlow")!.status, "action");
});

test("health/D: cash flow reads the canonical recorded surplus", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "i1", amount: 900, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
      { id: "e1", amount: 400, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
  });
  const factor = getHealthFactor(getFinancialHealthSnapshot(state, NOW), "cashFlow")!;
  assert.equal(factor.value, getFinancialSnapshot(state, NOW).currentMonthSurplus);
  assert.equal(factor.value, 500);
  assert.equal(factor.detail, "Spending within income");
});

// --- E. plan execution ------------------------------------------------------

function tradeThisMonth(id: string, amountMyr: number): Trade {
  return { id, date: iso(2026, 7, 5), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr, amountUsd: 0, priceUsd: 1, feeMyr: 0 };
}

test("health/E: plan execution is healthy when on track and watch otherwise", () => {
  const onTrack = stateWith({ dca: { monthly: 100, targets: { VOO: 1 } }, trades: [tradeThisMonth("t1", 100)] });
  const behind = stateWith({ dca: { monthly: 100, targets: { VOO: 1 } }, trades: [tradeThisMonth("t1", 40)] });
  const none = stateWith({ dca: { monthly: 100, targets: { VOO: 1 } }, trades: [] });

  assert.equal(getHealthFactor(getFinancialHealthSnapshot(onTrack, NOW), "planExecution")!.status, "healthy");
  assert.equal(getHealthFactor(getFinancialHealthSnapshot(behind, NOW), "planExecution")!.status, "watch");
  assert.equal(getHealthFactor(getFinancialHealthSnapshot(none, NOW), "planExecution")!.status, "watch");
});

test("health/E: plan execution wording matches the Plan Status labels", () => {
  const cases: Array<[WealthState, string]> = [
    [stateWith({ dca: { monthly: 100, targets: { VOO: 1 } }, trades: [tradeThisMonth("t", 100)] }), "On plan"],
    [stateWith({ dca: { monthly: 100, targets: { VOO: 1 } }, trades: [tradeThisMonth("t", 40)] }), "Partially funded"],
    [stateWith({ dca: { monthly: 100, targets: { VOO: 1 } }, trades: [] }), "Not yet funded"],
  ];
  for (const [state, expected] of cases) {
    const factor = getHealthFactor(getFinancialHealthSnapshot(state, NOW), "planExecution")!;
    assert.equal(factor.detail, expected);
    // ...and it agrees with the Overview's own Plan Status section.
    assert.equal(buildOverviewModel(state, NOW).planStatus.label, expected);
  }
});

test("health/E: plan execution and the Overview share one computation", () => {
  const state = stateWith({ dca: { monthly: 250, targets: { VOO: 1 } }, trades: [tradeThisMonth("t", 90)] });
  const plan = getPlanExecution(state, NOW);
  const overviewPlan = buildOverviewModel(state, NOW).planStatus;
  assert.equal(plan.plannedAmount, overviewPlan.plannedAmount);
  assert.equal(plan.actualAmount, overviewPlan.actualAmount);
  assert.equal(plan.progress, overviewPlan.progress);
  assert.equal(plan.onTrack, overviewPlan.onTrack);

  const factor = getHealthFactor(getFinancialHealthSnapshot(state, NOW), "planExecution")!;
  assert.equal(factor.value, plan.actualAmount);
  assert.equal(factor.target, plan.plannedAmount);
});

test("health/E: sells and other months never count as contributions", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [
      { ...tradeThisMonth("sell", 500), type: "Sell" },
      { ...tradeThisMonth("old", 500), date: iso(2026, 6, 5) },
    ],
  });
  assert.equal(getPlanExecution(state, NOW).actualAmount, 0);
});

// --- F. debt load -----------------------------------------------------------

test("health/F: debt load is healthy with none, watch when covered, action when exceeding assets", () => {
  const noDebt = stateWith({ ledgerAccounts: accounts });
  const covered = stateWith({
    ledgerAccounts: accounts,
    liabilities: [{ id: "l", name: "Card", balance: 1000, annualRate: 0.1, minimumPayment: 50 }],
  });
  const exceeding = stateWith({
    ledgerAccounts: accounts,
    liabilities: [{ id: "l", name: "Loan", balance: 50000, annualRate: 0.1, minimumPayment: 500 }],
  });

  assert.equal(getHealthFactor(getFinancialHealthSnapshot(noDebt, NOW), "debtLoad")!.status, "healthy");
  assert.equal(getHealthFactor(getFinancialHealthSnapshot(covered, NOW), "debtLoad")!.status, "watch");
  assert.equal(getHealthFactor(getFinancialHealthSnapshot(exceeding, NOW), "debtLoad")!.status, "action");
});

test("health/F: debt load reports liabilities against assets", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    liabilities: [{ id: "l", name: "Card", balance: 1200, annualRate: 0.1, minimumPayment: 50 }],
  });
  const financial = getFinancialSnapshot(state, NOW);
  const factor = getHealthFactor(getFinancialHealthSnapshot(state, NOW), "debtLoad")!;
  assert.equal(factor.value, financial.totalLiabilities);
  assert.equal(factor.target, financial.totalAssets);
  assert.equal(factor.detail, "Debt recorded against assets");
});

// --- G. the Dashboard consumes the canonical health -------------------------

test("health/G: the Overview model's wealthHealth IS the canonical snapshot", () => {
  for (const state of [cloneDefaultState(), stateWith(), emptyState()]) {
    const model = buildOverviewModel(state, NOW);
    const canonical = getFinancialHealthSnapshot(state, NOW, {
      hasUrgentAdvice: advisorRecommendations(state).some((r) => r.severity === "action"),
    });
    assert.equal(model.wealthHealth.status, canonical.status);
    assert.equal(model.wealthHealth.label, canonical.label);
    assert.equal(model.wealthHealth.summary, canonical.summary);
    assert.deepEqual(
      model.wealthHealth.factors.map((f) => `${f.label}:${f.status}:${f.detail}`),
      canonical.factors.map((f) => `${f.label}:${f.status}:${f.detail}`),
    );
  }
});

test("health/G: the Dashboard still shows the five expected factors", () => {
  const model = buildOverviewModel(cloneDefaultState(), NOW);
  assert.deepEqual(model.wealthHealth.factors.map((f) => f.label),
    ["Safety buffer", "Cash flow", "Budget", "Plan execution", "Debt load"]);
});

// --- H & I. no advice leaks in ----------------------------------------------

test("health/H: the snapshot contains no recommendation or action fields", () => {
  const serialized = JSON.stringify(getFinancialHealthSnapshot(cloneDefaultState(), NOW));
  for (const forbidden of ["recommendation", "action", "actionLabel", "destination", "severity", "impact", "ruleId", "fact"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} belongs to the Advisor`);
  }
});

test("health/H: the snapshot exposes exactly the expected keys", () => {
  const snapshot = getFinancialHealthSnapshot(cloneDefaultState(), NOW);
  assert.deepEqual(Object.keys(snapshot).sort(), ["factors", "label", "status", "summary", "supportingFacts"].sort());
  for (const factor of snapshot.factors) {
    assert.deepEqual(Object.keys(factor).sort(), ["detail", "id", "label", "status", "target", "value"].sort());
  }
});

test("health/H: factor detail text never gives instructions", () => {
  const imperatives = ["you should", "consider ", "reduce ", "increase ", "top up", "review "];
  for (const state of [cloneDefaultState(), emptyState(), stateWith()]) {
    for (const factor of getFinancialHealthSnapshot(state, NOW).factors) {
      const detail = factor.detail.toLowerCase();
      for (const phrase of imperatives) {
        assert.equal(detail.includes(phrase), false, `${factor.id} gives advice: "${factor.detail}"`);
      }
    }
  }
});

test("health/I: the Advisor can consume health facts, and health produces none of its advice", () => {
  const state = cloneDefaultState();
  const snapshot = getFinancialHealthSnapshot(state, NOW);
  const recommendations = advisorRecommendations(state);
  // The Advisor still produces the recommendations...
  assert.ok(recommendations.length > 0);
  for (const recommendation of recommendations) {
    assert.ok(recommendation.action.length > 0);
  }
  // ...and none of that copy appears in the health snapshot.
  const serialized = JSON.stringify(snapshot);
  for (const recommendation of recommendations) {
    assert.equal(serialized.includes(recommendation.action), false,
      `advisor copy leaked into the health snapshot: ${recommendation.action}`);
  }
});

// --- J & K. safety and purity -----------------------------------------------

test("health/J: empty and partial states do not crash", () => {
  const partial = migrateState({ deviceId: "d", trades: [], liabilities: [], ledgerTransactions: [] });
  for (const [label, state] of [["empty", emptyState()], ["partial", partial], ["default", cloneDefaultState()]] as const) {
    const snapshot = getFinancialHealthSnapshot(state, NOW);
    assert.ok(STATUSES.has(snapshot.status), `${label} bad status`);
    assert.equal(snapshot.factors.length, 5, `${label} missing factors`);
    for (const [key, value] of Object.entries(snapshot.supportingFacts)) {
      assert.ok(Number.isFinite(value), `${label}: ${key} is not finite`);
    }
    for (const factor of snapshot.factors) {
      assert.ok(factor.value === null || Number.isFinite(factor.value), `${label}: ${factor.id} value`);
      assert.ok(factor.target === null || Number.isFinite(factor.target), `${label}: ${factor.id} target`);
      assert.ok(!factor.detail.includes("NaN"), `${label}: ${factor.id} leaked NaN`);
    }
  }
});

test("health/J: a zero emergency target does not divide by zero", () => {
  const state = stateWith({ emergency: { current: 0, target: 0, annualYield: 0, monthlyTopUp: 0 } });
  const factor = getHealthFactor(getFinancialHealthSnapshot(state, NOW), "safetyBuffer")!;
  assert.ok(Number.isFinite(factor.value!));
  assert.ok(!factor.detail.includes("NaN"));
});

test("health/K: the snapshot does not mutate WealthState", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  const keysBefore = Object.keys(state);
  getFinancialHealthSnapshot(state, NOW, { hasUrgentAdvice: true });
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(Object.keys(state), keysBefore);
  for (const forbidden of ["healthSnapshot", "financialHealth", "status"]) {
    assert.equal(keysBefore.includes(forbidden), false, `${forbidden} must not be persisted`);
  }
  assert.equal(state.version, CURRENT_VERSION);
  // Read models never migrate: the version is whatever the schema says.
  assert.ok(Number.isInteger(CURRENT_VERSION) && CURRENT_VERSION > 0);
});

test("health: the snapshot is pure and deterministic", () => {
  const state = cloneDefaultState();
  assert.deepEqual(
    getFinancialHealthSnapshot(state, NOW, { hasUrgentAdvice: false }),
    getFinancialHealthSnapshot(state, new Date(NOW), { hasUrgentAdvice: false }),
  );
});

// --- Boundaries unchanged ---------------------------------------------------

test("health: Money Leak detection is unchanged", () => {
  const state = stateWith({
    liabilities: [{ id: "card", name: "Credit Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
  });
  const debt = detectMoneyLeakFindings(state).leaks.find((leak) => leak.id === "debt-card");
  assert.equal(debt!.monthlyImpact, 6000 * 0.18 / 12);
  assert.equal(debt!.confidence, 0.99);
});
