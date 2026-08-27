import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  completeActionRecord,
  createActionRecord,
  getActionRecordFor,
  getActionRecords,
  isRecommendationCompleted,
  markRecommendationDone,
  normalizeActionRecords,
  validateActionRecord,
  MAX_ACTION_RECORDS,
} from "../src/actionRecords";
import { getAdvisorSnapshot, advisorRecommendations, prioritizeRecommendations } from "../src/advisor";
import { buildOverviewModel } from "../src/overview";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { ActionRecord, WealthState } from "../src/models";

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-actions", ...overrides });
}

function record(overrides: Partial<ActionRecord> & Pick<ActionRecord, "id" | "recommendationId">): ActionRecord {
  return { action: "do the thing", status: "pending", createdAt: 1_000, ...overrides };
}

// --- schema & defaults ------------------------------------------------------

test("actions: the schema version is current", () => {
  // Tracks the constant rather than a literal: a legitimate migration should
  // not force unrelated version pins to be edited.
  assert.ok(Number.isInteger(CURRENT_VERSION) && CURRENT_VERSION >= 17);
});

test("actions: a new user starts with an empty actionRecords array", () => {
  for (const [label, state] of [["default", cloneDefaultState()], ["empty", emptyState()]] as const) {
    assert.ok(Array.isArray(state.actionRecords), `${label} must have the array`);
    assert.deepEqual(state.actionRecords, [], `${label} must start empty`);
  }
});

test("actions: actionRecords is part of the persisted WealthState", () => {
  assert.ok(Object.keys(cloneDefaultState()).includes("actionRecords"));
});

// --- migration --------------------------------------------------------------

test("actions: a v16 state migrates to v17 with an empty actionRecords array", () => {
  const migrated = migrateState({
    version: 16,
    deviceId: "device-v16",
    dca: { monthly: 250, targets: { VOO: 0.8, QQQM: 0.2 } },
  });
  assert.equal(migrated.version, CURRENT_VERSION);
  assert.deepEqual(migrated.actionRecords, []);
});

test("actions: migration preserves every existing field", () => {
  const migrated = migrateState({
    version: 16,
    deviceId: "device-v16",
    dca: { monthly: 250, targets: { VOO: 0.8, QQQM: 0.2 } },
    emergency: { current: 3000, target: 6000, annualYield: 0.03, monthlyTopUp: 200 },
    trades: [{ id: "keep", date: "2026-01-02", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23, priceUsd: 500, feeMyr: 2 }],
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 900 }],
    liabilities: [{ id: "l1", name: "Card", balance: 700, annualRate: 0.18, minimumPayment: 50 }],
    ruleCardOverrides: { "dca-mandate": { title: "Mine", body: "My wording" } },
    hiddenRuleIds: ["data-safety"],
    ruleNotesList: [{ id: "n1", title: "Note", body: "Body", createdAt: 1 }],
    customTickers: ["AAPL"],
  });

  assert.equal(migrated.dca.monthly, 250);
  assert.equal(migrated.emergency.target, 6000);
  assert.equal(migrated.trades[0].id, "keep");
  assert.equal(migrated.liabilities[0].balance, 700);
  assert.deepEqual(migrated.ruleCardOverrides["dca-mandate"], { title: "Mine", body: "My wording" });
  assert.deepEqual(migrated.hiddenRuleIds, ["data-safety"]);
  assert.equal(migrated.ruleNotesList.length, 1);
  assert.deepEqual(migrated.customTickers, ["AAPL"]);
  assert.ok(migrated.financialRules.length > 0, "v16 structured rules survive");
});

test("actions: a much older state (v10) also migrates safely", () => {
  const migrated = migrateState({ version: 10, deviceId: "old" });
  assert.equal(migrated.version, CURRENT_VERSION);
  assert.deepEqual(migrated.actionRecords, []);
  assert.ok(Array.isArray(migrated.financialRules));
});

test("actions: existing records survive migration and are not reset", () => {
  const migrated = migrateState({
    version: 17,
    deviceId: "d",
    actionRecords: [record({ id: "a1", recommendationId: "advisor:dca-mandate", status: "completed", completedAt: 2_000 })],
  });
  assert.equal(migrated.actionRecords.length, 1);
  assert.equal(migrated.actionRecords[0].status, "completed");
  assert.equal(migrated.actionRecords[0].completedAt, 2_000);
});

