/**
 * Which debts come before the safety buffer and investing (PLAN.md L-1), and
 * the loan arithmetic behind them (L-2).
 *
 * Paying off RM1 of an 18% card is a sure 18% return; savings earn about 3%
 * and shares a hoped-for 6–8%. So a debt's rate decides where it goes:
 *
 *   high   ≥ 8% a year   a month's spending aside, then every spare ringgit to
 *                        it, highest rate first; no full buffer, no investing
 *   medium 4–8%          paid on schedule; buffer as usual, then spare money
 *                        split between investing and paying early
 *   low    < 4%          paid on schedule; never the debt stage (PTPTN, housing)
 *
 * Rates are the effective yearly rate as a fraction (0.18 = 18%), the unit
 * `Liability.annualRate` holds. A rate of 0 is read as "not given": the forms
 * save a blank rate as 0. Such a debt comes first only when the user said
 * paying off debt comes first — what the app did before rates counted. A card
 * paid in full every month charges no interest and never comes first.
 *
 * Guidance only, not financial advice. Pure: no DOM, no storage.
 */

import type { DebtKind, Liability } from "./models";

export const HIGH_RATE = 0.08;
export const MEDIUM_RATE = 0.04;
/** The starter emergency money when monthly spending is not known. */
export const STARTER_BUFFER_FALLBACK = 1000;
/** The term a flat rate is converted over when none is given. */
export const DEFAULT_FLAT_TERM_MONTHS = 60;

export type DebtTier = "high" | "medium" | "low" | "unknown";

export function debtTier(annualRate: number): DebtTier {
  if (!Number.isFinite(annualRate) || annualRate <= 0) return "unknown";
  if (annualRate >= HIGH_RATE) return "high";
  if (annualRate >= MEDIUM_RATE) return "medium";
  return "low";
}

/**
 * Does a debt at this rate come before the buffer? An unknown rate does only
 * when the user put debt first.
 */
export function debtComesFirst(annualRate: number, saidDebtFirst: boolean): boolean {
  const tier = debtTier(annualRate);
  return tier === "high" || (tier === "unknown" && saidDebtFirst);
}

/**
 * The debts to clear before the buffer, in the order to clear them: highest
 * rate first (unknown rates last), then the larger balance.
 */
export function priorityDebts(liabilities: readonly Liability[], saidDebtFirst: boolean): Liability[] {
  const rate = (item: Liability) => (debtTier(item.annualRate) === "unknown" ? -1 : item.annualRate);
  return liabilities
    .filter((item) => item.balance > 0 && !item.paidInFull && debtComesFirst(item.annualRate, saidDebtFirst))
    .sort((a, b) => rate(b) - rate(a) || b.balance - a.balance);
}

/**
 * Money kept aside while paying debt down, so one surprise bill does not go
 * straight back on the card: a month of spending, else RM1,000.
 */
export function starterBufferTarget(monthlySpending: number | null | undefined): number {
  return monthlySpending !== null && monthlySpending !== undefined && Number.isFinite(monthlySpending) && monthlySpending > 0
    ? monthlySpending
    : STARTER_BUFFER_FALLBACK;
}

// --- L-2: kinds of debt ----------------------------------------------------------

export interface DebtKindInfo {
  /** As a name: "Credit card". */
  label: string;
  /** Inside a sentence: "The debt is a credit card". */
  phrase: string;
  /** A common rate in Malaysia, as quoted (flat when `quotedFlat`). 0 = no typical rate. An estimate. */
  typicalRate: number;
  /** Banks quote it as a flat rate (hire purchase, most personal loans). */
  quotedFlat: boolean;
  /** Paid in fixed instalments over a term. */
  hasTerm: boolean;
  /** A common time left, for the pre-filled answer; null = no guess. */
  typicalMonthsLeft: number | null;
}

export const DEBT_KINDS: Readonly<Record<DebtKind, DebtKindInfo>> = {
  "credit-card": { label: "Credit card", phrase: "a credit card", typicalRate: 0.18, quotedFlat: false, hasTerm: false, typicalMonthsLeft: null },
  "personal-loan": { label: "Personal loan", phrase: "a personal loan", typicalRate: 0.06, quotedFlat: true, hasTerm: true, typicalMonthsLeft: 60 },
  bnpl: { label: "Buy now, pay later", phrase: "buy now, pay later", typicalRate: 0.18, quotedFlat: false, hasTerm: false, typicalMonthsLeft: null },
  "car-loan": { label: "Car loan", phrase: "a car loan", typicalRate: 0.03, quotedFlat: true, hasTerm: true, typicalMonthsLeft: 84 },
  ptptn: { label: "PTPTN", phrase: "a PTPTN loan", typicalRate: 0.01, quotedFlat: false, hasTerm: true, typicalMonthsLeft: 120 },
  "housing-loan": { label: "Housing loan", phrase: "a housing loan", typicalRate: 0.04, quotedFlat: false, hasTerm: true, typicalMonthsLeft: 300 },
  other: { label: "Debt", phrase: "something else", typicalRate: 0, quotedFlat: false, hasTerm: true, typicalMonthsLeft: null },
};
export const DEBT_KIND_IDS = Object.keys(DEBT_KINDS) as DebtKind[];

