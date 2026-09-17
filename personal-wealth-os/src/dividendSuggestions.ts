/**
 * Dividend suggestions — what the user should have received, worked out from
 * their own trades and each listing's dividend history, for them to confirm.
 *
 * WHY SUGGEST RATHER THAN RECORD
 *
 * The payout history says what one share paid; the trades say how many shares
 * were held. Their product is the gross dividend, and the market's withholding
 * rate gives the tax. That is an estimate of the statement, not the statement:
 * brokers round fractional payouts, a special distribution may be taxed
 * differently, and a London fund's payout currency cannot be read off the
 * price feed. So nothing here is stored. The user confirms, edits or dismisses
 * each suggestion (D-4), and only that becomes a Dividend.
 *
 * WHO HOLDS THE PAYOUT
 *
 * Shares bought before the ex-dividend date earn it; shares bought on or after
 * it do not. Units are therefore counted from trades dated strictly before the
 * ex-date, sales included.
 *
 * Pure: no fetching, no persistence, no UI.
 */
import type { Dividend, Market, Ticker, Trade } from "./models";
import { calculatePositionCostBasis } from "./rules";
import { marketOfTicker, normalizeTradeMarket } from "./tradeCurrency";
import { dividendId, dividendKey } from "./dividends";

/** One payout from a listing's dividend history, per share, in a major currency. */
export interface DividendEvent {
  exDate: string;
  perShare: number;
  currency: string;
}

/** One day's closing rate, MYR per unit. */
export interface RatePoint {
  date: string;
  close: number;
}

/**
 * Tax withheld at source on a dividend paid to an individual resident in
 * Malaysia, by the market the listing trades on. Checked 2026-09-18:
 *
 *   US   30%  IRS NRA withholding; Malaysia has no income tax treaty with the US
 *   MY    0%  single-tier dividends are exempt (REITs: no withholding from
 *            YA 2026, but taxable in the personal return — LHDN PN 2/2026)
 *   HK    0%  Hong Kong levies no withholding tax on dividends
 *   SG    0%  one-tier dividends, no withholding for non-residents (IRAS)
 *   LSE   0%  Irish-domiciled UCITS funds do not withhold for non-residents;
 *            the 15% US tax is paid inside the fund
 */
export const DEFAULT_WITHHOLDING: Readonly<Record<Market, number>> = {
  US: 0.3,
  MY: 0,
  HK: 0,
  SG: 0,
  LSE: 0,
};

/** A payout the user has not yet confirmed or dismissed. */
export interface DividendSuggestion {
  id: string;
  ticker: Ticker;
  market: Market;
  exDate: string;
  /** The feed carries no pay date; the ex-date stands in until the user edits it. */
  payDate: string;
  currency: string;
  units: number;
  perShare: number;
  gross: number;
  withholdingTax: number;
  /** The rate applied, 0..1. */
  taxRate: number;
  /** MYR per unit on the pay date, from rate history, when known. */
  rateToMyr?: number;
  /** Why this one needs a closer look at the statement, when it does. */
  caution?: string;
}

/** Units of `ticker` held at the start of `exDate`: every trade dated before it. */
export function unitsHeldBefore(trades: Trade[], ticker: Ticker, exDate: string): number {
  const before = trades.filter((trade) => trade.ticker === ticker && trade.date.slice(0, 10) < exDate);
  return calculatePositionCostBasis(before, ticker).units;
}

/**
 * The closing rate on `date`, or on the last trading day before it. A rate from
 * after the date would be one the money had not met yet, so it is never used.
 */
export function rateOnOrBefore(history: RatePoint[], date: string): number | null {
  let best: RatePoint | null = null;
  for (const point of history) {
    if (point.date > date || !(point.close > 0)) continue;
    if (!best || point.date > best.date) best = point;
  }
  return best?.close ?? null;
}

