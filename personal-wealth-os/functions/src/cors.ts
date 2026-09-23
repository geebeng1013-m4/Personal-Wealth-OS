/**
 * Cross-origin policy for the assistant function.
 *
 * Unlike the Vercel proxies in api/, this function is on a different origin from
 * the site (the app is served from wealthup.cc on Vercel; this runs on Cloud
 * Functions), so every real browser call IS cross-origin and MUST carry an
 * allowed Origin. The rule here is therefore an allowlist, not "deny known-bad".
 *
 * A request with no Origin at all (curl, server-to-server, a health check) is
 * allowed through so the route stays testable — it carries no credentials and
 * the rate limiter still applies.
 */

const ALLOWED_ORIGINS = new Set([
  "https://wealthup.cc",
  "https://www.wealthup.cc",
  "http://localhost:5173",
  "http://localhost:5199",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5199",
]);

/** Vercel gives every preview deployment its own generated *.vercel.app origin. */
function isVercelPreviewOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && (hostname === "vercel.app" || hostname.endsWith(".vercel.app"));
  } catch {
    return false;
  }
}

export interface CorsDecision {
  /** Whether the request may proceed. */
  allowed: boolean;
  /** Response headers to set regardless of outcome (echoes the Origin when known-good). */
  headers: Record<string, string>;
}

export function resolveCors(origin: string | undefined): CorsDecision {
  const base: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Authorization carries the caller's Firebase ID token. Leave it out and
    // the browser's preflight fails before the real request is ever sent.
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "3600",
  };

  if (origin === undefined || origin === "") {
    // No browser origin: a non-browser caller. Allowed, no ACAO header needed.
    return { allowed: true, headers: base };
  }

  if (ALLOWED_ORIGINS.has(origin) || isVercelPreviewOrigin(origin)) {
    return { allowed: true, headers: { ...base, "Access-Control-Allow-Origin": origin } };
  }

  return { allowed: false, headers: base };
}
