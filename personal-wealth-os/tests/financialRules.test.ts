import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  getDefaultFinancialRules,
  getFinancialRule,
  getFinancialRules,
  getFinancialRulesOfKind,
  goalContributionRuleId,
  normalizeFinancialRules,
  validateFinancialRule,
  DEFAULT_DRIFT_TOLERANCE,
} from "../src/financialRules";
import { CURRENT_VERSION, cloneDefaultState, defaultState, emptyState, migrateState } from "../src/state";
import type { FinancialRule, WealthState } from "../src/models";

function v15State(overrides: Partial<WealthState> = {}): Partial<WealthState> {
  // A realistic pre-v16 state: no financialRules field at all.
  return {
    version: 15,
    deviceId: "device-v15",
    cashflow: { allowance: 2000, transport: 300, food: 450, otherFixed: 150, irregularIncome: 0 },
    emergency: { current: 3000, target: 6000, annualYield: 0.035, monthlyTopUp: 200 },
    dca: { monthly: 500, targets: { VOO: 0.6, QQQM: 0.4 } },
    opportunity: {
      total: 2000,
      used: 0,
      allocation: { VOO: 1200, QQQM: 800 },
      tranches: [
        { drawdown: 10, percent: 0.2, amount: 400, deployed: false },
        { drawdown: 20, percent: 0.5, amount: 1000, deployed: false },
      ],
    },
    goals: [
      { id: "travel", name: "Travel", label: "Travel", current: 100, target: 1000, monthlyContribution: 75, note: "" },
      { id: "done", name: "Done", label: "Done", current: 500, target: 500, monthlyContribution: 0, note: "" },
    ],
    ...overrides,
  };
}

test("financialRules: the schema version tracks the latest migration", () => {
  // v16 added structured rules; v17 added action records.
  assert.equal(CURRENT_VERSION, 17);
});

test("financialRules: a version 15 state migrates successfully and gains structured rules", () => {
  const migrated = migrateState(v15State());
  assert.equal(migrated.version, CURRENT_VERSION);
  assert.ok(Array.isArray(migrated.financialRules));
  assert.ok(migrated.financialRules.length > 0, "migration should seed rules for an upgrading user");
});

test("financialRules: migration preserves existing user data untouched", () => {
  const input = v15State({
    trades: [{ id: "t1", date: "2026-01-02", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23, priceUsd: 500, feeMyr: 2 }],
    ledgerAccounts: [{ id: "acc-bank", name: "Bank", type: "bank", openingBalance: 900 }],
    ledgerTransactions: [{ id: "lt1", amount: 40, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: "2026-01-03T00:00:00.000Z" }],
    liabilities: [{ id: "l1", name: "Card", balance: 700, annualRate: 0.18, minimumPayment: 50 }],
    reviews: [{ id: "r1", month: "2026-01", income: 2000, spending: 900, dcaDone: true, disciplineScore: 88, notes: "ok" }],
    customTickers: ["AAPL"],
  });
  const migrated = migrateState(input);

  assert.equal(migrated.trades.length, 1);
  assert.equal(migrated.trades[0].id, "t1");
  assert.equal(migrated.ledgerTransactions.length, 1);
  assert.equal(migrated.ledgerTransactions[0].id, "lt1");
  assert.equal(migrated.liabilities.length, 1);
  assert.equal(migrated.liabilities[0].balance, 700);
  assert.equal(migrated.reviews.length, 1);
  assert.deepEqual(migrated.customTickers, ["AAPL"]);
  assert.equal(migrated.goals.length, 2);
  assert.equal(migrated.dca.monthly, 500);
  assert.equal(migrated.emergency.target, 6000);
});

