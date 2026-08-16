// Market data module — fetches VOO/QQQM quotes from Yahoo Finance
// K-line chart powered by TradingView Widget

import { calculatePositionCostBasis, type CostBasisTrade } from "./rules";

/** Default fallback USD→MYR rate when all dynamic sources fail. */
const DEFAULT_USD_MYR = 4.25;

/** Cached USD→MYR exchange rate. */
let cachedUsdToMyr: number | null = null;
let cachedUsdToMyrTimestamp = 0;
const FX_CACHE_TTL = 3600_000; // 1 hour

/**
 * Fetch the current USD→MYR exchange rate.
 * Tries a free exchange-rate API with a 1-hour cache, then falls back to the
 * most-recent trade rate if available, then to DEFAULT_USD_MYR.
 */
export async function fetchUsdToMyr(trades?: { exchangeRate?: number; date: string }[]): Promise<number> {
  // 1. Return cached if fresh
  if (cachedUsdToMyr !== null && Date.now() - cachedUsdToMyrTimestamp < FX_CACHE_TTL) {
    return cachedUsdToMyr;
  }
  // 2. Try a free exchange-rate API
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
  } catch { /* fall through */ }

  // 3. Derive from the most recent trade that has a valid exchangeRate
  if (trades && trades.length > 0) {
    const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date));
    for (const t of sorted) {
      if (typeof t.exchangeRate === "number" && t.exchangeRate > 0) {
        return t.exchangeRate;
      }
    }
  }

  // 4. Hard-coded last resort
  return DEFAULT_USD_MYR;
}

/**
 * Synchronous getter for the cached USD→MYR rate.
 * Returns the cached dynamic rate if available, otherwise falls back to DEFAULT_USD_MYR.
 * Call fetchUsdToMyr() early in the app lifecycle to populate the cache.
 */
export function getUsdToMyr(): number {
  return cachedUsdToMyr ?? DEFAULT_USD_MYR;
}

/** Pure string HTML-escape — safe for non-DOM environments. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "\x26": return "\x26amp;";
      case "<": return "\x26lt;";
      case ">": return "\x26gt;";
      case "\x22": return "\x26quot;";
      case "\x27": return "\x26#39;";
      default: return ch;
    }
  });
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

const CORS_PROXIES = [
  "https://api.allorigins.win/raw?url=",
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=",
];

const CACHE_KEY = "pwo_market_cache";
const CACHE_TTL = 30_000; // 30 seconds — fresher quotes for P&L accuracy

interface CacheEntry {
  timestamp: number;
  data: unknown;
}

function getCached(key: string): unknown | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY + "_" + key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL) return null;
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

async function fetchWithProxy(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return await res.text();
  } catch { /* fall through to proxy */ }

  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetch(proxy + encodeURIComponent(url), { signal: AbortSignal.timeout(15000) });
      if (res.ok) return await res.text();
    } catch { /* try next proxy */ }
  }

  throw new Error("Unable to fetch market data — network error");
}

export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const cacheKey = "quote_" + symbol;
  const cached = getCached(cacheKey);
  if (cached) return cached as MarketQuote;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
  const text = await fetchWithProxy(url);
  const json = JSON.parse(text);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No data for " + symbol);

  const meta = result.meta;
  // Strip exchange prefix (e.g. "AMEX:QQQM" → "QQQM")
  const cleanSymbol = (meta.symbol ?? symbol).replace(/^[A-Z]+:/, "");
  const quote: MarketQuote = {
    symbol: cleanSymbol,
    price: meta.regularMarketPrice ?? 0,
    change: (meta.regularMarketPrice ?? 0) - (meta.chartPreviousClose ?? meta.previousClose ?? 0),
    changePercent: 0,
    open: meta.regularMarketOpen ?? 0,
    high: meta.regularMarketDayHigh ?? 0,
    low: meta.regularMarketDayLow ?? 0,
    prevClose: meta.chartPreviousClose ?? meta.previousClose ?? 0,
    volume: meta.regularMarketVolume ?? 0,
    marketState: meta.marketState ?? "UNKNOWN",
    shortName: meta.shortName ?? symbol,
    currency: meta.currency ?? "USD",
  };
  if (quote.prevClose > 0) {
    quote.changePercent = ((quote.price - quote.prevClose) / quote.prevClose) * 100;
  }

  setCache(cacheKey, quote);
  return quote;
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

// --- Trade Timeline HTML ---

interface TradeForTimeline {
  ticker: string;
  date: string;
  type: CostBasisTrade["type"];
  priceUsd: number;
  amountUsd: number;
  amountMyr: number;
  feeMyr: number;
}