export function isDebtKind(value: unknown): value is DebtKind {
  return typeof value === "string" && Object.hasOwn(DEBT_KINDS, value);
}

/** Monthly rate that makes `payment` a month repay 1 over `months`, by bisection. */
function monthlyRateFor(payment: number, months: number): number {
  const presentValue = (rate: number) => (rate === 0 ? payment * months : payment * (1 - (1 + rate) ** -months) / rate);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > 1) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

/**
 * A flat rate charges interest on the whole loan for the whole term, so the
 * real (effective) rate is nearly double: flat 6% over 5 years ≈ 10.9% a year.
 * Both as fractions; the result is the yearly rate banks print as the EIR.
 */
export function flatToEffectiveRate(flatRate: number, months: number): number {
  if (!Number.isFinite(flatRate) || flatRate <= 0) return 0;
  const term = Number.isFinite(months) && months >= 1 ? Math.round(months) : DEFAULT_FLAT_TERM_MONTHS;
  const payment = (1 + flatRate * term / 12) / term;
  return Math.round(monthlyRateFor(payment, term) * 12 * 10000) / 10000;
}

/** The fixed monthly instalment that clears `balance` in `months` at this effective rate. */
export function monthlyInstalment(balance: number, annualRate: number, months: number): number {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  if (!Number.isFinite(months) || months < 1) return balance;
  const rate = Number.isFinite(annualRate) && annualRate > 0 ? annualRate / 12 : 0;
  return rate === 0 ? balance / months : balance * rate / (1 - (1 + rate) ** -months);
}

/** Interest a month on what is owed now. */
export function monthlyInterest(balance: number, annualRate: number): number {
  return balance > 0 && Number.isFinite(annualRate) && annualRate > 0 ? balance * annualRate / 12 : 0;
}

/** A card's minimum payment in Malaysia: 5% of the balance or RM50, whichever is more (never above the balance). */
export function cardMinimumPayment(balance: number): number {
  return balance > 0 ? Math.min(balance, Math.max(balance * 0.05, 50)) : 0;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

/** "2026-09-22" (or "2026-09") plus 57 months → "2031-06". */
export function addMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + Math.round(months);
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
}

/** Instalments left until `endMonth`, counting from `today`'s month; 0 once it has passed. */
export function monthsUntil(endMonth: string, today: string): number {
  if (!isMonth(endMonth)) return 0;
  const months = (Number(endMonth.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(endMonth.slice(5, 7)) - Number(today.slice(5, 7));
  return Math.max(0, months);
}

// --- L-2: a liability from a form -------------------------------------------------

/** What the Settings and Overview debt forms collect, as typed. Rates are percents here. */
export interface LiabilityInput {
  name: string;
  balance: number;
  /** Percent as typed (18 = 18%); NaN or blank = not given. */
  ratePercent: number;
  rateFlat: boolean;
  minimumPayment: number;
  kind: DebtKind | null;
  /** "YYYY-MM" or "". */
  endMonth: string;
  paidInFull: boolean;
}

export type LiabilityResult = { ok: true; liability: Liability } | { ok: false; error: string };

/**
 * Check a form's debt and turn it into a liability: the typed percent stored
 * as a fraction, a flat rate converted over the months left (5 years when no
 * end month is given).
 */
export function buildLiability(id: string, input: LiabilityInput, today: string): LiabilityResult {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, error: "Give it a name, like Credit card." };
  if (!Number.isFinite(input.balance) || input.balance < 0) return { ok: false, error: "Enter how much is still owed." };
  const percent = Number.isFinite(input.ratePercent) ? input.ratePercent : 0;
  if (percent < 0 || percent >= 100) return { ok: false, error: "Enter the yearly rate as a percent, like 18." };
  if (!Number.isFinite(input.minimumPayment) || input.minimumPayment < 0) return { ok: false, error: "The minimum payment can't be negative." };
  if (input.endMonth && !isMonth(input.endMonth)) return { ok: false, error: "Pick the month of the last payment." };
  if (input.endMonth && monthsUntil(input.endMonth, today) < 1) return { ok: false, error: "The last payment month has to be after this month." };
  const months = input.endMonth ? monthsUntil(input.endMonth, today) : Number.NaN;
  const annualRate = input.rateFlat ? flatToEffectiveRate(percent / 100, months) : Math.round(percent * 100) / 10000;
  const liability: Liability = { id, name, balance: input.balance, annualRate, minimumPayment: input.minimumPayment };
  if (input.kind) liability.kind = input.kind;
  if (input.endMonth) liability.endMonth = input.endMonth;
  if (input.kind === "credit-card") liability.paidInFull = input.paidInFull;
  return { ok: true, liability };
}

/**
 * Months to clear `balance` paying `payment` a month at this effective rate;
 * null when the payment does not even cover the interest.
 */
export function monthsToClear(balance: number, annualRate: number, payment: number): number | null {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  if (!Number.isFinite(payment) || payment <= 0) return null;
  const rate = Number.isFinite(annualRate) && annualRate > 0 ? annualRate / 12 : 0;
  if (rate === 0) return Math.ceil(balance / payment);
  if (payment <= balance * rate) return null;
  return Math.ceil(-Math.log(1 - (rate * balance) / payment) / Math.log(1 + rate));
}
