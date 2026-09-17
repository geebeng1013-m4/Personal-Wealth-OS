/**
 * Market and currency on trades and conversions — the multi-market data shape.
 *
 * WHY THIS EXISTS
 *
 * Every trade used to be a US share bought in dollars, so the dollar was baked
 * into the field names: amountUsd, priceUsd, feeMyr, and conversions that could
 * only ever be ringgit ↔ dollar. A Maybank buy at RM 9.80 had nowhere to go but
 * "USD 9.80", which the portfolio then multiplied by the exchange rate. This
 * module adds the general shape — which market, which currency, the amounts in
 * that currency, and which currency the fee was paid in — without yet changing
 * a single calculation. Nothing reads these fields for arithmetic until the
 * currency pools are split per currency.
 *
 * WHY THE OLD FIELDS STAY, AND WIN
 *
 * The same cloud document is read by whatever build production is running. An
 * older build knows only the dollar fields: it keeps unknown fields on a trade
 * (it spreads the stored object) but rebuilds each conversion from its dollar
 * and ringgit amounts, dropping anything else. So:
 *
 *   - the old fields are never removed, or an older build loses the record;
 *   - for a dollar trade and a ringgit ↔ dollar conversion, the old fields are
 *     the source of truth and the new ones are re-derived on every load. An
 *     edit made in an older build only changes the old fields, and the new ones
 *     must follow it rather than keep a stale copy.
 *
 * Only a record in some other currency — which no older build can create —
 * carries its amounts in the new fields alone.
 *
 * Pure: imports only the domain types. No fetching, no persistence, no UI.
 */
import type { CurrencyExchange, Market, Trade } from "./models";

export interface MarketInfo {
  market: Market;
  /** Chinese name shown to the user. */
  label: string;
  /** Yahoo symbol suffix, "" for US listings. */
  suffix: string;
  /** The currency a listing on this market trades in unless told otherwise. */
  defaultCurrency: string;
}

/**
 * The markets V1 supports. London is here for Irish-domiciled ETFs; its
 * listings trade in dollars (VWRA) or sterling (VWRL), which is exactly why
 * market and currency are stored separately rather than one implying the other.
 */
export const MARKETS: readonly MarketInfo[] = [
  { market: "US", label: "美股", suffix: "", defaultCurrency: "USD" },
  { market: "MY", label: "马股", suffix: ".KL", defaultCurrency: "MYR" },
  { market: "HK", label: "港股", suffix: ".HK", defaultCurrency: "HKD" },
  { market: "SG", label: "新加坡股", suffix: ".SI", defaultCurrency: "SGD" },
  { market: "LSE", label: "伦敦 ETF", suffix: ".L", defaultCurrency: "USD" },
];

export function isMarket(value: unknown): value is Market {
  return typeof value === "string" && MARKETS.some((info) => info.market === value);
}

/** A three-letter ISO 4217 code. Not a closed list: new markets must not need a schema change. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

/** Which market a Yahoo-style ticker belongs to, by its suffix. No suffix is a US listing. */
export function marketOfTicker(ticker: string): Market {
  const upper = ticker.trim().toUpperCase();
  const match = MARKETS.find((info) => info.suffix && upper.endsWith(info.suffix));
  return match?.market ?? "US";
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Fill in a trade's market, currency, amounts and fee currency.
 *
 * A trade with no currency predates multi-market support and is a dollar
 * trade by definition. For any dollar trade the dollar fields are copied into
 * the general ones every time, so the two can never disagree. A fee is in
 * ringgit unless it is recorded in the trade's own currency — the only two
 * choices the entry form offers — and a ringgit fee always comes from feeMyr.
 *
 * Idempotent: normalizing twice gives the same trade.
 */
export function normalizeTradeMarket(trade: Trade): Trade {
  const currency = isCurrencyCode(trade.currency) ? trade.currency : "USD";
  const market = isMarket(trade.market) ? trade.market : marketOfTicker(trade.ticker ?? "");

  const amount = currency === "USD" || !isAmount(trade.amount) ? trade.amountUsd : trade.amount;
  const price = currency === "USD" || !isAmount(trade.price) ? trade.priceUsd : trade.price;

  const feeInTradeCurrency = currency !== "MYR"
    && trade.feeCurrency === currency
    && isAmount(trade.fee);
  const feeCurrency = feeInTradeCurrency ? currency : "MYR";
  const fee = feeInTradeCurrency ? trade.fee as number : trade.feeMyr;

  return { ...trade, market, currency, amount, price, fee, feeCurrency };
}

/** The two sides of a conversion in general form. */
export interface ExchangeSides {
  fromCurrency: string;
  fromAmount: number;
  toCurrency: string;
  toAmount: number;
}

/**
 * The from/to sides of a ringgit ↔ dollar conversion, derived from its dollar
 * and ringgit amounts and its direction — the fields every build understands.
 */
export function exchangeSides(
  exchange: Pick<CurrencyExchange, "direction" | "myrAmount" | "usdAmount">,
): ExchangeSides {
  return exchange.direction === "usd-to-myr"
    ? { fromCurrency: "USD", fromAmount: exchange.usdAmount, toCurrency: "MYR", toAmount: exchange.myrAmount }
    : { fromCurrency: "MYR", fromAmount: exchange.myrAmount, toCurrency: "USD", toAmount: exchange.usdAmount };
}

/**
 * Read the ringgit and dollar amounts out of a conversion recorded only in
 * general form, when it is a ringgit ↔ dollar one. Returns null for any other
 * pair or anything malformed.
 */
export function myrUsdFromSides(record: Record<string, unknown>): Pick<CurrencyExchange, "direction" | "myrAmount" | "usdAmount"> | null {
  const { fromCurrency, toCurrency, fromAmount, toAmount } = record;
  if (!isPositive(fromAmount) || !isPositive(toAmount)) return null;
  if (fromCurrency === "MYR" && toCurrency === "USD") {
    return { direction: "myr-to-usd", myrAmount: fromAmount, usdAmount: toAmount };
  }
  if (fromCurrency === "USD" && toCurrency === "MYR") {
    return { direction: "usd-to-myr", myrAmount: toAmount, usdAmount: fromAmount };
  }
  return null;
}
