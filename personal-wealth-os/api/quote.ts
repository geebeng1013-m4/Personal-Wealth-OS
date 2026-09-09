import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAllowedOrigin } from "./_originGuard.js";
import { checkRateLimit } from "./_rateLimit.js";

/**
 * Server-side quote proxy.
 *
 * The browser cannot call Yahoo Finance directly (no CORS headers), and the
 * anonymous CORS proxies the client used to fall back on have all stopped
 * working — corsproxy.io now rejects keyless requests with 403, the others
 * time out. Called from a server there is no CORS involved at all, so this
 * route is the reliable path to a price.
 *
 * It is a read-only passthrough for a public endpoint: no API key, no secret,
 * no user data, and nothing is persisted. A quote that cannot be established
 * is reported as unavailable rather than as a zero price — a fabricated
 * valuation is worse than a missing one.
 */

const UPSTREAM = "https://query1.finance.yahoo.com/v8/finance/chart";
const MAX_SYMBOLS = 12;
const UPSTREAM_TIMEOUT_MS = 8000;
/**
 * Quotes are 15-minute-delayed anyway, so a 60s shared cache collapses a burst
 * of page-loads into one upstream call without anyone seeing a staler number
 * than the upstream itself serves.
 */
const CACHE_SECONDS = 60;

/**
 * Per-IP request budget. The app refreshing every open page's prices makes a
 * handful of calls a minute; 40 leaves a user with several tabs generous room
 * while still cutting off a script in a loop. Best-effort, not a hard
 * cluster-wide cap — see _rateLimit.ts.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 40;

export interface QuotePayload {
  symbol: string;
  /** Always a finite number greater than zero. Absent when no price could be established. */
  price?: number;
  currency?: string;
  marketState?: string;
  shortName?: string;
  previousClose?: number;
  /** Milliseconds since epoch, from the upstream quote. */
  quotedAt?: number;
  /** Present only when this symbol could not be priced. */
  error?: string;
}

/** Yahoo tickers: letters, digits and the few punctuation marks real symbols use. */
function isValidSymbol(value: string): boolean {
  return /^[A-Za-z0-9.^:-]{1,20}$/.test(value);
}

/**
 * A price is only a price when it is a finite number above zero. Yahoo returns
 * nulls and occasionally zeros for delisted or halted symbols, and treating
 * either as "worth nothing" would misreport a real holding.
 */
function toPrice(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Turn a parsed Yahoo chart response into a QuotePayload.
 *
 * Pure and total: any shape Yahoo did not promise — a renamed key, a missing
 * nesting level, a string where an object was expected, an HTML error page
 * parsed to a bare string — resolves to `{ symbol, error }`, never to a
 * fabricated price. This is the seam the upstream-resilience tests exercise;
 * fetchOne only does the network and hands the result here.
 */
export function parseYahooQuote(json: unknown, symbol: string): QuotePayload {
  const meta = (json as { chart?: { result?: Array<{ meta?: unknown }> } } | null | undefined)
    ?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta !== "object") return { symbol, error: "no data" };
  const m = meta as Record<string, unknown>;

  const price = toPrice(m.regularMarketPrice);
  if (price === undefined) return { symbol, error: "no price" };

  const quotedAt = typeof m.regularMarketTime === "number" && Number.isFinite(m.regularMarketTime)
    ? m.regularMarketTime * 1000
    : Date.now();

  const previousClose = toPrice(m.chartPreviousClose ?? m.previousClose);
  return {
    // Strip any exchange prefix ("AMEX:QQQM" -> "QQQM") so it matches the ticker on file.
    symbol: (toText(m.symbol) ?? symbol).replace(/^[A-Za-z]+:/, "").toUpperCase(),
    price,
    currency: toText(m.currency) ?? "USD",
    marketState: toText(m.marketState) ?? "UNKNOWN",
    shortName: toText(m.shortName) ?? symbol,
    ...(previousClose !== undefined ? { previousClose } : {}),
    quotedAt,
  };
}

async function fetchOne(symbol: string): Promise<QuotePayload> {
  const url = `${UPSTREAM}/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        // Yahoo rejects requests without a browser-like agent.
        "user-agent": "Mozilla/5.0 (compatible; WealthUp/1.0)",
        accept: "application/json",
      },
    });
    if (!response.ok) return { symbol, error: `upstream ${response.status}` };

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      // A 200 that is not JSON — an HTML block page, an empty body.
      return { symbol, error: "bad json" };
    }
    return parseYahooQuote(json, symbol);
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error";
    return { symbol, error: reason };
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!isAllowedOrigin(request)) {
    response.status(403).json({ error: "Forbidden" });
    return;
  }

  const rate = checkRateLimit(request, { bucket: "quote", windowMs: RATE_WINDOW_MS, max: RATE_MAX });
  response.setHeader("RateLimit-Limit", String(rate.limit));
  response.setHeader("RateLimit-Remaining", String(rate.remaining));
  response.setHeader("RateLimit-Reset", String(rate.resetSec));
  if (!rate.ok) {
    response.setHeader("Retry-After", String(rate.retryAfterSec));
    response.status(429).json({ error: "Too many requests" });
    return;
  }

  const raw = request.query.symbols ?? request.query.symbol;
  const requested = (Array.isArray(raw) ? raw.join(",") : raw ?? "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);

  if (requested.length === 0) {
    response.status(400).json({ error: "Provide ?symbols=VOO,QQQM" });
    return;
  }
  if (requested.length > MAX_SYMBOLS) {
    response.status(400).json({ error: `At most ${MAX_SYMBOLS} symbols per request` });
    return;
  }

  const unique = [...new Set(requested)];
  const invalid = unique.filter((symbol) => !isValidSymbol(symbol));
  if (invalid.length > 0) {
    response.status(400).json({ error: `Invalid symbol: ${invalid[0]}` });
    return;
  }

  const quotes = await Promise.all(unique.map(fetchOne));

  // Cached at the edge so several pages opening at once cost one upstream call.
  response.setHeader("Cache-Control", `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=300`);
  response.status(200).json({ quotes });
}
