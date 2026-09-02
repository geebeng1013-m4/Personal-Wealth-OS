/**
 * Formatters for canonical valuation figures.
 *
 * Shared by the Dashboard and Portfolio pages, which both render the same
 * market-value / unrealised-P&L / fee-drag block from the same PortfolioSnapshot.
 * Every function here treats a null as genuinely unknown — it becomes "--" or
 * "", never 0 — so the two pages can't disagree about what an absent price means.
 */

import type { PortfolioSnapshot } from "../portfolioSummary";
import { money, percent } from "../rules";
import { escapeHtml } from "../html";
import { quoteAgeLabel } from "../livePrices";

/** Placeholder for a fact that is genuinely unknown. Never a zero. */
export const UNKNOWN = "--";

/**
 * Format a canonical money field that may be unknown.
 * Formatting only — a null stays "--" and is never coerced to 0.
 */
export function moneyOrUnknown(value: number | null | undefined): string {
  return value == null ? UNKNOWN : money(value);
}

/** Format a canonical P&L: signed money plus signed percent, or "--". */
export function pnlText(
  amount: number | null | undefined,
  ratio: number | null | undefined,
  currency = "MYR",
): string {
  if (amount == null) return UNKNOWN;
  const sign = amount >= 0 ? "+" : "−";
  const percentPart = ratio == null ? "" : ` (${sign}${percent(Math.abs(ratio), 2)})`;
  return `${sign}${money(Math.abs(amount), currency)}${percentPart}`;
}

/**
 * The same unrealised P&L, stated in USD.
 *
 * Shown next to the ringgit figure because users compare the ringgit one
 * against their broker app, where it does not match — and the mismatch is real:
 * the two are converted on different terms. The USD figure is the exact one,
 * since units and prices come straight off the broker's own data, while the
 * ringgit cost basis depends on the FX rate each trade happens to carry (see
 * csvImport.ts for why that rate is weak on imported trades).
 *
 * Returns "" rather than "--" when unknown, so a caller can drop it into a
 * separator-joined note without leaving a dangling placeholder.
 */
export function usdPnlNote(portfolio: PortfolioSnapshot): string {
  if (portfolio.unrealizedPnlUsd == null) return "";
  return pnlText(portfolio.unrealizedPnlUsd, portfolio.unrealizedPnlPercent, "USD");
}

/**
 * What the return would have been with no trading costs.
 *
 * Shown next to the headline because the two answer different questions and
 * the user asked for both: the headline is what every ringgit handed over
 * became, this is how the investment itself did. The gap between them is the
 * broker's cut, which is otherwise invisible — buried inside the cost basis
 * with nothing on screen to say so.
 *
 * Returns "" when unknown or when nothing was charged, so it can be dropped
 * into a separator-joined note without leaving a stray placeholder.
 */
export function feeFreeReturnNote(portfolio: PortfolioSnapshot): string {
  if (portfolio.feesInCostBasisMyr <= 0.005) return "";
  if (portfolio.unrealizedPnlMyrExFees === null) return "";
  return `Before trading costs ${pnlText(portfolio.unrealizedPnlMyrExFees, portfolio.unrealizedPnlPercentMyrExFees)}`;
}

/** The Trading costs row's contents, shared by the first paint and the repaint. */
export function feeRowHtml(portfolio: PortfolioSnapshot): string {
  const note = feeFreeReturnNote(portfolio) || "Commission paid, already inside the cost above";
  return `${money(portfolio.feesInCostBasisMyr)} <span class="wu-note">${escapeHtml(note)}</span>`;
}

/** Join note fragments with the standard separator, dropping empty ones. */
export function joinNotes(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" · ");
}

/** CSS modifier for a canonical P&L value. Neutral while unknown. */
export function pnlTone(amount: number | null | undefined): string {
  if (amount == null) return "";
  return amount >= 0 ? "wu-metric__value--positive" : "wu-metric__value--negative";
}

/**
 * One honest sentence about how complete a valuation is, straight from the
 * canonical status. The UI never decides this itself.
 */
export function valuationNote(portfolio: PortfolioSnapshot): string {
  // The age is shown alongside the delayed-data disclaimer rather than instead
  // of it: "may be delayed" alone gave no way to tell a 30-second-old quote
  // from one that had sat unrefreshed for an hour.
  const age = quoteAgeLabel(portfolio.valuedAt);
  const ageSuffix = age ? ` · ${age}` : "";
  if (portfolio.valuationStatus === "complete") return `Market data may be delayed${ageSuffix}`;
  if (portfolio.valuationStatus === "partial") {
    const missing = portfolio.unpricedTickers.length;
    return `Partial valuation · ${missing} ${missing === 1 ? "holding" : "holdings"} unavailable${ageSuffix}`;
  }
  return portfolio.totalInvestedMyr > 0 ? "No market price available yet" : "No holdings recorded";
}
