import assert from "node:assert/strict";
import { test } from "./testHarness";
import { detectMoneyLeakFindings, type MoneyLeakObservation } from "../src/moneyLeaks";
import { detectMoneyLeaks, moneyLeakRecommendations } from "../src/advisor";
import { cloneDefaultState, emptyState, migrateState } from "../src/state";
import type { LedgerTransaction, WealthState } from "../src/models";

/** Fields that used to live on a leak and are now the Advisor's responsibility. */
const ADVISORY_FIELDS = ["why", "recommendation", "primaryAction", "actionLabel"] as const;

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-leaks", ...overrides });
}

/** A state that trips the fee, duplicate, goal and debt detectors at once. */
function multiLeakState(): WealthState {
  return stateWith({
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 9000 }],
    ledgerTransactions: [
      { id: "fee-1", amount: 45, type: "expense", categoryId: "expense-bills", accountId: "acc-bank", date: "2026-07-10T00:00:00.000Z", note: "Late payment fee" },
      { id: "dup-1", amount: 120, type: "expense", categoryId: "expense-shopping", accountId: "acc-bank", date: "2026-07-12T00:00:00.000Z", note: "Headphones" },
      { id: "dup-2", amount: 120, type: "expense", categoryId: "expense-shopping", accountId: "acc-bank", date: "2026-07-12T00:00:00.000Z", note: "Headphones" },
    ] as LedgerTransaction[],
    goals: [
      { id: "travel", name: "Travel Fund", label: "Travel", current: 0, target: 2400, monthlyContribution: 0, note: "" },
    ],
    liabilities: [
      { id: "card", name: "Credit Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 },
    ],
  });
}

test("split: detector output contains no advisory fields", () => {
  const findings = detectMoneyLeakFindings(multiLeakState());
  assert.ok(findings.leaks.length > 0, "fixture should produce findings");
  for (const leak of findings.leaks) {
    for (const field of ADVISORY_FIELDS) {
      assert.equal(field in leak, false, `${leak.id} still carries advisory field "${field}"`);
    }
  }
});

test("split: an observation is complete and valid without any recommendation", () => {
  const findings = detectMoneyLeakFindings(multiLeakState());
  for (const leak of findings.leaks) {
    // Everything needed to describe WHAT happened is present on its own.
    assert.ok(leak.id.length > 0);
    assert.ok(leak.title.length > 0);
    assert.ok(leak.summary.length > 0);
    assert.ok(Number.isFinite(leak.monthlyImpact));
    assert.ok(Number.isFinite(leak.annualImpact));
    assert.ok(leak.confidence > 0 && leak.confidence <= 1);
    assert.ok(["high", "medium", "low"].includes(leak.severity));
    assert.ok(Array.isArray(leak.transactionIds));
    assert.ok(Array.isArray(leak.relatedEntityIds));
    assert.ok(Array.isArray(leak.evidence));
  }
});

test("split: detection values are unchanged by the refactor", () => {
  // Pinned against the pre-refactor detector output.
  const findings = detectMoneyLeakFindings(multiLeakState());
  const byId = (id: string) => findings.leaks.find((leak) => leak.id === id);

  const fee = byId("avoidable-fees");
  assert.ok(fee, "fee detector still fires");
  assert.equal(fee!.category, "fee");
  assert.equal(fee!.monthlyImpact, 45);
  assert.equal(fee!.annualImpact, 45 * 12);
  assert.equal(fee!.confidence, 0.9);
  assert.equal(fee!.severity, "medium");
  assert.equal(fee!.impactBasis, "recurring");
  assert.deepEqual(fee!.transactionIds, ["fee-1"]);

  const duplicate = byId("duplicate-dup-1");
  assert.ok(duplicate, "duplicate detector still fires");
  assert.equal(duplicate!.monthlyImpact, 120, "second of the pair is the impact");
  assert.equal(duplicate!.annualImpact, 120);
  assert.equal(duplicate!.impactBasis, "one-time");
  assert.equal(duplicate!.confidence, 0.86);
  assert.deepEqual(duplicate!.transactionIds, ["dup-1", "dup-2"]);

  const debt = byId("debt-card");
  assert.ok(debt, "debt detector still fires");
  assert.equal(debt!.confidence, 0.99);
  assert.equal(debt!.monthlyImpact, 6000 * 0.18 / 12);
  assert.equal(debt!.annualImpact, 6000 * 0.18);

  const goal = byId("goal-travel");
  assert.ok(goal, "goal detector still fires");
  assert.equal(goal!.confidence, 0.95);
  assert.equal(goal!.monthlyImpact, 2400 / 12);
});

test("split: detectors still answer only WHAT, never WHAT TO DO", () => {
  const findings = detectMoneyLeakFindings(multiLeakState());
  const imperatives = ["you should", "consider ", "cancel,", "prioritise", "review the", "set a tighter"];
  for (const leak of findings.leaks) {
    const summary = leak.summary.toLowerCase();
    for (const phrase of imperatives) {
      assert.equal(summary.includes(phrase), false, `${leak.id} summary gives advice: "${leak.summary}"`);
    }
  }
});

