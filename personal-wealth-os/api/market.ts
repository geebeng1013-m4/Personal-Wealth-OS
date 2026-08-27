import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Server-side market-data passthrough for the Market page's secondary panels
 * (fundamentals and price history).
 *
 * Same reasoning as api/quote: the browser cannot reach the upstream directly
 * (no CORS headers) and the anonymous CORS proxies the client fell back on have
 * all stopped working, so these panels never loaded. From a server there is no
 * CORS at all.
 *
 * Deliberately NOT a general proxy. The caller chooses a `kind` from a fixed
 * set and supplies a validated symbol; the upstream URL is built here. An
 * endpoint that forwarded an arbitrary `url` would be an open relay.
 */

const MAX_SYMBOL_LENGTH = 20;
const UPSTREAM_TIMEOUT_MS = 8000;
/** Fundamentals and daily history move slowly; cache them harder than quotes. */
const CACHE_SECONDS = 900;

const RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]);

const TRADINGVIEW_SCANNER_URL = "https://scanner.tradingview.com/america/scan";
/**
 * The fields TradingView actually populates for the ETFs this app tracks.
 * Probed directly: yield, AUM, expense ratio and price come back with real
 * values, while per-share dividend, ex-dividend date, payout frequency and P/E
 * are all null for ETFs. Only the working ones are requested, and anything the
 * provider cannot answer stays unknown rather than being filled with a guess.
 */
const TRADINGVIEW_FUNDAMENTAL_COLUMNS = [
  "dividends_yield",
  "expense_ratio",
  "aum",
  "close",
  "currency",
] as const;

function isValidSymbol(value: string): boolean {
  return new RegExp(`^[A-Za-z0-9.^:-]{1,${MAX_SYMBOL_LENGTH}}$`).test(value);
}

/**
 * Live fundamentals via TradingView's public scanner.
 *
 * Replaces the previous upstream, whose quoteSummary endpoint now requires an
 * authenticated session and returns 401 for everyone — which meant the panel
 * silently fell back to hardcoded figures that had drifted from reality (a
 * hardcoded 1.32% yield for VOO against a real 1.04%).
 */
async function fetchTradingViewFundamentals(symbol: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(TRADINGVIEW_SCANNER_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      filter: [{ left: "name", operation: "in_range", right: [symbol] }],
      symbols: { query: { types: [] } },
      columns: TRADINGVIEW_FUNDAMENTAL_COLUMNS,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as { data?: Array<{ s?: string; d?: unknown[] }> };
  // The scanner matches on the plain ticker but answers with an exchange-
  // qualified symbol ("AMEX:VOO"), so match on the suffix rather than equality.
  const row = payload?.data?.find((entry) => (entry?.s ?? "").split(":").pop()?.toUpperCase() === symbol);
  if (!row?.d) return null;

  const out: Record<string, unknown> = {};
  TRADINGVIEW_FUNDAMENTAL_COLUMNS.forEach((column, index) => {
    const value = row.d![index];
    if (value !== null && value !== undefined) out[column] = value;
  });
  return Object.keys(out).length > 0 ? out : null;
}

/** Only "history" is a plain GET passthrough; "fundamentals" has its own path. */
function upstreamFor(kind: string, symbol: string, range: string): string | null {
  const ticker = encodeURIComponent(symbol);
  if (kind === "history") {
    return `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${encodeURIComponent(range)}&interval=1d`;
  }
  return null;
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const read = (key: string): string => {
    const raw = request.query[key];
    return (Array.isArray(raw) ? raw[0] : raw ?? "").trim();
  };

  const kind = read("kind");
  const symbol = read("symbol").toUpperCase();
  const range = read("range") || "1y";

  if (!symbol) {
    response.status(400).json({ error: "Provide ?symbol=VOO" });
    return;
  }
  if (!isValidSymbol(symbol)) {
    response.status(400).json({ error: `Invalid symbol: ${symbol}` });
    return;
  }
  if (kind === "history" && !RANGES.has(range)) {
    response.status(400).json({ error: `Unsupported range: ${range}` });
    return;
  }

  if (kind === "fundamentals") {
    try {
      const fundamentals = await fetchTradingViewFundamentals(symbol);
      if (!fundamentals) {
        response.status(502).json({ error: "no fundamentals available" });
        return;
      }
      response.setHeader("Cache-Control", `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600`);
      response.status(200).json({ symbol, fundamentals });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error";
      response.status(504).json({ error: reason });
    }
    return;
  }

  const upstream = upstreamFor(kind, symbol, range);
  if (!upstream) {
    response.status(400).json({ error: "kind must be 'fundamentals' or 'history'" });
    return;
  }

  try {
    const upstreamResponse = await fetch(upstream, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; WealthUp/1.0)",
        accept: "application/json",
      },
    });
    if (!upstreamResponse.ok) {
      response.status(502).json({ error: `upstream ${upstreamResponse.status}` });
      return;
    }
    const body = await upstreamResponse.text();
    response.setHeader("Cache-Control", `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600`);
    response.setHeader("content-type", "application/json");
    response.status(200).send(body);
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error";
    response.status(504).json({ error: reason });
  }
}
