import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { WealthState } from "../src/models";
import { CURRENT_VERSION, emptyState, migrateState } from "../src/state";
import { answerPayPrompt, buildCheckins, confirmWeeklyCheck } from "../src/checkins";

type Tx = WealthState["ledgerTransactions"][number];
const tx = (type: "income" | "expense", amount: number, date: string, extra: Partial<Tx> = {}): Tx =>
  ({ id: `${type}-${date}-${amount}`, type, amount, date, accountId: "account-bank", categoryId: type === "income" ? "income-salary" : "expense-food", note: "", ...extra }) as Tx;

/** An account past the newcomer card, paid on the 25th. */
function settled(extra: Partial<WealthState> = {}): WealthState {
  return {
    ...emptyState(),
    onboardingDone: true,
    recurringTransactions: [{ id: "salary", label: "Salary", amount: 4500, type: "income", dayOfMonth: 25, accountId: "account-bank", active: true }],
    ...extra,
  };
}
const day = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 10); };
const item = (state: WealthState, today: string, id: string) => buildCheckins(state, day(today)).items.find((i) => i.id === id);

// --- schema ------------------------------------------------------------------

test("checkins: v27 remembers the weekly look and the payday question; old data starts clean", () => {
  assert.ok(CURRENT_VERSION >= 27);
  assert.deepEqual(emptyState().checkins, { weeklyCheckedOn: "", payPromptAnswered: false });
  const legacy = { ...structuredClone(emptyState()), version: 26 } as Partial<WealthState> & Record<string, unknown>;
  delete legacy.checkins;
  assert.deepEqual(migrateState(legacy).checkins, { weeklyCheckedOn: "", payPromptAnswered: false });
  const messy = { ...emptyState(), checkins: { weeklyCheckedOn: "last week", payPromptAnswered: "yes" } } as unknown as WealthState;
  assert.deepEqual(migrateState(messy).checkins, { weeklyCheckedOn: "", payPromptAnswered: false });
});

// --- payday -------------------------------------------------------------------

test("checkins: payday opens two days before and stays open five days after", () => {
  const state = settled();
  assert.equal(item(state, "2026-10-22", "pay:salary")?.status, "later");
  assert.equal(item(state, "2026-10-22", "pay:salary")?.opensOn, "2026-10-23");
  assert.equal(item(state, "2026-10-23", "pay:salary")?.status, "due");
  assert.equal(item(state, "2026-10-30", "pay:salary")?.status, "due");
  assert.equal(item(state, "2026-10-31", "pay:salary")?.status, "later");
  assert.equal(item(state, "2026-10-31", "pay:salary")?.opensOn, "2026-11-23");
});

test("checkins: pay recorded near payday ticks it, even a few days early", () => {
  assert.equal(item(settled({ ledgerTransactions: [tx("income", 4500, "2026-10-24")] }), "2026-10-26", "pay:salary")?.status, "done");
  assert.equal(item(settled({ ledgerTransactions: [tx("income", 4500, "2026-10-21")] }), "2026-10-24", "pay:salary")?.status, "done", "paid early before a weekend");
  assert.equal(item(settled({ ledgerTransactions: [tx("income", 4500, "2026-09-25")] }), "2026-10-26", "pay:salary")?.status, "due", "last month's pay does not count");
  assert.equal(item(settled({ ledgerTransactions: [tx("income", 50, "2026-10-25", { fundingSource: "sponsored" })] }), "2026-10-26", "pay:salary")?.status, "due", "sponsored money is not pay");
});

test("checkins: a payday on the 31st falls on the last day of a short month, and a window can cross the year", () => {
  const state = settled({ recurringTransactions: [{ id: "salary", label: "Salary", amount: 4500, type: "income", dayOfMonth: 31, active: true }] });
  assert.equal(item(state, "2027-02-26", "pay:salary")?.status, "due", "Feb 28 minus two days");
  assert.equal(item(state, "2027-02-25", "pay:salary")?.opensOn, "2027-02-26");
  assert.equal(item(state, "2027-01-04", "pay:salary")?.status, "due", "Dec 31 plus four days");
});

test("checkins: variable income, a paused recurring item, or none at all means no payday check-in", () => {
  const variable = settled();
  variable.allocation = { ...variable.allocation, incomeType: "variable" };
  assert.equal(item(variable, "2026-10-25", "pay:salary"), undefined);
  assert.equal(item(settled({ recurringTransactions: [{ id: "salary", label: "Salary", amount: 4500, type: "income", dayOfMonth: 25, active: false }] }), "2026-10-25", "pay:salary"), undefined);
  assert.equal(buildCheckins(settled({ recurringTransactions: [] }), day("2026-10-25")).items.some((i) => i.kind === "pay"), false);
});

test("checkins: two monthly incomes give two payday check-ins", () => {
  const state = settled({ recurringTransactions: [
    { id: "salary", label: "Salary", amount: 4500, type: "income", dayOfMonth: 25, active: true },
    { id: "rent-in", label: "Rent received", amount: 800, type: "income", dayOfMonth: 1, active: true },
  ] });
  assert.deepEqual(buildCheckins(state, day("2026-10-25")).items.filter((i) => i.kind === "pay").map((i) => [i.id, i.status]), [["pay:salary", "due"], ["pay:rent-in", "later"]]);
});

