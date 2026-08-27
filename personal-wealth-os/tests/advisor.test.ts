import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  ADVISOR_RECOMMENDATION_IDS,
  advisorActions,
  advisorMessages,
  advisorRecommendations,
  nextActions,
  prioritizeRecommendations,
} from "../src/advisor";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getFinancialRule } from "../src/financialRules";
import { money } from "../src/rules";
import { cloneDefaultState, emptyState, migrateState } from "../src/state";
import type { AdvisorRecommendation, LedgerTransaction, WealthState } from "../src/models";

const SEVERITIES = new Set(["positive", "watch", "action"]);

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-advisor", ...overrides });
}

function byId(recommendations: AdvisorRecommendation[], id: string): AdvisorRecommendation {
  const found = recommendations.find((recommendation) => recommendation.id === id);
  assert.ok(found, `expected a recommendation with id ${id}`);
  return found!;
}

test("advisor: recommendations are deterministic for the same state", () => {
  const state = stateWith();
  assert.deepEqual(advisorRecommendations(state), advisorRecommendations(state));
  assert.deepEqual(advisorMessages(state), advisorMessages(state));
});

test("advisor: every recommendation has a stable, unique, non-empty id", () => {
  const recommendations = advisorRecommendations(stateWith());
  const ids = recommendations.map((recommendation) => recommendation.id);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(id.length > 0, "id must not be empty");
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");

  // Stable across unrelated state changes: same concern keeps the same id
  // even when the outcome flips from positive to action.
  const drifting = stateWith({ dca: { monthly: 100, targets: { VOO: 0.99, QQQM: 0.01 } } });
  const driftId = byId(advisorRecommendations(drifting), ADVISOR_RECOMMENDATION_IDS.allocationDrift).id;
  assert.equal(driftId, ADVISOR_RECOMMENDATION_IDS.allocationDrift);
});

test("advisor: severity is only positive, watch or action", () => {
  for (const state of [stateWith(), cloneDefaultState(), emptyState()]) {
    for (const recommendation of advisorRecommendations(state)) {
      assert.ok(SEVERITIES.has(recommendation.severity), `unexpected severity ${recommendation.severity}`);
    }
    for (const message of advisorMessages(state)) {
      assert.ok(SEVERITIES.has(message.severity));
    }
  }
});

test("advisor: every recommendation carries the full FACT/RULE/IMPACT/ACTION contract", () => {
  for (const recommendation of advisorRecommendations(stateWith())) {
    assert.ok(recommendation.fact.length > 0, `${recommendation.id} missing fact`);
    assert.ok(recommendation.rule.length > 0, `${recommendation.id} missing rule`);
    assert.ok(recommendation.impact.length > 0, `${recommendation.id} missing impact`);
    assert.ok(recommendation.action.length > 0, `${recommendation.id} missing action`);
    assert.ok(Array.isArray(recommendation.evidence), `${recommendation.id} missing evidence`);
  }
});

test("advisor: ruleId points at a structured FinancialRule that actually exists", () => {
  const state = stateWith();
  const ruleIds = new Set(state.financialRules.map((rule) => rule.id));
  for (const recommendation of advisorRecommendations(state)) {
    if (recommendation.ruleId === null) continue;
    assert.ok(ruleIds.has(recommendation.ruleId), `${recommendation.id} references unknown rule ${recommendation.ruleId}`);
  }
});

test("advisor: the emergency recommendation uses the structured emergency rule", () => {
  const state = stateWith({ emergency: { current: 1000, target: 4000, annualYield: 0.03, monthlyTopUp: 100 } });
  const recommendation = byId(advisorRecommendations(state), ADVISOR_RECOMMENDATION_IDS.emergencyFund);

  assert.equal(recommendation.ruleId, "emergency-fund-minimum");
  const rule = getFinancialRule(state, "emergency-fund-minimum");
  assert.ok(recommendation.rule.includes(money(rule!.targetAmount)), "rule text should quote the structured target");
  assert.equal(recommendation.severity, "watch", "an underfunded buffer is a watch");
});

test("advisor: the emergency recommendation follows the structured rule, not state.emergency.target", () => {
  // The structured rule is the policy; deliberately diverge it from the legacy field.
  const state = stateWith({ emergency: { current: 5000, target: 4000, annualYield: 0.03, monthlyTopUp: 0 } });
  state.financialRules = state.financialRules.map((rule) =>
    rule.kind === "emergency-fund-minimum" ? { ...rule, targetAmount: 9000 } : rule,
  );
  const recommendation = byId(advisorRecommendations(state), ADVISOR_RECOMMENDATION_IDS.emergencyFund);
  assert.ok(recommendation.rule.includes(money(9000)), "should quote the structured rule's 9000, not the legacy 4000");
});

