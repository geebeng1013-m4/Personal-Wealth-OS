import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  getFinancialRule,
  getFinancialRulesOfKind,
  isPlaceholderRule,
  repairPlaceholderRules,
  syncGoalContributionRules,
  syncPlanningRules,
} from "../src/financialRules";
import { advisorRecommendations } from "../src/advisor";
import { buildUserRulesContext } from "../src/components/assistant/assistantContext";
import { emptyState, migrateState } from "../src/state";
import type { FinancialRule, WealthState } from "../src/models";
import { money } from "../src/rules";

const NOW = new Date(2026, 8, 15, 12, 0, 0);

/** A brand-new user, exactly as main.ts creates one on first sign-in. */
function newUser(): WealthState {
  return emptyState();
}

/** What the Settings emergency form saves, including the rule sync it now does. */
function saveEmergency(state: WealthState, current: number, target: number): WealthState {
  const next = { ...state, emergency: { ...state.emergency, current, target } };
  next.financialRules = syncPlanningRules(next, ["emergency-fund-minimum"]);
  return next;
}

/** What the Settings cash-flow form saves. */
function saveCashflow(state: WealthState, food: number, transport: number, otherFixed: number, dcaMonthly: number): WealthState {
  const next = {
    ...state,
    cashflow: { ...state.cashflow, allowance: 3000, food, transport, otherFixed },
    dca: { ...state.dca, monthly: dcaMonthly },
  };
  next.financialRules = syncPlanningRules(next, ["monthly-spending-limit", "dca-monthly-amount"]);
  return next;
}

/** A reload: state is written as JSON and read back through migrateState. */
function reload(state: WealthState): WealthState {
  return migrateState(JSON.parse(JSON.stringify(state)));
}

// --- the bug, end to end ----------------------------------------------------

test("rules follow settings: a new user's emergency target reaches the rule, the Advisor and the assistant", () => {
  const state = reload(saveEmergency(newUser(), 1500, 4500));

  const rule = getFinancialRule(state, "emergency-fund-minimum");
  assert.equal(rule?.targetAmount, 4500, "the rule holds what Settings saved");
  assert.equal(rule?.enabled, true, "a placeholder turns on once it holds a value");

  const advice = advisorRecommendations(state).find((recommendation) => recommendation.id === "advisor:emergency-fund");
  assert.ok(advice?.rule.includes(money(4500)), `Advisor quoted: ${advice?.rule}`);
  assert.ok(!advice?.rule.includes(money(0)), "no longer 'Hold at least MYR 0'");

  assert.match(buildUserRulesContext(state, NOW), /Emergency fund target: MYR 4,500/);
});

test("rules follow settings: cash flow saves update the spending limit and DCA rules", () => {
  const state = saveCashflow(newUser(), 400, 200, 150, 600);
  assert.equal(getFinancialRule(state, "monthly-spending-limit")?.limitAmount, 750);
  assert.equal(getFinancialRule(state, "monthly-spending-limit")?.enabled, true);
  assert.equal(getFinancialRule(state, "dca-monthly-amount")?.amount, 600);
  assert.equal(getFinancialRule(state, "dca-monthly-amount")?.enabled, true);
});

test("rules follow settings: a later change to a live rule updates its value", () => {
  let state = saveEmergency(newUser(), 1500, 4500);
  state = saveEmergency(state, 1500, 6000);
  assert.equal(getFinancialRule(state, "emergency-fund-minimum")?.targetAmount, 6000);
  assert.equal(getFinancialRule(state, "emergency-fund-minimum")?.enabled, true);
});

test("rules follow settings: saving zero switches the rule off rather than asserting MYR 0", () => {
  let state = saveCashflow(newUser(), 400, 200, 150, 600);
  state = saveCashflow(state, 400, 200, 150, 0);
  const dca = getFinancialRule(state, "dca-monthly-amount");
  assert.equal(dca?.amount, 0);
  assert.equal(dca?.enabled, false);
});

test("rules follow settings: target allocation turns on when weights are saved", () => {
  const state = newUser();
  assert.ok(isPlaceholderRule(getFinancialRule(state, "target-allocation")!), "starts as a placeholder");
  const next = { ...state, dca: { ...state.dca, targets: { VOO: 0.7, QQQM: 0.3 } } };
  next.financialRules = syncPlanningRules(next, ["target-allocation"]);
  const rule = getFinancialRule(next, "target-allocation");
  assert.deepEqual(rule?.targets, { VOO: 0.7, QQQM: 0.3 });
  assert.equal(rule?.enabled, true);
});

// --- what a save must never override ------------------------------------------

test("rules follow settings: a rule the user switched off with a value stays off after a save", () => {
  const base = newUser();
  const state: WealthState = {
    ...base,
    financialRules: base.financialRules.map((rule): FinancialRule =>
      rule.kind === "dca-monthly-amount" ? { ...rule, enabled: false, amount: 250 } : rule),
  };
  const next = saveCashflow(state, 400, 200, 150, 600);
  const dca = getFinancialRule(next, "dca-monthly-amount");
  assert.equal(dca?.amount, 600, "the value follows the save");
  assert.equal(dca?.enabled, false, "the deliberate off switch is respected");
});

