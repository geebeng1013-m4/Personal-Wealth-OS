/**
 * The Record-trade form, as data: what the user typed in → one Trade.
 *
 * Split out of the Portfolio page so the rules can be tested without a DOM.
 * The page reads the form fields into TradeEntry, looks up a rate if it needs
 * one, and stores whatever tradeFromEntry returns.
 *
 * The form asks for figures in the listing's own currency, because that is
 * what a broker's contract note shows: HKD for a Hong Kong fill, ringgit for a
 * Bursa one. Ringgit cost is filled in from recorded conversions later (see
 * currencyExchange.ts); the figure stored here is only the starting estimate.
 *
 * Pure: no fetching, no persistence, no DOM.
 */
import type { Market, Trade, TradeType } from "./models";
import { MARKETS, isCurrencyCode, isMarket, normalizeTradeMarket } from "./tradeCurrency";

/** The currencies a market's listings can be priced in. The first is the default. */
export function currenciesFor(market: Market): string[] {
  // London lists the same kind of ETF in dollars (VWRA) and in sterling (VWRL).
  if (market === "LSE") return ["USD", "GBP"];
  return [MARKETS.find((info) => info.market === market)?.defaultCurrency ?? "USD"];
}

/**
 * The ticker as Yahoo and the rest of the app know it.
 *
 * Adds the market's suffix when it is missing, so "1155" on Malaysia is stored
 * as "1155.KL" and prices. Hong Kong codes are padded to four digits
 * ("700" → "0700.HK"), which is how the exchange and Yahoo write them. A ticker
 * that already carries a different market's suffix is left alone: the user
 * typed something specific.
 */
export function normalizeTicker(input: string, market: Market): string {
  const raw = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  const suffix = MARKETS.find((info) => info.market === market)?.suffix ?? "";
  if (!suffix) return raw;
  if (/\.[A-Z]{1,3}$/.test(raw)) return raw;
  const code = market === "HK" && /^\d{1,4}$/.test(raw) ? raw.padStart(4, "0") : raw;
  return code + suffix;
}

/** What the Record-trade form holds, already read as numbers. 0 means left blank. */
export interface TradeEntry {
  id: string;
  date: string;
  platform: string;
  ticker: string;
  market: Market;
  currency: string;
  type: TradeType;
  /** Order value in `currency`. */
  amount: number;
  /** Price per unit in `currency`. */
  price: number;
  units: number;
  /** What the order cost in ringgit, when the user knows it. Ignored for a ringgit trade. */
  amountMyr: number;
  fee: number;
  /** The trade's currency or "MYR". */
  feeCurrency: string;
  notes: string;
}

/**
 * Build the trade to store.
 *
 * `rateToMyr` is MYR per unit of the trade's currency — today's rate — used
 * only when the user left the ringgit amount blank. With no rate either, the
 * ringgit amount is stored as 0 and the conversions, once recorded, supply it.
 *
 * Returns null when there is nothing to record: no ticker, or no way to tell
 * what the order was worth.
 */
export function tradeFromEntry(entry: TradeEntry, rateToMyr: number | null): Trade | null {
  const ticker = normalizeTicker(entry.ticker, entry.market);
  if (!ticker) return null;
  const market: Market = isMarket(entry.market) ? entry.market : "US";
  const allowed = currenciesFor(market);
  const currency = isCurrencyCode(entry.currency) && allowed.includes(entry.currency) ? entry.currency : allowed[0];

  const positive = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);
  const units = positive(entry.units);
  const price = positive(entry.price);
  // A blank amount is the fill: price times quantity, as a contract note adds it up.
  const amount = positive(entry.amount) || (price > 0 && units > 0 ? price * units : 0);
  if (amount <= 0) return null;

  const isMyr = currency === "MYR";
  const usableRate = rateToMyr !== null && Number.isFinite(rateToMyr) && rateToMyr > 0 ? rateToMyr : null;
  const amountMyr = isMyr
    ? amount
    : positive(entry.amountMyr) || (usableRate !== null ? amount * usableRate : 0);
  // The rate this trade was entered at: what the user said it cost, else today's.
  const entryRate = isMyr ? 1 : amountMyr > 0 ? amountMyr / amount : null;

  const fee = positive(entry.fee);
  const feeCurrency = !isMyr && entry.feeCurrency === currency ? currency : "MYR";
  // feeMyr is what every older build reads, so it always holds a ringgit figure:
  // a fee in the trade's currency is converted at the trade's own rate.
  const feeMyr = feeCurrency === "MYR" ? fee : entryRate !== null ? fee * entryRate : 0;

  const isUsd = currency === "USD";
  return normalizeTradeMarket({
    id: entry.id,
    date: entry.date,
    platform: entry.platform,
    ticker,
    type: entry.type,
    market,
    currency,
    amount,
    price,
    ...(units > 0 ? { units } : {}),
    fee,
    feeCurrency,
    // The dollar fields keep meaning dollars, so an older build reading this
    // trade never mistakes Hong Kong dollars for US ones.
    amountUsd: isUsd ? amount : 0,
    priceUsd: isUsd ? price : 0,
    amountMyr,
    feeMyr,
    ...(entryRate !== null ? { exchangeRate: entryRate } : {}),
    notes: entry.notes,
  });
}