test("financialRules: existing rule-card overrides, hidden ids and notes survive migration", () => {
  const input = v15State({
    ruleCardOverrides: { "dca-mandate": { title: "My DCA", body: "My own wording" } },
    hiddenRuleIds: ["data-safety"],
    ruleNoteTitle: "My Rules",
    ruleNotes: "Never skip a month.",
    ruleNotesList: [{ id: "n1", title: "Note", body: "Body text", createdAt: 123 }],
  });
  const migrated = migrateState(input);

  assert.deepEqual(migrated.ruleCardOverrides["dca-mandate"], { title: "My DCA", body: "My own wording" });
  assert.deepEqual(migrated.hiddenRuleIds, ["data-safety"]);
  assert.equal(migrated.ruleNoteTitle, "My Rules");
  assert.equal(migrated.ruleNotes, "Never skip a month.");
  assert.equal(migrated.ruleNotesList.length, 1);
  assert.equal(migrated.ruleNotesList[0].body, "Body text");
  // ...and the new structured rules exist alongside them, not instead of them.
  assert.ok(migrated.financialRules.length > 0);
});

test("financialRules: the DCA rule inherits the existing monthly amount", () => {
  const migrated = migrateState(v15State());
  const dca = getFinancialRule(migrated, "dca-monthly-amount");
  assert.ok(dca);
  assert.equal(dca!.amount, 500);
  assert.equal(dca!.enabled, true);
});

test("financialRules: the allocation rule inherits the existing DCA targets", () => {
  const migrated = migrateState(v15State());
  const allocation = getFinancialRule(migrated, "target-allocation");
  assert.ok(allocation);
  assert.deepEqual(allocation!.targets, { VOO: 0.6, QQQM: 0.4 });
  assert.equal(allocation!.enabled, true);
});

test("financialRules: emergency, spending, drift and reserve rules derive from existing config", () => {
  const migrated = migrateState(v15State());

  const emergency = getFinancialRule(migrated, "emergency-fund-minimum");
  assert.equal(emergency!.targetAmount, 6000, "from emergency.target");

  const spending = getFinancialRule(migrated, "monthly-spending-limit");
  assert.equal(spending!.limitAmount, 900, "transport 300 + food 450 + otherFixed 150");

  const drift = getFinancialRule(migrated, "allocation-drift-tolerance");
  assert.equal(drift!.maxDrift, DEFAULT_DRIFT_TOLERANCE);
  assert.equal(drift!.maxDrift, 0.08, "matches the threshold advisorMessages already uses");

  const reserve = getFinancialRule(migrated, "opportunity-reserve-deployment");
  assert.deepEqual(reserve!.tranches, [{ drawdown: 10, percent: 0.2 }, { drawdown: 20, percent: 0.5 }]);
});

test("financialRules: one goal-contribution rule per goal that actually contributes", () => {
  const migrated = migrateState(v15State());
  const goalRules = getFinancialRulesOfKind(migrated, "goal-contribution");
  assert.equal(goalRules.length, 1, "the zero-contribution goal must not produce a rule");
  assert.equal(goalRules[0].goalId, "travel");
  assert.equal(goalRules[0].monthlyAmount, 75);
  assert.equal(goalRules[0].id, goalContributionRuleId("travel"));
});

test("financialRules: migration does not overwrite user-configured rules with defaults", () => {
  const userRules: FinancialRule[] = [
    { id: "dca-monthly-amount", kind: "dca-monthly-amount", enabled: false, amount: 1234 },
  ];
  const migrated = migrateState(v15State({ version: 16, financialRules: userRules }));

  assert.equal(migrated.financialRules.length, 1, "defaults must not be re-seeded over a stored array");
  const dca = getFinancialRule(migrated, "dca-monthly-amount");
  assert.equal(dca!.amount, 1234, "the user's own value wins over dca.monthly = 500");
  assert.equal(dca!.enabled, false, "an intentionally disabled rule stays disabled");
});

test("financialRules: an explicitly empty rules array is respected, not re-seeded", () => {
  const migrated = migrateState(v15State({ version: 16, financialRules: [] }));
  assert.deepEqual(migrated.financialRules, []);
});

