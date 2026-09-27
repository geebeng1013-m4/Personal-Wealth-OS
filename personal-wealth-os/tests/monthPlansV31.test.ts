import assert from "node:assert/strict";
import { test } from "./testHarness";
import { CURRENT_VERSION, cloneDefaultState, emptyState, migrateState } from "../src/state";
import type { WealthState } from "../src/models";

// M-1: expected income is stored per month, so planning next month can never
// rewrite the plan this month is measured against.

test("v31: the state version records the month plans", () => {
  assert.equal(CURRENT_VERSION, 31);
});

test("v31: a v30 document gains an empty set of month plans and loses nothing", () => {
  const v30 = { ...cloneDefaultState(), version: 30 } as Partial<WealthState> & Record<string, unknown>;
  delete v30.monthPlans;
  const migrated = migrateState(v30);

  assert.equal(migrated.version, CURRENT_VERSION);
  assert.deepEqual(migrated.monthPlans, {});
  // The fields a month plan sits beside come through untouched.
  assert.deepEqual(migrated.cashflow, v30.cashflow);
  assert.deepEqual(migrated.allocation, v30.allocation);
  assert.equal(migrated.ledgerTransactions.length, v30.ledgerTransactions?.length);
});

test("v31: new users and the sample state both start with no month plans", () => {
  assert.deepEqual(emptyState().monthPlans, {});
  assert.deepEqual(cloneDefaultState().monthPlans, {});
});

test("v31: stored month plans survive a reload, and a second migration", () => {
  const monthPlans = { "2026-09": { expectedIncome: 3200 }, "2026-10": { expectedIncome: 2500 } };
  const once = migrateState({ ...emptyState(), monthPlans });
  const twice = migrateState(JSON.parse(JSON.stringify(once)) as Partial<WealthState>);

  assert.deepEqual(once.monthPlans, monthPlans);
  assert.deepEqual(twice.monthPlans, monthPlans);
});

test("v31: a month of zero expected income is a real plan, not a missing one", () => {
  const migrated = migrateState({ ...emptyState(), monthPlans: { "2026-10": { expectedIncome: 0 } } });
  assert.deepEqual(migrated.monthPlans, { "2026-10": { expectedIncome: 0 } });
});

test("v31: a bad month is dropped on its own, keeping the months around it", () => {
  const monthPlans: Record<string, unknown> = {
    "2026-09": { expectedIncome: 3200 },
    "2026-13": { expectedIncome: 100 },          // no such month
    "2026-9": { expectedIncome: 100 },           // not YYYY-MM
    "Oct": { expectedIncome: 100 },
    "2026-10": { expectedIncome: -50 },          // negative
    "2026-11": { expectedIncome: Number.NaN },
    "2026-12": { expectedIncome: "2500" },       // a string, not an amount
    "2027-01": null,
    "2027-02": { expectedIncome: 1800, note: "extra field is not kept" },
  };
  const migrated = migrateState({ ...emptyState(), monthPlans } as unknown as Partial<WealthState>);

  assert.deepEqual(migrated.monthPlans, {
    "2026-09": { expectedIncome: 3200 },
    "2027-02": { expectedIncome: 1800 },
  });
});

test("v31: month plans that are not an object at all read as none", () => {
  for (const monthPlans of [null, "2026-10", 42, [{ expectedIncome: 1 }]]) {
    const migrated = migrateState({ ...emptyState(), monthPlans } as unknown as Partial<WealthState>);
    assert.deepEqual(migrated.monthPlans, {}, `input ${JSON.stringify(monthPlans)}`);
  }
});

test("v31: Infinity cannot pass as an expected income", () => {
  // JSON cannot carry Infinity, but an in-memory import can.
  const migrated = migrateState({ ...emptyState(), monthPlans: { "2026-10": { expectedIncome: Infinity } } });
  assert.deepEqual(migrated.monthPlans, {});
});