test("checkins: entries saved as full UTC timestamps count on their local day", () => {
  // What the Ledger form saves: local midnight as an ISO timestamp.
  const localMidnight = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
  const paid = settled({ ledgerTransactions: [tx("income", 4500, localMidnight(2026, 10, 25))] });
  assert.equal(item(paid, "2026-10-26", "pay:salary")?.status, "done");
  const spent = settled({ ledgerTransactions: [tx("expense", 40, localMidnight(2026, 10, 5, 0, 30)), tx("expense", 99, localMidnight(2026, 10, 4, 23, 30))] });
  assert.match(item(spent, "2026-10-06", "weekly")?.detail ?? "", /^MYR 40 spent this week/, "00:30 on Monday is this week, 23:30 on Sunday is not");
  const prompt = buildCheckins(settled({ recurringTransactions: [], ledgerTransactions: [tx("income", 4500, localMidnight(2026, 9, 30))] }), day("2026-10-01")).payPrompt;
  assert.equal(prompt?.dayOfMonth, 30);
  assert.equal(prompt?.date, "2026-09-30");
});

// --- weekly -------------------------------------------------------------------

test("checkins: the weekly look is due from Monday until confirmed, then waits for next Monday", () => {
  const state = settled({ ledgerTransactions: [tx("expense", 86, "2026-10-05"), tx("expense", 34, "2026-10-07"), tx("expense", 200, "2026-10-02")] });
  const due = item(state, "2026-10-07", "weekly");
  assert.equal(due?.status, "due");
  assert.match(due?.detail ?? "", /^MYR 120 spent this week/, "Monday Oct 5 to Wednesday Oct 7 only");
  const confirmed = confirmWeeklyCheck(state, day("2026-10-07"));
  assert.equal(confirmed.checkins.weeklyCheckedOn, "2026-10-07");
  assert.equal(item(confirmed, "2026-10-09", "weekly")?.status, "later");
  assert.equal(item(confirmed, "2026-10-09", "weekly")?.opensOn, "2026-10-12");
  assert.equal(item(confirmed, "2026-10-12", "weekly")?.status, "due", "a new week");
});

test("checkins: the weekly line measures the month against the spending limit when there is one", () => {
  const state = settled({ ledgerTransactions: [tx("expense", 300, "2026-10-02"), tx("expense", 86, "2026-10-06")] });
  state.cashflow = { ...state.cashflow, otherFixed: 2800 };
  assert.equal(item(state, "2026-10-07", "weekly")?.detail, "MYR 86 spent this week. MYR 386 of your MYR 2,800 limit so far this month.");
});

// --- month-end ------------------------------------------------------------------

test("checkins: the month-end review opens for the last three days and the first three of the next month", () => {
  const state = settled();
  assert.equal(item(state, "2026-10-28", "month-end")?.status, "later");
  assert.equal(item(state, "2026-10-28", "month-end")?.opensOn, "2026-10-29");
  assert.equal(item(state, "2026-10-29", "month-end")?.month, "2026-10");
  assert.equal(item(state, "2026-11-03", "month-end")?.month, "2026-10", "early November still reviews October");
  assert.equal(item(state, "2026-11-04", "month-end")?.status, "later");
  assert.equal(item(state, "2027-02-26", "month-end")?.status, "due", "February's last three days");
});

test("checkins: a saved review for that month ticks the month-end check-in", () => {
  const state = settled({ reviews: [{ id: "r1", month: "2026-10", income: 4500, spending: 2400, dcaDone: true, disciplineScore: 90, notes: "" }] });
  assert.equal(item(state, "2026-10-30", "month-end")?.status, "done");
  assert.equal(item(state, "2026-11-02", "month-end")?.status, "done");
});

// --- the board ------------------------------------------------------------------

test("checkins: nothing shows while the newcomer card is still up", () => {
  const board = buildCheckins({ ...settled(), onboardingDone: false }, day("2026-10-26"));
  assert.equal(board.hidden, true);
  assert.equal(board.dueCount, 0);
});

test("checkins: the due count is what the sidebar says", () => {
  // Monday Oct 26: payday window and the weekly look are due; month-end is not open yet.
  assert.equal(buildCheckins(settled(), day("2026-10-26")).dueCount, 2);
  assert.equal(buildCheckins(confirmWeeklyCheck(settled(), day("2026-10-26")), day("2026-10-26")).dueCount, 1);
});

// --- the payday question ------------------------------------------------------------

test("checkins: after a first pay with no monthly income on file, ask once whether it is monthly", () => {
  const state = settled({ recurringTransactions: [], ledgerTransactions: [tx("income", 4500, "2026-09-25")] });
  const prompt = buildCheckins(state, day("2026-09-26")).payPrompt;
  assert.deepEqual(prompt, { amount: 4500, dayOfMonth: 25, date: "2026-09-25", label: "Salary", accountId: "account-bank" });
  const saved = answerPayPrompt(state, prompt!, true, "rec-1");
  assert.deepEqual(saved.recurringTransactions, [{ id: "rec-1", label: "Salary", amount: 4500, type: "income", dayOfMonth: 25, active: true, accountId: "account-bank" }]);
  assert.equal(buildCheckins(saved, day("2026-09-26")).payPrompt, null);
  assert.equal(item(saved, "2026-10-24", "pay:rec-1")?.status, "due", "and now there is a payday");
  const declined = answerPayPrompt(state, prompt!, false, "rec-1");
  assert.deepEqual(declined.recurringTransactions, []);
  assert.equal(buildCheckins(declined, day("2026-09-26")).payPrompt, null, "not asked again");
});

test("checkins: no payday question for variable income or before any pay is recorded", () => {
  const variable = settled({ recurringTransactions: [], ledgerTransactions: [tx("income", 4500, "2026-09-25")] });
  variable.allocation = { ...variable.allocation, incomeType: "variable" };
  assert.equal(buildCheckins(variable, day("2026-09-26")).payPrompt, null);
  assert.equal(buildCheckins(settled({ recurringTransactions: [] }), day("2026-09-26")).payPrompt, null);
});