test("financialRules: migration is idempotent", () => {
  const once = migrateState(v15State());
  const twice = migrateState(once);
  const thrice = migrateState(twice);
  assert.deepEqual(twice.financialRules, once.financialRules);
  assert.deepEqual(thrice.financialRules, once.financialRules);
  assert.equal(twice.version, CURRENT_VERSION);
});

test("financialRules: malformed rule data is dropped without destroying the rest of the state", () => {
  const migrated = migrateState(v15State({
    version: 16,
    financialRules: [
      null,
      "not a rule",
      { id: "", kind: "dca-monthly-amount", enabled: true, amount: 10 },        // empty id
      { id: "no-kind", enabled: true },                                          // missing kind
      { id: "unknown", kind: "teleport-money", enabled: true },                  // unknown kind
      { id: "neg", kind: "dca-monthly-amount", enabled: true, amount: -50 },     // negative amount
      { id: "nan", kind: "emergency-fund-minimum", enabled: true, targetAmount: Number.NaN },
      { id: "big", kind: "allocation-drift-tolerance", enabled: true, maxDrift: 5 }, // >1
      { id: "ok", kind: "dca-monthly-amount", enabled: true, amount: 300 },      // the only valid one
    ] as unknown as FinancialRule[],
    trades: [{ id: "t1", date: "2026-01-02", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 100, amountUsd: 23, priceUsd: 500, feeMyr: 2 }],
  }));

  assert.equal(migrated.financialRules.length, 1);
  assert.equal(migrated.financialRules[0].id, "ok");
  assert.equal(migrated.trades.length, 1, "unrelated state must survive malformed rules");
  assert.equal(migrated.dca.monthly, 500);
});

test("financialRules: validateFinancialRule enforces bounds per rule kind", () => {
  assert.equal(validateFinancialRule({ id: "a", kind: "dca-monthly-amount", amount: 0 })?.amount, 0, "zero is a valid amount");
  assert.equal(validateFinancialRule({ id: "a", kind: "dca-monthly-amount", amount: -1 }), null);
  assert.equal(validateFinancialRule({ id: "a", kind: "dca-monthly-amount", amount: Infinity }), null);
  assert.equal(validateFinancialRule({ id: "a", kind: "allocation-drift-tolerance", maxDrift: 0 })?.maxDrift, 0);
  assert.equal(validateFinancialRule({ id: "a", kind: "allocation-drift-tolerance", maxDrift: 1 })?.maxDrift, 1);
  assert.equal(validateFinancialRule({ id: "a", kind: "allocation-drift-tolerance", maxDrift: 1.5 }), null);
  assert.equal(validateFinancialRule({ id: "a", kind: "goal-contribution", goalId: "", monthlyAmount: 10 }), null);
  // A rule persisted without `enabled` is treated as enabled.
  assert.equal(validateFinancialRule({ id: "a", kind: "dca-monthly-amount", amount: 5 })?.enabled, true);
});

test("financialRules: allocation targets are validated per ticker", () => {
  const valid = validateFinancialRule({
    id: "target-allocation",
    kind: "target-allocation",
    enabled: true,
    targets: { voo: 0.5, "QQQM": 0.5, "bad ticker!": 0.2, VXUS: 1.4, NEG: -0.1 },
  });
  assert.ok(valid && valid.kind === "target-allocation");
  // Lowercase is normalized; invalid ticker and out-of-range weights are dropped.
  assert.deepEqual(valid.targets, { VOO: 0.5, QQQM: 0.5 });

  assert.equal(validateFinancialRule({ id: "x", kind: "target-allocation", targets: {} }), null, "no usable ticker");
});

test("financialRules: deployment tranches are bounded and sorted by drawdown", () => {
  const rule = validateFinancialRule({
    id: "opportunity-reserve-deployment",
    kind: "opportunity-reserve-deployment",
    enabled: true,
    tranches: [
      { drawdown: 20, percent: 0.5 },
      { drawdown: 10, percent: 0.2 },
      { drawdown: 0, percent: 0.3 },     // non-positive drawdown
      { drawdown: 150, percent: 0.3 },   // beyond 100%
      { drawdown: 15, percent: 2 },      // percent > 1
    ],
  });
  assert.ok(rule && rule.kind === "opportunity-reserve-deployment");
  assert.deepEqual(rule.tranches, [{ drawdown: 10, percent: 0.2 }, { drawdown: 20, percent: 0.5 }]);
});

