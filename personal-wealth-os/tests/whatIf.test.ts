import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getSpendingImpact } from "../src/whatIf";
import { monthsToEmergencyTarget } from "../src/rules";
import { migrateState, cloneDefaultState } from "../src/state";
import type { Goal, WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-whatif", ...overrides });
}

function goal(overrides: Partial<Goal> & Pick<Goal, "id">): Goal {
  return {
    name: overrides.id, label: overrides.id, current: 0, target: 0,
    monthlyContribution: 0, note: "", ...overrides,
  };
}

// --- A. emergency fund impact, "once" ------------------------------------

test("whatIf/A: a zero or invalid amount has no impact", () => {
  const state = stateWith({ emergency: { current: 1000, target: 5000, annualYield: 0, monthlyTopUp: 200 } });
  for (const bad of [0, -100, NaN, Infinity]) {
    const impact = getSpendingImpact(state, bad, "once", NOW);
    assert.equal(impact.amount, 0);
    assert.equal(impact.emergency.monthsToTargetAfter, impact.emergency.monthsToTargetNow);
    assert.equal(impact.emergency.newMonthlyRate, null);
  }
});

test("whatIf/A: 'once' delay is the amount divided by the monthly top-up, rounded up", () => {
  const state = stateWith({ emergency: { current: 1000, target: 5000, annualYield: 0, monthlyTopUp: 200 } });
  const impact = getSpendingImpact(state, 350, "once", NOW);
  assert.equal(impact.amount, 350);
  assert.equal(impact.emergency.monthsToTargetNow, monthsToEmergencyTarget(state));
  assert.equal(impact.emergency.monthsToTargetAfter, impact.emergency.monthsToTargetNow + 2); // ceil(350/200)
  assert.equal(impact.emergency.newMonthlyRate, null, "'once' never reports a new permanent rate");
});

test("whatIf/A: 'once' with no monthly top-up reports the delay as unknown (Infinity)", () => {
  const state = stateWith({ emergency: { current: 1000, target: 5000, annualYield: 0, monthlyTopUp: 0 } });
  const impact = getSpendingImpact(state, 300, "once", NOW);
  assert.equal(impact.emergency.monthsToTargetAfter, Infinity);
});

// --- A2. emergency fund impact, "monthly" ---------------------------------

test("whatIf/A2: 'monthly' permanently lowers the top-up pace and recomputes via the canonical formula", () => {
  const state = stateWith({ emergency: { current: 1000, target: 5000, annualYield: 0, monthlyTopUp: 200 } });
  const impact = getSpendingImpact(state, 150, "monthly", NOW);
  assert.equal(impact.emergency.newMonthlyRate, 50); // 200 - 150
  const expected = monthsToEmergencyTarget({
    ...state,
    emergency: { ...state.emergency, monthlyTopUp: 50 },
  });
  assert.equal(impact.emergency.monthsToTargetAfter, expected);
});

test("whatIf/A2: 'monthly' cost that exceeds the top-up floors the new rate at zero, not negative", () => {
  const state = stateWith({ emergency: { current: 1000, target: 5000, annualYield: 0, monthlyTopUp: 100 } });
  const impact = getSpendingImpact(state, 400, "monthly", NOW);
  assert.equal(impact.emergency.newMonthlyRate, 0);
  assert.equal(impact.emergency.monthsToTargetAfter, Infinity, "a zeroed pace never reaches an unmet target");
});

// --- B. goal impact --------------------------------------------------------

test("whatIf/B: no goals means no goal impact, but emergency impact still computes", () => {
  const state = stateWith({ goals: [], emergency: { current: 0, target: 1000, annualYield: 0, monthlyTopUp: 100 } });
  const impact = getSpendingImpact(state, 300, "once", NOW);
  assert.equal(impact.goal, null);
  assert.equal(impact.emergency.monthsToTargetNow, 10); // ceil(1000/100)
  assert.equal(impact.emergency.monthsToTargetAfter, 13); // +ceil(300/100)
});

