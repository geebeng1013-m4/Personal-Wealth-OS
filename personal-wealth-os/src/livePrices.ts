/**
 * Live market prices — the transient quote cache and its refresh loop.
 *
 * Shared by the Dashboard, Portfolio and Market pages, which is why it is its
 * own module: each of those pages starts a poll on mount and reads the same
 * cache, and none of them owns it.
 *
 * The quotes live here for the life of the page and nowhere else. They are
 * deliberately not part of WealthState — a price is an observation about the
 * world, not something the user owns, and persisting one would let a stale
 * number later read as current. Reloading simply re-fetches.
 */

import type { WealthState } from "./models";
import type { PriceMap } from "./marketPrices";
import type { ValuationInputs } from "./portfolioSummary";
import { fetchLivePrices, fetchUsdToMyr } from "./market";

// Quotes live here for the lifetime of the page and nowhere else. They are
// deliberately NOT part of WealthState: a price is an observation about the
// world, not something the user owns, and persisting it would mean a stale
// number could later be presented as current. Reloading simply re-fetches.
//
// An empty map is the honest default — it means "no price known", which every
// consumer renders as unknown rather than as zero.
let livePrices: PriceMap = new Map();
let liveUsdToMyr: number | null = null;
let priceFetchInFlight = false;
/** Tickers the last fetch covered, so switching symbols can refetch. */
let pricedSymbols = "";
/** When the current livePrices were fetched, so a long-open tab can tell it has gone stale. */
let pricesFetchedAt = 0;
/**
 * How long a price is trusted before refreshLivePrices() will fetch again.
 *
 * Without this, a tab left open kept showing whatever quote arrived on the
 * very first load, forever — the fetch guard only ever asked "do we have SOME
 * price for these tickers", never "is it still recent". A real comparison
 * against a live brokerage app surfaced this: after the tab had been open a
 * while, the app's gain figure was noticeably behind the brokerage's, purely
 * because the market had moved since that one fetch and nothing ever asked
 * again.
 */
const PRICE_STALE_AFTER_MS = 60_000;
/**
 * How often an open page re-checks whether its price has gone stale.
 *
 * Deliberately shorter than PRICE_STALE_AFTER_MS. Polling at exactly the
 * staleness period never works: the timer starts before the first quote
 * resolves, so every tick lands a few hundred milliseconds INSIDE the freshness
 * window and no-ops, and the price only actually refreshes on the tick after
 * that. Checking twice per window means a stale price is picked up promptly
 * while still making at most one request per window.
 */
export const PRICE_POLL_INTERVAL_MS = PRICE_STALE_AFTER_MS / 2;

/** The market inputs handed to the canonical portfolio snapshot. */
export function livePriceInputs(): ValuationInputs {
  return { prices: livePrices, usdToMyr: liveUsdToMyr };
}

/**
 * Fetch quotes for the tickers the user actually holds, then re-render.
 *
 * Guarded so a page that renders repeatedly does not queue duplicate requests.
 * Once fetched, a price is reused for PRICE_STALE_AFTER_MS rather than forever
 * — a tab left open must eventually ask again, or its valuation quietly falls
 * behind a real brokerage's live view. Silent on failure: no prices simply
 * means the valuation stays unknown (or keeps whatever was last known).
 */
export function refreshLivePrices(state: WealthState, onUpdated: () => void): void {
  const symbols = [...new Set([
    ...state.trades.map((trade) => trade.ticker),
    ...Object.keys(state.dca.targets),
  ])].filter(Boolean).sort();
  if (symbols.length === 0) return;

  const key = symbols.join(",");
  const isFresh = key === pricedSymbols && livePrices.size > 0 && Date.now() - pricesFetchedAt < PRICE_STALE_AFTER_MS;
  if (priceFetchInFlight || isFresh) return;
  priceFetchInFlight = true;

  void Promise.all([
    fetchLivePrices(symbols),
    fetchUsdToMyr(state.trades, state.currencyExchanges).catch(() => null),
  ]).then(([prices, rate]) => {
    priceFetchInFlight = false;
    if (prices.size === 0) return; // unknown stays unknown; do not overwrite a good price with nothing
    livePrices = prices;
    pricedSymbols = key;
    pricesFetchedAt = Date.now();
    liveUsdToMyr = typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
    onUpdated();
  }).catch(() => { priceFetchInFlight = false; });
}

/** Human-scale "how long ago" for a quote timestamp. Never claims to be live. */
export function quoteAgeLabel(quotedAtMs: number | null): string {
  if (!quotedAtMs) return "";
  const ageMs = Date.now() - quotedAtMs;
  if (ageMs < 0) return "";
  const minutes = Math.floor(ageMs / 60_000);
  // "priced" read as "the app last refreshed", which sent a user hunting for a
  // bug during a normal US market close. The timestamp is the market's, not
  // ours: the app re-asks every 30 seconds, and outside trading hours every
  // answer is the same closing print. "last traded" says whose clock this is.
  if (minutes < 1) return "last traded moments ago";
  if (minutes < 60) return `last traded ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last traded ${hours}h ago`;
  return `last traded ${Math.floor(hours / 24)}d ago`;
}
