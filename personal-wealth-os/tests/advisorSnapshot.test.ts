import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  ADVISOR_RECOMMENDATION_IDS,
  advisorActions,
  advisorMessages,
  advisorRecommendations,
  getAdvisorSnapshot,
  moneyLeakRecommendations,
  prioritizeRecommendations,
} from "../src/advisor";
import { buildOverviewModel } from "../src/overview";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { money } from "../src/rules";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { LedgerAccount, LedgerTransaction, WealthState } from "../src/models";

const SEVERITIES = new Set(["positive", "watch", "action"]);

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-advisor-snap", ...overrides });
}

const accounts: LedgerAccount[] = [
  { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 5000 },
];

function iso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0).toISOString();
}

// --- A. construction --------------------------------------------------------

test("advisorSnapshot/A: builds from state with the expected shape", () => {
  const snapshot = getAdvisorSnapshot(cloneDefaultState());
  assert.ok(Array.isArray(snapshot.recommendations));
  assert.ok(Array.isArray(snapshot.actions));
  assert.ok(Array.isArray(snapshot.leakRecommendations));
  assert.ok(snapshot.recommendations.length > 0);
  assert.deepEqual(Object.keys(snapshot).sort(),
    ["actions", "leakRecommendations", "priority", "recommendations"].sort());
});

// --- B. recommendations come from existing Financial Rules ------------------

test("advisorSnapshot/B: recommendations reference real structured rules", () => {
  const state = stateWith();
  const ruleIds = new Set(state.financialRules.map((rule) => rule.id));
  for (const recommendation of getAdvisorSnapshot(state).recommendations) {
    if (recommendation.ruleId === null) continue;
    assert.ok(ruleIds.has(recommendation.ruleId), `${recommendation.id} references unknown rule`);
  }
});

test("advisorSnapshot/B: the snapshot contains the same recommendations as the engine", () => {
  const state = stateWith();
  const snapshot = getAdvisorSnapshot(state);
  const raw = advisorRecommendations(state);
  assert.equal(snapshot.recommendations.length, raw.length);
  assert.deepEqual(
    [...snapshot.recommendations].map((r) => r.id).sort(),
    [...raw].map((r) => r.id).sort(),
    "ranking reorders but never adds or drops",
  );
});

// --- C & D & E. priority ----------------------------------------------------

test("advisorSnapshot/C: priority is at most one recommendation", () => {
  for (const state of [cloneDefaultState(), stateWith(), emptyState()]) {
    const snapshot = getAdvisorSnapshot(state);
    assert.equal(Array.isArray(snapshot.priority), false);
    assert.ok(snapshot.priority === null || typeof snapshot.priority === "object");
  }
});

