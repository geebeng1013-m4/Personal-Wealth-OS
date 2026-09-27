import assert from "node:assert/strict";
import { test } from "./testHarness";
import { expectedIncomeFor, getBudgetSnapshot, layersVersusPlan, nextMonthKeyOf } from "../src/budgetSummary";
import { migrateState, parseExpectedIncomeInput, withExpectedIncome } from "../src/state";
import { allocateMonth } from "../src/allocation";
import { budgetContent, planAheadRows, versusPlanSummary, type BudgetView } from "../src/components/allocationPanel";
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

const closed: BudgetView = { openLayer: null, openBucket: null, overflowOpen: false, planMonth: 0, layerOpenIn: "table", aheadDraft: null };

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
  const html = planAheadRows(allocateMonth(plan, 1000), closed);
  assert.match(html, /200<\/span> short/);
  assert.match(html, /Fixed layers need .*200.* more than this income\. You can still save it\./);
});

test("plan ahead: an income that covers the fixed layers raises no warning", () => {
  assert.doesNotMatch(planAheadRows(allocateMonth(plan, 3200), closed), /short|more than this income/);
});

test("plan ahead: a layer the user named is escaped before it reaches the page", () => {
  const named: AllocationPlan = { ...plan, steps: [{ id: "x", name: "<img src=x onerror=alert(1)>", kind: "fill", value: 100 }] };
  const html = planAheadRows(allocateMonth(named, 500), closed);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("plan ahead: no layers says so instead of an empty list", () => {
  assert.match(planAheadRows(allocateMonth({ incomeType: "fixed", steps: [] }, 1000), closed), /No layers yet/);
});

// --- MP-3: this month's plan against what arrived ----------------------------

const bank = { id: "acc-bank", name: "Bank", type: "bank" as const, openingBalance: 0 };
function receivedThisMonth(amount: number, overrides: Partial<WealthState> = {}): WealthState {
  return stateWith({
    ledgerAccounts: [bank],
    ledgerTransactions: amount > 0
      ? [{ id: "pay", amount, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: new Date(2026, 8, 5, 12, 0, 0).toISOString() }]
      : [],
    ...overrides,
  });
}
const layer = (budget: ReturnType<typeof getBudgetSnapshot>, id: string) =>
  budget.allocation.versusPlan.find((entry) => entry.stepId === id);

test("plan vs actual: a thin month shows which layers got less, and by how much", () => {
  // Planned 3,200 (Me page); received 2,600. 2,600 - 1,200 = 1,400 left: 700 / 420 / 280.
  const budget = getBudgetSnapshot(receivedThisMonth(2600), NOW);
  assert.deepEqual(layer(budget, "survival"), { stepId: "survival", name: "Survival", planned: 1200, actual: 1200, difference: 0 });
  assert.deepEqual(layer(budget, "growth"), { stepId: "growth", name: "Growth", planned: 1000, actual: 700, difference: -300 });
  assert.equal(layer(budget, "freedom")?.difference, -180);
  assert.equal(layer(budget, "learning")?.difference, -120);
});

test("plan vs actual: this month's own written figure is what it is measured against", () => {
  const budget = getBudgetSnapshot(receivedThisMonth(2600, { monthPlans: { "2026-09": { expectedIncome: 2600 } } }), NOW);
  assert.ok(budget.allocation.versusPlan.every((entry) => entry.difference === 0));
});

test("plan vs actual: next month's plan never enters this month's comparison", () => {
  const plain = getBudgetSnapshot(receivedThisMonth(2600), NOW).allocation.versusPlan;
  const withNext = getBudgetSnapshot(receivedThisMonth(2600, { monthPlans: { "2026-10": { expectedIncome: 9999 } } }), NOW).allocation.versusPlan;
  assert.deepEqual(withNext, plain);
});

test("plan vs actual: a layer missing from one side is dropped, never compared with another", () => {
  const planned = allocateMonth(plan, 3200);
  const actual = allocateMonth({ ...plan, steps: plan.steps.filter((step) => step.id !== "freedom") }, 3200);
  assert.deepEqual(layersVersusPlan(planned, actual).map((entry) => entry.stepId), ["survival", "growth", "learning"]);
});

test("plan vs actual: the sentence names the layers below plan, with signs in text", () => {
  const budget = getBudgetSnapshot(receivedThisMonth(2600), NOW);
  const text = versusPlanSummary(budget.allocation.actual.income, budget.allocation.planned.income, budget.allocation.versusPlan)
    .replace(/<[^>]+>/g, "");
  assert.equal(text, "Received 2,600 of the 3,200 you planned. Below plan: Growth −300, Freedom −180, Learning −120.");
});

test("plan vs actual: more than planned, and exactly as planned, each say so", () => {
  const strip = (html: string) => html.replace(/<[^>]+>/g, "");
  assert.equal(strip(versusPlanSummary(3500, 3200, [])), "Received 300 more than the 3,200 you planned.");
  assert.equal(strip(versusPlanSummary(3200, 3200, [])), "Received the 3,200 you planned.");
});

// --- MP-4: edit a layer's rule from Plan ahead --------------------------------

const openAt = (index: number, place: BudgetView["layerOpenIn"]): BudgetView => ({ ...closed, openLayer: index, layerOpenIn: place });
const editorsIn = (html: string): number => (html.match(/class="wu-stack wu-stack--sm layerForm/g) ?? []).length;

test("plan ahead: each layer is a button that opens its rule", () => {
  const html = planAheadRows(allocateMonth(plan, 3200), closed);
  assert.equal((html.match(/<button class="wu-budget-row wu-budget-row--ahead ahead-layer-row" type="button"/g) ?? []).length, 4);
  assert.match(html, /data-index="2" aria-expanded="false"/);
  assert.equal(editorsIn(html), 0);
});

test("plan ahead: an open layer shows the shared editor, and says it changes every month", () => {
  const html = planAheadRows(allocateMonth(plan, 3200), openAt(1, "ahead"));
  assert.equal(editorsIn(html), 1);
  assert.match(html, /layerForm wu-budget-editor" data-index="1"/);
  assert.match(html, /Changes this layer for every month/);
  assert.match(html, /data-index="1" aria-expanded="true"/);
});

test("plan ahead: one layer opens in one place, never in both", () => {
  const budget = getBudgetSnapshot(stateWith(), NOW);
  const inAhead = budgetContent(budget, plan, openAt(1, "ahead"));
  const inTable = budgetContent(budget, plan, openAt(1, "table"));
  assert.equal(editorsIn(inAhead), 1);
  assert.equal(editorsIn(inTable), 1);
  // The table's editor never carries Plan ahead's every-month note.
  assert.match(inAhead, /Changes this layer for every month/);
  assert.doesNotMatch(inTable, /Changes this layer for every month/);
});

test("plan ahead: an unsaved figure is kept through a re-render, marked as not saved", () => {
  const budget = getBudgetSnapshot(stateWith(), NOW);
  const draft: BudgetView = { ...closed, aheadDraft: { monthKey: "2026-09", text: "2600" } };
  const html = budgetContent(budget, plan, draft, allocateMonth(plan, 2600));
  assert.match(html, /id="planAheadIncome"[^>]*value="2600"/);
  assert.match(html, /Not saved yet./);
  // A draft for another month does not leak into this one.
  const other = budgetContent(budget, plan, { ...closed, aheadDraft: { monthKey: "2026-10", text: "2600" } });
  assert.match(other, /id="planAheadIncome"[^>]*value="3200"/);
});

test("plan ahead: an unsaved figure that is not an amount is shown as it was typed, and flagged", () => {
  const budget = getBudgetSnapshot(stateWith(), NOW);
  const html = budgetContent(budget, plan, { ...closed, aheadDraft: { monthKey: "2026-09", text: "" } }, null);
  assert.match(html, /value="" aria-describedby="planAheadHint" aria-invalid="true"/);
  assert.match(html, /Enter an amount of 0 or more./);
});
