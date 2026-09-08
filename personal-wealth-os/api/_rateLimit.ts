import type { VercelRequest } from "@vercel/node";

/**
 * Per-caller rate limiting for this project's market-data proxies.
 *
 * The origin guard (_originGuard.ts) stops another site pointing its front-end
 * at these routes, but it deliberately does nothing about a script or curl,
 * which sends no Origin and looks exactly like the app. This is the piece that
 * puts a ceiling on that caller.
 *
 * SCOPE — read before trusting this:
 *
 *   - The counter lives in this serverless instance's memory. Vercel keeps a
 *     warm instance around and reuses its module scope across invocations, so
 *     one client hammering a warm instance IS caught. But a cold start resets
 *     the counter, and under load Vercel runs several instances side by side,
 *     each with its own count — so the real ceiling is (max x live instances).
 *   - Combined with the origin guard, the edge cache (identical requests never
 *     reach this code at all) and MAX_SYMBOLS, this covers the ordinary abuse
 *     case: one script pulling the same few routes in a loop.
 *   - For a hard, cluster-wide limit, back this with a shared store. Smallest
 *     change: `npm i @upstash/ratelimit @upstash/redis`, then when
 *     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set, swap the body
 *     of checkRateLimit for a `Ratelimit.slidingWindow(max, `${windowMs}ms`)`
 *     call keyed on clientKey(request). The call sites and the 429 handling in
 *     quote.ts / market.ts do not change.
 *
 * Fails toward letting the request through: a limiter that throws must never be
 * what takes the app down.
 */

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the caller may retry. 0 while ok. */
  retryAfterSec: number;
  /** Epoch seconds at which the current window frees a slot. */
  resetSec: number;
}

export interface RateLimitOptions {
  /**
   * Names the budget. Each route gets its own so heavy use of one does not
   * spend another's allowance — the counters live in one shared map.
   */
  bucket: string;
  windowMs: number;
  max: number;
  /** Injectable clock, for tests. Defaults to Date.now(). */
  now?: number;
}

/** key -> timestamps (ms) of the allowed requests still inside the window. */
const hits = new Map<string, number[]>();

/**
 * Bound memory. A flood of spoofed X-Forwarded-For values would otherwise grow
 * this map without limit; past this size the least-recently-touched bucket is
 * dropped (Map keeps insertion order and every touch re-inserts).
 */
const MAX_TRACKED_KEYS = 5000;

/**
 * The caller's identity for limiting: the first hop of X-Forwarded-For, which
 * on Vercel is the real client IP it saw. Falls back to X-Real-IP, then to a
 * single shared "unknown" bucket — a caller we cannot identify is limited
 * alongside every other such caller rather than escaping the limit entirely.
 */
export function clientKey(request: VercelRequest): string {
  const fwd = request.headers?.["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] ?? "" : fwd ?? "").split(",")[0].trim();
  if (first) return first;
  const real = request.headers?.["x-real-ip"];
  const realStr = (Array.isArray(real) ? real[0] ?? "" : real ?? "").trim();
  return realStr || "unknown";
}

/**
 * Sliding-window log: the window holds only the requests that were allowed, so
 * the array is naturally capped at `max` and a rejected request costs nothing
 * and extends nothing. As the oldest allowed request ages past windowMs it
 * frees exactly one slot.
 */
export function checkRateLimit(request: VercelRequest, options: RateLimitOptions): RateLimitResult {
  const { bucket, windowMs, max } = options;
  const now = options.now ?? Date.now();

  try {
    const key = `${bucket}:${clientKey(request)}`;
    const windowStart = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

    const ok = recent.length < max;
    if (ok) recent.push(now);

    hits.delete(key);
    if (recent.length > 0) hits.set(key, recent);

    if (hits.size > MAX_TRACKED_KEYS) {
      const oldest = hits.keys().next().value as string | undefined;
      if (oldest !== undefined && oldest !== key) hits.delete(oldest);
    }

    const resetMs = (recent[0] ?? now) + windowMs;
    return {
      ok,
      limit: max,
      remaining: Math.max(0, max - recent.length),
      retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((resetMs - now) / 1000)),
      resetSec: Math.ceil(resetMs / 1000),
    };
  } catch {
    return {
      ok: true,
      limit: max,
      remaining: max,
      retryAfterSec: 0,
      resetSec: Math.ceil((now + windowMs) / 1000),
    };
  }
}

/** Test seam: forget every tracked caller. */
export function __resetRateLimits(): void {
  hits.clear();
}
