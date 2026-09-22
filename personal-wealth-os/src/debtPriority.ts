/**
 * Which debts come before the safety buffer and investing (PLAN.md L-1).
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
 * paying off debt comes first — what the app did before rates counted.
 *
 * Guidance only, not financial advice. Pure: no DOM, no storage.
 */

import type { Liability } from "./models";

export const HIGH_RATE = 0.08;
export const MEDIUM_RATE = 0.04;
/** The starter emergency money when monthly spending is not known. */
export const STARTER_BUFFER_FALLBACK = 1000;

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
    .filter((item) => item.balance > 0 && debtComesFirst(item.annualRate, saidDebtFirst))
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