test("actions: migration is idempotent", () => {
  const once = migrateState({ version: 16, deviceId: "d", actionRecords: [record({ id: "a1", recommendationId: "r1" })] });
  const twice = migrateState(once);
  assert.deepEqual(twice.actionRecords, once.actionRecords);
  assert.equal(twice.version, CURRENT_VERSION);
});

test("actions: an export/import round-trip preserves records", () => {
  const original = migrateState({
    version: 17, deviceId: "d",
    actionRecords: [record({ id: "a1", recommendationId: "advisor:dca-mandate", status: "completed", completedAt: 5 })],
  });
  const roundTripped = migrateState(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(roundTripped.actionRecords, original.actionRecords);
});

// --- validation / robustness ------------------------------------------------

test("actions: malformed records are dropped without breaking the state", () => {
  const migrated = migrateState({
    version: 17,
    deviceId: "d",
    trades: [{ id: "keep", date: "2026-01-02", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23, priceUsd: 500, feeMyr: 2 }],
    actionRecords: [
      null,
      "not a record",
      { recommendationId: "r", status: "pending", createdAt: 1 },        // no id
      { id: "x", status: "pending", createdAt: 1 },                       // no recommendationId
      { id: "y", recommendationId: "r2", status: "wat", createdAt: 1 },   // bad status
      { id: "z", recommendationId: "r3", status: "pending" },             // no createdAt
      { id: "n", recommendationId: "r4", status: "pending", createdAt: Number.NaN },
      { id: "ok", recommendationId: "r5", action: "go", status: "pending", createdAt: 7 },
    ] as unknown as ActionRecord[],
  });
  assert.equal(migrated.actionRecords.length, 1);
  assert.equal(migrated.actionRecords[0].id, "ok");
  assert.equal(migrated.trades.length, 1, "unrelated state survives");
});

test("actions: validateActionRecord strips a completedAt from a pending record", () => {
  const validated = validateActionRecord({
    id: "a", recommendationId: "r", status: "pending", createdAt: 1, completedAt: 9,
  })!;
  assert.equal(validated.status, "pending");
  assert.equal("completedAt" in validated, false, "a pending record cannot carry a completion time");
});

test("actions: normalizeActionRecords de-duplicates by recommendation, keeping the first", () => {
  const records = normalizeActionRecords([
    record({ id: "a1", recommendationId: "r1", action: "first" }),
    record({ id: "a2", recommendationId: "r1", action: "second" }),
    record({ id: "a3", recommendationId: "r2" }),
  ]);
  assert.equal(records.length, 2);
  assert.equal(records[0].action, "first");
});

test("actions: a non-array value yields an empty list", () => {
  for (const value of [undefined, null, 0, "x", {}]) {
    assert.deepEqual(normalizeActionRecords(value), []);
  }
});

// --- lifecycle --------------------------------------------------------------

test("actions: createActionRecord adds a pending record", () => {
  const records = createActionRecord([], { id: "a1", recommendationId: "advisor:dca-mandate", action: "Do it", now: 100 });
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "pending");
  assert.equal(records[0].recommendationId, "advisor:dca-mandate");
  assert.equal(records[0].action, "Do it");
  assert.equal(records[0].createdAt, 100);
  assert.equal(records[0].completedAt, undefined);
});

test("actions: completeActionRecord flips status and stamps completedAt", () => {
  const pending = createActionRecord([], { id: "a1", recommendationId: "r1", action: "Do it", now: 100 });
  const done = completeActionRecord(pending, "r1", 200);
  assert.equal(done[0].status, "completed");
  assert.equal(done[0].completedAt, 200);
  assert.equal(done[0].createdAt, 100, "creation time is untouched");
});

test("actions: completing twice does not move the timestamp", () => {
  const done = completeActionRecord(
    createActionRecord([], { id: "a1", recommendationId: "r1", action: "x", now: 1 }), "r1", 200);
  const again = completeActionRecord(done, "r1", 999);
  assert.equal(again[0].completedAt, 200);
  assert.equal(again, done, "an unchanged list is returned as-is");
});