test("whatIf/B: a stalled goal (no contribution) is skipped, not reported with a fake delay", () => {
  const state = stateWith({
    goals: [goal({ id: "car", name: "Car", target: 10000, current: 1000, monthlyContribution: 0 })],
  });
  const impact = getSpendingImpact(state, 500, "once", NOW);
  assert.equal(impact.goal, null);
});

test("whatIf/B: an already-complete goal is skipped", () => {
  const state = stateWith({
    goals: [goal({ id: "phone", name: "Phone", target: 1000, current: 1000, monthlyContribution: 100 })],
  });
  const impact = getSpendingImpact(state, 500, "once", NOW);
  assert.equal(impact.goal, null);
});

test("whatIf/B: 'once' on an actively-funded goal reports its own delay from its own contribution rate", () => {
  const state = stateWith({
    goals: [goal({ id: "travel", name: "Travel", target: 2000, current: 500, monthlyContribution: 150 })],
  });
  const impact = getSpendingImpact(state, 450, "once", NOW);
  assert.ok(impact.goal);
  assert.equal(impact.goal!.id, "travel");
  assert.equal(impact.goal!.monthsToTargetNow, Math.ceil(1500 / 150)); // remaining 2000-500
  assert.equal(impact.goal!.monthsToTargetAfter, impact.goal!.monthsToTargetNow + 3); // ceil(450/150)
  assert.equal(impact.goal!.newMonthlyRate, null);
});

test("whatIf/B: the first actively-funded goal in order is used when there are several", () => {
  const state = stateWith({
    goals: [
      goal({ id: "done", name: "Done", target: 1000, current: 1000, monthlyContribution: 50 }), // complete, skipped
      goal({ id: "first", name: "First", target: 2000, current: 0, monthlyContribution: 100 }),
      goal({ id: "second", name: "Second", target: 2000, current: 0, monthlyContribution: 100 }),
    ],
  });
  const impact = getSpendingImpact(state, 100, "once", NOW);
  assert.equal(impact.goal!.id, "first");
});

// --- B2. goal impact, "monthly" --------------------------------------------

test("whatIf/B2: 'monthly' permanently lowers the goal's contribution and recomputes via buildGoalSnapshot", () => {
  const state = stateWith({
    goals: [goal({ id: "travel", name: "Travel", target: 2000, current: 500, monthlyContribution: 150 })],
  });
  const impact = getSpendingImpact(state, 50, "monthly", NOW);
  assert.equal(impact.goal!.newMonthlyRate, 100); // 150 - 50
  assert.equal(impact.goal!.monthsToTargetAfter, Math.ceil(1500 / 100));
});

test("whatIf/B2: a 'monthly' cost that consumes the entire contribution reports the goal as never reached", () => {
  const state = stateWith({
    goals: [goal({ id: "travel", name: "Travel", target: 2000, current: 500, monthlyContribution: 150 })],
  });
  const impact = getSpendingImpact(state, 150, "monthly", NOW);
  assert.equal(impact.goal!.newMonthlyRate, 0);
  assert.equal(impact.goal!.monthsToTargetAfter, Infinity);
});

// --- C. purity -------------------------------------------------------------

test("whatIf/C: is pure and never mutates or persists state", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  const a = getSpendingImpact(state, 777, "monthly", NOW);
  const b = getSpendingImpact(state, 777, "monthly", NOW);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(state), before, "state must be untouched");
});

test("whatIf/C: defaults to 'once' mode when omitted", () => {
  const state = stateWith({ emergency: { current: 1000, target: 5000, annualYield: 0, monthlyTopUp: 200 } });
  const withDefault = getSpendingImpact(state, 350);
  assert.equal(withDefault.mode, "once");
  assert.equal(withDefault.emergency.monthsToTargetAfter, withDefault.emergency.monthsToTargetNow + 2); // ceil(350/200)
});
