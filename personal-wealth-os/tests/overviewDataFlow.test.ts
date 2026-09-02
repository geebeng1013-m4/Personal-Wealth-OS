import assert from "node:assert/strict";
import { test } from "./testHarness";
import { buildOverviewModel, trackedCapital } from "../src/overview";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { getAdvisorSnapshot, advisorRecommendations } from "../src/advisor";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { LedgerAccount, LedgerTransaction, WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);

function iso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0).toISOString();
}

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-overview-flow", ...overrides });
}

const accounts: LedgerAccount[] = [
  { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 5000 },
];

/** A state with activity across every domain the Dashboard renders. */
function richState(): WealthState {
  return stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "i1", amount: 3000, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
      { id: "e1", amount: 420, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 5) },
      { id: "p1", amount: 300, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 6, 5) },
    ] as LedgerTransaction[],
    liabilities: [{ id: "card", name: "Card", balance: 2000, annualRate: 0.18, minimumPayment: 100 }],
  });
}

// --- A & B. financial snapshot ---------------------------------------------

test("flow/A: Dashboard headline metrics equal the canonical FinancialSnapshot", () => {
  const state = richState();
  const model = buildOverviewModel(state, NOW);
  const financial = getFinancialSnapshot(state, NOW);

  assert.equal(model.netWorth, financial.netWorth);
  assert.equal(model.totalAssets, financial.totalAssets);
  assert.equal(model.totalLiabilities, financial.totalLiabilities);
  assert.equal(model.cashFlow.income, financial.currentMonthIncome);
  assert.equal(model.cashFlow.expenses, financial.currentMonthExpenses);
  assert.equal(model.cashFlow.surplus, financial.currentMonthSurplus);
  assert.deepEqual(model.snapshot, financial, "the model carries the snapshot itself");
});

test("flow/B: the month-over-month trend is derived from the canonical ledger months", () => {
  const state = richState();
  const model = buildOverviewModel(state, NOW);
  const ledger = getLedgerSnapshot(state, NOW);
  assert.equal(
    model.cashFlow.expenseChange,
    (ledger.currentMonth.expenses - ledger.previousMonth.expenses) / ledger.previousMonth.expenses,
  );
  assert.equal(ledger.currentMonth.expenses, 420);
  assert.equal(ledger.previousMonth.expenses, 300);
});

test("flow/B: the model never restates a metric that disagrees with its snapshot", () => {
  for (const state of [cloneDefaultState(), richState(), emptyState()]) {
    const model = buildOverviewModel(state, NOW);
    assert.equal(model.netWorth, model.snapshot.netWorth);
    assert.equal(model.cashFlow.income, model.snapshot.currentMonthIncome);
    assert.equal(model.cashFlow.expenses, model.snapshot.currentMonthExpenses);
    assert.equal(model.cashFlow.surplus, model.snapshot.currentMonthSurplus);
  }
});

// --- C. wealth health -------------------------------------------------------

test("flow/C: Wealth Health equals the canonical FinancialHealthSnapshot", () => {
  for (const state of [cloneDefaultState(), richState()]) {
    const model = buildOverviewModel(state, NOW);
    const canonical = getFinancialHealthSnapshot(state, NOW, {
      hasUrgentAdvice: advisorRecommendations(state).some((r) => r.severity === "action"),
    });
    assert.equal(model.wealthHealth.status, canonical.status);
    assert.equal(model.wealthHealth.label, canonical.label);
    assert.equal(model.wealthHealth.summary, canonical.summary);
    assert.deepEqual(
      model.wealthHealth.factors.map((f) => `${f.label}:${f.status}`),
      canonical.factors.map((f) => `${f.label}:${f.status}`),
    );
  }
});

test("flow/C: the emergency ratio comes from the health facts, not a second call", () => {
  const state = richState();
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.emergencyRatio, model.wealthHealth.supportingFacts.emergencyRatio);
});

// --- D. plan status ---------------------------------------------------------

test("flow/D: Plan Status figures agree with the canonical budget snapshot", () => {
  const state = stateWith({ dca: { monthly: 300, targets: { VOO: 1 } } });
  const model = buildOverviewModel(state, NOW);
  const budget = getBudgetSnapshot(state, NOW);

  assert.deepEqual(model.budget, budget, "the model carries the budget snapshot");
  assert.equal(model.planStatus.plannedAmount, budget.plannedDcaAmount);
  assert.equal(model.budget.planCoversDca, budget.planCoversDca);
  assert.equal(model.budget.plannedSurplus, budget.plannedSurplus);
});

test("flow/D: plan progress is not recomputed by the Dashboard", () => {
  const state = stateWith({
    dca: { monthly: 200, targets: { VOO: 1 } },
    trades: [{ id: "t1", date: iso(2026, 7, 5), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 80, amountUsd: 19, priceUsd: 600, feeMyr: 0 }],
  });
  const plan = buildOverviewModel(state, NOW).planStatus;
  assert.equal(plan.plannedAmount, 200);
  assert.equal(plan.actualAmount, 80);
  assert.equal(plan.progress, 0.4);
  assert.equal(plan.onTrack, false);
});

