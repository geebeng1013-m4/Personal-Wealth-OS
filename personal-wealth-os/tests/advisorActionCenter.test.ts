import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getAdvisorSnapshot, advisorMessages } from "../src/advisor";
import {
  markRecommendationDone, isRecommendationCompleted, getActionRecordFor,
  createActionRecord, completeActionRecord, normalizeActionRecords,
} from "../src/actionRecords";
import { buildOverviewModel } from "../src/overview";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { demoState } from "../src/demoData";
import { migrateState, CURRENT_VERSION } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);
const demo = (): WealthState => migrateState(JSON.parse(JSON.stringify(demoState)));

/**
 * Step 23: every Advisor recommendation becomes actionable. What must hold is
 * that recording an action is the ONLY thing that changes — the advice, its
 * ranking and every financial fact stay exactly where they were.
 */

// --- Advisor recommendations ----------------------------------------------

test("advisor: recommendations are deterministic, uniquely identified and ranked", () => {
  const state = demo();
  const first = getAdvisorSnapshot(state).recommendations;
  const second = getAdvisorSnapshot(state).recommendations;
  assert.deepEqual(second.map((r) => r.id), first.map((r) => r.id), "order is not deterministic");

  const ids = first.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate recommendation ids");
  for (const recommendation of first) {
    assert.ok(recommendation.id.length > 0, "every recommendation needs a stable id");
    assert.ok(recommendation.action.length > 0, "every recommendation needs an action");
  }
  // Priority is exactly the first ranked recommendation.
  assert.equal(getAdvisorSnapshot(state).priority?.id, first[0]!.id);
});

test("advisor: the card list still shows the same words it always did", () => {
  // The page moved from advisorMessages() to rendering recommendations
  // directly. Same title, same body composition, same order.
  const state = demo();
  const recommendations = getAdvisorSnapshot(state).recommendations;
  const messages = advisorMessages(state);
  assert.equal(messages.length, recommendations.length);
  recommendations.forEach((recommendation, index) => {
    const message = messages[index]!;
    assert.equal(message.title, recommendation.title, `card ${index} title drifted`);
    assert.equal(message.severity, recommendation.severity, `card ${index} severity drifted`);
    assert.equal(message.body, `${recommendation.fact} ${recommendation.action}`.trim(), `card ${index} body drifted`);
  });
});

// --- Execution state per recommendation ------------------------------------

test("advisor: any recommendation can be marked done, not just the priority", () => {
  const state = demo();
  const recommendations = getAdvisorSnapshot(state).recommendations;
  assert.ok(recommendations.length > 1, "fixture needs several recommendations");

  // Take a NON-priority recommendation, which previously had no control at all.
  const target = recommendations[recommendations.length - 1]!;
  assert.notEqual(target.id, getAdvisorSnapshot(state).priority?.id);

  const records = markRecommendationDone(state.actionRecords, {
    id: "a1", recommendationId: target.id, action: target.action, now: 1000,
  });
  const next: WealthState = { ...state, actionRecords: records };
  assert.equal(isRecommendationCompleted(next, target.id), true);
  // Every other recommendation is still pending.
  for (const other of recommendations.filter((r) => r.id !== target.id)) {
    assert.equal(isRecommendationCompleted(next, other.id), false, `${other.id} was wrongly completed`);
  }
});

test("advisor: status lookup handles pending, completed and missing records", () => {
  const state = demo();
  const target = getAdvisorSnapshot(state).recommendations[0]!;

  assert.equal(getActionRecordFor(state, target.id), undefined, "no record yet");
  assert.equal(isRecommendationCompleted(state, target.id), false);

  const pending: WealthState = {
    ...state,
    actionRecords: createActionRecord([], { id: "a1", recommendationId: target.id, action: target.action, now: 1000 }),
  };
  assert.equal(getActionRecordFor(pending, target.id)?.status, "pending");
  assert.equal(isRecommendationCompleted(pending, target.id), false, "pending must not read as completed");

  const done: WealthState = { ...pending, actionRecords: completeActionRecord(pending.actionRecords, target.id, 2000) };
  assert.equal(isRecommendationCompleted(done, target.id), true);
  assert.equal(isRecommendationCompleted(done, "advisor:does-not-exist"), false, "unknown id must be false");
});

test("advisor: a record outlives the recommendation that produced it", () => {
  // Advice is derived, so it can disappear when the facts improve. The record
  // of what the user did is history and must survive that.
  const state = demo();
  const target = getAdvisorSnapshot(state).recommendations[0]!;
  const withRecord: WealthState = {
    ...state,
    actionRecords: markRecommendationDone([], { id: "a1", recommendationId: target.id, action: target.action, now: 1000 }),
  };
  // A state where that advice no longer applies still keeps the record intact.
  const later = migrateState(JSON.parse(JSON.stringify({ ...withRecord, deviceId: "later" })));
  assert.equal(later.actionRecords.length, 1);
  assert.equal(later.actionRecords[0]!.recommendationId, target.id);
  assert.equal(later.actionRecords[0]!.status, "completed");
});

// --- ActionRecord integrity ------------------------------------------------

test("advisor: duplicate accept and duplicate completion are both no-ops", () => {
  const target = getAdvisorSnapshot(demo()).recommendations[0]!;
  const once = createActionRecord([], { id: "a1", recommendationId: target.id, action: "x", now: 1000 });
  const twice = createActionRecord(once, { id: "a2", recommendationId: target.id, action: "y", now: 2000 });
  assert.equal(twice.length, 1, "a second record was created");
  assert.equal(twice[0]!.id, "a1");

  const done = completeActionRecord(twice, target.id, 3000);
  const doneAgain = completeActionRecord(done, target.id, 9999);
  assert.equal(doneAgain[0]!.completedAt, 3000, "completedAt must be immutable");
  assert.equal(doneAgain, done, "an unchanged list should not be rebuilt");
});