test("advisor: the DCA recommendation uses the structured DCA rule", () => {
  const state = stateWith({ dca: { monthly: 250, targets: { VOO: 0.6, QQQM: 0.4 } } });
  const recommendation = byId(advisorRecommendations(state), ADVISOR_RECOMMENDATION_IDS.dcaMandate);

  assert.equal(recommendation.ruleId, "dca-monthly-amount");
  assert.ok(recommendation.fact.includes(money(250)));
  assert.ok(recommendation.rule.includes(money(250)));
  assert.equal(recommendation.severity, "positive");
});

test("advisor: the DCA recommendation splits by the structured allocation rule", () => {
  const state = stateWith({ dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } } });
  const recommendation = byId(advisorRecommendations(state), ADVISOR_RECOMMENDATION_IDS.dcaMandate);
  assert.ok(recommendation.fact.includes("VOO"), "allocation split should be shown");
  assert.ok(recommendation.fact.includes(money(70)), "70% of 100");
  assert.ok(recommendation.fact.includes(money(30)), "30% of 100");
});

test("advisor: the drift recommendation uses the structured drift tolerance as its threshold", () => {
  // Heavily skewed targets against the seeded default trades produce real drift.
  const state = stateWith({ dca: { monthly: 100, targets: { VOO: 0.99, QQQM: 0.01 } } });
  const recommendation = byId(advisorRecommendations(state), ADVISOR_RECOMMENDATION_IDS.allocationDrift);
  assert.equal(recommendation.ruleId, "allocation-drift-tolerance");

  // Widening the tolerance to its maximum must flip the same recommendation to positive.
  const tolerant: WealthState = {
    ...state,
    financialRules: state.financialRules.map((rule) =>
      rule.kind === "allocation-drift-tolerance" ? { ...rule, maxDrift: 1 } : rule,
    ),
  };
  const relaxed = byId(advisorRecommendations(tolerant), ADVISOR_RECOMMENDATION_IDS.allocationDrift);
  assert.equal(relaxed.severity, "positive", "no drift can exceed a 100% tolerance");
  assert.equal(relaxed.id, recommendation.id, "the id is stable even as the outcome flips");
});

test("advisor: the drift threshold defaults to the historical 8% when no rule exists", () => {
  const state = stateWith();
  const withoutDriftRule: WealthState = {
    ...state,
    financialRules: state.financialRules.filter((rule) => rule.kind !== "allocation-drift-tolerance"),
  };
  const recommendation = byId(advisorRecommendations(withoutDriftRule), ADVISOR_RECOMMENDATION_IDS.allocationDrift);
  assert.equal(recommendation.ruleId, null, "no rule exists, so none is invented");
  assert.ok(recommendation.rule.includes("8%"), "falls back to the pre-existing 8% threshold");
});

test("advisor: recorded spending facts come from getFinancialSnapshot(), not planning fields", () => {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5, 12, 0, 0).toISOString();
  const state = stateWith({
    cashflow: { allowance: 2000, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 5000 }],
    ledgerTransactions: [
      { id: "spend-1", amount: 900, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: thisMonth },
    ] as LedgerTransaction[],
  });

  const recommendation = byId(advisorRecommendations(state), ADVISOR_RECOMMENDATION_IDS.spendingLimit);
  const snapshot = getFinancialSnapshot(state);

  assert.equal(recommendation.ruleId, "monthly-spending-limit");
  assert.equal(snapshot.currentMonthExpenses, 900);
  assert.ok(recommendation.fact.includes(money(900)), "fact must quote recorded ledger spending");
  // Limit is 200 (transport 100 + food 100), recorded 900 → over.
  assert.equal(recommendation.severity, "action");
});

test("advisor: the spending recommendation reacts to ledger changes, not to planning changes", () => {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5, 12, 0, 0).toISOString();
  const base = {
    cashflow: { allowance: 2000, transport: 300, food: 300, otherFixed: 0, irregularIncome: 0 },
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 5000 }],
  };
  const lowSpend = stateWith({
    ...base,
    ledgerTransactions: [{ id: "s1", amount: 100, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: thisMonth }] as LedgerTransaction[],
  });
  const highSpend = stateWith({
    ...base,
    ledgerTransactions: [{ id: "s1", amount: 5000, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: thisMonth }] as LedgerTransaction[],
  });

  assert.equal(byId(advisorRecommendations(lowSpend), ADVISOR_RECOMMENDATION_IDS.spendingLimit).severity, "positive");
  assert.equal(byId(advisorRecommendations(highSpend), ADVISOR_RECOMMENDATION_IDS.spendingLimit).severity, "action");
});

