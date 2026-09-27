import assert from "node:assert/strict";
import { test } from "./testHarness";
import { expectedIncomeFor, getBudgetSnapshot, nextMonthKeyOf } from "../src/budgetSummary";
import { migrateState, parseExpectedIncomeInput, withExpectedIncome } from "../src/state";
import { allocateMonth } from "../src/allocation";
import { planAheadRows } from "../src/components/allocationPanel";
import type { AllocationPlan, WealthState } from "../src/models";

// MP-2: plan this month or next before the money arrives.

// escapeHtml goes through the DOM. Node has none, so the card is rendered
// against the one thing it uses: a span whose innerHTML serialises its text
// the way a browser does (&, < and > escaped).
if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        let text = "";
        return {
          set textContent(value: string) { text = value; },
          get innerHTML() { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
        };
      },
    },
  });
}

const NOW = new Date(2026, 8, 15, 12, 0, 0); // 2026-09-15 local

/** Survival fixed 1,200, then Growth 50% / Freedom 30% / Learning 20% of the rest. */
const plan: AllocationPlan = {
  incomeType: "variable",
  steps: [
    { id: "survival", name: "Survival", kind: "fill", value: 1200 },
    { id: "growth", name: "Growth", kind: "pct", value: 50 },
    { id: "freedom", name: "Freedom", kind: "pct", value: 30 },
    { id: "learning", name: "Learning", kind: "pct", value: 20 },
  ],
  overflowStepId: "growth",
};

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({
    deviceId: "device-ahead",
    cashflow: { allowance: 3000, transport: 0, food: 0, otherFixed: 0, irregularIncome: 200 },
    allocation: plan,
    ...overrides,
  });
}

const got = (result: ReturnType<typeof allocateMonth>, id: string): number =>
  result.rows.find((row) => row.stepId === id)?.got ?? Number.NaN;

// --- where the expected income comes from ----------------------------------

test("plan ahead: a month with nothing written starts from the Me page", () => {
  assert.deepEqual(expectedIncomeFor(stateWith(), "2026-10"), { income: 3200, source: "me-page" });
});

test("plan ahead: a written month uses its own figure, and zero counts as written", () => {
  const state = stateWith({ monthPlans: { "2026-10": { expectedIncome: 2500 }, "2026-11": { expectedIncome: 0 } } });
  assert.deepEqual(expectedIncomeFor(state, "2026-10"), { income: 2500, source: "month-plan" });
  assert.deepEqual(expectedIncomeFor(state, "2026-11"), { income: 0, source: "month-plan" });
  assert.deepEqual(expectedIncomeFor(state, "2026-12"), { income: 3200, source: "me-page" });
});

test("plan ahead: next month rolls over the year", () => {
  assert.equal(nextMonthKeyOf(new Date(2026, 11, 31, 23, 0, 0)), "2027-01");
  assert.equal(nextMonthKeyOf(new Date(2026, 0, 31, 12, 0, 0)), "2026-02");
});

// --- the snapshot ------------------------------------------------------------

test("plan ahead: the snapshot carries this month and next, each routed through the plan", () => {
  const state = stateWith({ monthPlans: { "2026-10": { expectedIncome: 2500 } } });
  const [thisMonth, nextMonth] = getBudgetSnapshot(state, NOW).allocation.ahead;

  assert.equal(thisMonth.monthKey, "2026-09");
  assert.equal(thisMonth.source, "me-page");
  assert.equal(thisMonth.expectedIncome, 3200);
  // 3,200 - 1,200 = 2,000 left: 1,000 / 600 / 400.
  assert.equal(got(thisMonth.result, "survival"), 1200);
  assert.equal(got(thisMonth.result, "growth"), 1000);
  assert.equal(got(thisMonth.result, "freedom"), 600);
  assert.equal(got(thisMonth.result, "learning"), 400);

  assert.equal(nextMonth.monthKey, "2026-10");
  assert.equal(nextMonth.source, "month-plan");
  // 2,500 - 1,200 = 1,300 left: 650 / 390 / 260.
  assert.equal(got(nextMonth.result, "growth"), 650);
  assert.equal(got(nextMonth.result, "freedom"), 390);
  assert.equal(got(nextMonth.result, "learning"), 260);
});