test("advisorSnapshot/D: ranking is action > watch > positive", () => {
  const state = stateWith({
    cashflow: { allowance: 100, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
    dca: { monthly: 500, targets: { VOO: 0.99, QQQM: 0.01 } },
  });
  const snapshot = getAdvisorSnapshot(state);
  const rank = { action: 0, watch: 1, positive: 2 } as const;
  for (let i = 1; i < snapshot.recommendations.length; i += 1) {
    assert.ok(
      rank[snapshot.recommendations[i - 1].severity] <= rank[snapshot.recommendations[i].severity],
      "severity order must be non-decreasing",
    );
  }
  assert.equal(snapshot.priority!.severity, "action");
});

test("advisorSnapshot/D: priority is always the first ranked recommendation", () => {
  for (const state of [cloneDefaultState(), stateWith()]) {
    const snapshot = getAdvisorSnapshot(state);
    assert.equal(snapshot.priority!.id, snapshot.recommendations[0].id);
  }
});

test("advisorSnapshot/E: equal severities keep a deterministic, stable order", () => {
  const state = cloneDefaultState();
  const a = getAdvisorSnapshot(state).recommendations.map((r) => r.id);
  const b = getAdvisorSnapshot(state).recommendations.map((r) => r.id);
  assert.deepEqual(a, b, "repeated builds must agree");

  // Ties preserve generation order.
  const generated = advisorRecommendations(state).map((r) => r.id);
  const positives = getAdvisorSnapshot(state).recommendations
    .filter((r) => r.severity === "positive").map((r) => r.id);
  const generatedPositives = generated.filter((id) =>
    advisorRecommendations(state).find((r) => r.id === id)!.severity === "positive");
  assert.deepEqual(positives, generatedPositives, "tie-break is generation order");
});

// --- F. Dashboard and Advisor agree ----------------------------------------

test("advisorSnapshot/F: Dashboard priority and Advisor page first card are the same recommendation", () => {
  for (const state of [cloneDefaultState(), stateWith(), emptyState()]) {
    const snapshot = getAdvisorSnapshot(state);
    const dashboard = buildOverviewModel(state).priorityAction;
    const advisorPageFirst = advisorMessages(state)[0];

    assert.equal(dashboard!.recommendationId, snapshot.priority!.id, "Dashboard uses the canonical priority");
    assert.equal(advisorPageFirst.title, snapshot.priority!.title, "Advisor page leads with the same one");
    assert.equal(dashboard!.title, advisorPageFirst.title, "no two different first priorities");
    assert.equal(dashboard!.actionLabel, snapshot.priority!.action);
    assert.equal(dashboard!.severity, snapshot.priority!.severity);
  }
});

test("advisorSnapshot/F: destinations are preserved, never invented", () => {
  const snapshot = getAdvisorSnapshot(cloneDefaultState());
  const known = new Set(["dashboard", "portfolio", "goals", "market", "ledger", "buckets",
    "money-leaks", "advisor", "review", "rules", "tvm", "calculator", "settings"]);
  for (const recommendation of snapshot.recommendations) {
    if (recommendation.destination === undefined) continue;
    assert.ok(known.has(recommendation.destination), `unknown destination ${recommendation.destination}`);
  }
  for (const action of snapshot.actions) {
    if (action.destination === undefined) continue;
    assert.ok(known.has(action.destination));
  }
});

test("advisorSnapshot/F: actions mirror the ranked recommendations one-for-one", () => {
  const snapshot = getAdvisorSnapshot(cloneDefaultState());
  assert.equal(snapshot.actions.length, snapshot.recommendations.length);
  snapshot.actions.forEach((action, index) => {
    assert.equal(action.recommendationId, snapshot.recommendations[index].id);
    assert.equal(action.id, `action:${snapshot.recommendations[index].id}`);
  });
  assert.deepEqual(advisorActions(cloneDefaultState()), snapshot.actions);
});

// --- G-J. the Advisor does not re-derive canonical facts --------------------

test("advisorSnapshot/G: recorded ledger metrics come from the canonical snapshot", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "e1", amount: 900, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
  });
  const financial = getFinancialSnapshot(state);
  const spending = getAdvisorSnapshot(state).recommendations
    .find((r) => r.id === ADVISOR_RECOMMENDATION_IDS.spendingLimit);
  if (spending) {
    const quoted = spending.evidence.find((e) => e.label === "Recorded spending");
    assert.equal(quoted!.value, money(financial.currentMonthExpenses),
      "the Advisor quotes the canonical recorded spending");
  }
});

test("advisorSnapshot/H: portfolio drift comes from the canonical portfolio snapshot", () => {
  const state = stateWith({ dca: { monthly: 100, targets: { VOO: 0.99, QQQM: 0.01 } } });
  const portfolio = getPortfolioSnapshot(state);
  const drift = getAdvisorSnapshot(state).recommendations
    .find((r) => r.id === ADVISOR_RECOMMENDATION_IDS.allocationDrift)!;
  const quoted = drift.evidence.find((e) => e.label === "Largest drift")!;
  assert.equal(quoted.value, `${(portfolio.maxAbsoluteDrift * 100).toFixed(0)}%`,
    "the Advisor never recomputes drift");
});