test("rules follow settings: rules a form does not own are returned untouched", () => {
  const base = newUser();
  const state: WealthState = {
    ...base,
    financialRules: base.financialRules.map((rule): FinancialRule =>
      rule.kind === "allocation-drift-tolerance" ? { ...rule, maxDrift: 0.05 } : rule),
  };
  const next = saveEmergency(state, 0, 4500);
  assert.equal(getFinancialRule(next, "allocation-drift-tolerance")?.maxDrift, 0.05);
});

test("rules follow settings: a missing rule is added by the save that configures it", () => {
  const state: WealthState = { ...newUser(), financialRules: [] };
  const next = saveEmergency(state, 0, 4500);
  assert.equal(getFinancialRule(next, "emergency-fund-minimum")?.targetAmount, 4500);
  assert.equal(next.financialRules.length, 1, "only the configured rule is added");
});

// --- goals ---------------------------------------------------------------------

test("goal rules: a contributing goal gains a rule, changes update it, stopping removes it", () => {
  let state = newUser();
  state = { ...state, goals: [{ id: "car", name: "Car", label: "Car", current: 0, target: 12000, monthlyContribution: 500, note: "" }] };
  state.financialRules = syncGoalContributionRules(state);
  assert.equal(getFinancialRulesOfKind(state, "goal-contribution")[0]?.monthlyAmount, 500);

  state = { ...state, goals: [{ ...state.goals[0], monthlyContribution: 800 }] };
  state.financialRules = syncGoalContributionRules(state);
  const rules = getFinancialRulesOfKind(state, "goal-contribution");
  assert.equal(rules.length, 1, "updated in place, not duplicated");
  assert.equal(rules[0].monthlyAmount, 800);

  state = { ...state, goals: [{ ...state.goals[0], monthlyContribution: 0 }] };
  state.financialRules = syncGoalContributionRules(state);
  assert.equal(getFinancialRulesOfKind(state, "goal-contribution").length, 0);
});

test("goal rules: deleting a goal removes its rule and leaves the rest", () => {
  let state = newUser();
  state = {
    ...state,
    goals: [
      { id: "car", name: "Car", label: "Car", current: 0, target: 12000, monthlyContribution: 500, note: "" },
      { id: "trip", name: "Trip", label: "Trip", current: 0, target: 2000, monthlyContribution: 100, note: "" },
    ],
  };
  state.financialRules = syncGoalContributionRules(state);
  const before = state.financialRules.filter((rule) => rule.kind !== "goal-contribution");

  state = { ...state, goals: state.goals.filter((goal) => goal.id !== "car") };
  state.financialRules = syncGoalContributionRules(state);
  const goalRules = getFinancialRulesOfKind(state, "goal-contribution");
  assert.deepEqual(goalRules.map((rule) => rule.goalId), ["trip"]);
  assert.deepEqual(state.financialRules.filter((rule) => rule.kind !== "goal-contribution"), before, "other rules untouched");
});

// --- the load-time mend for users already affected ------------------------------

test("repair: an affected user's placeholders are switched on when their settings hold values", () => {
  // The state as it was saved before the fix: settings filled in, rules still placeholders.
  const base = newUser();
  const affected: WealthState = {
    ...base,
    emergency: { ...base.emergency, current: 1500, target: 4500 },
    dca: { ...base.dca, monthly: 600 },
  };
  assert.ok(isPlaceholderRule(getFinancialRule(affected, "emergency-fund-minimum")!), "precondition: still a placeholder");

  const loaded = reload(affected);
  assert.equal(getFinancialRule(loaded, "emergency-fund-minimum")?.targetAmount, 4500);
  assert.equal(getFinancialRule(loaded, "emergency-fund-minimum")?.enabled, true);
  assert.equal(getFinancialRule(loaded, "dca-monthly-amount")?.amount, 600);
});

test("repair: a rule the user configured is never changed on load", () => {
  const base = newUser();
  const configured: WealthState = {
    ...base,
    emergency: { ...base.emergency, target: 4500 },
    financialRules: base.financialRules.map((rule): FinancialRule =>
      rule.kind === "emergency-fund-minimum" ? { ...rule, enabled: true, targetAmount: 9000 } : rule),
  };
  const loaded = reload(configured);
  assert.equal(getFinancialRule(loaded, "emergency-fund-minimum")?.targetAmount, 9000, "the rule, not the setting, is the policy");
});

test("repair: an empty rules array stays empty, and repair is idempotent", () => {
  const base = newUser();
  const empty: WealthState = { ...base, emergency: { ...base.emergency, target: 4500 }, financialRules: [] };
  assert.deepEqual(repairPlaceholderRules(empty), []);

  const affected: WealthState = { ...base, emergency: { ...base.emergency, target: 4500 } };
  const once = reload(affected);
  const twice = reload(once);
  assert.deepEqual(twice.financialRules, once.financialRules);
});

test("repair: nothing to mend returns the same rules", () => {
  const state = newUser();
  assert.equal(repairPlaceholderRules(state), state.financialRules, "no copy when nothing changed");
});
