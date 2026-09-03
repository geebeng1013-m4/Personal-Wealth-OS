import type { VercelRequest } from "@vercel/node";

/**
 * Rejects cross-site browser calls to this project's data proxies.
 *
 * These routes are unauthenticated read-only proxies for public market data,
 * so nothing private leaks through them. What they do spend is this project's
 * Vercel function budget, and there is no reason another site should be able
 * to spend it by pointing its own front-end at /api/quote.
 *
 * The rule is deliberately "deny a known-bad Origin" rather than "allow only a
 * known-good one":
 *
 *   - The app's own calls are same-origin, and browsers send NO Origin header
 *     on a same-origin GET. Those are allowed, so this can never break a real
 *     user — including one whose Referer is stripped by a privacy extension,
 *     which an allowlist keyed on Referer would have locked out.
 *   - A cross-site fetch always carries a real Origin that page JavaScript
 *     cannot forge. Those are rejected.
 *
 * What this does NOT stop is a script or curl, which simply sends no Origin
 * and looks identical to the app. Blocking that needs per-caller rate
 * limiting, which needs shared state across serverless invocations (Vercel KV
 * or similar) — deliberately not added here. Edge caching (see each route's
 * Cache-Control) is what currently absorbs repeated identical requests.
 */

const ALLOWED_HOSTNAMES = new Set([
  "wealthup.cc",
  "www.wealthup.cc",
  "localhost",
  "127.0.0.1",
]);

/** Vercel gives every preview deployment its own generated subdomain. */
function isVercelPreviewHost(hostname: string): boolean {
  return hostname === "vercel.app" || hostname.endsWith(".vercel.app");
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    // "null" is a real Origin value (sandboxed iframes, file://) and is not a
    // URL. It is not one of ours either.
    return null;
  }
}

/**
 * True when the request may proceed.
 *
 * Absent Origin means same-origin or a non-browser caller: allowed. A present
 * Origin must resolve to one of this project's own hostnames.
 */
export function isAllowedOrigin(request: VercelRequest): boolean {
  const origin = request.headers?.origin;
  if (typeof origin !== "string" || origin.length === 0) return true;

  const hostname = hostnameOf(origin);
  if (hostname === null) return false;

  return ALLOWED_HOSTNAMES.has(hostname) || isVercelPreviewHost(hostname);
}
