import assert from "node:assert/strict";
import { test } from "./testHarness";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { getAdvisorSnapshot, moneyLeakRecommendations, detectMoneyLeaks } from "../src/advisor";
import { markRecommendationDone, isRecommendationCompleted, createActionRecord, completeActionRecord } from "../src/actionRecords";
import { buildOverviewModel } from "../src/overview";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { demoState } from "../src/demoData";
import { migrateState, CURRENT_VERSION } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);
const demo = (): WealthState => migrateState(JSON.parse(JSON.stringify(demoState)));

/**
 * Step 22: Money Leak recommendations gain a real consumer, and completing one
 * records execution state without touching the finding behind it.
 */

// --- Detector is untouched -------------------------------------------------

test("leaks: detection output is unchanged and carries no advisory fields", () => {
  const findings = detectMoneyLeakFindings(demo());
  assert.equal(findings.leaks.length, 5, "the demo baseline still detects 5 leaks");
  const serialized = JSON.stringify(findings);
  for (const advisory of ["why", "recommendation", "primaryAction", "actionLabel", "destination", "ruleId"]) {
    assert.equal(serialized.includes(`"${advisory}"`), false, `${advisory} leaked into the detector`);
  }
});

test("leaks: detection is deterministic", () => {
  const state = demo();
  assert.deepEqual(detectMoneyLeakFindings(state), detectMoneyLeakFindings(state));
});

// --- Recommendations -------------------------------------------------------

test("leaks: every finding maps to exactly one recommendation with a stable id", () => {
  const state = demo();
  const findings = detectMoneyLeakFindings(state);
  const recommendations = getAdvisorSnapshot(state).leakRecommendations;

  assert.equal(recommendations.length, findings.leaks.length);
  for (const leak of findings.leaks) {
    const matches = recommendations.filter((r) => r.id === `advisor:leak:${leak.id}`);
    assert.equal(matches.length, 1, `${leak.id} should map to exactly one recommendation`);
    const recommendation = matches[0]!;
    assert.ok(recommendation.impact.length > 0, "advice must explain why it matters");
    assert.ok(recommendation.action.length > 0, "advice must say what to do");
    assert.equal(recommendation.title, leak.title, "the recommendation names its finding");
  }
});

test("leaks: recommendation ids and order are stable across rebuilds", () => {
  const state = demo();
  const first = getAdvisorSnapshot(state).leakRecommendations.map((r) => r.id);
  const second = getAdvisorSnapshot(state).leakRecommendations.map((r) => r.id);
  assert.deepEqual(second, first);
  // The snapshot is the single ordering authority; the UI must not re-sort.
  assert.deepEqual(first, getAdvisorSnapshot(state).leakRecommendations.map((r) => r.id));
});

test("leaks: the deprecated merged shape agrees with the canonical recommendations", () => {
  // The page moved from detectMoneyLeaks().why/.recommendation to the canonical
  // recommendation. Both draw on the same advice table, so the words the user
  // sees must not have changed.
  const state = demo();
  const merged = detectMoneyLeaks(state);
  const canonical = moneyLeakRecommendations(state);
  for (const leak of merged.leaks) {
    const recommendation = canonical.find((r) => r.id === `advisor:leak:${leak.id}`);
    assert.ok(recommendation, `${leak.id} has no canonical recommendation`);
    assert.equal(recommendation.impact, leak.why, `${leak.id} "why" text drifted`);
    assert.equal(recommendation.action, leak.recommendation, `${leak.id} action text drifted`);
  }
});

test("leaks: no findings means no invented recommendations", () => {
  const empty = migrateState({
    deviceId: "s22e",
    ledgerTransactions: [], ledgerAccounts: [], recurringTransactions: [],
    liabilities: [], goals: [], trades: [],
  });
  assert.equal(detectMoneyLeakFindings(empty).leaks.length, 0);
  assert.deepEqual(getAdvisorSnapshot(empty).leakRecommendations, []);
});

// --- ActionRecord ----------------------------------------------------------

function firstLeakRecommendationId(state: WealthState): string {
  const id = getAdvisorSnapshot(state).leakRecommendations[0]?.id;
  assert.ok(id, "fixture must produce a leak recommendation");
  return id;
}

test("leaks: marking an action done creates exactly one record", () => {
  const state = demo();
  const recommendationId = firstLeakRecommendationId(state);
  const records = markRecommendationDone(state.actionRecords, {
    id: "a1", recommendationId, action: "Review recurring payments", now: 1000,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]!.recommendationId, recommendationId);
  assert.equal(records[0]!.status, "completed");
  assert.equal(records[0]!.completedAt, 1000);
});

test("leaks: repeated acceptance never duplicates, and completion is idempotent", () => {
  const recommendationId = firstLeakRecommendationId(demo());
  const once = createActionRecord([], { id: "a1", recommendationId, action: "x", now: 1000 });
  const twice = createActionRecord(once, { id: "a2", recommendationId, action: "x again", now: 2000 });
  assert.equal(twice.length, 1, "a duplicate record was created");
  assert.equal(twice[0]!.id, "a1");

  const done = completeActionRecord(twice, recommendationId, 3000);
  const doneAgain = completeActionRecord(done, recommendationId, 9999);
  assert.equal(doneAgain[0]!.completedAt, 3000, "completing twice moved the timestamp");
  assert.equal(doneAgain, done);
});

