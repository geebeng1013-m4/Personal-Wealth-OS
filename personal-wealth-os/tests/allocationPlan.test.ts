import assert from "node:assert/strict";
import { test } from "./testHarness";
import { allocateMonth, getAllocationRow, validatePlan } from "../src/allocation";
import { allocationPlanFromBuckets, cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import { demoState } from "../src/demoData";
import type { Bucket, WealthState } from "../src/models";

/**
 * The plan is derived from the buckets a state already has, so switching the
 * Budget page onto the engine cannot move anyone's figures. That promise is
 * what these tests hold: same layers, same order, same amounts, and a month's
 * income routed to exactly the numbers the page has always printed.
 */

const monthly = (state: WealthState) => state.buckets.filter((bucket) => bucket.cadence === "monthly");
const plannedTotal = (state: WealthState) => monthly(state).reduce((sum, bucket) => sum + bucket.amount, 0);

test("allocation plan: v22 is the schema that carries it", () => {
  assert.equal(CURRENT_VERSION, 22);
});

test("allocation plan: the default state's plan mirrors its own buckets", () => {
  const state = cloneDefaultState();
  const steps = state.allocation.steps;
  assert.deepEqual(steps.map((step) => step.id), monthly(state).map((bucket) => bucket.id));
  assert.deepEqual(steps.map((step) => step.value), monthly(state).map((bucket) => bucket.amount));
  assert.ok(steps.every((step) => step.kind === "fill"), "existing data means fixed amounts");
  assert.equal(state.allocation.incomeType, "fixed");
});

test("allocation plan: the one-time Opportunity reserve stays out of the waterfall", () => {
  const state = cloneDefaultState();
  assert.ok(state.buckets.some((bucket) => bucket.id === "opportunity"), "the fixture still has it");
  assert.equal(state.allocation.steps.some((step) => step.id === "opportunity"), false);
});

test("allocation plan: routing a month reproduces today's bucket figures exactly", () => {
  // The migration promise, measured rather than asserted in prose.
  const state = cloneDefaultState();
  const result = allocateMonth(state.allocation, plannedTotal(state));
  for (const bucket of monthly(state)) {
    assert.equal(getAllocationRow(result, bucket.id)!.got, bucket.amount, bucket.name);
  }
  assert.equal(result.shortfall, 0);
  assert.equal(result.unassigned, 0);
});

test("allocation plan: the demo fixture routes to its own authored figures", () => {
  // Demo data carries different amounts from the seed, so it catches a plan
  // that was quietly derived from the wrong buckets.
  const result = allocateMonth(demoState.allocation, plannedTotal(demoState));
  for (const bucket of monthly(demoState)) {
    assert.equal(getAllocationRow(result, bucket.id)!.got, bucket.amount, bucket.name);
  }
});

test("allocation plan: data from before v22 is migrated, not left empty", () => {
  const buckets: Bucket[] = [
    { id: "living", name: "Living", label: "Living", amount: 1450, cadence: "monthly", note: "Rent and food" },
    { id: "growth", name: "Growth", label: "Growth", amount: 380, cadence: "monthly", note: "DCA" },
    { id: "opportunity", name: "Opportunity", label: "Opportunity", amount: 900, cadence: "one-time", note: "Reserve" },
  ];
  const migrated = migrateState({ version: 21, deviceId: "pre-v22", buckets });

  assert.equal(migrated.version, CURRENT_VERSION);
  assert.deepEqual(migrated.allocation.steps.map((step) => [step.id, step.kind, step.value]), [
    ["living", "fill", 1450],
    ["growth", "fill", 380],
  ]);
  // The surplus goes where the plan already puts long-term money.
  assert.equal(migrated.allocation.overflowStepId, "growth");
  assert.deepEqual(validatePlan(migrated.allocation), []);

  const result = allocateMonth(migrated.allocation, 1830);
  assert.equal(getAllocationRow(result, "living")!.got, 1450);
  assert.equal(getAllocationRow(result, "growth")!.got, 380);
});

test("allocation plan: with no Growth bucket the surplus falls to the last layer", () => {
  const plan = allocationPlanFromBuckets([
    { id: "living", name: "Living", label: "Living", amount: 1000, cadence: "monthly", note: "" },
    { id: "fun", name: "Fun", label: "Fun", amount: 200, cadence: "monthly", note: "" },
  ]);
  assert.equal(plan.overflowStepId, "fun");
  assert.equal(getAllocationRow(allocateMonth(plan, 1500), "fun")!.got, 500);
});

test("allocation plan: a state with no buckets gets an empty plan, not a guessed one", () => {
  const blank = emptyState();
  assert.deepEqual(blank.allocation.steps, []);
  assert.equal(blank.allocation.overflowStepId, undefined);
  assert.deepEqual(validatePlan(blank.allocation).map((warning) => warning.code), ["no-steps"]);
});

test("allocation plan: a stored plan is kept, never rebuilt from the buckets", () => {
  const stored = migrateState({
    version: CURRENT_VERSION,
    deviceId: "has-plan",
    buckets: [{ id: "living", name: "Living", label: "Living", amount: 1450, cadence: "monthly", note: "" }],
    allocation: {
      incomeType: "variable",
      ...({ baseIncome: 800 } as object), // an old document still carrying the field
      steps: [
        { id: "living", name: "Living", kind: "fill", value: 1500 },
        { id: "growth", name: "Growth", kind: "pct", value: 60 },
        { id: "freedom", name: "Freedom", kind: "pct", value: 40 },
      ],
      overflowStepId: "growth",
    },
  });
  assert.equal(stored.allocation.incomeType, "variable");
  // The fixed part of a month lives in cashflow.allowance; a plan never
  // carries a second copy of it, even when an old document still has one.
  assert.equal("baseIncome" in stored.allocation, false);
  assert.equal(stored.allocation.steps.length, 3);
  assert.equal(stored.allocation.steps[0].value, 1500, "the plan wins over the bucket amount");
});

test("allocation plan: malformed layers are dropped and a dead overflow is repaired", () => {
  const migrated = migrateState({
    version: CURRENT_VERSION,
    deviceId: "messy",
    buckets: [{ id: "living", name: "Living", label: "Living", amount: 900, cadence: "monthly", note: "" }],
    allocation: {
      incomeType: "variable",
      steps: [
        null,
        { id: "living", name: "Living", kind: "fill", value: 900 },
        { id: "bad-kind", name: "Nope", kind: "whatever", value: 10 },
        { id: "negative", name: "Nope", kind: "pct", value: -5 },
        { id: "growth", name: "Growth", kind: "pct", value: 100 },
      ],
      overflowStepId: "deleted-layer",
    } as never,
  });
  assert.deepEqual(migrated.allocation.steps.map((step) => step.id), ["living", "growth"]);
  assert.equal(migrated.allocation.overflowStepId, "growth", "falls back to the last layer");
  assert.deepEqual(validatePlan(migrated.allocation), []);
});

test("allocation plan: migrating twice changes nothing", () => {
  const once = migrateState({ version: 18, deviceId: "twice" });
  const twice = migrateState(JSON.parse(JSON.stringify(once)) as Partial<WealthState>);
  assert.deepEqual(twice.allocation, once.allocation);
});

test("allocation plan: the plan survives a round trip through storage", () => {
  const state = cloneDefaultState();
  const reloaded = migrateState(JSON.parse(JSON.stringify(state)) as Partial<WealthState>);
  assert.deepEqual(reloaded.allocation, state.allocation);
});

test("allocation plan: every earlier persisted state arrives with a usable plan", () => {
  for (const version of [3, 10, 15, 18, 21]) {
    const migrated = migrateState({ version, deviceId: `v${version}` });
    assert.ok(migrated.allocation.steps.length > 0, `v${version} has no layers`);
    assert.deepEqual(validatePlan(migrated.allocation), [], `v${version} migrated to an invalid plan`);
  }
});
