/**
 * Live market prices — normalization only.
 *
 * ── Dependency direction ──────────────────────────────────────────────────
 *   quote source (api/quote) → normalizeQuotes() → PriceMap → PortfolioSnapshot
 *
 * This module is pure: it never fetches, never touches the DOM, and never
 * reads or writes WealthState. Fetching lives in market.ts; valuation lives in
 * portfolioSummary.ts. Splitting them keeps the UI out of the pricing path and
 * makes every validation rule below testable without a network.
 *
 * ── The one rule that matters ─────────────────────────────────────────────
 * A price is a price only when it is a finite number strictly above zero.
 * Anything else — null, undefined, 0, negative, NaN, Infinity, a string, a
 * malformed response — means UNKNOWN, and unknown must never be represented
 * as zero. Valuing a real holding at zero reports a total loss that did not
 * happen, which is a worse failure than showing nothing at all.
 */

/** One usable live price. Constructing this guarantees `priceUsd` is valid. */
export interface LivePrice {
  ticker: string;
  /** Always finite and > 0. */
  priceUsd: number;
  currency: string;
  /** Milliseconds since epoch. */
  quotedAt: number;
  marketState: string;
  /** Previous close, when the source supplied a usable one. */
  previousClose: number | null;
}

/** Usable prices keyed by upper-case ticker. Absent key = unknown price. */
export type PriceMap = ReadonlyMap<string, LivePrice>;

/** The FX rate needed to express a USD price in MYR, or null when unknown. */
export type UsdToMyr = number | null;

/**
 * The single price predicate. Everything else defers to this so "is this a
 * usable price" cannot drift between modules.
 */
export function isUsablePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Same rule, applied to an FX rate. */
export function isUsableRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function timestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Turn a raw `/api/quote` response into validated prices.
 *
 * Malformed input is not an error: anything unrecognised is simply omitted, so
 * a bad payload degrades to "no prices known" instead of throwing inside a
 * render. Entries carrying an `error`, or any price failing isUsablePrice(),
 * are dropped.
 */
export function normalizeQuotes(payload: unknown): PriceMap {
  const prices = new Map<string, LivePrice>();
  if (!payload || typeof payload !== "object") return prices;

  const quotes = (payload as { quotes?: unknown }).quotes;
  if (!Array.isArray(quotes)) return prices;

  for (const entry of quotes) {
    if (!entry || typeof entry !== "object") continue;
    const quote = entry as Record<string, unknown>;

    const ticker = typeof quote.symbol === "string" ? quote.symbol.trim().toUpperCase() : "";
    if (!ticker) continue;
    if (!isUsablePrice(quote.price)) continue;

    prices.set(ticker, {
      ticker,
      priceUsd: quote.price,
      currency: text(quote.currency, "USD"),
      quotedAt: timestamp(quote.quotedAt),
      marketState: text(quote.marketState, "UNKNOWN"),
      previousClose: isUsablePrice(quote.previousClose) ? quote.previousClose : null,
    });
  }

  return prices;
}

/** Look up one ticker's price, or null when it is unknown. */
export function getPrice(prices: PriceMap | undefined, ticker: string): LivePrice | null {
  if (!prices) return null;
  return prices.get(ticker.trim().toUpperCase()) ?? null;
}

/**
 * Build a PriceMap directly from validated values. Used by callers that
 * already hold prices from somewhere other than the quote endpoint.
 */
export function priceMapFrom(entries: Array<Partial<LivePrice> & { ticker: string; priceUsd: number }>): PriceMap {
  const prices = new Map<string, LivePrice>();
  for (const entry of entries) {
    const ticker = entry.ticker.trim().toUpperCase();
    if (!ticker || !isUsablePrice(entry.priceUsd)) continue;
    prices.set(ticker, {
      ticker,
      priceUsd: entry.priceUsd,
      currency: entry.currency ?? "USD",
      quotedAt: entry.quotedAt ?? 0,
      marketState: entry.marketState ?? "UNKNOWN",
      previousClose: isUsablePrice(entry.previousClose) ? entry.previousClose : null,
    });
  }
  return prices;
}
