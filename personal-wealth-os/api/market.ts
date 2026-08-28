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

/**
 * ETF holdings and sector weights, via Yahoo's quoteSummary.
 *
 * That endpoint answers "Invalid Crumb" to an anonymous request, which an
 * earlier round read as "gone" — it is not. It wants a session: one request to
 * pick up a cookie, one to trade that cookie for a crumb, then the real call
 * carrying both. The crumb is reused until it stops working, so the ordinary
 * request costs nothing extra.
 *
 * Worth the two extra requests because nothing else has this. TradingView's
 * scanner returns null for every holdings and sector column, and the fund
 * issuers' own endpoints are per-issuer (Vanguard answers for VOO, not QQQM).
 * This is the one source that covers every ETF the app tracks.
 */
const YAHOO_SUMMARY = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";
const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
let yahooSession: { cookie: string; crumb: string } | null = null;

async function openYahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  const seed = await fetch("https://fc.yahoo.com", {
    headers: { "user-agent": YAHOO_UA },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  // The seed request is expected to fail as a page; only its Set-Cookie matters.
  const cookie = (seed.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) return null;
  const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "user-agent": YAHOO_UA, cookie },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!crumbResponse.ok) return null;
  const crumb = (await crumbResponse.text()).trim();
  // A crumb with markup in it is an error page, not a token.
  if (!crumb || crumb.length > 64 || crumb.includes("<")) return null;
  return { cookie, crumb };
}

interface HoldingsPayload {
  asOfLabel: string | null;
  holdings: Array<{ symbol: string; name: string; weight: number }>;
  sectors: Array<{ sector: string; weight: number }>;
}

function readTopHoldings(raw: unknown): HoldingsPayload | null {
  const result = (raw as { quoteSummary?: { result?: unknown[] } })?.quoteSummary?.result;
  const top = Array.isArray(result)
    ? (result[0] as { topHoldings?: Record<string, unknown> } | undefined)?.topHoldings
    : undefined;
  if (!top) return null;

  const num = (value: unknown): number | null => {
    const raw = (value as { raw?: unknown } | undefined)?.raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  };

  const holdings = (Array.isArray(top.holdings) ? top.holdings : [])
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      const weight = num(item.holdingPercent);
      const symbol = typeof item.symbol === "string" ? item.symbol : "";
      if (weight === null || !symbol) return null;
      return {
        symbol,
        name: typeof item.holdingName === "string" ? item.holdingName : symbol,
        weight,
      };
    })
    .filter((item): item is { symbol: string; name: string; weight: number } => item !== null);

  // Sector weights arrive as an array of single-key objects.
  const sectors = (Array.isArray(top.sectorWeightings) ? top.sectorWeightings : [])
    .map((entry) => {
      const pair = Object.entries(entry as Record<string, unknown>)[0];
      if (!pair) return null;
      const weight = num(pair[1]);
      if (weight === null || weight <= 0) return null;
      return { sector: pair[0], weight };
    })
    .filter((item): item is { sector: string; weight: number } => item !== null)
    .sort((a, b) => b.weight - a.weight);

  if (holdings.length === 0 && sectors.length === 0) return null;
  return { asOfLabel: null, holdings, sectors };
}

async function fetchYahooHoldings(symbol: string): Promise<HoldingsPayload | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!yahooSession) yahooSession = await openYahooSession();
    if (!yahooSession) return null;
    const url = `${YAHOO_SUMMARY}/${encodeURIComponent(symbol)}`
      + `?modules=topHoldings&crumb=${encodeURIComponent(yahooSession.crumb)}`;
    const response = await fetch(url, {
      headers: { "user-agent": YAHOO_UA, cookie: yahooSession.cookie },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      // The session went stale. Drop it and try once with a fresh one.
      yahooSession = null;
      continue;
    }
    if (!response.ok) return null;
    return readTopHoldings(await response.json());
  }
  return null;
}

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

  if (kind === "holdings") {
    try {
      const holdings = await fetchYahooHoldings(symbol);
      if (!holdings) {
        // A stock has no holdings, and that is an answer, not a failure.
        response.status(404).json({ error: "no holdings available" });
        return;
      }
      // Holdings are restated monthly at most; a stale hour costs nothing.
      response.setHeader("Cache-Control", "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400");
      response.status(200).json({ symbol, ...holdings });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error";
      response.status(504).json({ error: reason });
    }
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
    response.status(400).json({ error: "kind must be 'fundamentals', 'holdings' or 'history'" });
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
