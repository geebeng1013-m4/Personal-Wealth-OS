import assert from "node:assert/strict";
import { test } from "./testHarness";
import { expectedIncomeFor, getBudgetSnapshot, layersVersusPlan, nextMonthKeyOf } from "../src/budgetSummary";
import { migrateState, parseExpectedIncomeInput, withExpectedIncome } from "../src/state";
import { allocateMonth } from "../src/allocation";
import { budgetContent, versusPlanSummary, type BudgetView } from "../src/components/allocationPanel";
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

const closed: BudgetView = { openLayer: null, openBucket: null, overflowOpen: false, planMonth: 0, aheadDraft: null };
const nextMonthView: BudgetView = { ...closed, planMonth: 1 };

/** The Budget page's content for a state, as the page renders it. */
function card(state: WealthState, view: BudgetView = closed, draftIncome: number | null = null): string {
  return budgetContent(getBudgetSnapshot(state, NOW), state.allocation, view, draftIncome === null ? null : allocateMonth(state.allocation, draftIncome));
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
  const html = card(stateWith(), nextMonthView, 1000);
  assert.match(html, /200<\/span> short/);
  assert.match(html, /Fixed layers need .*200.* more than the expected income\. You can still save it\./);
});

test("plan ahead: an income that covers the fixed layers raises no warning", () => {
  assert.doesNotMatch(card(stateWith(), nextMonthView, 3200), /short<|more than the expected income/);
});

test("plan ahead: a layer the user named is escaped before it reaches the page", () => {
  const named: AllocationPlan = { ...plan, steps: [{ id: "x", name: "<img src=x onerror=alert(1)>", kind: "fill", value: 100, note: "<b>trip</b>" }] };
  const html = card(stateWith({ allocation: named }), nextMonthView);
  assert.doesNotMatch(html, /<img|<b>trip/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;b&gt;trip/);
});