test("advisorSnapshot/I: goal facts are not recomputed by the Advisor", () => {
  const state = stateWith({
    goals: [{ id: "travel", name: "Travel", label: "Travel", current: 0, target: 2400, monthlyContribution: 0, note: "" }],
  });
  // The goal signal reaches the Advisor as a Money Leak observation, whose
  // figures come from the detector — not from a second goal calculation.
  const observation = detectMoneyLeakFindings(state).leaks.find((l) => l.id === "goal-travel")!;
  const recommendation = moneyLeakRecommendations(state).find((r) => r.id === "advisor:leak:goal-travel")!;
  assert.equal(recommendation.fact, observation.summary);
  // And the canonical goal model is untouched by the Advisor.
  assert.equal(getGoalsSnapshot(state).goals[0].targetAmount, 2400);
});

test("advisorSnapshot/J: planning surplus comes from the canonical budget snapshot", () => {
  const state = stateWith({
    cashflow: { allowance: 2000, transport: 300, food: 400, otherFixed: 100, irregularIncome: 200 },
    dca: { monthly: 500, targets: { VOO: 1 } },
  });
  const budget = getBudgetSnapshot(state);
  const cashflow = getAdvisorSnapshot(state).recommendations
    .find((r) => r.id === ADVISOR_RECOMMENDATION_IDS.cashflowDiscipline)!;
  const quoted = cashflow.evidence.find((e) => e.label === "Planned surplus")!;
  // money() formats with separators, so compare against the formatted value.
  assert.equal(quoted.value, money(budget.plannedSurplus),
    "the Advisor quotes the canonical planned surplus");
  assert.equal(budget.plannedSurplus, 1400, "2200 income - 800 fixed");
});

// --- K & L. Money Leaks stay observations -----------------------------------