// --- E & H. priority action -------------------------------------------------

test("flow/E: Priority Action id equals AdvisorSnapshot.priority.id", () => {
  for (const state of [cloneDefaultState(), richState(), emptyState()]) {
    const model = buildOverviewModel(state, NOW);
    const advisor = getAdvisorSnapshot(state, { now: NOW });
    assert.equal(model.priorityAction!.recommendationId, advisor.priority!.id);
    assert.equal(model.priorityAction!.title, advisor.priority!.title);
    assert.equal(model.priorityAction!.actionLabel, advisor.priority!.action);
    assert.equal(model.priorityAction!.severity, advisor.priority!.severity);
    assert.deepEqual(model.advisor, advisor, "the model carries the advisor snapshot");
  }
});

test("flow/H: the Dashboard does not re-rank recommendations", () => {
  const state = stateWith({
    cashflow: { allowance: 100, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
    dca: { monthly: 500, targets: { VOO: 0.99, QQQM: 0.01 } },
  });
  const model = buildOverviewModel(state, NOW);
  const advisor = getAdvisorSnapshot(state, { now: NOW });
  // The model's list IS the ranked list, in the same order.
  assert.deepEqual(model.advisor.recommendations.map((r) => r.id), advisor.recommendations.map((r) => r.id));
  assert.equal(model.priorityAction!.recommendationId, advisor.recommendations[0].id);
});

test("flow/H: the briefing quotes the same recommendation as the priority", () => {
  const state = richState();
  const model = buildOverviewModel(state, NOW);
  const priority = model.advisor.priority!;
  assert.equal(model.briefing, `${priority.fact} ${priority.action}`.trim());
});

// --- F & I. goals -----------------------------------------------------------

test("flow/F: the featured goal equals GoalSnapshot.featured", () => {
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  const goals = getGoalsSnapshot(state);
  assert.deepEqual(model.goals, goals, "the model carries the goals snapshot");
  assert.equal(model.goals.featured!.id, goals.featured!.id);
  assert.equal(model.goals.featuredGoalId, goals.featuredGoalId);
});

test("flow/I: goal progress is not recomputed by the Dashboard", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [
      { id: "linked", name: "Linked", label: "Linked", current: 0, target: 10000, monthlyContribution: 100, note: "", accountId: "acc-bank" },
    ],
  });
  const featured = buildOverviewModel(state, NOW).goals.featured!;
  const canonical = getGoalsSnapshot(state).goals[0];
  // Uses the linked balance, exactly as Step 9.1 established.
  assert.equal(featured.currentAmount, canonical.currentAmount);
  assert.equal(featured.currentAmount, 5000);
  assert.equal(featured.progress, canonical.progress);
  assert.equal(featured.recordedAmount, 0, "the raw field is untouched");
});

// --- G & J. portfolio -------------------------------------------------------

test("flow/G: portfolio data equals the canonical PortfolioSnapshot", () => {
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  const portfolio = getPortfolioSnapshot(state);
  assert.deepEqual(model.portfolio, portfolio);
  assert.equal(model.trackedWealth.invested, portfolio.totalInvestedMyr);
});

test("flow/J: allocation drift is not recomputed by the Dashboard", () => {
  const state = stateWith({ dca: { monthly: 100, targets: { VOO: 0.99, QQQM: 0.01 } } });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.portfolio.maxAbsoluteDrift, getPortfolioSnapshot(state).maxAbsoluteDrift);
});

test("flow/G: tracked wealth shares are computed once and sum sensibly", () => {
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  const tracked = model.trackedWealth;
  assert.equal(tracked.total, tracked.invested + tracked.safety + tracked.reserve);
  for (const share of [tracked.investedShare, tracked.safetyShare, tracked.reserveShare]) {
    assert.ok(Number.isFinite(share) && share >= 0 && share <= 1, `share out of range: ${share}`);
  }
  // trackedCapital() delegates to the same builder.
  const legacy = trackedCapital(state);
  assert.equal(legacy.invested, tracked.invested);
  assert.equal(legacy.safety, tracked.safety);
  assert.equal(legacy.reserve, tracked.reserve);
  assert.equal(legacy.total, tracked.total);
});

test("flow/G: an empty portfolio cannot divide by zero", () => {
  const bare: WealthState = {
    ...emptyState(),
    emergency: { current: 0, target: 0, annualYield: 0, monthlyTopUp: 0 },
    opportunity: { total: 0, used: 0, allocation: {}, tranches: [] },
  };
  const tracked = buildOverviewModel(bare, NOW).trackedWealth;
  assert.equal(tracked.total, 0);
  for (const share of [tracked.investedShare, tracked.safetyShare, tracked.reserveShare]) {
    assert.ok(Number.isFinite(share), "share must not be NaN");
    assert.equal(share, 0);
  }
});

