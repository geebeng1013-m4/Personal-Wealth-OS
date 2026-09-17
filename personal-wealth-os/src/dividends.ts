/**
 * Dividend records — the payouts the user actually received, and the tax taken
 * before they arrived.
 *
 * WHY THIS EXISTS
 *
 * A US ETF pays a dividend every quarter, and for a Malaysian holder the US
 * withholds 30% of it first: Malaysia has no income tax treaty with the United
 * States, so the statutory rate applies. Without these records the portfolio's
 * return leaves that income out, the tax is invisible, and the dollars that
 * land in the brokerage balance are money no conversion explains.
 *
 * WHAT A RECORD HOLDS
 *
 * One record per ticker and ex-dividend date. Gross and withholding tax are
 * stored as the statement shows them; the net amount is derived, so the three
 * can never disagree. A "dismissed" record is the user saying "not this one":
 * it keeps a suggested payout from being offered again, and carries no money.
 *
 * Suggesting records from dividend history, and counting them in returns, are
 * separate steps (D-2, D-3). This module is only the shape and its validation.
 *
 * Pure: imports only the domain types. No fetching, no persistence, no UI.
 */
import type { Dividend, DividendStatus } from "./models";

/** Max records kept, so the list cannot grow without bound. */
export const MAX_DIVIDENDS = 2000;

const STATUSES: DividendStatus[] = ["confirmed", "dismissed"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The one key a payout is known by: a ticker pays at most once per ex-date. */
export function dividendKey(ticker: string, exDate: string): string {
  return `${ticker.trim().toUpperCase()}|${exDate}`;
}

/** A stable id for the payout on this ticker and ex-date. */
export function dividendId(ticker: string, exDate: string): string {
  return `div-${ticker.trim().toUpperCase()}-${exDate}`;
}

/** What the user received: gross less the tax withheld. Never negative. */
export function netDividend(dividend: Pick<Dividend, "gross" | "withholdingTax">): number {
  return Math.max(dividend.gross - dividend.withholdingTax, 0);
}

/** Withholding tax as a share of gross, 0..1, or null when there was no gross. */
export function withholdingRate(dividend: Pick<Dividend, "gross" | "withholdingTax">): number | null {
  return dividend.gross > 0 ? dividend.withholdingTax / dividend.gross : null;
}

/**
 * Validate and normalize one persisted record.
 * Returns null for anything malformed, so a single bad entry can be dropped
 * without taking the rest of the state down with it.
 */
export function validateDividend(candidate: unknown): Dividend | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;

  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (typeof record.ticker !== "string" || !/^[A-Za-z0-9._^:=-]{1,20}$/.test(record.ticker.trim())) return null;
  if (typeof record.exDate !== "string" || !DATE.test(record.exDate)) return null;
  const status: DividendStatus = STATUSES.includes(record.status as DividendStatus)
    ? record.status as DividendStatus
    : "confirmed";

  // A received dividend is money; a dismissed one is only a marker and may
  // carry the suggestion's figures or none.
  const gross = isAmount(record.gross) ? record.gross : 0;
  if (status === "confirmed" && gross <= 0) return null;
  // Tax cannot exceed what it was taken from. A figure above gross is a typing
  // slip, and clamping it would invent a number, so the record is refused.
  const withholdingTax = isAmount(record.withholdingTax) ? record.withholdingTax : 0;
  if (withholdingTax > gross) return null;

  return {
    id: record.id.trim().slice(0, 120),
    ticker: record.ticker.trim().toUpperCase(),
    exDate: record.exDate,
    payDate: typeof record.payDate === "string" && DATE.test(record.payDate) ? record.payDate : record.exDate,
    currency: typeof record.currency === "string" && /^[A-Z]{3}$/.test(record.currency) ? record.currency : "USD",
    ...(isPositive(record.units) ? { units: record.units } : {}),
    ...(isPositive(record.perShare) ? { perShare: record.perShare } : {}),
    gross,
    withholdingTax,
    status,
    ...(typeof record.notes === "string" && record.notes.trim()
      ? { notes: record.notes.trim().slice(0, 200) }
      : {}),
  };
}

/**
 * Normalize a persisted array: drop malformed entries, keep one record per
 * ticker and ex-date (the later entry wins, as an edit would), sort by date.
 */
export function normalizeDividends(value: unknown): Dividend[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, Dividend>();
  for (const candidate of value) {
    const record = validateDividend(candidate);
    if (!record) continue;
    const key = dividendKey(record.ticker, record.exDate);
    if (!byKey.has(key) && byKey.size >= MAX_DIVIDENDS) break;
    byKey.set(key, record);
  }
  return [...byKey.values()].sort((a, b) => a.exDate.localeCompare(b.exDate) || a.ticker.localeCompare(b.ticker));
}