export function buildTradeTimelineHtml(
  trades: TradeForTimeline[],
  ticker: string,
  currentPriceUsd: number,
): string {
  const filtered = trades.filter((t) => t.ticker === ticker);
  if (filtered.length === 0) return "";

  const pnl = calcPnLForTicker(trades, ticker, currentPriceUsd, getUsdToMyr());
  const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
  const minDate = new Date(sorted[0].date + "T00:00:00Z");
  const maxDate = new Date(sorted[sorted.length - 1].date + "T00:00:00Z");

  // Add some padding
  const padMs = Math.max((maxDate.getTime() - minDate.getTime()) * 0.05, 86400000 * 3);
  const startMs = minDate.getTime() - padMs;
  const endMs = maxDate.getTime() + padMs;
  const rangeMs = endMs - startMs;

  // Cost line position (based on price range)
  const allPrices = sorted.map((t) => t.priceUsd);
  allPrices.push(currentPriceUsd);
  const minPrice = Math.min(...allPrices) * 0.95;
  const maxPrice = Math.max(...allPrices) * 1.05;
  const priceRange = maxPrice - minPrice;

  const costLineTopPct = priceRange > 0 ? ((maxPrice - pnl.averageCostUsd) / priceRange) * 100 : 50;

  // Trade markers
  const safeTicker = escapeHtml(ticker);
  const markers = sorted.map((t) => {
    const isBuy = t.type !== "Sell";
    const posMs = new Date(t.date + "T16:00:00Z").getTime();
    const leftPct = rangeMs > 0 ? ((posMs - startMs) / rangeMs) * 100 : 50;
    const priceTopPct = priceRange > 0 ? ((maxPrice - t.priceUsd) / priceRange) * 100 : 50;
    const units = t.priceUsd > 0 ? (t.amountUsd / t.priceUsd).toFixed(3) : "0";
    const safeDate = escapeHtml(t.date);

    return `<div class="tl-marker" style="left:${leftPct.toFixed(1)}%;top:${priceTopPct.toFixed(1)}%;" title="${safeDate}\n${isBuy ? "Buy" : "Sell"} ${units} units @ $${t.priceUsd.toFixed(2)}">
      <span class="tl-dot ${isBuy ? "tl-buy" : "tl-sell"}">${isBuy ? "\u2191" : "\u2193"}</span>
      <span class="tl-label">${isBuy ? "B" : "S"} ${units} @ $${t.priceUsd.toFixed(0)}</span>
    </div>`;
  }).join("");

  // Date labels
  const dateLabels = sorted.map((t) => {
    const posMs = new Date(t.date + "T16:00:00Z").getTime();
    const leftPct = rangeMs > 0 ? ((posMs - startMs) / rangeMs) * 100 : 50;
    const d = new Date(t.date + "T00:00:00Z");
    const label = (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
    return `<span class="tl-date-label" style="left:${leftPct.toFixed(1)}%">${label}</span>`;
  }).join("");

  return `<div class="trade-timeline">
    <div class="tl-header">
      <span class="tl-title">\ud83d\udcca Trade Timeline \u2014 ${safeTicker}</span>
      <span class="tl-cost-label">Avg Cost $${pnl.averageCostUsd.toFixed(2)}</span>
    </div>
    <div class="tl-body">
      <div class="tl-track">
        <div class="tl-cost-line" style="top:${costLineTopPct.toFixed(1)}%"></div>
        ${markers}
      </div>
      <div class="tl-dates">${dateLabels}</div>
    </div>
  </div>`;
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
  ytdReturn: number;           // e.g. 0.052 = 5.2%
  threeYearReturn: number;
  fiveYearReturn: number;
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

export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const cacheKey = "fund_" + symbol;
  const cached = getCached(cacheKey);
  if (cached) return cached as Fundamentals;

  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics`;
  const text = await fetchWithProxy(url);
  const json = JSON.parse(text);
  const result = json?.quoteSummary?.result?.[0];
  if (!result) throw new Error("No fundamentals for " + symbol);

  const sd = result.summaryDetail ?? {};
  const ks = result.defaultKeyStatistics ?? {};

  const freq = sd.dividendFrequency ?? "Quarterly";

  const fund: Fundamentals = {
    symbol,
    dividendYield: sd.dividendYield ?? 0,
    dividendRate: sd.dividendRate ?? 0,
    trailingPE: sd.trailingPE?.raw ?? ks.trailingPE?.raw ?? 0,
    exDividendDate: sd.exDividendDate?.fmt ?? "",
    exDividendTimestamp: sd.exDividendDate?.raw ?? 0,
    dividendFrequency: typeof freq === "string" ? freq : String(freq),
    fiveYearAvgDividendYield: sd.fiveYearAvgDividendYield?.raw ?? 0,
    marketCap: sd.marketCap?.raw ?? 0,
    trailingAnnualDividendRate: sd.trailingAnnualDividendRate?.raw ?? 0,
    trailingAnnualDividendYield: sd.trailingAnnualDividendYield?.raw ?? 0,
    expenseRatio: ks.expenseRatio?.raw ?? 0,
    totalAssets: sd.totalAssets?.raw ?? ks.totalAssets?.raw ?? 0,
    ytdReturn: ks.ytdReturn?.raw ?? 0,
    threeYearReturn: ks.threeYearReturn?.raw ?? 0,
    fiveYearReturn: ks.fiveYearReturn?.raw ?? 0,
  };

  // Temporarily override cache TTL for fundamentals
  try {
    const entry = { timestamp: Date.now(), data: fund };
    localStorage.setItem(CACHE_KEY + "_" + cacheKey, JSON.stringify(entry));
  } catch { /* ignore */ }
  return fund;
}

// --- Historical prices for risk calculation ---

export interface HistoricalPrice {
  date: string;   // "2026-01-15"
  close: number;
}

export async function fetchHistoricalPrices(symbol: string, range = "1y"): Promise<HistoricalPrice[]> {
  const cacheKey = "hist_" + symbol + "_" + range;
  const cached = getCached(cacheKey);
  if (cached) return cached as HistoricalPrice[];

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const text = await fetchWithProxy(url);
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

  // Cache with longer TTL
  try {
    const entry = { timestamp: Date.now(), data: prices };
    localStorage.setItem(CACHE_KEY + "_" + cacheKey, JSON.stringify(entry));
  } catch { /* ignore */ }
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