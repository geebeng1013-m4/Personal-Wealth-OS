// Market data module — fetches VOO/QQQM quotes from Yahoo Finance
// K-line chart powered by TradingView Widget

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
  feeMyr: number;
}

export function calcPnLForTicker(
  trades: { ticker: string; date: string; type: string; amountUsd: number; amountMyr: number; priceUsd: number; feeMyr: number }[],
  ticker: string,
  currentPriceUsd: number,
  usdToMyr = 4.25,
): PortfolioPnL {
  const filtered = trades.filter((t) => t.ticker === ticker);
  let totalUnits = 0;
  let totalInvestedUsd = 0;
  let totalInvestedMyr = 0;
  let feeMyr = 0;

  for (const t of filtered) {
    const dir = t.type === "Sell" ? -1 : 1;
    const units = t.priceUsd > 0 ? t.amountUsd / t.priceUsd : 0;
    totalUnits += dir * units;
    totalInvestedUsd += dir * t.amountUsd;
    totalInvestedMyr += dir * (t.amountMyr + t.feeMyr);
    feeMyr += t.feeMyr;
  }

  const avgCost = totalUnits > 0 ? totalInvestedUsd / totalUnits : 0;
  const currentValueUsd = totalUnits * currentPriceUsd;
  const currentValueMyr = currentValueUsd * usdToMyr;
  const pnlUsd = currentValueUsd - totalInvestedUsd;
  const pnlMyr = currentValueMyr - totalInvestedMyr;
  const pnlPct = totalInvestedUsd > 0 ? pnlUsd / totalInvestedUsd : 0;

  return {
    ticker,
    totalUnits,
    totalInvestedUsd,
    totalInvestedMyr,
    averageCostUsd: round2(avgCost),
    currentPriceUsd,
    currentValueUsd: round2(currentValueUsd),
    currentValueMyr: round2(currentValueMyr),
    unrealizedPnlUsd: round2(pnlUsd),
    unrealizedPnlMyr: round2(pnlMyr),
    unrealizedPnlPct: round2(pnlPct),
    feeMyr: round2(feeMyr),
  };
}

// --- Trade Timeline HTML ---

interface TradeForTimeline {
  ticker: string;
  date: string;
  type: string;
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

  const pnl = calcPnLForTicker(trades, ticker, currentPriceUsd, 4.25);
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
  const markers = sorted.map((t) => {
    const isBuy = t.type !== "Sell";
    const posMs = new Date(t.date + "T16:00:00Z").getTime();
    const leftPct = rangeMs > 0 ? ((posMs - startMs) / rangeMs) * 100 : 50;
    const priceTopPct = priceRange > 0 ? ((maxPrice - t.priceUsd) / priceRange) * 100 : 50;
    const units = t.priceUsd > 0 ? (t.amountUsd / t.priceUsd).toFixed(3) : "0";

    return `<div class="tl-marker" style="left:${leftPct.toFixed(1)}%;top:${priceTopPct.toFixed(1)}%;" title="${t.date}\n${isBuy ? "Buy" : "Sell"} ${units} units @ $${t.priceUsd.toFixed(2)}">
      <span class="tl-dot ${isBuy ? "tl-buy" : "tl-sell"}">${isBuy ? "↑" : "↓"}</span>
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
      <span class="tl-title">📊 Trade Timeline — ${ticker}</span>
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