function cautionFor(market: Market, eventCurrency: string, holdingCurrency: string): string | undefined {
  if (eventCurrency !== holdingCurrency) {
    return `The payout is listed in ${eventCurrency} while you bought in ${holdingCurrency} — check the currency on your statement.`;
  }
  if (market === "LSE") return "London funds may pay out in a different currency from their price — check your statement.";
  if (market === "HK" || market === "SG") return "If this is a REIT, withholding here is unverified — check your statement.";
  return undefined;
}

/**
 * Every payout the user's holdings earned that is not yet on record.
 *
 * `events` is each ticker's dividend history; `rateHistory` is daily MYR rates
 * per currency. A payout already confirmed or dismissed is not suggested again,
 * nor is one whose ex-date is still ahead, nor one on a day nothing was held.
 * Newest first.
 */
export function suggestDividends(input: {
  trades: Trade[];
  dividends: Dividend[];
  events: ReadonlyMap<Ticker, DividendEvent[]>;
  rateHistory: ReadonlyMap<string, RatePoint[]>;
  now: Date;
}): DividendSuggestion[] {
  const today = input.now.toISOString().slice(0, 10);
  const recorded = new Set(input.dividends.map((dividend) => dividendKey(dividend.ticker, dividend.exDate)));
  const suggestions: DividendSuggestion[] = [];

  for (const [ticker, events] of input.events) {
    const tickerTrades = input.trades.filter((trade) => trade.ticker === ticker);
    if (tickerTrades.length === 0) continue;
    const newest = normalizeTradeMarket(tickerTrades.reduce((a, b) => (b.date > a.date ? b : a)));
    const market = newest.market ?? marketOfTicker(ticker);
    const holdingCurrency = newest.currency ?? "USD";

    for (const event of events) {
      if (!(event.perShare > 0) || event.exDate > today) continue;
      if (recorded.has(dividendKey(ticker, event.exDate))) continue;
      const units = unitsHeldBefore(input.trades, ticker, event.exDate);
      if (!(units > 1e-9)) continue;

      const gross = units * event.perShare;
      const taxRate = DEFAULT_WITHHOLDING[market] ?? 0;
      const rate = event.currency === "MYR"
        ? 1
        : rateOnOrBefore(input.rateHistory.get(event.currency) ?? [], event.exDate);
      const caution = cautionFor(market, event.currency, holdingCurrency);
      suggestions.push({
        id: dividendId(ticker, event.exDate),
        ticker,
        market,
        exDate: event.exDate,
        payDate: event.exDate,
        currency: event.currency,
        units,
        perShare: event.perShare,
        gross,
        withholdingTax: gross * taxRate,
        taxRate,
        ...(rate !== null ? { rateToMyr: rate } : {}),
        ...(caution ? { caution } : {}),
      });
    }
  }
  return suggestions.sort((a, b) => b.exDate.localeCompare(a.exDate) || a.ticker.localeCompare(b.ticker));
}

/** A suggestion as the record the user confirms, with any edits applied. */
export function dividendFromSuggestion(
  suggestion: DividendSuggestion,
  edits: Partial<Pick<Dividend, "payDate" | "gross" | "withholdingTax" | "notes">> = {},
): Dividend {
  return {
    id: suggestion.id,
    ticker: suggestion.ticker,
    exDate: suggestion.exDate,
    payDate: edits.payDate ?? suggestion.payDate,
    currency: suggestion.currency,
    units: suggestion.units,
    perShare: suggestion.perShare,
    gross: edits.gross ?? suggestion.gross,
    withholdingTax: edits.withholdingTax ?? suggestion.withholdingTax,
    ...(suggestion.rateToMyr !== undefined ? { rateToMyr: suggestion.rateToMyr } : {}),
    status: "confirmed",
    ...(edits.notes ? { notes: edits.notes } : {}),
  };
}

/** A suggestion the user says is not theirs: kept only so it is not offered again. */
export function dismissedFromSuggestion(suggestion: DividendSuggestion): Dividend {
  return {
    id: suggestion.id,
    ticker: suggestion.ticker,
    exDate: suggestion.exDate,
    payDate: suggestion.payDate,
    currency: suggestion.currency,
    gross: 0,
    withholdingTax: 0,
    status: "dismissed",
  };
}