test("advisor: the cashflow recommendation still evaluates PLANNING surplus, not recorded surplus", () => {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5, 12, 0, 0).toISOString();
  const planning = {
    cashflow: { allowance: 1000, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
    dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } },
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 50000 }],
  };
  // Planning surplus is 800, comfortably above the 100 DCA → positive.
  const noLedger = stateWith(planning);
  const cashflowNoLedger = byId(advisorRecommendations(noLedger), ADVISOR_RECOMMENDATION_IDS.cashflowDiscipline);
  assert.equal(cashflowNoLedger.severity, "positive");

  // A huge RECORDED expense must not change a PLANNING conclusion.
  const withLedger = stateWith({
    ...planning,
    ledgerTransactions: [{ id: "big", amount: 40000, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: thisMonth }] as LedgerTransaction[],
  });
  const cashflowWithLedger = byId(advisorRecommendations(withLedger), ADVISOR_RECOMMENDATION_IDS.cashflowDiscipline);
  assert.equal(cashflowWithLedger.severity, "positive", "recorded spending must not drive the planning rule");
  assert.equal(cashflowWithLedger.fact, cashflowNoLedger.fact, "planning fact is unchanged by ledger activity");

  // Changing the PLAN, however, must change it.
  const tightPlan = stateWith({
    ...planning,
    cashflow: { allowance: 150, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
  });
  assert.equal(byId(advisorRecommendations(tightPlan), ADVISOR_RECOMMENDATION_IDS.cashflowDiscipline).severity, "action");
});

test("advisor: planning-rule recommendations reference structured rules, not raw planning fields", () => {
  const state = stateWith({ dca: { monthly: 300, targets: { VOO: 1 } } });
  const cashflow = byId(advisorRecommendations(state), ADVISOR_RECOMMENDATION_IDS.cashflowDiscipline);
  assert.equal(cashflow.ruleId, "dca-monthly-amount", "the plan is measured against the structured DCA rule");
  assert.ok(cashflow.rule.includes(money(300)));
});

test("advisor: the opportunity reserve recommendation uses the structured deployment ladder", () => {
  const state = stateWith({
    opportunity: {
      total: 1000, used: 0, allocation: { VOO: 1000 },
      tranches: [
        { drawdown: 12, percent: 0.4, amount: 400, deployed: false },
        { drawdown: 25, percent: 0.6, amount: 600, deployed: false },
      ],
    },
  });
  const recommendation = byId(advisorRecommendations(state), ADVISOR_RECOMMENDATION_IDS.opportunityReserve);
  assert.equal(recommendation.ruleId, "opportunity-reserve-deployment");
  assert.ok(recommendation.fact.includes("-12%"), "ladder should come from the user's configured tranches");
  assert.ok(recommendation.fact.includes("-25%"));
  assert.equal(recommendation.severity, "watch");
});

test("advisor: structured actions trace back to their source recommendation", () => {
  const state = stateWith();
  const recommendations = advisorRecommendations(state);
  const actions = advisorActions(state);

  assert.equal(actions.length, recommendations.length);
  const recommendationIds = new Set(recommendations.map((recommendation) => recommendation.id));
  for (const action of actions) {
    assert.ok(action.id.length > 0);
    assert.ok(action.label.length > 0);
    assert.ok(recommendationIds.has(action.recommendationId), "every action must trace to a recommendation");
    assert.equal(action.id, `action:${action.recommendationId}`);
  }
  assert.equal(new Set(actions.map((action) => action.id)).size, actions.length, "action ids are unique");
});

test("advisor: actions are prioritised most urgent first", () => {
  const state = stateWith({
    cashflow: { allowance: 100, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
    dca: { monthly: 500, targets: { VOO: 0.99, QQQM: 0.01 } },
  });
  const ordered = prioritizeRecommendations(advisorRecommendations(state));
  const rank = { action: 0, watch: 1, positive: 2 } as const;
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(rank[ordered[i - 1].severity] <= rank[ordered[i].severity], "severity order must be non-decreasing");
  }
  assert.equal(ordered[0].severity, "action", "an unaffordable plan must surface first");
});

test("advisor: prioritisation is stable for equal severities", () => {
  const recommendations = advisorRecommendations(stateWith());
  const positives = recommendations.filter((recommendation) => recommendation.severity === "positive").map((r) => r.id);
  const orderedPositives = prioritizeRecommendations(recommendations)
    .filter((recommendation) => recommendation.severity === "positive")
    .map((r) => r.id);
  assert.deepEqual(orderedPositives, positives, "equal severities keep their original relative order");
});

test("advisor: advisorMessages compatibility wrapper keeps the flat title/body/severity shape", () => {
  // Step 12: messages are now RANKED, so they line up with the prioritised
  // recommendations rather than generation order. This is what makes the
  // Advisor page's first card the same one the Dashboard calls the priority.
  const state = stateWith();
  const messages = advisorMessages(state);
  const recommendations = prioritizeRecommendations(advisorRecommendations(state));

  assert.equal(messages.length, recommendations.length);
  messages.forEach((message, index) => {
    assert.equal(message.title, recommendations[index].title, "titles are preserved");
    assert.equal(message.severity, recommendations[index].severity, "severities are preserved");
    assert.ok(message.body.includes(recommendations[index].fact), "body still leads with the fact");
    assert.deepEqual(Object.keys(message).sort(), ["body", "severity", "title"]);
  });
});

