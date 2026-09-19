/**
 * Check-ins on the Review page (PLAN.md P-6a): the rhythm after setup —
 * payday, a weekly spending look, the month-end review.
 *
 * Read model only: which check-ins are open today, which are done and when
 * the next one opens. Nothing here is ticked by hand except the weekly look
 * (the user saying "looks right" is the only evidence it happened); payday
 * is done when an income is recorded near it, the month-end review when a
 * review exists for that month.
 *
 * Shown only once the newcomer "Your next step" card is gone, so a new user
 * never has two to-do lists at once.
 */

import type { LedgerTransaction, RecurringTransaction, WealthState } from "./models";
import { buildNextSteps } from "./onboarding";
import { getFinancialRule } from "./financialRules";
import { ledgerMonthTotals } from "./ledgerSummary";

/** What the check-ins remember between visits. (v27) */
export interface CheckinState {
  /** ISO date the weekly look was last confirmed; "" = never. */
  weeklyCheckedOn: string;
  /** The "paid on this day every month?" question was answered, either way. */
  payPromptAnswered: boolean;
}

export const EMPTY_CHECKIN_STATE: CheckinState = { weeklyCheckedOn: "", payPromptAnswered: false };

export function normalizeCheckinState(value: unknown): CheckinState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_CHECKIN_STATE };
  const raw = value as Record<string, unknown>;
  return {
    weeklyCheckedOn: typeof raw.weeklyCheckedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.weeklyCheckedOn) ? raw.weeklyCheckedOn : "",
    payPromptAnswered: raw.payPromptAnswered === true,
  };
}

export type CheckinKind = "pay" | "weekly" | "month-end";
export type CheckinStatus = "due" | "done" | "later";

export interface Checkin {
  /** "pay:<recurring id>", "weekly" or "month-end". */
  id: string;
  kind: CheckinKind;
  status: CheckinStatus;
  title: string;
  /** One line under the title: the figures when due, when it opens when later. */
  detail: string;
  /** ISO date it opens next, for "later" items. */
  opensOn?: string;
  /** For pay: the recurring income it is about. */
  recurring?: RecurringTransaction;
  /** For month-end: the "YYYY-MM" to review. */
  month?: string;
}

/** Offered once, after a first pay is recorded without a monthly income on file. */
export interface PayPrompt {
  amount: number;
  dayOfMonth: number;
  date: string;
  label: string;
  accountId?: string;
}

export interface CheckinBoard {
  /** The newcomer card is still up: show nothing yet. */
  hidden: boolean;
  items: Checkin[];
  dueCount: number;
  payPrompt: PayPrompt | null;
}

/** Days before and after payday that the pay check-in is open. Employers often pay early before a weekend. */
export const PAY_OPENS_BEFORE = 2;
export const PAY_OPEN_AFTER = 5;
/** Pay recorded this close to payday counts for that payday. */
const PAY_MATCH_DAYS = 5;
/** The month-end review opens this many days before the month ends and stays open this many days into the next. */
const MONTH_END_DAYS = 3;

const DAY_MS = 86_400_000;

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Payday in a given month: the recurring day, pulled back to the month's last day in a short month. */
function paydayIn(year: number, monthIndex: number, dayOfMonth: number): Date {
  return new Date(year, monthIndex, Math.min(dayOfMonth, daysInMonth(year, monthIndex)));
}