test("advisor: a record never carries advice content", () => {
  const target = getAdvisorSnapshot(demo()).recommendations[0]!;
  const records = markRecommendationDone([], { id: "a1", recommendationId: target.id, action: target.action, now: 1 });
  assert.deepEqual(Object.keys(records[0]!).sort(),
    ["action", "completedAt", "createdAt", "id", "recommendationId", "status"].sort());
  const serialized = JSON.stringify(records[0]);
  for (const owned of ["severity", "impact", "title", "destination", "ruleId", "fact", "evidence"]) {
    assert.equal(serialized.includes(`"${owned}"`), false, `${owned} was embedded`);
  }
});

test("advisor: malformed records are dropped without touching the good ones", () => {
  const target = getAdvisorSnapshot(demo()).recommendations[0]!;
  const good = markRecommendationDone([], { id: "a1", recommendationId: target.id, action: "x", now: 1 })[0]!;
  const normalized = normalizeActionRecords([null, 42, "nope", { id: "x" }, good, { recommendationId: "y" }]);
  assert.deepEqual(normalized, [good]);
});

test("advisor: records survive a persistence round trip exactly", () => {
  const state = demo();
  const target = getAdvisorSnapshot(state).recommendations[0]!;
  const withRecord: WealthState = {
    ...state,
    actionRecords: markRecommendationDone(state.actionRecords, {
      id: "a1", recommendationId: target.id, action: target.action, now: 1_700_000_000_000,
    }),
  };
  const reloaded = migrateState(JSON.parse(JSON.stringify(withRecord)));
  assert.deepEqual(reloaded.actionRecords, withRecord.actionRecords);
  assert.equal(reloaded.version, CURRENT_VERSION);
  assert.ok(CURRENT_VERSION >= 17);
});

// --- Completion never leaks into the facts ---------------------------------

test("advisor: completing every recommendation changes no fact and no ranking", () => {
  const base = demo();
  const snapshot = getAdvisorSnapshot(base);
  // Mark ALL of them done — the strongest version of the invariant.
  let records = base.actionRecords;
  for (const [index, recommendation] of snapshot.recommendations.entries()) {
    records = markRecommendationDone(records, {
      id: `a${index}`, recommendationId: recommendation.id, action: recommendation.action, now: 1000 + index,
    });
  }
  const after: WealthState = { ...base, actionRecords: records };
  assert.equal(after.actionRecords.length, snapshot.recommendations.length);

  // Advice, ranking and priority are identical.
  assert.deepEqual(getAdvisorSnapshot(after), getAdvisorSnapshot(base));
  assert.equal(getAdvisorSnapshot(after).priority?.id, snapshot.priority?.id);
  // Nothing disappears just because it was completed.
  assert.equal(getAdvisorSnapshot(after).recommendations.length, snapshot.recommendations.length);

  // Every financial read model is untouched.
  assert.deepEqual(getLedgerSnapshot(after, NOW), getLedgerSnapshot(base, NOW));
  assert.deepEqual(getFinancialSnapshot(after, NOW), getFinancialSnapshot(base, NOW));
  assert.deepEqual(getGoalsSnapshot(after), getGoalsSnapshot(base));
  assert.deepEqual(getBudgetSnapshot(after, NOW), getBudgetSnapshot(base, NOW));
  assert.deepEqual(getFinancialHealthSnapshot(after, NOW), getFinancialHealthSnapshot(base, NOW));
  assert.deepEqual(getPortfolioSnapshot(after), getPortfolioSnapshot(base));
  assert.deepEqual(detectMoneyLeakFindings(after), detectMoneyLeakFindings(base));

  const before = buildOverviewModel(base, NOW);
  const model = buildOverviewModel(after, NOW);
  assert.equal(model.netWorth, before.netWorth);
  assert.deepEqual(model.cashFlow, before.cashFlow);
  assert.deepEqual(model.trackedWealth, before.trackedWealth);
  assert.equal(model.priorityAction?.recommendationId, before.priorityAction?.recommendationId,
    "the Dashboard priority must not follow completion state");
});

test("advisor: leak recommendations share ActionRecord without joining the ranking", () => {
  const state = demo();
  const snapshot = getAdvisorSnapshot(state);
  const leak = snapshot.leakRecommendations[0]!;

  // The two collections stay separate.
  const mainIds = new Set(snapshot.recommendations.map((r) => r.id));
  for (const recommendation of snapshot.leakRecommendations) {
    assert.equal(mainIds.has(recommendation.id), false, `${recommendation.id} leaked into the main list`);
  }

  // But one shared mechanism records execution for both.
  const after: WealthState = {
    ...state,
    actionRecords: markRecommendationDone(state.actionRecords, {
      id: "a1", recommendationId: leak.id, action: leak.action, now: 1000,
    }),
  };
  assert.equal(isRecommendationCompleted(after, leak.id), true);
  assert.deepEqual(
    getAdvisorSnapshot(after).recommendations.map((r) => r.id),
    snapshot.recommendations.map((r) => r.id),
    "completing a leak action changed the main ranking",
  );
  assert.deepEqual(detectMoneyLeakFindings(after), detectMoneyLeakFindings(state));
});