test("actions: completing an unknown recommendation is a no-op", () => {
  const records = createActionRecord([], { id: "a1", recommendationId: "r1", action: "x", now: 1 });
  assert.equal(completeActionRecord(records, "nope", 5), records);
});

test("actions: markRecommendationDone creates and completes in one step", () => {
  const records = markRecommendationDone([], { id: "a1", recommendationId: "r1", action: "Do it", now: 50 });
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "completed");
  assert.equal(records[0].completedAt, 50);
});

// --- duplicate behaviour ----------------------------------------------------

test("actions: a recommendation gets at most one record, no matter how often it is accepted", () => {
  let records = createActionRecord([], { id: "a1", recommendationId: "r1", action: "x", now: 1 });
  records = createActionRecord(records, { id: "a2", recommendationId: "r1", action: "y", now: 2 });
  records = createActionRecord(records, { id: "a3", recommendationId: "r1", action: "z", now: 3 });
  assert.equal(records.length, 1, "duplicates are ignored");
  assert.equal(records[0].id, "a1", "the first record wins");
  assert.equal(records[0].action, "x");
});

test("actions: markRecommendationDone twice leaves exactly one completed record", () => {
  const once = markRecommendationDone([], { id: "a1", recommendationId: "r1", action: "x", now: 10 });
  const twice = markRecommendationDone(once, { id: "a2", recommendationId: "r1", action: "x", now: 20 });
  assert.equal(twice.length, 1);
  assert.equal(twice[0].status, "completed");
  assert.equal(twice[0].completedAt, 10, "the original completion time stands");
});

test("actions: different recommendations get their own records", () => {
  let records = createActionRecord([], { id: "a1", recommendationId: "r1", action: "x", now: 1 });
  records = createActionRecord(records, { id: "a2", recommendationId: "r2", action: "y", now: 2 });
  assert.equal(records.length, 2);
});

test("actions: the record list is capped", () => {
  let records: ActionRecord[] = [];
  for (let i = 0; i < MAX_ACTION_RECORDS + 20; i += 1) {
    records = createActionRecord(records, { id: `a${i}`, recommendationId: `r${i}`, action: "x", now: i });
  }
  assert.equal(records.length, MAX_ACTION_RECORDS);
});

test("actions: lifecycle helpers are pure and never mutate the input array", () => {
  const original = createActionRecord([], { id: "a1", recommendationId: "r1", action: "x", now: 1 });
  const snapshot = JSON.stringify(original);
  createActionRecord(original, { id: "a2", recommendationId: "r2", action: "y", now: 2 });
  completeActionRecord(original, "r1", 5);
  markRecommendationDone(original, { id: "a3", recommendationId: "r3", action: "z", now: 6 });
  assert.equal(JSON.stringify(original), snapshot);
});

// --- lookup -----------------------------------------------------------------

test("actions: lookup helpers find records by recommendation", () => {
  const state = stateWith({
    actionRecords: [record({ id: "a1", recommendationId: "advisor:dca-mandate", status: "completed", completedAt: 2 })],
  });
  assert.equal(getActionRecords(state).length, 1);
  assert.equal(getActionRecordFor(state, "advisor:dca-mandate")!.id, "a1");
  assert.equal(getActionRecordFor(state, "nope"), undefined);
  assert.equal(isRecommendationCompleted(state, "advisor:dca-mandate"), true);
  assert.equal(isRecommendationCompleted(state, "nope"), false);
});

test("actions: a pending record is not reported as completed", () => {
  const state = stateWith({ actionRecords: [record({ id: "a1", recommendationId: "r1", status: "pending" })] });
  assert.equal(isRecommendationCompleted(state, "r1"), false);
});

test("actions: lookups tolerate a state with no records", () => {
  assert.deepEqual(getActionRecords({} as WealthState), []);
  assert.equal(isRecommendationCompleted({} as WealthState, "r1"), false);
});

// --- Advisor integration ----------------------------------------------------

