// Market data module — fetches VOO/QQQM quotes from Yahoo Finance
// K-line chart powered by TradingView Widget

import { calculatePositionCostBasis, type CostBasisTrade } from "./rules";
import { normalizeQuotes, type PriceMap } from "./marketPrices";

/**
 * Last-resort USD→MYR rate, used only when nothing better exists anywhere.
 *
 * Deliberately a poor answer: a constant cannot track a currency, and at the
 * time of writing it is 5% away from the market. Every path below exists to
 * avoid reaching it, and reaching it should be understood as "we know nothing".
 */
const DEFAULT_USD_MYR = 4.25;

/** Live rate from the FX API. Only ever written by a successful fetch. */
let cachedUsdToMyr: number | null = null;
let cachedUsdToMyrTimestamp = 0;
const FX_CACHE_TTL = 3600_000; // 1 hour

/**
 * Best rate derivable from the user's own records.
 *
 * Kept apart from cachedUsdToMyr on purpose. Writing a fallback into the live
 * cache would suppress API retries for a full hour, so a single network blip
 * would pin the whole session to an old rate. Held here, it serves the
 * synchronous getter without ever standing in the way of a real quote.
 */
let derivedUsdToMyr: number | null = null;

/** A conversion the user actually made — the strongest evidence available. */
export interface FxEvidence {
  date: string;
  direction: string;
  myrAmount: number;
  usdAmount: number;
}

/**
 * The rate implied by the user's own records, newest first.
 *
 * Conversions outrank trades: a conversion IS an exchange rate, recorded as two
 * amounts the broker actually moved, while a trade's exchangeRate is whatever a
 * CSV import stamped on it and may be from the wrong day entirely.
 */
function rateFromRecords(
  trades?: { exchangeRate?: number; date: string }[],
  exchanges?: FxEvidence[],
): number | null {
  const conversions = (exchanges ?? [])
    .filter((item) => item.usdAmount > 0 && item.myrAmount > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  const newest = conversions[0];
  if (newest) return newest.myrAmount / newest.usdAmount;

  const sorted = [...(trades ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  for (const trade of sorted) {
    if (typeof trade.exchangeRate === "number" && trade.exchangeRate > 0) return trade.exchangeRate;
  }
  return null;
}

/**
 * Fetch the current USD→MYR exchange rate.
 *
 * API first, then the user's own conversion and trade records, then the
 * constant. Pass the records: without them a failed request drops straight to a
 * number nobody has ever traded at, and every ringgit figure in the app shifts
 * with it — silently, since a stale rate looks exactly like a fresh one.
 */
export async function fetchUsdToMyr(
  trades?: { exchangeRate?: number; date: string }[],
  exchanges?: FxEvidence[],
): Promise<number> {
  // Remember what the records imply even when the API answers, so the
  // synchronous getter is never left with only the constant.
  const derived = rateFromRecords(trades, exchanges);
  if (derived !== null) derivedUsdToMyr = derived;

  if (cachedUsdToMyr !== null && Date.now() - cachedUsdToMyrTimestamp < FX_CACHE_TTL) {
    return cachedUsdToMyr;
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const json = await res.json() as { rates?: { MYR?: number } };
      if (typeof json.rates?.MYR === "number" && json.rates.MYR > 0) {
        cachedUsdToMyr = json.rates.MYR;
        cachedUsdToMyrTimestamp = Date.now();
        return cachedUsdToMyr;
      }
    }
  } catch { /* fall through to the records */ }

  return derivedUsdToMyr ?? DEFAULT_USD_MYR;
}

/**
 * Synchronous getter for the best USD→MYR rate currently known.
 *
 * Resolves in the same order as fetchUsdToMyr, so the two can never disagree
 * about what today's rate is — they did before, and the sync path was the one
 * handing out the hard-coded constant.
 */
export function getUsdToMyr(): number {
  return cachedUsdToMyr ?? derivedUsdToMyr ?? DEFAULT_USD_MYR;
}

/** Test seam: forget every cached and derived rate. */
export function resetUsdToMyrCache(): void {
  cachedUsdToMyr = null;
  cachedUsdToMyrTimestamp = 0;
  derivedUsdToMyr = null;
}

export interface MarketQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  marketState: string;
  shortName: string;
  currency: string;
}

const CACHE_KEY = "pwo_market_cache";
const CACHE_TTL = 30_000; // 30 seconds — fresher quotes for P&L accuracy

interface CacheEntry {
  timestamp: number;
  data: unknown;
}

function getCached(key: string, ttl: number = CACHE_TTL): unknown | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY + "_" + key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > ttl) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function setCache(key: string, data: unknown): void {
  try {
    const entry: CacheEntry = { timestamp: Date.now(), data };
    localStorage.setItem(CACHE_KEY + "_" + key, JSON.stringify(entry));
  } catch { /* ignore */ }
}