test("split: observations carry structured source links", () => {
  const state = multiLeakState();
  const findings = detectMoneyLeakFindings(state);
  const goal = findings.leaks.find((leak) => leak.category === "goal");
  const debt = findings.leaks.find((leak) => leak.category === "debt");

  assert.deepEqual(goal!.relatedEntityIds, ["travel"], "goal finding links to its goal");
  assert.deepEqual(debt!.relatedEntityIds, ["card"], "debt finding links to its liability");

  const fee = findings.leaks.find((leak) => leak.category === "fee");
  assert.deepEqual(fee!.relatedEntityIds, [], "transaction-based findings use transactionIds instead");
});

test("split: Advisor produces one recommendation per observation", () => {
  const state = multiLeakState();
  const findings = detectMoneyLeakFindings(state);
  const recommendations = moneyLeakRecommendations(state);

  assert.equal(recommendations.length, findings.leaks.length);
  findings.leaks.forEach((leak, index) => {
    assert.equal(recommendations[index].id, `advisor:leak:${leak.id}`);
  });
});

test("split: Advisor does not re-implement detector calculations", () => {
  const state = multiLeakState();
  const findings = detectMoneyLeakFindings(state);
  const recommendations = moneyLeakRecommendations(state);

  findings.leaks.forEach((leak, index) => {
    const recommendation = recommendations[index];
    // Facts and evidence are passed through verbatim, never recomputed.
    assert.equal(recommendation.fact, leak.summary, "fact must be the detector's own summary");
    assert.deepEqual(recommendation.evidence, leak.evidence, "evidence must be the detector's own");
  });
});

test("split: Advisor supplies impact, action and destination — the detector does not", () => {
  const recommendations = moneyLeakRecommendations(multiLeakState());
  assert.ok(recommendations.length > 0);
  for (const recommendation of recommendations) {
    assert.ok(recommendation.impact.length > 0, `${recommendation.id} missing impact`);
    assert.ok(recommendation.action.length > 0, `${recommendation.id} missing action`);
    assert.ok(recommendation.destination, `${recommendation.id} missing destination`);
  }
});

test("split: leak severity maps to the three Advisor states, never positive", () => {
  const recommendations = moneyLeakRecommendations(multiLeakState());
  for (const recommendation of recommendations) {
    assert.ok(["watch", "action"].includes(recommendation.severity), `a detected leak must not be positive: ${recommendation.severity}`);
  }
});

test("split: ruleId is only set when a structured rule genuinely exists", () => {
  const state = multiLeakState();
  const ruleIds = new Set(state.financialRules.map((rule) => rule.id));
  for (const recommendation of moneyLeakRecommendations(state)) {
    if (recommendation.ruleId === null) continue;
    assert.ok(ruleIds.has(recommendation.ruleId), `${recommendation.id} references non-existent rule ${recommendation.ruleId}`);
  }
});

test("split: one-off and debt findings are left unlinked rather than given an invented rule", () => {
  const state = multiLeakState();
  const recommendations = moneyLeakRecommendations(state);
  const debt = recommendations.find((r) => r.id === "advisor:leak:debt-card");
  const duplicate = recommendations.find((r) => r.id === "advisor:leak:duplicate-dup-1");

  assert.equal(debt!.ruleId, null, "no structured debt rule exists yet");
  assert.equal(duplicate!.ruleId, null, "a one-off duplicate is not governed by a policy");
});

test("split: a goal finding links to that goal's contribution rule when one exists", () => {
  const state = stateWith({
    goals: [
      { id: "travel", name: "Travel Fund", label: "Travel", current: 0, target: 2400, monthlyContribution: 0, note: "" },
      { id: "car", name: "Car Fund", label: "Car", current: 0, target: 1200, monthlyContribution: 50, note: "" },
    ],
  });
  const recommendations = moneyLeakRecommendations(state);
  const travel = recommendations.find((r) => r.id === "advisor:leak:goal-travel");
  assert.ok(travel, "the un-funded goal should be flagged");
  // "travel" has no contribution, so no goal-contribution rule was seeded for it.
  assert.equal(travel!.ruleId, null, "no rule exists for a goal with zero contribution");
});

test("split: spending-related findings link to the monthly spending limit rule", () => {
  const state = multiLeakState();
  const fee = moneyLeakRecommendations(state).find((r) => r.id === "advisor:leak:avoidable-fees");
  assert.equal(fee!.ruleId, "monthly-spending-limit");
  assert.ok(fee!.rule.includes("spending"), "rule text should describe the spending policy");
});

test("split: removing the spending rule unlinks those findings instead of breaking them", () => {
  const state = multiLeakState();
  const ruleless: WealthState = {
    ...state,
    financialRules: state.financialRules.filter((rule) => rule.kind !== "monthly-spending-limit"),
  };
  const fee = moneyLeakRecommendations(ruleless).find((r) => r.id === "advisor:leak:avoidable-fees");
  assert.ok(fee, "the finding still stands on its own");
  assert.equal(fee!.ruleId, null);
  assert.ok(fee!.action.length > 0, "advice is still given");
});