// --- K. budget --------------------------------------------------------------

test("flow/K: bucket allocation is not recomputed by the Dashboard", () => {
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  const budget = getBudgetSnapshot(state, NOW);
  assert.deepEqual(model.budget.buckets, budget.buckets);
  for (const bucket of model.budget.buckets) {
    assert.ok(Number.isFinite(bucket.allocationRatio));
    assert.ok(bucket.allocationRatio >= 0 && bucket.allocationRatio <= 1);
  }
});

// --- Money Leaks unchanged --------------------------------------------------

test("flow: Money Leak detection is unchanged", () => {
  const state = richState();
  const debt = detectMoneyLeakFindings(state).leaks.find((l) => l.id === "debt-card")!;
  assert.equal(debt.monthlyImpact, 2000 * 0.18 / 12);
  assert.equal(debt.confidence, 0.99);
  for (const advisory of ["why", "recommendation", "primaryAction", "actionLabel"]) {
    assert.equal(advisory in debt, false, `detector must not carry ${advisory}`);
  }
});

// --- L & M. robustness ------------------------------------------------------

test("flow/L: empty and partial states do not crash", () => {
  const partial = migrateState({ deviceId: "d", goals: [], trades: [], ledgerTransactions: [], liabilities: [], buckets: [] });
  for (const [label, state] of [["empty", emptyState()], ["partial", partial], ["default", cloneDefaultState()]] as const) {
    const model = buildOverviewModel(state, NOW);
    for (const value of [model.netWorth, model.totalAssets, model.totalLiabilities,
                         model.cashFlow.income, model.cashFlow.expenses, model.cashFlow.surplus,
                         model.emergencyRatio, model.trackedWealth.total]) {
      assert.ok(Number.isFinite(value), `${label} produced a non-finite value`);
    }
    assert.ok(model.briefing.length > 0, `${label} briefing`);
    assert.ok(!model.briefing.includes("undefined"), `${label} briefing leaked undefined`);
    assert.ok(!model.headline.includes("NaN"), `${label} headline leaked NaN`);
    assert.ok(Array.isArray(model.budget.buckets), `${label} buckets`);
    assert.ok(Array.isArray(model.goals.goals), `${label} goals`);
  }
});

test("flow/M: the goal picker still addresses real goals", () => {
  // The Dashboard's goal select is UI interaction state; it must keep pointing
  // at ids that exist on the state.
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  const ids = new Set(state.goals.map((goal) => goal.id));
  assert.ok(ids.has(model.goals.featuredGoalId), "featured id must exist on the state");
  for (const goal of model.goals.goals) {
    assert.ok(ids.has(goal.id));
    assert.equal(state.goals[goal.index].id, goal.id, "index addresses the original entry");
  }
});

test("flow/M: priority action destinations remain real navigation ids", () => {
  const known = new Set(["dashboard", "portfolio", "goals", "market", "ledger", "buckets",
    "money-leaks", "advisor", "review", "rules", "tvm", "calculator", "settings"]);
  for (const state of [cloneDefaultState(), richState()]) {
    const action = buildOverviewModel(state, NOW).priorityAction!;
    assert.ok(known.has(action.destination), `unknown destination ${action.destination}`);
  }
});

// --- Read-model discipline --------------------------------------------------

test("flow: the model is pure, deterministic and does not mutate state", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  const keysBefore = Object.keys(state);
  assert.deepEqual(buildOverviewModel(state, NOW), buildOverviewModel(state, new Date(NOW)));
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(Object.keys(state), keysBefore);
  assert.equal(state.version, CURRENT_VERSION);
  // Read models never migrate: the version is whatever the schema says.
  assert.ok(Number.isInteger(CURRENT_VERSION) && CURRENT_VERSION > 0);
});

test("flow: the model carries no persistence or AI state", () => {
  const serialized = JSON.stringify(buildOverviewModel(cloneDefaultState(), NOW));
  for (const forbidden of ["completed", "dismissed", "createdAt", "updatedAt", "firebase", "uid", "prompt"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} must not appear`);
  }
});

test("flow: every canonical snapshot the model exposes is the real one", () => {
  // Guards against the model quietly building a parallel copy of any domain.
  const state = richState();
  const model = buildOverviewModel(state, NOW);
  assert.deepEqual(model.snapshot, getFinancialSnapshot(state, NOW));
  assert.deepEqual(model.portfolio, getPortfolioSnapshot(state));
  assert.deepEqual(model.goals, getGoalsSnapshot(state));
  assert.deepEqual(model.budget, getBudgetSnapshot(state, NOW));
  assert.deepEqual(model.advisor, getAdvisorSnapshot(state, { now: NOW }));
});