test("actions: an Advisor recommendationId links cleanly to a record", () => {
  const base = cloneDefaultState();
  const priority = getAdvisorSnapshot(base).priority!;
  const state: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: priority.id, action: priority.action, now: 42,
    }),
  };
  assert.equal(isRecommendationCompleted(state, priority.id), true);
  assert.equal(getActionRecordFor(state, priority.id)!.action, priority.action);
});

test("actions: records never change Advisor ranking or priority", () => {
  const base = cloneDefaultState();
  const before = getAdvisorSnapshot(base);
  const withRecords: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: before.priority!.id, action: before.priority!.action, now: 1,
    }),
  };
  const after = getAdvisorSnapshot(withRecords);

  assert.deepEqual(after.recommendations.map((r) => r.id), before.recommendations.map((r) => r.id),
    "ranking is identical");
  assert.equal(after.priority!.id, before.priority!.id, "the priority does not change once completed");
  assert.deepEqual(
    prioritizeRecommendations(advisorRecommendations(withRecords)).map((r) => r.id),
    prioritizeRecommendations(advisorRecommendations(base)).map((r) => r.id),
  );
});

test("actions: the Dashboard priority is unaffected by records", () => {
  const base = cloneDefaultState();
  const before = buildOverviewModel(base).priorityAction!;
  const withRecords: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: before.recommendationId, action: before.actionLabel, now: 1,
    }),
  };
  const after = buildOverviewModel(withRecords).priorityAction!;
  assert.equal(after.recommendationId, before.recommendationId);
  assert.equal(after.severity, before.severity);
});

test("actions: a record never carries a copy of the recommendation", () => {
  const base = cloneDefaultState();
  const priority = getAdvisorSnapshot(base).priority!;
  const records = markRecommendationDone([], {
    id: "a1", recommendationId: priority.id, action: priority.action, now: 1,
  });
  assert.deepEqual(Object.keys(records[0]).sort(),
    ["action", "completedAt", "createdAt", "id", "recommendationId", "status"].sort());
  const serialized = JSON.stringify(records[0]);
  for (const forbidden of ["title", "severity", "impact", "destination", "ruleId", "fact", "evidence"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} must stay with the Advisor`);
  }
});

// --- boundaries unchanged ---------------------------------------------------

test("actions: Money Leak detection is unchanged", () => {
  const state = stateWith({
    liabilities: [{ id: "card", name: "Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
  });
  const debt = detectMoneyLeakFindings(state).leaks.find((l) => l.id === "debt-card")!;
  assert.equal(debt.monthlyImpact, 6000 * 0.18 / 12);
  assert.equal(debt.confidence, 0.99);
  for (const advisory of ["why", "recommendation", "primaryAction", "actionLabel"]) {
    assert.equal(advisory in debt, false, `detector must not carry ${advisory}`);
  }
});

test("actions: adding records changes no financial figure", () => {
  const base = cloneDefaultState();
  const withRecords: WealthState = {
    ...base,
    actionRecords: markRecommendationDone(base.actionRecords, {
      id: "a1", recommendationId: "advisor:dca-mandate", action: "x", now: 1,
    }),
  };
  const before = buildOverviewModel(base);
  const after = buildOverviewModel(withRecords);
  assert.equal(after.netWorth, before.netWorth);
  assert.equal(after.cashFlow.surplus, before.cashFlow.surplus);
  assert.equal(after.wealthHealth.status, before.wealthHealth.status);
  assert.equal(after.planStatus.label, before.planStatus.label);
  assert.deepEqual(after.budget, before.budget);
  assert.deepEqual(after.portfolio, before.portfolio);
  assert.deepEqual(after.goals, before.goals);
});

test("actions: empty and partial states do not crash", () => {
  const partial = migrateState({ deviceId: "d", actionRecords: undefined as unknown as ActionRecord[] });
  for (const [label, state] of [["empty", emptyState()], ["partial", partial], ["default", cloneDefaultState()]] as const) {
    assert.ok(Array.isArray(state.actionRecords), `${label} records`);
    assert.doesNotThrow(() => getActionRecords(state), `${label} read`);
    assert.doesNotThrow(() => isRecommendationCompleted(state, "anything"), `${label} lookup`);
    assert.doesNotThrow(() => buildOverviewModel(state), `${label} overview`);
  }
});
