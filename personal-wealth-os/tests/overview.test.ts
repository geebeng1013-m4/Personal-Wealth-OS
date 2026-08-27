import assert from "node:assert/strict";
import { test } from "./testHarness";
import { buildOverviewModel, selectPriorityAction } from "../src/overview";
import { getFinancialSnapshot } from "../src/financialHealth";
import { advisorRecommendations } from "../src/advisor";
import { cloneDefaultState, emptyState, migrateState } from "../src/state";
import type { AdvisorRecommendation, LedgerTransaction, WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0); // 2026-08-15 local

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-overview", ...overrides });
}

function iso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0).toISOString();
}

function recommendation(overrides: Partial<AdvisorRecommendation>): AdvisorRecommendation {
  return {
    id: "r", severity: "positive", title: "t", fact: "f",
    ruleId: null, rule: "r", impact: "i", action: "a", evidence: [],
    ...overrides,
  };
}

test("overview: canonical figures come from getFinancialSnapshot()", () => {
  const state = stateWith({
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 5000 }],
    ledgerTransactions: [
      { id: "i1", amount: 3000, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
      { id: "e1", amount: 1200, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
    liabilities: [{ id: "l1", name: "Card", balance: 900, annualRate: 0.1, minimumPayment: 50 }],
  });
  const model = buildOverviewModel(state, NOW);
  const snapshot = getFinancialSnapshot(state, NOW);

  assert.equal(model.netWorth, snapshot.netWorth);
  assert.equal(model.totalAssets, snapshot.totalAssets);
  assert.equal(model.totalLiabilities, snapshot.totalLiabilities);
  assert.equal(model.cashFlow.income, snapshot.currentMonthIncome);
  assert.equal(model.cashFlow.expenses, snapshot.currentMonthExpenses);
  assert.equal(model.cashFlow.surplus, snapshot.currentMonthSurplus);
  assert.deepEqual(model.snapshot, snapshot);
});

test("overview: net worth still satisfies the canonical identity", () => {
  const model = buildOverviewModel(cloneDefaultState(), NOW);
  assert.equal(model.netWorth, model.totalAssets - model.totalLiabilities);
});

test("overview: cash-flow surplus is income minus expenses", () => {
  const state = stateWith({
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 0 }],
    ledgerTransactions: [
      { id: "i1", amount: 500, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
      { id: "e1", amount: 200, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
      { id: "t1", amount: 100, type: "transfer", fromAccountId: "acc-bank", toAccountId: "acc-bank2", date: iso(2026, 7, 5) },
    ] as LedgerTransaction[],
  });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.cashFlow.income, 500);
  assert.equal(model.cashFlow.expenses, 200);
  assert.equal(model.cashFlow.surplus, 300, "transfers must not affect the surplus");
});

test("overview: expense change compares against the previous calendar month", () => {
  const state = stateWith({
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 0 }],
    ledgerTransactions: [
      { id: "prev", amount: 100, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 6, 10) },
      { id: "now", amount: 150, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 10) },
    ] as LedgerTransaction[],
  });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.cashFlow.expenseChange, 0.5, "150 vs 100 is +50%");
});

test("overview: expense change is null when there is no prior month", () => {
  const state = stateWith({
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 0 }],
    ledgerTransactions: [
      { id: "now", amount: 150, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 10) },
    ] as LedgerTransaction[],
  });
  assert.equal(buildOverviewModel(state, NOW).cashFlow.expenseChange, null);
});

test("overview: there is never more than one priority action", () => {
  for (const state of [cloneDefaultState(), emptyState(), stateWith()]) {
    const model = buildOverviewModel(state, NOW);
    // The field is a single object or null — structurally at most one.
    assert.ok(model.priorityAction === null || typeof model.priorityAction === "object");
    assert.equal(Array.isArray(model.priorityAction), false);
  }
});

test("overview: action outranks watch and positive", () => {
  const chosen = selectPriorityAction([
    recommendation({ id: "p", severity: "positive", title: "Positive" }),
    recommendation({ id: "w", severity: "watch", title: "Watch" }),
    recommendation({ id: "a", severity: "action", title: "Action" }),
  ]);
  assert.equal(chosen!.recommendationId, "a");
  assert.equal(chosen!.severity, "action");
});

test("overview: watch outranks positive when no action exists", () => {
  const chosen = selectPriorityAction([
    recommendation({ id: "p", severity: "positive" }),
    recommendation({ id: "w", severity: "watch" }),
  ]);
  assert.equal(chosen!.recommendationId, "w");
  assert.equal(chosen!.severity, "watch");
});

test("overview: falls back to positive when that is all there is", () => {
  const chosen = selectPriorityAction([recommendation({ id: "p", severity: "positive" })]);
  assert.equal(chosen!.recommendationId, "p");
  assert.equal(chosen!.severity, "positive");
});

test("overview: no recommendations means no invented action", () => {
  assert.equal(selectPriorityAction([]), null);
});

test("overview: the priority action carries every field the UI renders", () => {
  const model = buildOverviewModel(cloneDefaultState(), NOW);
  const action = model.priorityAction;
  assert.ok(action, "the default state should produce advice");
  assert.ok(action!.title.length > 0);
  assert.ok(action!.explanation.length > 0);
  assert.ok(action!.actionLabel.length > 0);
  assert.ok(action!.destination.length > 0);
  assert.ok(action!.recommendationId.length > 0);
});