test("plan ahead: planning next month never changes this month's plan", () => {
  const before = getBudgetSnapshot(stateWith(), NOW).allocation;
  const after = getBudgetSnapshot(withExpectedIncome(stateWith(), "2026-10", 1500), NOW).allocation;
  assert.deepEqual(after.planned, before.planned);
  assert.deepEqual(after.ahead[0], before.ahead[0]);
  assert.notDeepEqual(after.ahead[1], before.ahead[1]);
});

test("plan ahead: this month's written figure is the plan the page measures against", () => {
  const budget = getBudgetSnapshot(stateWith({ monthPlans: { "2026-09": { expectedIncome: 2800 } } }), NOW);
  assert.equal(budget.allocation.planned.income, 2800);
  assert.deepEqual(budget.allocation.planned, budget.allocation.ahead[0].result);
  // The Me page's usual month is still reported as it was.
  assert.equal(budget.plannedIncome, 3200);
});

test("plan ahead: with no month written, this month's plan is exactly what it was before", () => {
  const budget = getBudgetSnapshot(stateWith(), NOW);
  assert.deepEqual(budget.allocation.planned, allocateMonth(plan, budget.plannedIncome));
});

// --- writing a month ---------------------------------------------------------

test("plan ahead: saving one month leaves the state it came from and every other month alone", () => {
  const state = stateWith({ monthPlans: { "2026-09": { expectedIncome: 2800 } } });
  const next = withExpectedIncome(state, "2026-10", 2500);

  assert.deepEqual(next.monthPlans, { "2026-09": { expectedIncome: 2800 }, "2026-10": { expectedIncome: 2500 } });
  assert.deepEqual(state.monthPlans, { "2026-09": { expectedIncome: 2800 } }, "the old state is not mutated");
  assert.deepEqual(withExpectedIncome(next, "2026-10", 2600).monthPlans["2026-10"], { expectedIncome: 2600 });
});

test("plan ahead: a bad month key or amount writes nothing", () => {
  const state = stateWith();
  for (const [monthKey, amount] of [["2026-13", 100], ["Oct", 100], ["2026-10", -1], ["2026-10", Number.NaN], ["2026-10", Infinity]] as const) {
    assert.equal(withExpectedIncome(state, monthKey, amount), state, `${monthKey} ${amount}`);
  }
});

test("plan ahead: the field accepts 0 or more, and an empty field is not zero", () => {
  assert.equal(parseExpectedIncomeInput("2500"), 2500);
  assert.equal(parseExpectedIncomeInput(" 2500.50 "), 2500.5);
  assert.equal(parseExpectedIncomeInput("0"), 0);
  for (const raw of ["", "   ", "-5", "abc", "Infinity", "1e999"]) {
    assert.equal(parseExpectedIncomeInput(raw), null, JSON.stringify(raw));
  }
});

// --- what the card says ------------------------------------------------------

test("plan ahead: fixed layers that need more than the income are named, in words", () => {
  const html = planAheadRows(allocateMonth(plan, 1000));
  assert.match(html, /200<\/span> short/);
  assert.match(html, /Fixed layers need .*200.* more than this income\. You can still save it\./);
});

test("plan ahead: an income that covers the fixed layers raises no warning", () => {
  assert.doesNotMatch(planAheadRows(allocateMonth(plan, 3200)), /short|more than this income/);
});

test("plan ahead: a layer the user named is escaped before it reaches the page", () => {
  const named: AllocationPlan = { ...plan, steps: [{ id: "x", name: "<img src=x onerror=alert(1)>", kind: "fill", value: 100 }] };
  const html = planAheadRows(allocateMonth(named, 500));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("plan ahead: no layers says so instead of an empty list", () => {
  assert.match(planAheadRows(allocateMonth({ incomeType: "fixed", steps: [] }, 1000)), /No layers yet/);
});