test("plan ahead: no layers says so instead of an empty list", () => {
  assert.match(card(stateWith({ allocation: { incomeType: "fixed", steps: [] } })), /No layers yet/);
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

// --- MP-5: one card, one list, one editor -------------------------------------

const editorsIn = (html: string): number => (html.match(/class="wu-stack wu-stack--sm layerForm/g) ?? []).length;
const layerButtons = (html: string): number => (html.match(/<button class="wu-budget-row layer-row"/g) ?? []).length;

test("one card: each layer appears once, in both months", () => {
  for (const view of [closed, nextMonthView]) {
    const html = card(receivedThisMonth(2600), view);
    assert.equal(layerButtons(html), 4);
    assert.doesNotMatch(html, /ahead-layer-row|wu-budget-ahead"/, "the separate Plan ahead card is gone");
    assert.equal((html.match(/id="budLayersLabel">Plan ahead</g) ?? []).length, 1);
  }
});

test("one card: an open layer shows the one editor, which says rules are for every month", () => {
  const html = card(stateWith(), { ...closed, openLayer: 1 });
  assert.equal(editorsIn(html), 1);
  assert.match(html, /layerForm wu-budget-editor" data-index="1"/);
  assert.match(html, /A layer's rule applies to every month\. Only the expected income is set month by month\./);
});

test("one card: the editor keeps the layer's note", () => {
  const noted: AllocationPlan = { ...plan, steps: plan.steps.map((step) => step.id === "freedom" ? { ...step, note: "Japan trip" } : step) };
  const html = card(stateWith({ allocation: noted }), { ...closed, openLayer: 2 });
  assert.match(html, /name="note" type="text" value="Japan trip"/);
});

test("one card: this month shows Plan beside Allocated, and how far each is off", () => {
  const html = card(receivedThisMonth(2600));
  assert.doesNotMatch(html, /wu-budget-layers--ahead/);
  assert.match(html, /<span>Progress<\/span><span>Plan<\/span><span>Allocated<\/span>/);
  // Growth: planned 1,000 from 3,200; got 700 from 2,600.
  assert.match(html, /data-live="plan-1">[^<]*<span[^>]*>1,000<\/span>/);
  assert.match(html, /data-live="got-1"><small>Allocated<\/small><span[^>]*>700<\/span>/);
  assert.match(html, /−300<\/span> vs plan/);
  assert.match(html, /Received .*2,600.* of the .*3,200.* you planned\./);
});

test("one card: next month shows the plan and each layer's note, with no progress yet", () => {
  const noted: AllocationPlan = { ...plan, steps: plan.steps.map((step) => step.id === "freedom" ? { ...step, note: "Japan trip" } : step) };
  const state = receivedThisMonth(2600, { allocation: noted, monthPlans: { "2026-10": { expectedIncome: 2500 } } });
  const html = card(state, nextMonthView);
  assert.match(html, /wu-budget-layers wu-budget-layers--ahead/);
  assert.match(html, /<span>What it is for<\/span>/);
  // The caption is the note alone: no progress against this month's income.
  assert.match(html, /<small>Japan trip<\/small>/);
  assert.doesNotMatch(html, /% of plan/);
  // 2,500 - 1,200 = 1,300: Growth 650.
  assert.match(html, /data-live="plan-1">[^<]*<span[^>]*>650<\/span>/);
  assert.doesNotMatch(html, /vs plan/, "next month is never compared with this month's money");
  assert.match(html, /A plan for October 2026\./);
});

test("one card: the figures an income changes are all marked for the live swap", () => {
  const html = card(receivedThisMonth(2600));
  for (let index = 0; index < 4; index += 1) {
    assert.match(html, new RegExp(`data-live="plan-${index}"`));
    assert.match(html, new RegExp(`data-live="got-${index}"`));
    assert.match(html, new RegExp(`data-live="progress-${index}"`));
    assert.match(html, new RegExp(`data-live="status-${index}"`));
  }
  assert.match(html, /data-live="plan-notes"/);
});

// Task 2: the comparison uses planned allocations, even for percentage layers
// whose rules have been satisfied by a smaller month. These render tests pin
// the financial meaning visible to the reader, not just the engine's totals.
function renderedLayer(html: string, index: number): string {
  const row = html.match(new RegExp(`<button class="wu-budget-row layer-row"[^>]*data-index="${index}"[\\s\\S]*?</button>`));
  assert.ok(row, `layer ${index} must exist`);
  return row[0];
}

test("budget progress: a percentage layer in a thin month is below Plan, not filled", () => {
  const row = renderedLayer(card(receivedThisMonth(2600)), 1);
  assert.match(row, /width:70%/);
  assert.match(row, /70% of plan/);
  assert.match(row, /Below plan/);
  assert.doesNotMatch(row, /Filled|100% of plan/);
  assert.match(card(receivedThisMonth(2600)), /Allocated is calculated from recorded income, not confirmed transfers or account balances/);
});

test("budget progress: no income shows zero against a nonzero Plan, including on a phone", () => {
  const row = renderedLayer(card(receivedThisMonth(0)), 1);
  assert.match(row, /width:0%/);
  assert.match(row, /0% of plan/);
  assert.match(row, /Below plan/);
  assert.match(row, /wu-budget-row__vs-plan">Plan .*1,000/);
  assert.match(row, /−1,000<\/span> vs plan/);
});

test("budget progress: exact Plan is on plan, extra allocations cap the bar and retain the difference", () => {
  const exact = renderedLayer(card(receivedThisMonth(3200)), 1);
  assert.match(exact, /width:100%/);
  assert.match(exact, /100% of plan/);
  assert.match(exact, /On plan/);
  const above = renderedLayer(card(receivedThisMonth(4200)), 1);
  assert.match(above, /width:100%/);
  assert.match(above, /150% of plan/);
  assert.match(above, /Above plan/);
  assert.match(above, /\+500<\/span> vs plan/);
});

test("budget progress: a zero plan has no invented percentage, with or without income", () => {
  for (const amount of [0, 2600]) {
    const row = renderedLayer(card(receivedThisMonth(amount, { monthPlans: { "2026-09": { expectedIncome: 0 } } })), 1);
    assert.match(row, /width:0%/);
    assert.match(row, /No planned amount/);
    assert.doesNotMatch(row, /(?:NaN|Infinity|\d+)% of plan/);
    if (amount > 0) {
      assert.match(row, /Above plan/);
      assert.match(row, /\+700<\/span> vs plan/);
    }
  }
});

test("budget progress: a plan that cannot cover a fixed rule still compares with its displayed Plan", () => {
  const row = renderedLayer(card(receivedThisMonth(400, { monthPlans: { "2026-09": { expectedIncome: 800 } } })), 0);
  // Fixed rule wants 1,200; Plan can allocate 800; received income allocates 400.
  assert.match(row, /width:50%/);
  assert.match(row, /50% of plan/);
  assert.match(row, /Below plan/);
  assert.match(row, /400<\/span> short/);
});

test("budget progress: overflow is compared with Plan, rather than automatically called extra", () => {
  const fixed: AllocationPlan = {
    incomeType: "fixed",
    steps: [{ id: "survival", name: "Living", kind: "fill", value: 1200 }, { id: "growth", name: "Saving", kind: "fill", value: 500 }],
    overflowStepId: "growth",
  };
  const row = renderedLayer(card(receivedThisMonth(2600, { allocation: fixed })), 1);
  // Both months overflow into saving: Plan 2,000, Allocated 1,400.
  assert.match(row, /width:70%/);
  assert.match(row, /Below plan/);
  assert.match(row, /−600<\/span> vs plan/);
  assert.doesNotMatch(row, / extra/);
});

test("budget progress: an expected-income draft updates the bar, status and Plan together", () => {
  const state = receivedThisMonth(2600);
  const row = renderedLayer(card(state, { ...closed, openLayer: 1, aheadDraft: { monthKey: "2026-09", text: "2600" } }, 2600), 1);
  assert.match(row, /data-live="progress-1"[\s\S]*width:100%/);
  assert.match(row, /100% of plan/);
  assert.match(row, /data-live="status-1"><span class="t-positive">On plan/);
  assert.doesNotMatch(row, /Below plan/);
  assert.match(card(state, nextMonthView), /What it is for/);
  assert.doesNotMatch(card(state, nextMonthView), /% of plan/);
});

test("budget progress: rendering never changes rules, transactions or persisted state", () => {
  const state = receivedThisMonth(2600);
  const before = JSON.stringify(state);
  card(state, closed, 4200);
  card(state, nextMonthView, 0);
  assert.equal(JSON.stringify(state), before);
});

test("one card: an unsaved figure is kept through a re-render, marked as not saved", () => {
  const html = card(stateWith(), { ...closed, aheadDraft: { monthKey: "2026-09", text: "2600" } }, 2600);
  assert.match(html, /id="planAheadIncome"[^>]*value="2600"/);
  assert.match(html, /Not saved yet\./);
  // A draft for another month does not leak into this one.
  const other = card(stateWith(), { ...closed, aheadDraft: { monthKey: "2026-10", text: "2600" } });
  assert.match(other, /id="planAheadIncome"[^>]*value="3200"/);
});

test("one card: an unsaved figure that is not an amount is shown as it was typed, and flagged", () => {
  const html = card(stateWith(), { ...closed, aheadDraft: { monthKey: "2026-09", text: "" } });
  assert.match(html, /value="" aria-describedby="planAheadHint" aria-invalid="true"/);
  assert.match(html, /Enter an amount of 0 or more\./);
});