test("overview: the priority action comes from the existing Advisor engine", () => {
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  const ids = new Set(advisorRecommendations(state).map((r) => r.id));
  assert.ok(ids.has(model.priorityAction!.recommendationId), "must be a real Advisor recommendation, not a new one");
});

test("overview: an urgent Advisor action surfaces as the priority", () => {
  // A plan that cannot be funded produces a cashflow "action".
  const state = stateWith({
    cashflow: { allowance: 100, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
    dca: { monthly: 500, targets: { VOO: 1 } },
  });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.priorityAction!.severity, "action");
});

test("overview: plan status reports planned, actual and progress", () => {
  const state = stateWith({
    dca: { monthly: 200, targets: { VOO: 1 } },
    trades: [
      { id: "t1", date: iso(2026, 7, 5), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 80, amountUsd: 19, priceUsd: 600, feeMyr: 0 },
    ],
  });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.planStatus.plannedAmount, 200);
  assert.equal(model.planStatus.actualAmount, 80);
  assert.equal(model.planStatus.progress, 0.4);
  assert.equal(model.planStatus.onTrack, false);
  assert.equal(model.planStatus.hasActual, true);
  assert.equal(model.planStatus.label, "Partially funded");
});

test("overview: plan status is on track once the planned amount is contributed", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [
      { id: "t1", date: iso(2026, 7, 5), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 24, priceUsd: 600, feeMyr: 0 },
    ],
  });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.planStatus.onTrack, true);
  assert.equal(model.planStatus.label, "On plan");
  assert.equal(model.planStatus.progress, 1);
});

test("overview: plan status ignores sells and other months", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [
      { id: "sell", date: iso(2026, 7, 5), platform: "moomoo", ticker: "VOO", type: "Sell", amountMyr: 500, amountUsd: 120, priceUsd: 600, feeMyr: 0 },
      { id: "old", date: iso(2026, 6, 5), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 500, amountUsd: 120, priceUsd: 600, feeMyr: 0 },
    ],
  });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.planStatus.actualAmount, 0, "sells and prior months must not count");
  assert.equal(model.planStatus.hasActual, false);
  assert.equal(model.planStatus.label, "Not yet funded");
});

test("overview: wealth health exposes only healthy, watch or action", () => {
  const allowed = new Set(["healthy", "watch", "action"]);
  for (const state of [cloneDefaultState(), emptyState(), stateWith()]) {
    const health = buildOverviewModel(state, NOW).wealthHealth;
    assert.ok(allowed.has(health.status));
    assert.ok(health.label.length > 0, "status must have a text label, not colour alone");
    assert.ok(health.factors.length > 0);
    for (const factor of health.factors) assert.ok(allowed.has(factor.status));
  }
});

test("overview: wealth health degrades to action when liabilities exceed assets", () => {
  const state = stateWith({
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 100 }],
    liabilities: [{ id: "l1", name: "Loan", balance: 50000, annualRate: 0.05, minimumPayment: 500 }],
  });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.wealthHealth.status, "action");
  const debtFactor = model.wealthHealth.factors.find((factor) => factor.label === "Debt load");
  assert.equal(debtFactor!.status, "action");
});

test("overview: existing dashboard data is still reachable", () => {
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  // The five headline answers are all present.
  assert.ok(Number.isFinite(model.netWorth));
  assert.ok(Number.isFinite(model.cashFlow.income));
  assert.ok(Number.isFinite(model.cashFlow.expenses));
  assert.ok(Number.isFinite(model.cashFlow.surplus));
  assert.ok(model.wealthHealth.status);
  assert.ok(model.planStatus.label);
  assert.ok(model.headline.length > 0);
  assert.ok(model.greetingName.length > 0);
});

test("overview: empty and partial states do not crash and stay finite", () => {
  const partial = migrateState({ deviceId: "d", goals: [], trades: [], ledgerTransactions: [], liabilities: [] });
  for (const [label, state] of [["empty", emptyState()], ["partial", partial], ["default", cloneDefaultState()]] as const) {
    const model = buildOverviewModel(state, NOW);
    for (const value of [model.netWorth, model.totalAssets, model.totalLiabilities,
                         model.cashFlow.income, model.cashFlow.expenses, model.cashFlow.surplus,
                         model.planStatus.plannedAmount, model.planStatus.actualAmount]) {
      assert.ok(Number.isFinite(value), `${label} produced a non-finite value`);
    }
    assert.ok(!model.headline.includes("NaN"), `${label} leaked NaN into the headline`);
    assert.ok(!model.headline.includes("undefined"), `${label} leaked undefined into the headline`);
  }
});

test("overview: a state with no plan reports it without dividing by zero", () => {
  const state = stateWith({ dca: { monthly: 0, targets: {} } });
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.planStatus.plannedAmount, 0);
  assert.equal(model.planStatus.progress, null);
  assert.equal(model.planStatus.onTrack, true, "nothing planned cannot be off plan");
  assert.equal(model.planStatus.label, "No plan set");
});

test("overview: the model is pure and does not mutate state", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  buildOverviewModel(state, NOW);
  assert.equal(JSON.stringify(state), before);
});

test("overview: the model is deterministic for the same state and date", () => {
  const state = cloneDefaultState();
  assert.deepEqual(buildOverviewModel(state, NOW), buildOverviewModel(state, new Date(NOW)));
});

test("overview: the model contains no HTML", () => {
  const model = buildOverviewModel(cloneDefaultState(), NOW);
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes("<div"), false);
  assert.equal(serialized.includes("<section"), false);
  assert.equal(serialized.includes("class="), false);
});