test("leaks: an ActionRecord stores no leak facts and no advisory copy", () => {
  const state = demo();
  const recommendationId = firstLeakRecommendationId(state);
  const records = markRecommendationDone([], { id: "a1", recommendationId, action: "Do it", now: 1 });
  assert.deepEqual(Object.keys(records[0]!).sort(),
    ["action", "completedAt", "createdAt", "id", "recommendationId", "status"].sort());
  const serialized = JSON.stringify(records[0]);
  for (const owned of ["category", "severity", "impact", "monthlyImpact", "annualImpact", "confidence", "evidence", "leakId", "findingId"]) {
    assert.equal(serialized.includes(`"${owned}"`), false, `${owned} was embedded in the record`);
  }
});

// --- Completion changes nothing factual ------------------------------------

test("leaks: completing an action leaves the finding and every figure intact", () => {
  const base = demo();
  const recommendationId = firstLeakRecommendationId(base);
  const after: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId, action: "Done", now: 1000,
    }),
  };

  assert.equal(isRecommendationCompleted(after, recommendationId), true);
  // The leak is still detected — completion is not a fix.
  assert.deepEqual(detectMoneyLeakFindings(after), detectMoneyLeakFindings(base));
  assert.deepEqual(getAdvisorSnapshot(after).leakRecommendations, getAdvisorSnapshot(base).leakRecommendations);
  // And the Advisor's own ranking is untouched.
  assert.deepEqual(
    getAdvisorSnapshot(after).recommendations.map((r) => r.id),
    getAdvisorSnapshot(base).recommendations.map((r) => r.id),
  );
  assert.equal(getAdvisorSnapshot(after).priority?.id, getAdvisorSnapshot(base).priority?.id);
});

test("leaks: completing an action changes no financial fact anywhere", () => {
  const base = demo();
  const after: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: firstLeakRecommendationId(base), action: "Done", now: 1000,
    }),
  };
  assert.deepEqual(getLedgerSnapshot(after, NOW), getLedgerSnapshot(base, NOW));
  assert.deepEqual(getFinancialSnapshot(after, NOW), getFinancialSnapshot(base, NOW));
  assert.deepEqual(getGoalsSnapshot(after), getGoalsSnapshot(base));
  assert.deepEqual(getBudgetSnapshot(after, NOW), getBudgetSnapshot(base, NOW));
  assert.deepEqual(getFinancialHealthSnapshot(after, NOW), getFinancialHealthSnapshot(base, NOW));
  assert.deepEqual(getPortfolioSnapshot(after), getPortfolioSnapshot(base));

  const before = buildOverviewModel(base, NOW);
  const model = buildOverviewModel(after, NOW);
  assert.equal(model.netWorth, before.netWorth);
  assert.deepEqual(model.cashFlow, before.cashFlow);
  assert.equal(model.priorityAction?.recommendationId, before.priorityAction?.recommendationId);
});

// --- Rendered numbers are always finite ------------------------------------

test("leaks: no finding ever carries a non-finite or missing number", () => {
  const states = [
    demo(),
    migrateState({ deviceId: "s22a", ledgerTransactions: [], ledgerAccounts: [] }),
    migrateState({ deviceId: "s22b", liabilities: [{ id: "l", name: "L", balance: 9000, annualRate: 0.18, minimumPayment: 0 }] }),
    migrateState({ deviceId: "s22c", goals: [{ id: "g", name: "G", label: "G", note: "", target: 0, current: 0, monthlyContribution: 0 }] }),
  ];
  for (const state of states) {
    const findings = detectMoneyLeakFindings(state);
    for (const leak of findings.leaks) {
      for (const [field, value] of [["monthlyImpact", leak.monthlyImpact], ["annualImpact", leak.annualImpact], ["confidence", leak.confidence]] as const) {
        assert.equal(typeof value, "number", `${leak.id}.${field} is not a number`);
        assert.ok(Number.isFinite(value), `${leak.id}.${field} is not finite`);
      }
      assert.ok(leak.title.length > 0 && leak.summary.length > 0);
      for (const item of leak.evidence) {
        assert.ok(typeof item.value === "string" && !/NaN|Infinity|undefined|null/.test(item.value),
          `${leak.id} evidence "${item.label}" renders "${item.value}"`);
      }
    }
    for (const total of [findings.monthlyImpact, findings.annualImpact]) {
      assert.ok(Number.isFinite(total), "a total impact is not finite");
    }
  }
});

// --- Persistence -----------------------------------------------------------

test("leaks: findings stay derived and the schema stays at v17", () => {
  const state = demo();
  const withRecord: WealthState = {
    ...state,
    actionRecords: markRecommendationDone(state.actionRecords, {
      id: "a1", recommendationId: firstLeakRecommendationId(state), action: "Done", now: 1000,
    }),
  };
  const serialized = JSON.stringify(withRecord);
  for (const derived of ["moneyLeakFindings", "leakRecommendations", "monthlyImpact", "annualImpact", "dismissed", "resolved", "fixed"]) {
    assert.equal(serialized.includes(`"${derived}"`), false, `${derived} was persisted`);
  }
  // The record itself survives a reload untouched.
  const reloaded = migrateState(JSON.parse(serialized));
  assert.deepEqual(reloaded.actionRecords, withRecord.actionRecords);
  assert.equal(reloaded.version, CURRENT_VERSION);
  assert.equal(CURRENT_VERSION, 17);
});