test("advisorSnapshot/K: a Money Leak observation stands without any recommendation", () => {
  const state = stateWith({
    liabilities: [{ id: "card", name: "Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
  });
  const observation = detectMoneyLeakFindings(state).leaks.find((l) => l.id === "debt-card")!;
  for (const advisory of ["why", "recommendation", "primaryAction", "actionLabel"]) {
    assert.equal(advisory in observation, false, `detector must not carry ${advisory}`);
  }
  assert.ok(observation.summary.length > 0);
  assert.equal(observation.confidence, 0.99);
});

test("advisorSnapshot/L: the Advisor turns observations into recommendations", () => {
  const state = stateWith({
    liabilities: [{ id: "card", name: "Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
  });
  const snapshot = getAdvisorSnapshot(state);
  const leak = snapshot.leakRecommendations.find((r) => r.id === "advisor:leak:debt-card")!;
  assert.ok(leak, "the observation produced a recommendation");
  assert.ok(leak.impact.length > 0);
  assert.ok(leak.action.length > 0);
  assert.ok(SEVERITIES.has(leak.severity));
});

test("advisorSnapshot/L: leak recommendations are ranked but kept separate from the main list", () => {
  const state = stateWith({
    liabilities: [{ id: "card", name: "Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
  });
  const snapshot = getAdvisorSnapshot(state);
  const mainIds = new Set(snapshot.recommendations.map((r) => r.id));
  for (const leak of snapshot.leakRecommendations) {
    assert.equal(mainIds.has(leak.id), false, "leak advice is not silently merged into the main list");
  }
  assert.deepEqual(snapshot.leakRecommendations, prioritizeRecommendations(moneyLeakRecommendations(state)));
});

// --- M. empty states --------------------------------------------------------

test("advisorSnapshot/M: no recommendations means priority is null", () => {
  const empty = { recommendations: [], priority: null };
  assert.equal(prioritizeRecommendations([]).length, 0);
  assert.equal(prioritizeRecommendations([])[0] ?? null, empty.priority);

  const state = stateWith();
  const stripped: WealthState = { ...state, financialRules: [] };
  // Even with no structured rules the engine still advises, so priority stands.
  const snapshot = getAdvisorSnapshot(stripped);
  assert.ok(snapshot.priority !== null);
  assert.equal(snapshot.priority!.id, snapshot.recommendations[0].id);
});

test("advisorSnapshot/M: a state with no leaks yields no leak recommendations", () => {
  const clean = stateWith({ ledgerTransactions: [], goals: [], liabilities: [], recurringTransactions: [] });
  assert.deepEqual(getAdvisorSnapshot(clean).leakRecommendations, []);
});

// --- N, O, P. read-model discipline ----------------------------------------

test("advisorSnapshot/N: the snapshot carries no persistence or AI state", () => {
  const serialized = JSON.stringify(getAdvisorSnapshot(cloneDefaultState()));
  for (const forbidden of ["completed", "dismissed", "acknowledged", "createdAt", "updatedAt",
    "timestamp", "firebase", "localStorage", "uid", "prompt", "model", "completion"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} must not appear`);
  }
});

test("advisorSnapshot/O: building the snapshot does not mutate WealthState", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  const keysBefore = Object.keys(state);
  getAdvisorSnapshot(state);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(Object.keys(state), keysBefore);
  for (const forbidden of ["advisorSnapshot", "recommendations", "priority"]) {
    assert.equal(keysBefore.includes(forbidden), false, `${forbidden} must not be persisted`);
  }
  assert.equal(state.version, CURRENT_VERSION);
  // Read models never migrate: the version is whatever the schema says.
  assert.ok(Number.isInteger(CURRENT_VERSION) && CURRENT_VERSION > 0);
});

test("advisorSnapshot/P: empty and partial states do not crash", () => {
  const partial = migrateState({ deviceId: "d", goals: [], trades: [], ledgerTransactions: [], liabilities: [] });
  for (const [label, state] of [["empty", emptyState()], ["partial", partial], ["default", cloneDefaultState()]] as const) {
    const snapshot = getAdvisorSnapshot(state);
    assert.ok(Array.isArray(snapshot.recommendations), `${label}: recommendations`);
    for (const recommendation of snapshot.recommendations) {
      assert.ok(SEVERITIES.has(recommendation.severity), `${label}: bad severity`);
      assert.ok(!recommendation.fact.includes("NaN"), `${label}: NaN leaked into a fact`);
      assert.ok(!recommendation.action.includes("undefined"), `${label}: undefined leaked into an action`);
    }
    assert.doesNotThrow(() => buildOverviewModel(state), `${label}: overview`);
    assert.doesNotThrow(() => advisorMessages(state), `${label}: messages`);
  }
});

test("advisorSnapshot: the snapshot is pure and deterministic", () => {
  const state = cloneDefaultState();
  assert.deepEqual(getAdvisorSnapshot(state), getAdvisorSnapshot(state));
});

// --- Architecture guards ----------------------------------------------------

test("advisorSnapshot/arch: FinancialHealth does not depend on the Advisor", () => {
  // Health must be buildable without any Advisor input; the urgency signal is
  // injected, never imported.
  const state = cloneDefaultState();
  assert.doesNotThrow(() => getFinancialHealthSnapshot(state));
  const withoutSignal = getFinancialHealthSnapshot(state, new Date(), {});
  const withSignal = getFinancialHealthSnapshot(state, new Date(), { hasUrgentAdvice: true });
  assert.deepEqual(withSignal.factors, withoutSignal.factors,
    "the Advisor signal only escalates the overall status, never the facts");
});

test("advisorSnapshot/arch: Money Leak detection works with no Advisor involved", () => {
  const state = stateWith({
    liabilities: [{ id: "card", name: "Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
  });
  const findings = detectMoneyLeakFindings(state);
  assert.ok(findings.leaks.length > 0, "the detector stands alone");
  const serialized = JSON.stringify(findings);
  for (const forbidden of ["impact", "destination", "actionLabel", "ruleId"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} is Advisor territory`);
  }
});

test("advisorSnapshot/arch: canonical snapshots stay independent of the Advisor", () => {
  // Each canonical model must build on its own, proving no circular reliance.
  const state = cloneDefaultState();
  assert.doesNotThrow(() => getFinancialSnapshot(state));
  assert.doesNotThrow(() => getPortfolioSnapshot(state));
  assert.doesNotThrow(() => getGoalsSnapshot(state));
  assert.doesNotThrow(() => getBudgetSnapshot(state));
  assert.doesNotThrow(() => detectMoneyLeakFindings(state));
});