const CACHE_RETENTION_MS = 24 * 3600_000; // 24 hours — well past every TTL above, so anything older is dead weight

/**
 * Drop stale pwo_market_cache_* entries (old symbols/ranges the user no longer
 * looks at). Cache reads already ignore expired entries via getCached(); this
 * just keeps localStorage from growing forever as the user browses more tickers
 * over time. Safe to call once per app load.
 */
export function pruneMarketCache(): void {
  try {
    const now = Date.now();
    const staleKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(CACHE_KEY + "_")) continue;
      try {
        const raw = localStorage.getItem(key);
        const entry: CacheEntry | null = raw ? JSON.parse(raw) : null;
        if (!entry || now - entry.timestamp > CACHE_RETENTION_MS) staleKeys.push(key);
      } catch {
        staleKeys.push(key); // corrupted entry — drop it
      }
    }
    staleKeys.forEach((key) => localStorage.removeItem(key));
  } catch { /* localStorage unavailable */ }
}

/**
 * Fetch a secondary market dataset through the server-side route.
 *
 * /api/market is the only path that works. The browser cannot call the upstream
 * directly (no CORS headers), and the anonymous proxies this used to fall back
 * on have all stopped answering keyless requests — so the fallback could no
 * longer rescue anything; it only spent up to 45 seconds of timeouts before
 * reporting the failure the route had already reported.
 *
 * There is also no environment left for it to serve: Vercel runs api/ in
 * production and vite.config.ts mounts the same handlers in dev, so /api is
 * present wherever the app runs.
 *
 * A failure means the panel stays empty rather than showing invented data.
 */
async function fetchMarketData(kind: "fundamentals" | "holdings" | "history", symbol: string, range?: string): Promise<string> {
  const query = new URLSearchParams({ kind, symbol });
  if (range) query.set("range", range);
  const response = await fetch(`/api/market?${query.toString()}`, {
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`No ${kind} for ${symbol} — upstream ${response.status}`);
  return await response.text();
}

export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const cacheKey = "quote_" + symbol;
  const cached = getCached(cacheKey);
  if (cached) return cached as MarketQuote;

  // Preferred path: the server-side route, which has no CORS restriction.
  const live = await fetchLivePrices([symbol]);
  const price = live.get(symbol.trim().toUpperCase());
  if (price) {
    const quote: MarketQuote = {
      symbol: price.ticker,
      price: price.priceUsd,
      change: price.previousClose !== null ? price.priceUsd - price.previousClose : 0,
      changePercent: price.previousClose !== null
        ? ((price.priceUsd - price.previousClose) / price.previousClose) * 100
        : 0,
      open: 0, high: 0, low: 0,
      prevClose: price.previousClose ?? 0,
      volume: 0,
      marketState: price.marketState,
      shortName: symbol,
      currency: price.currency,
    };
    setCache(cacheKey, quote);
    return quote;
  }

  // /api/quote is the only quote path. When it returns nothing the price is
  // unknown, and a rejection is how every caller already reads that — never a
  // zero, which would be a fabricated price.
  throw new Error("No price for " + symbol);
}

/**
 * Live prices for the given tickers, as validated PriceMap entries.
 *
 * Goes through the server-side /api/quote route: the browser cannot reach the
 * upstream quote API directly (no CORS headers) and the anonymous CORS proxies
 * the client used to fall back on no longer work. Called from the server there
 * is no CORS at all.
 *
 * Never throws and never returns a fabricated price. A failure — offline, route
 * missing in a static preview, malformed payload, unknown ticker — yields no
 * entry for that ticker, which every consumer reads as "unknown".
 */