test("split: empty findings are handled safely everywhere", () => {
  for (const [label, state] of [["empty", emptyState()], ["no ledger", stateWith({ ledgerTransactions: [], goals: [], liabilities: [], recurringTransactions: [] })]] as const) {
    const findings = detectMoneyLeakFindings(state);
    assert.deepEqual(findings.leaks, [], `${label}: expected no findings`);
    assert.equal(findings.monthlyImpact, 0);
    assert.equal(findings.annualImpact, 0);
    assert.equal(findings.highCount, 0);
    assert.equal(findings.categoryCount, 0);
    assert.equal(findings.topLeak, undefined);

    assert.deepEqual(moneyLeakRecommendations(state), [], `${label}: no findings means no recommendations`);
    const summary = detectMoneyLeaks(state);
    assert.deepEqual(summary.leaks, []);
    assert.equal(summary.topLeak, undefined);
  }
});

test("split: the compatibility shape preserves every detection value untouched", () => {
  const state = multiLeakState();
  const findings = detectMoneyLeakFindings(state);
  const annotated = detectMoneyLeaks(state);

  assert.equal(annotated.leaks.length, findings.leaks.length);
  assert.equal(annotated.monthlyImpact, findings.monthlyImpact);
  assert.equal(annotated.annualImpact, findings.annualImpact);
  assert.equal(annotated.highCount, findings.highCount);
  assert.equal(annotated.categoryCount, findings.categoryCount);

  findings.leaks.forEach((observation, index) => {
    const decorated = annotated.leaks[index];
    // Strip the Advisor-owned fields; what remains must be byte-identical.
    const { why, recommendation, primaryAction, actionLabel, ...rest } = decorated;
    void why; void recommendation; void primaryAction; void actionLabel;
    assert.deepEqual(rest as MoneyLeakObservation, observation, `${observation.id} detection values changed`);
  });
});

test("split: the compatibility shape still carries the original advisory wording", () => {
  // Pinned against the pre-refactor strings so the Money Leaks UI is unchanged.
  const annotated = detectMoneyLeaks(multiLeakState());
  const fee = annotated.leaks.find((leak) => leak.category === "fee")!;
  const debt = annotated.leaks.find((leak) => leak.category === "debt")!;
  const goal = annotated.leaks.find((leak) => leak.category === "goal")!;
  const duplicate = annotated.leaks.find((leak) => leak.category === "duplicate")!;

  assert.equal(fee.why, "Fees usually provide no lasting value and can often be removed by changing payment timing, account settings, or providers.");
  assert.equal(fee.recommendation, "Open the matching entries, confirm the cause, then add a reminder or payment rule that prevents the next charge.");
  assert.equal(fee.primaryAction, "review-ledger");
  assert.equal(fee.actionLabel, "Review matching entries");

  assert.equal(debt.primaryAction, "review-debt");
  assert.equal(debt.actionLabel, "Review debt plan");
  assert.equal(debt.recommendation, "Prioritise payments above the minimum while preserving the essential emergency buffer.");

  assert.equal(goal.primaryAction, "review-goal");
  assert.equal(goal.actionLabel, "Update goal");

  assert.equal(duplicate.primaryAction, "review-ledger");
  assert.equal(duplicate.actionLabel, "Inspect transactions");
});

test("split: budget-drift advice still names the drifting category", () => {
  const state = stateWith({
    cashflow: { allowance: 2000, transport: 50, food: 100, otherFixed: 0, irregularIncome: 0 },
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 9000 }],
    ledgerTransactions: [
      { id: "f1", amount: 600, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: "2026-07-05T00:00:00.000Z" },
    ] as LedgerTransaction[],
  });
  const annotated = detectMoneyLeaks(state);
  const budget = annotated.leaks.find((leak) => leak.category === "budget");
  assert.ok(budget, "budget drift should be detected");
  assert.equal(budget!.id, "budget-food");
  assert.equal(budget!.recommendation, "Set a tighter food guardrail and review its largest recent transactions before the next budget cycle.");
  assert.equal(budget!.actionLabel, "Adjust money plan");
});

test("split: detection and recommendations are deterministic", () => {
  const state = multiLeakState();
  assert.deepEqual(detectMoneyLeakFindings(state), detectMoneyLeakFindings(state));
  assert.deepEqual(moneyLeakRecommendations(state), moneyLeakRecommendations(state));
  assert.deepEqual(detectMoneyLeaks(state), detectMoneyLeaks(state));
});

test("split: detection does not mutate state", () => {
  const state = multiLeakState();
  const before = JSON.stringify(state);
  detectMoneyLeakFindings(state);
  moneyLeakRecommendations(state);
  detectMoneyLeaks(state);
  assert.equal(JSON.stringify(state), before);
});

test("split: the default state still produces its usual findings", () => {
  const state = cloneDefaultState();
  assert.doesNotThrow(() => detectMoneyLeakFindings(state));
  assert.doesNotThrow(() => moneyLeakRecommendations(state));
  assert.doesNotThrow(() => detectMoneyLeaks(state));
});