test("advisor: existing message titles and severities are unchanged from the pre-refactor Advisor", () => {
  const state = stateWith();
  const titles = advisorMessages(state).map((message) => message.title);
  for (const expected of [
    "Keep DCA mechanical",
    "Opportunity Reserve remains separate",
    "Cashflow discipline",
  ]) {
    assert.ok(titles.includes(expected), `original title "${expected}" must survive the refactor`);
  }
  // The emergency and drift titles are outcome-dependent; both variants preserved.
  assert.ok(titles.some((title) => title.startsWith("Safety")), "emergency card preserved");
  assert.ok(titles.some((title) => title.includes("Allocation drift")), "drift card preserved");
});

test("advisor: nextActions compatibility behaviour is unchanged", () => {
  const state = stateWith({ dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } } });
  const actions = nextActions(state);

  assert.ok(Array.isArray(actions));
  for (const action of actions) assert.equal(typeof action, "string");
  assert.ok(actions[0].startsWith(`DCA ${money(100)} this month`), "first action wording preserved");
  assert.ok(actions.some((action) => action.includes("Review spending at month end")), "review action preserved");
  assert.deepEqual(nextActions(state), actions, "deterministic");
});

test("advisor: nextActions appends the drift action only when the drift rule is breached", () => {
  const driftText = "Use the next buy to reduce allocation drift toward your configured targets.";
  // Real drift needs money actually invested: this state holds only QQQM
  // against a 99% VOO target. It previously relied on a state with NO trades
  // reporting 99% drift, which was the bug fixed in this step — an allocation
  // cannot be off target before anything has been bought.
  const drifting = stateWith({
    dca: { monthly: 100, targets: { VOO: 0.99, QQQM: 0.01 } },
    trades: [{
      id: "t1", date: "2026-01-05", platform: "moomoo", ticker: "QQQM", type: "DCA",
      amountMyr: 1000, amountUsd: 220, priceUsd: 220, feeMyr: 0,
    }],
  });
  assert.ok(nextActions(drifting).includes(driftText));

  const tolerant: WealthState = {
    ...drifting,
    financialRules: drifting.financialRules.map((rule) =>
      rule.kind === "allocation-drift-tolerance" ? { ...rule, maxDrift: 1 } : rule,
    ),
  };
  assert.ok(!nextActions(tolerant).includes(driftText), "a 100% tolerance cannot be breached");
});

test("advisor: empty and default states produce safe output", () => {
  for (const [label, state] of [["empty", emptyState()], ["default", cloneDefaultState()]] as const) {
    const recommendations = advisorRecommendations(state);
    assert.ok(recommendations.length > 0, `${label} state should still advise`);
    for (const recommendation of recommendations) {
      assert.ok(recommendation.id.length > 0, `${label}: missing id`);
      assert.ok(SEVERITIES.has(recommendation.severity), `${label}: bad severity`);
      assert.ok(!recommendation.fact.includes("NaN"), `${label}: NaN leaked into fact "${recommendation.fact}"`);
      assert.ok(!recommendation.action.includes("NaN"), `${label}: NaN leaked into action`);
      assert.ok(!recommendation.impact.includes("undefined"), `${label}: undefined leaked into impact`);
    }
    assert.doesNotThrow(() => advisorMessages(state));
    assert.doesNotThrow(() => advisorActions(state));
    assert.doesNotThrow(() => nextActions(state));
  }
});

test("advisor: a state with no structured rules degrades safely without inventing rule ids", () => {
  const state = stateWith();
  const ruleless: WealthState = { ...state, financialRules: [] };
  const recommendations = advisorRecommendations(ruleless);

  assert.ok(recommendations.length > 0, "advice must still be produced");
  for (const recommendation of recommendations) {
    assert.equal(recommendation.ruleId, null, `${recommendation.id} must not invent a rule id`);
    assert.ok(recommendation.rule.length > 0, "a human-readable policy line is still provided");
  }
  // The spending recommendation is rule-driven, so it simply does not appear.
  assert.equal(recommendations.some((r) => r.id === ADVISOR_RECOMMENDATION_IDS.spendingLimit), false);
});

test("advisor: recommendations are pure and do not mutate the state", () => {
  const state = stateWith();
  const before = JSON.stringify(state);
  advisorRecommendations(state);
  advisorActions(state);
  advisorMessages(state);
  nextActions(state);
  assert.equal(JSON.stringify(state), before);
});
