// Market data module — fetches VOO/QQQM quotes from Yahoo Finance
// K-line chart powered by TradingView Widget

import { calculatePositionCostBasis, tradeUnits, type CostBasisTrade } from "./rules";
import { isUsablePrice, normalizeQuotes, type PriceMap } from "./marketPrices";

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
 * Fallback fetcher for the secondary market features (fundamentals, history).
 *
 * These public proxies are unreliable — corsproxy.io now rejects keyless
 * requests and the others frequently time out — so anything that must be
 * correct goes through the dedicated /api/quote route instead. This path is
 * deliberately NOT a general server-side proxy: forwarding arbitrary URLs from
 * the browser would be an open relay.
 */
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

/**
 * Fetch a secondary market dataset through the server-side route.
 *
 * The browser cannot call the upstream directly, so this is the only path that
 * works. It falls back to the old public-proxy chain purely for environments
 * where /api is not deployed; those proxies are unreliable, so a failure here
 * simply means the panel stays empty rather than showing invented data.
 */
async function fetchMarketData(kind: "fundamentals" | "history", symbol: string, range?: string): Promise<string> {
  const query = new URLSearchParams({ kind, symbol });
  if (range) query.set("range", range);
  try {
    const response = await fetch(`/api/market?${query.toString()}`, {
      signal: AbortSignal.timeout(12_000),
      headers: { accept: "application/json" },
    });
    if (response.ok) return await response.text();
  } catch { /* fall through to the legacy path */ }

  const upstream = kind === "fundamentals"
    ? `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics`
    : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range ?? "1y"}&interval=1d`;
  return fetchWithProxy(upstream);
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

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
  const text = await fetchWithProxy(url);
  const json = JSON.parse(text);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No data for " + symbol);

  const meta = result.meta;
  // Strip exchange prefix (e.g. "AMEX:QQQM" → "QQQM")
  const cleanSymbol = (meta.symbol ?? symbol).replace(/^[A-Z]+:/, "");
  // A missing or non-positive price means "unknown", never "worth zero", so
  // the quote is rejected rather than published with a fabricated 0.
  if (!isUsablePrice(meta.regularMarketPrice)) throw new Error("No price for " + symbol);
  const quote: MarketQuote = {
    symbol: cleanSymbol,
    price: meta.regularMarketPrice,
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

// --- Trade Timeline HTML ---

interface TradeForTimeline {
  ticker: string;
  date: string;
  type: CostBasisTrade["type"];
  priceUsd: number;
  amountUsd: number;
  amountMyr: number;
  units?: number;
  feeMyr: number;
}

function timelineDate(raw: string, dateOnlyTime: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T${dateOnlyTime}Z` : raw);
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
  const minDate = timelineDate(sorted[0].date, "00:00:00");
  const maxDate = timelineDate(sorted[sorted.length - 1].date, "00:00:00");

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
    const posMs = timelineDate(t.date, "16:00:00").getTime();
    const leftPct = rangeMs > 0 ? ((posMs - startMs) / rangeMs) * 100 : 50;
    const priceTopPct = priceRange > 0 ? ((maxPrice - t.priceUsd) / priceRange) * 100 : 50;
    const units = tradeUnits(t).toFixed(4);
    const safeDate = escapeHtml(t.date);

    return `<div class="tl-marker" style="left:${leftPct.toFixed(1)}%;top:${priceTopPct.toFixed(1)}%;" title="${safeDate}\n${isBuy ? "Buy" : "Sell"} ${units} units @ $${t.priceUsd.toFixed(2)}">
      <span class="tl-dot ${isBuy ? "tl-buy" : "tl-sell"}">${isBuy ? "\u2191" : "\u2193"}</span>
      <span class="tl-label">${isBuy ? "B" : "S"} ${units} @ $${t.priceUsd.toFixed(0)}</span>
    </div>`;
  }).join("");

  // Date labels
  const dateLabels = sorted.map((t) => {
    const posMs = timelineDate(t.date, "16:00:00").getTime();
    const leftPct = rangeMs > 0 ? ((posMs - startMs) / rangeMs) * 100 : 50;
    const d = timelineDate(t.date, "00:00:00");
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
    ytdReturn: 0,
    threeYearReturn: 0,
    fiveYearReturn: 0,
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