function mondayOf(date: Date): Date {
  const weekday = (date.getDay() + 6) % 7; // Monday = 0
  return addDays(date, -weekday);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const rm = (value: number) => `MYR ${Math.round(value).toLocaleString("en-MY")}`;
const shortDate = (date: Date) => date.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

function personalIncomes(transactions: LedgerTransaction[]): LedgerTransaction[] {
  return transactions.filter((tx) => tx.type === "income" && tx.fundingSource !== "sponsored");
}

function payCheckin(state: WealthState, recurring: RecurringTransaction, today: Date): Checkin {
  const incomes = personalIncomes(state.ledgerTransactions);
  // The payday whose window holds today, else the next one to open.
  const candidates = [-1, 0, 1, 2].map((offset) => paydayIn(today.getFullYear(), today.getMonth() + offset, recurring.dayOfMonth));
  const open = candidates.find((payday) => {
    const fromPayday = daysBetween(payday, today);
    return fromPayday >= -PAY_OPENS_BEFORE && fromPayday <= PAY_OPEN_AFTER;
  });
  const base = { id: `pay:${recurring.id}`, kind: "pay" as const, recurring };
  const label = recurring.label || "pay";
  if (open) {
    const recorded = incomes.some((tx) => Math.abs(daysBetween(open, parseIso(tx.date))) <= PAY_MATCH_DAYS);
    return recorded
      ? { ...base, status: "done", title: `Payday · ${label} recorded`, detail: `Recorded for ${shortDate(open)}.` }
      : { ...base, status: "due", title: `Payday · record this month's ${label}`, detail: `${label} usually comes in on the ${ordinal(recurring.dayOfMonth)} (${rm(recurring.amount)}).` };
  }
  const next = candidates.map((payday) => addDays(payday, -PAY_OPENS_BEFORE)).find((opens) => daysBetween(today, opens) > 0) ?? today;
  return { ...base, status: "later", title: `Payday · ${label}`, detail: `Opens ${shortDate(next)}, two days before payday.`, opensOn: isoDate(next) };
}

function weeklyCheckin(state: WealthState, checkins: CheckinState, today: Date): Checkin {
  const weekStart = mondayOf(today);
  const base = { id: "weekly", kind: "weekly" as const };
  if (checkins.weeklyCheckedOn && checkins.weeklyCheckedOn >= isoDate(weekStart)) {
    const next = addDays(weekStart, 7);
    return { ...base, status: "later", title: "Weekly check · done this week", detail: `Next one on Monday, ${shortDate(next)}.`, opensOn: isoDate(next) };
  }
  const from = isoDate(weekStart), to = isoDate(today);
  const week = state.ledgerTransactions
    .filter((tx) => tx.type === "expense" && tx.fundingSource !== "sponsored" && tx.date >= from && tx.date <= to)
    .reduce((sum, tx) => sum + tx.amount, 0);
  const month = ledgerMonthTotals(state.ledgerTransactions, monthKey(today)).personalExpenses;
  const limit = plannedSpending(state);
  const detail = limit > 0
    ? `${rm(week)} spent this week. ${rm(month)} of your ${rm(limit)} limit so far this month.`
    : `${rm(week)} spent this week, ${rm(month)} so far this month.`;
  return { ...base, status: "due", title: "Weekly check · 30 seconds", detail };
}

/** The month's spending plan: the spending-limit rule when on, else the planned spending in Settings. */
function plannedSpending(state: WealthState): number {
  const rule = getFinancialRule(state, "monthly-spending-limit");
  if (rule?.enabled && rule.limitAmount > 0) return rule.limitAmount;
  return state.cashflow.transport + state.cashflow.food + state.cashflow.otherFixed;
}

function monthEndCheckin(state: WealthState, today: Date): Checkin {
  const year = today.getFullYear(), monthIndex = today.getMonth();
  const lastDay = daysInMonth(year, monthIndex);
  const base = { id: "month-end", kind: "month-end" as const };
  let target: Date | null = null;
  if (today.getDate() > lastDay - MONTH_END_DAYS) target = new Date(year, monthIndex, 1);
  else if (today.getDate() <= MONTH_END_DAYS) target = new Date(year, monthIndex - 1, 1);
  if (!target) {
    const opens = new Date(year, monthIndex, lastDay - MONTH_END_DAYS + 1);
    return { ...base, status: "later", title: "Month-end review", detail: `Opens ${shortDate(opens)}.`, opensOn: isoDate(opens) };
  }
  const month = monthKey(target);
  const name = target.toLocaleDateString("en-MY", { month: "long" });
  if (state.reviews.some((review) => review.month === month)) {
    return { ...base, month, status: "done", title: `Month-end review · ${name} done`, detail: "Reviewed. The next one opens near the end of next month." };
  }
  const spent = ledgerMonthTotals(state.ledgerTransactions, month).personalExpenses;
  const planned = plannedSpending(state);
  const detail = planned > 0
    ? `Planned ${rm(planned)}, spent ${rm(spent)}. See what to keep and what to change.`
    : `Spent ${rm(spent)}. See what to keep and what to change.`;
  return { ...base, month, status: "due", title: `Month-end review · how did ${name} go?`, detail };
}

function payPrompt(state: WealthState, checkins: CheckinState, hasMonthlyIncome: boolean): PayPrompt | null {
  if (hasMonthlyIncome || checkins.payPromptAnswered || state.allocation.incomeType === "variable") return null;
  const latest = [...personalIncomes(state.ledgerTransactions)].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) return null;
  const category = state.ledgerCategories.find((item) => item.id === latest.categoryId);
  return {
    amount: latest.amount,
    dayOfMonth: parseIso(latest.date).getDate(),
    date: latest.date,
    label: category?.label ?? "Salary",
    accountId: latest.accountId,
  };
}

export function buildCheckins(state: WealthState, today = new Date()): CheckinBoard {
  const checkins = state.checkins ?? EMPTY_CHECKIN_STATE;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (buildNextSteps(state).visible) return { hidden: true, items: [], dueCount: 0, payPrompt: null };

  const monthlyIncomes = state.recurringTransactions.filter((item) => item.active !== false && item.type === "income");
  // Variable income has no payday to remind about.
  const pays = state.allocation.incomeType === "variable" ? [] : monthlyIncomes.map((recurring) => payCheckin(state, recurring, day));
  const items = [...pays, weeklyCheckin(state, checkins, day), monthEndCheckin(state, day)];
  return {
    hidden: false,
    items,
    dueCount: items.filter((item) => item.status === "due").length,
    payPrompt: payPrompt(state, checkins, monthlyIncomes.length > 0),
  };
}

/** "Looks right" on the weekly check. */
export function confirmWeeklyCheck(state: WealthState, today = new Date()): WealthState {
  return { ...state, checkins: { ...(state.checkins ?? EMPTY_CHECKIN_STATE), weeklyCheckedOn: isoDate(today) } };
}

/** The answer to "paid around the Nth every month?": yes saves a monthly income; either way it is not asked again. */
export function answerPayPrompt(state: WealthState, prompt: PayPrompt, save: boolean, id: string): WealthState {
  const checkins = { ...(state.checkins ?? EMPTY_CHECKIN_STATE), payPromptAnswered: true };
  if (!save) return { ...state, checkins };
  const recurring: RecurringTransaction = {
    id,
    label: prompt.label,
    amount: prompt.amount,
    type: "income",
    dayOfMonth: prompt.dayOfMonth,
    active: true,
    ...(prompt.accountId ? { accountId: prompt.accountId } : {}),
  };
  return { ...state, checkins, recurringTransactions: [...state.recurringTransactions, recurring] };
}
