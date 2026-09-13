/**
 * Per-caller rate limiting for the assistant function.
 *
 * A near-verbatim port of api/_rateLimit.ts, with the Vercel type dependency
 * removed so this module stays dependency-free and unit-testable. Same scope
 * caveat: the counter lives in this instance's memory, so a warm instance
 * catches one caller in a loop, but a cold start resets it and several
 * instances under load each count separately — the real ceiling is
 * (max x live instances). For a hard cluster-wide limit, back this with a
 * shared store (Firestore, Upstash) keyed on clientKeyFromHeaders().
 *
 * Fails open: a limiter that throws must never be what takes the route down.
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
  bucket: string;
  windowMs: number;
  max: number;
  /** Injectable clock, for tests. Defaults to Date.now(). */
  now?: number;
}

type HeaderValue = string | string[] | undefined;

/** key -> timestamps (ms) of the allowed requests still inside the window. */
const hits = new Map<string, number[]>();

/** Bound memory against a flood of spoofed X-Forwarded-For values. */
const MAX_TRACKED_KEYS = 5000;

/**
 * The caller's identity: the first hop of X-Forwarded-For, which on Google's
 * front end is the real client IP. Falls back to X-Real-IP, then to one shared
 * "unknown" bucket so an unidentifiable caller is limited alongside every other
 * such caller rather than escaping the limit.
 */
export function clientKeyFromHeaders(headers: Record<string, HeaderValue>): string {
  const pick = (name: string): string => {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    const first = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
    return first.split(",")[0].trim();
  };
  return pick("x-forwarded-for") || pick("x-real-ip") || "unknown";
}

/**
 * Sliding-window log: the window holds only the requests that were allowed, so
 * the array is naturally capped at `max`, and a rejected request costs nothing
 * and extends nothing.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { bucket, windowMs, max } = options;
  const now = options.now ?? Date.now();

  try {
    const mapKey = `${bucket}:${key}`;
    const windowStart = now - windowMs;
    const recent = (hits.get(mapKey) ?? []).filter((t) => t > windowStart);

    const ok = recent.length < max;
    if (ok) recent.push(now);

    hits.delete(mapKey);
    if (recent.length > 0) hits.set(mapKey, recent);

    if (hits.size > MAX_TRACKED_KEYS) {
      const oldest = hits.keys().next().value as string | undefined;
      if (oldest !== undefined && oldest !== mapKey) hits.delete(oldest);
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