export async function fetchLivePrices(symbols: string[]): Promise<PriceMap> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  const cacheKey = "prices_" + wanted.slice().sort().join(",");
  const cached = getCached(cacheKey);
  if (cached) return normalizeQuotes(cached);

  try {
    const response = await fetch(`/api/quote?symbols=${encodeURIComponent(wanted.join(","))}`, {
      signal: AbortSignal.timeout(12_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return new Map();

    const payload: unknown = await response.json();
    const prices = normalizeQuotes(payload);
    // Only cache a response that actually produced prices, so a transient
    // outage is retried rather than remembered for the whole TTL.
    if (prices.size > 0) setCache(cacheKey, payload);
    return prices;
  } catch {
    return new Map();
  }
}

export async function fetchMultipleQuotes(symbols: string[]): Promise<MarketQuote[]> {
  const results: MarketQuote[] = [];
  const promises = symbols.map((s) => fetchQuote(s).catch(() => null));
  const settled = await Promise.all(promises);
  for (const q of settled) {
    if (q) results.push(q);
  }
  return results;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatPrice(price: number, currency = "USD"): string {
  return `${currency} ${price.toFixed(2)}`;
}

export function formatChange(change: number, changePercent: number): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)`;
}

export function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) return (volume / 1_000_000_000).toFixed(1) + "B";
  if (volume >= 1_000_000) return (volume / 1_000_000).toFixed(1) + "M";
  if (volume >= 1_000) return (volume / 1_000).toFixed(1) + "K";
  return volume.toLocaleString();
}

// --- Portfolio P&L ---

export interface PortfolioPnL {
  ticker: string;
  totalUnits: number;
  totalInvestedUsd: number;
  totalInvestedMyr: number;
  averageCostUsd: number;
  currentPriceUsd: number;
  currentValueUsd: number;
  currentValueMyr: number;
  unrealizedPnlUsd: number;
  unrealizedPnlMyr: number;
  unrealizedPnlPct: number;
  realizedPnlUsd: number;
  realizedPnlMyr: number;
  feeMyr: number;
}

export function calcPnLForTicker(
  trades: CostBasisTrade[],
  ticker: string,
  currentPriceUsd: number,
  usdToMyr = 4.25,
): PortfolioPnL {
  const costBasis = calculatePositionCostBasis(trades, ticker);
  const currentValueUsd = costBasis.units * currentPriceUsd;
  const currentValueMyr = currentValueUsd * usdToMyr;
  const pnlUsd = currentValueUsd - costBasis.costBasisUsd;
  const pnlMyr = currentValueMyr - costBasis.costBasisMyr;
  const pnlPct = costBasis.costBasisUsd > 0 ? pnlUsd / costBasis.costBasisUsd : 0;

  return {
    ticker,
    totalUnits: costBasis.units,
    totalInvestedUsd: round2(costBasis.costBasisUsd),
    totalInvestedMyr: round2(costBasis.costBasisMyr),
    averageCostUsd: round2(costBasis.averageCostUsd),
    currentPriceUsd,
    currentValueUsd: round2(currentValueUsd),
    currentValueMyr: round2(currentValueMyr),
    unrealizedPnlUsd: round2(pnlUsd),
    unrealizedPnlMyr: round2(pnlMyr),
    unrealizedPnlPct: round2(pnlPct),
    realizedPnlUsd: round2(costBasis.realizedPnlUsd),
    realizedPnlMyr: round2(costBasis.realizedPnlMyr),
    feeMyr: round2(costBasis.feesMyr),
  };
}

// --- Fundamentals (Dividend, P/E, etc.) ---

export interface Fundamentals {
  symbol: string;
  dividendYield: number;      // e.g. 0.0132 = 1.32%
  dividendRate: number;        // annual $ per share
  trailingPE: number;
  exDividendDate: string;      // "2026-06-27"
  exDividendTimestamp: number;
  dividendFrequency: string;   // "Quarterly"
  fiveYearAvgDividendYield: number;
  marketCap: number;
  trailingAnnualDividendRate: number;
  trailingAnnualDividendYield: number;
  expenseRatio: number;        // e.g. 0.0003 = 0.03%
  totalAssets: number;         // AUM in USD
  /**
   * Trailing returns. Always null: the upstream this is built from does not
   * publish them, and they were previously filled with 0 — a number that reads
   * as "flat year" rather than "not available" and had already reached the UI.
   */
  ytdReturn: number | null;
  threeYearReturn: number | null;
  fiveYearReturn: number | null;
}

export interface StockComparisonData {
  symbol: string;
  companyName: string;
  currency: string;
  sector: string | null;
  industry: string | null;
  businessSummary: string | null;
  businessModel: string | null;
  valuation: {
    peRatio: number | null;
    priceToBook: number | null;
    priceToSales: number | null;
  };
  growth: {
    returnOnEquity: number | null;
    revenueGrowth: number | null;
    earningsGrowth: number | null;
  };
  financialHealth: {
    debtToAssets: number | null;
    freeCashFlow: number | null;
  };
  marketPerformance: {
    marketCap: number | null;
    averageDailyValue: number | null;
    beta: number | null;
  };
  updatedAt: number;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "raw" in value) {
    const raw = (value as { raw?: unknown }).raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inferBusinessModel(summary: string | null, industry: string | null): string | null {
  const text = `${industry ?? ""} ${summary ?? ""}`.toLowerCase();
  if (!text.trim()) return null;
  if (/exchange traded fund|index fund|etf/.test(text)) return "Index-tracking fund";
  if (/subscription|software as a service|saas/.test(text)) return "Subscription software";
  if (/advertis/.test(text)) return "Advertising-led platform";
  if (/marketplace|e-commerce|ecommerce/.test(text)) return "Marketplace / commerce";
  if (/bank|lending|loans|credit/.test(text)) return "Interest and fee income";
  if (/semiconductor|chip/.test(text)) return "Semiconductor products";
  if (/manufactur/.test(text)) return "Product manufacturing";
  if (/retail|stores/.test(text)) return "Retail sales";
  return "Operating business";
}

const TRADINGVIEW_SCANNER_URL = "https://scanner.tradingview.com/america/scan";
const TRADINGVIEW_COLUMNS = [
  "name",
  "description",
  "close",
  "market_cap_basic",
  "price_earnings_ttm",
  "price_book_fq",
  "price_sales_current",
  "return_on_equity",
  "revenue_growth_yoy",
  "net_income_growth_yoy",
  "total_liabilities_fq",
  "total_assets_fq",
  "free_cash_flow_ttm",
  "average_volume_30d_calc",
  "beta_1_year",
  "sector",
  "industry",
  "currency",
] as const;

interface TradingViewScanRow {
  s?: unknown;
  d?: unknown;
}

function ratioFromPercent(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null ? null : number / 100;
}

function scannerRowToComparison(row: TradingViewScanRow, requestedSymbol: string): StockComparisonData | null {
  if (!Array.isArray(row.d)) return null;
  const values = row.d;
  const price = finiteNumber(values[2]);
  const averageVolume = finiteNumber(values[13]);
  const totalLiabilities = finiteNumber(values[10]);
  const totalAssets = finiteNumber(values[11]);
  const industry = nonEmptyString(values[16]);
  const sector = nonEmptyString(values[15]);
  const companyName = nonEmptyString(values[1]) ?? requestedSymbol;
  const debtToAssets = totalAssets !== null && totalAssets > 0 && totalLiabilities !== null
    ? totalLiabilities / totalAssets
    : null;

  return {
    symbol: requestedSymbol,
    companyName,
    currency: nonEmptyString(values[17]) ?? "USD",
    sector,
    industry,
    businessSummary: null,
    businessModel: inferBusinessModel(companyName, industry),
    valuation: {
      peRatio: finiteNumber(values[4]),
      priceToBook: finiteNumber(values[5]),
      priceToSales: finiteNumber(values[6]),
    },
    growth: {
      returnOnEquity: ratioFromPercent(values[7]),
      revenueGrowth: ratioFromPercent(values[8]),
      earningsGrowth: ratioFromPercent(values[9]),
    },
    financialHealth: {
      debtToAssets,
      freeCashFlow: finiteNumber(values[12]),
    },
    marketPerformance: {
      marketCap: finiteNumber(values[3]),
      averageDailyValue: price !== null && averageVolume !== null ? price * averageVolume : null,
      beta: finiteNumber(values[14]),
    },
    updatedAt: Date.now(),
  };
}

function tickerPart(symbol: string): string {
  const separator = symbol.lastIndexOf(":");
  return separator >= 0 ? symbol.slice(separator + 1) : symbol;
}

function selectScannerRow(rows: TradingViewScanRow[], requestedSymbol: string): TradingViewScanRow | undefined {
  const explicitExchange = requestedSymbol.includes(":");
  if (explicitExchange) {
    return rows.find((row) => typeof row.s === "string" && row.s.toUpperCase() === requestedSymbol);
  }
  const ticker = tickerPart(requestedSymbol);
  const matches = rows.filter((row) => {
    if (!Array.isArray(row.d)) return false;
    return nonEmptyString(row.d[0])?.toUpperCase() === ticker;
  });
  const exchangeOrder = ["NASDAQ:", "NYSE:", "AMEX:"];
  return matches.sort((a, b) => {
    const aSymbol = typeof a.s === "string" ? a.s.toUpperCase() : "";
    const bSymbol = typeof b.s === "string" ? b.s.toUpperCase() : "";
    const aRank = exchangeOrder.findIndex((exchange) => aSymbol.startsWith(exchange));
    const bRank = exchangeOrder.findIndex((exchange) => bSymbol.startsWith(exchange));
    return (aRank < 0 ? exchangeOrder.length : aRank) - (bRank < 0 ? exchangeOrder.length : bRank);
  })[0];
}

async function fetchScannerComparisons(symbols: string[]): Promise<StockComparisonData[]> {
  const tickerNames = Array.from(new Set(symbols.map(tickerPart)));
  const response = await fetch(TRADINGVIEW_SCANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: [{ left: "name", operation: "in_range", right: tickerNames }],
      symbols: { query: { types: [] } },
      columns: TRADINGVIEW_COLUMNS,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Market comparison provider returned HTTP " + response.status);

  const payload: unknown = await response.json();
  const rows = payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)
    ? payload.data.filter((row): row is TradingViewScanRow => Boolean(row) && typeof row === "object")
    : [];

  return symbols.flatMap((symbol) => {
    const row = selectScannerRow(rows, symbol);
    const comparison = row ? scannerRowToComparison(row, symbol) : null;
    if (!comparison) return [];
    setCache("comparison_" + symbol, comparison);
    return [comparison];
  });
}

export async function fetchStockComparison(symbol: string): Promise<StockComparisonData> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const cached = getCached("comparison_" + normalizedSymbol);
  if (cached) return cached as StockComparisonData;
  const comparison = (await fetchScannerComparisons([normalizedSymbol]))[0];
  if (!comparison) throw new Error("No comparison data for " + normalizedSymbol);
  return comparison;
}

export async function fetchStockComparisons(symbols: string[]): Promise<StockComparisonData[]> {
  const uniqueSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)));
  const cached = new Map<string, StockComparisonData>();
  const missing: string[] = [];
  for (const symbol of uniqueSymbols) {
    const value = getCached("comparison_" + symbol);
    if (value) cached.set(symbol, value as StockComparisonData);
    else missing.push(symbol);
  }

  const fetched = missing.length ? await fetchScannerComparisons(missing) : [];
  for (const comparison of fetched) cached.set(comparison.symbol, comparison);
  return uniqueSymbols.flatMap((symbol) => {
    const comparison = cached.get(symbol);
    return comparison ? [comparison] : [];
  });
}

const DIV_CACHE_TTL = 3600_000; // 1 hour

/**
 * Live fundamentals for one symbol.
 *
 * Served by /api/market?kind=fundamentals, which reads TradingView's public
 * scanner. The previous provider's endpoint now requires an authenticated
 * session and 401s for everyone, which silently left the panel showing
 * hardcoded figures that had drifted from reality.
 *
 * TradingView populates yield, expense ratio and AUM for ETFs but genuinely
 * returns nothing for per-share dividend, ex-dividend date, payout frequency
 * or P/E. Those stay 0/"" here, and the UI renders them as unknown rather than
 * inventing a value — a zero in this shape means "not reported", never "zero".
 */
/** One line of an ETF's published holdings. */
export interface EtfHolding {
  symbol: string;
  name: string;
  /** Fraction of the fund, e.g. 0.0755 = 7.55%. */
  weight: number;
}

/** What a fund actually owns, as the issuer last reported it. */
export interface EtfComposition {
  symbol: string;
  holdings: EtfHolding[];
  /** Sector weights, largest first. Empty when the provider gives none. */
  sectors: Array<{ sector: string; weight: number }>;
}

/**
 * Live holdings for an ETF.
 *
 * Returns null for anything that is not a fund — a single company has no
 * holdings, and that is an answer rather than a failure the caller should
 * retry. Cached for the same period as the other slow-moving fund data.
 */
export async function fetchEtfComposition(symbol: string): Promise<EtfComposition | null> {
  const cacheKey = "holdings_" + symbol;
  const cached = getCached(cacheKey, DIV_CACHE_TTL);
  if (cached) return cached as EtfComposition;

  let text: string;
  try {
    text = await fetchMarketData("holdings", symbol);
  } catch {
    return null;
  }
  const json = JSON.parse(text) as {
    holdings?: unknown;
    sectors?: unknown;
  };
  const holdings = (Array.isArray(json.holdings) ? json.holdings : [])
    .filter((item): item is EtfHolding =>
      Boolean(item) && typeof (item as EtfHolding).symbol === "string"
      && typeof (item as EtfHolding).weight === "number");
  const sectors = (Array.isArray(json.sectors) ? json.sectors : [])
    .filter((item): item is { sector: string; weight: number } =>
      Boolean(item) && typeof (item as { sector: string }).sector === "string"
      && typeof (item as { weight: number }).weight === "number");
  if (holdings.length === 0 && sectors.length === 0) return null;

  const composition: EtfComposition = { symbol, holdings, sectors };
  setCache(cacheKey, composition);
  return composition;
}

export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const cacheKey = "fund_" + symbol;
  const cached = getCached(cacheKey, DIV_CACHE_TTL);
  if (cached) return cached as Fundamentals;

  const text = await fetchMarketData("fundamentals", symbol);
  const json = JSON.parse(text);
  const raw = json?.fundamentals;
  if (!raw) throw new Error("No fundamentals for " + symbol);

  const numeric = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  // TradingView reports yield and expense ratio as percentages (1.043 = 1.043%);
  // this interface has always carried them as fractions (0.01043).
  const dividendYield = numeric(raw.dividends_yield) / 100;
  const close = numeric(raw.close);

  const fund: Fundamentals = {
    symbol,
    dividendYield,
    // Annual $ per share is not reported directly, but it is what the yield is
    // defined against, so deriving it from yield x price is exact rather than
    // a guess. Zero when either input is missing.
    dividendRate: dividendYield > 0 && close > 0 ? dividendYield * close : 0,
    trailingPE: 0,
    exDividendDate: "",
    exDividendTimestamp: 0,
    dividendFrequency: "",
    fiveYearAvgDividendYield: 0,
    marketCap: 0,
    trailingAnnualDividendRate: dividendYield > 0 && close > 0 ? dividendYield * close : 0,
    trailingAnnualDividendYield: dividendYield,
    expenseRatio: numeric(raw.expense_ratio) / 100,
    totalAssets: numeric(raw.aum),
    ytdReturn: null,
    threeYearReturn: null,
    fiveYearReturn: null,
  };

  setCache(cacheKey, fund);
  return fund;
}

// --- Historical prices for risk calculation ---

export interface HistoricalPrice {
  date: string;   // "2026-01-15"
  close: number;
}

export async function fetchHistoricalPrices(symbol: string, range = "1y"): Promise<HistoricalPrice[]> {
  const cacheKey = "hist_" + symbol + "_" + range;
  const cached = getCached(cacheKey, DIV_CACHE_TTL);
  if (cached) return cached as HistoricalPrice[];

  const text = await fetchMarketData("history", symbol, range);
  const json = JSON.parse(text);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No history for " + symbol);

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

  const prices: HistoricalPrice[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      const d = new Date(timestamps[i] * 1000);
      prices.push({
        date: d.toISOString().slice(0, 10),
        close: closes[i],
      });
    }
  }

  setCache(cacheKey, prices);
  return prices;
}

// --- Risk metrics calculation ---

export interface RiskMetrics {
  maxDrawdown: number;        // -0.339 = -33.9%
  currentDrawdown: number;    // from ATH
  sharpeRatio: number;
  beta: number;               // vs SPY
  volatility: number;         // annualized
  winRate: number;            // positive months %
}

export function calcRiskMetrics(prices: HistoricalPrice[], benchmarkPrices?: HistoricalPrice[]): RiskMetrics {
  if (prices.length < 2) return { maxDrawdown: 0, currentDrawdown: 0, sharpeRatio: 0, beta: 1, volatility: 0, winRate: 0 };

  // Daily returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i].close - prices[i - 1].close) / prices[i - 1].close);
  }

  // Max drawdown
  let peak = prices[0].close;
  let maxDD = 0;
  for (const p of prices) {
    if (p.close > peak) peak = p.close;
    const dd = (p.close - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  // Current drawdown
  const lastPrice = prices[prices.length - 1].close;
  let allTimeHigh = 0;
  for (const p of prices) {
    if (p.close > allTimeHigh) allTimeHigh = p.close;
  }
  const currentDD = allTimeHigh > 0 ? (lastPrice - allTimeHigh) / allTimeHigh : 0;

  // Volatility (annualized)
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  const annualVol = dailyVol * Math.sqrt(252);

  // Sharpe ratio (assume risk-free = 4.5%)
  const annualReturn = mean * 252;
  const riskFree = 0.045;
  const sharpe = annualVol > 0 ? (annualReturn - riskFree) / annualVol : 0;

  // Beta vs benchmark — align by date to handle mismatched histories
  let beta = 1;
  if (benchmarkPrices && benchmarkPrices.length >= 2) {
    const benchMap = new Map(benchmarkPrices.map((p) => [p.date, p.close]));
    // Build aligned price series using only dates present in both
    const alignedPrices: number[] = [];
    const alignedBenchPrices: number[] = [];
    for (const p of prices) {
      const benchClose = benchMap.get(p.date);
      if (benchClose !== undefined) {
        alignedPrices.push(p.close);
        alignedBenchPrices.push(benchClose);
      }
    }
    if (alignedPrices.length >= 2) {
      const alignedReturns: number[] = [];
      const benchReturns: number[] = [];
      for (let i = 1; i < alignedPrices.length; i++) {
        alignedReturns.push((alignedPrices[i] - alignedPrices[i - 1]) / alignedPrices[i - 1]);
        benchReturns.push((alignedBenchPrices[i] - alignedBenchPrices[i - 1]) / alignedBenchPrices[i - 1]);
      }
      const aMean = alignedReturns.reduce((s, r) => s + r, 0) / alignedReturns.length;
      const bMean = benchReturns.reduce((s, r) => s + r, 0) / benchReturns.length;
      let covariance = 0;
      let benchVariance = 0;
      for (let i = 0; i < alignedReturns.length; i++) {
        covariance += (alignedReturns[i] - aMean) * (benchReturns[i] - bMean);
        benchVariance += (benchReturns[i] - bMean) ** 2;
      }
      covariance /= alignedReturns.length;
      benchVariance /= alignedReturns.length;
      beta = benchVariance > 0 ? covariance / benchVariance : 1;
    }
  }

  // Win rate (positive months)
  const monthlyReturns = new Map<string, number>();
  for (const p of prices) {
    const month = p.date.slice(0, 7); // "2026-01"
    monthlyReturns.set(month, p.close);
  }
  const monthCloses = Array.from(monthlyReturns.values());
  let positiveMonths = 0;
  for (let i = 1; i < monthCloses.length; i++) {
    if (monthCloses[i] > monthCloses[i - 1]) positiveMonths++;
  }
  const winRate = monthCloses.length > 1 ? positiveMonths / (monthCloses.length - 1) : 0;

  return {
    maxDrawdown: maxDD,
    currentDrawdown: currentDD,
    sharpeRatio: sharpe,
    beta,
    volatility: annualVol,
    winRate,
  };
}