test("financialRules: normalizeFinancialRules de-duplicates by id, keeping the first", () => {
  const rules = normalizeFinancialRules([
    { id: "dca-monthly-amount", kind: "dca-monthly-amount", enabled: true, amount: 100 },
    { id: "dca-monthly-amount", kind: "dca-monthly-amount", enabled: true, amount: 999 },
  ]);
  assert.equal(rules.length, 1);
  assert.equal((rules[0] as { amount: number }).amount, 100);
});

test("financialRules: default and empty WealthState carry valid structured rules", () => {
  for (const [label, state] of [["default", cloneDefaultState()], ["empty", emptyState()]] as const) {
    assert.ok(Array.isArray(state.financialRules), `${label} state must have a rules array`);
    for (const rule of state.financialRules) {
      assert.deepEqual(validateFinancialRule(rule), rule, `${label} state has a rule that fails its own validation`);
    }
    // Every seeded rule must round-trip through persistence unchanged.
    assert.deepEqual(normalizeFinancialRules(state.financialRules), state.financialRules);
  }
});

test("financialRules: defaultState rules mirror defaultState's own planning config", () => {
  assert.equal(getFinancialRule(defaultState, "dca-monthly-amount")!.amount, defaultState.dca.monthly);
  assert.deepEqual(getFinancialRule(defaultState, "target-allocation")!.targets, defaultState.dca.targets);
  assert.equal(getFinancialRule(defaultState, "emergency-fund-minimum")!.targetAmount, defaultState.emergency.target);
});

test("financialRules: a brand-new empty state seeds placeholder rules that assert nothing", () => {
  const state = emptyState();
  assert.equal(getFinancialRule(state, "dca-monthly-amount")!.enabled, false);
  assert.equal(getFinancialRule(state, "emergency-fund-minimum")!.enabled, false);
  assert.equal(getFinancialRule(state, "monthly-spending-limit")!.enabled, false);
  assert.equal(getFinancialRule(state, "target-allocation")!.enabled, false, "all-zero targets are not a policy");
  assert.equal(getFinancialRulesOfKind(state, "goal-contribution").length, 0);
});

test("financialRules: export/import round-trip preserves structured rules", () => {
  const original = migrateState(v15State());
  // exportState serializes with JSON; importing runs the payload back through migrateState.
  const roundTripped = migrateState(JSON.parse(JSON.stringify({ ...original, version: CURRENT_VERSION })));

  assert.deepEqual(roundTripped.financialRules, original.financialRules);
  assert.deepEqual(roundTripped.ruleCardOverrides, original.ruleCardOverrides);
  assert.equal(roundTripped.dca.monthly, original.dca.monthly);
});

test("financialRules: rules survive Firebase-style JSON serialization", () => {
  const state = migrateState(v15State());
  // Firestore stores plain JSON: no undefined, no class instances, no cycles.
  const serialized = JSON.stringify(state.financialRules);
  assert.ok(!serialized.includes("undefined"));
  assert.deepEqual(JSON.parse(serialized), state.financialRules);
});

test("financialRules: getDefaultFinancialRules is pure and does not mutate the source state", () => {
  const state = migrateState(v15State());
  const before = JSON.stringify(state);
  const first = getDefaultFinancialRules(state);
  const second = getDefaultFinancialRules(state);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(state), before, "input state must not be mutated");
});

test("financialRules: getFinancialRules returns [] for a state without the field", () => {
  assert.deepEqual(getFinancialRules({} as WealthState), []);
  assert.equal(getFinancialRule({} as WealthState, "dca-monthly-amount"), undefined);
});
