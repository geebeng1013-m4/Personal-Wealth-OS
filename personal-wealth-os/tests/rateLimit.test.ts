import assert from "node:assert/strict";
import { test } from "./testHarness";
import { checkRateLimit, clientKey, __resetRateLimits } from "../api/_rateLimit";
import type { VercelRequest } from "@vercel/node";

/** Just enough of a VercelRequest for the limiter, which only reads headers. */
function requestFrom(headers: Record<string, string | string[]>): VercelRequest {
  return { headers } as unknown as VercelRequest;
}

const ip = (addr: string) => requestFrom({ "x-forwarded-for": addr });

// --- identity ------------------------------------------------------------

test("rateLimit: clientKey takes the first hop of X-Forwarded-For", () => {
  assert.equal(clientKey(requestFrom({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" })), "1.2.3.4");
});

test("rateLimit: clientKey falls back to X-Real-IP, then to a shared bucket", () => {
  assert.equal(clientKey(requestFrom({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
  assert.equal(clientKey(requestFrom({})), "unknown");
});

// --- the ceiling -------------------------------------------------------------

test("rateLimit: allows exactly max requests in a window, then rejects", () => {
  __resetRateLimits();
  const opts = { bucket: "t", windowMs: 60_000, max: 5, now: 1_000_000 };
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit(ip("1.1.1.1"), opts).ok, true, `request ${i + 1} should pass`);
  }
  const blocked = checkRateLimit(ip("1.1.1.1"), opts);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60);
});

test("rateLimit: remaining counts down and never goes negative", () => {
  __resetRateLimits();
  const opts = { bucket: "t", windowMs: 60_000, max: 3, now: 2_000_000 };
  assert.equal(checkRateLimit(ip("2.2.2.2"), opts).remaining, 2);
  assert.equal(checkRateLimit(ip("2.2.2.2"), opts).remaining, 1);
  assert.equal(checkRateLimit(ip("2.2.2.2"), opts).remaining, 0);
  assert.equal(checkRateLimit(ip("2.2.2.2"), opts).remaining, 0);
});

// --- the window slides -----------------------------------------------------

test("rateLimit: a slot frees only once the oldest allowed request ages past the window", () => {
  __resetRateLimits();
  const base = 5_000_000;
  const win = 60_000;
  const at = (now: number) => ({ bucket: "t", windowMs: win, max: 3, now });
  // Three requests, spaced out so they expire one at a time.
  for (const t of [base, base + 20_000, base + 40_000]) {
    assert.equal(checkRateLimit(ip("3.3.3.3"), at(t)).ok, true);
  }
  // All three still inside the window: blocked.
  assert.equal(checkRateLimit(ip("3.3.3.3"), at(base + 100)).ok, false);
  // First request (t=base) has just expired: one slot, and only one.
  assert.equal(checkRateLimit(ip("3.3.3.3"), at(base + win + 1)).ok, true);
  assert.equal(checkRateLimit(ip("3.3.3.3"), at(base + win + 2)).ok, false);
  // Second request (t=base+20_000) expires ~20s later: another slot.
  assert.equal(checkRateLimit(ip("3.3.3.3"), at(base + win + 20_001)).ok, true);
});

// --- isolation -----------------------------------------------------------

test("rateLimit: each caller gets an independent budget", () => {
  __resetRateLimits();
  const opts = { bucket: "t", windowMs: 60_000, max: 2, now: 7_000_000 };
  assert.equal(checkRateLimit(ip("4.4.4.4"), opts).ok, true);
  assert.equal(checkRateLimit(ip("4.4.4.4"), opts).ok, true);
  assert.equal(checkRateLimit(ip("4.4.4.4"), opts).ok, false);
  // A different IP is unaffected.
  assert.equal(checkRateLimit(ip("5.5.5.5"), opts).ok, true);
  assert.equal(checkRateLimit(ip("5.5.5.5"), opts).ok, true);
  assert.equal(checkRateLimit(ip("5.5.5.5"), opts).ok, false);
});

test("rateLimit: each named bucket is a separate budget for the same caller", () => {
  __resetRateLimits();
  const common = { windowMs: 60_000, max: 1, now: 6_500_000 };
  assert.equal(checkRateLimit(ip("6.6.6.6"), { ...common, bucket: "quote" }).ok, true);
  assert.equal(checkRateLimit(ip("6.6.6.6"), { ...common, bucket: "quote" }).ok, false);
  // Spending the "quote" budget leaves "market" untouched.
  assert.equal(checkRateLimit(ip("6.6.6.6"), { ...common, bucket: "market" }).ok, true);
});

test("rateLimit: callers with no usable IP header share the 'unknown' bucket", () => {
  __resetRateLimits();
  const opts = { bucket: "t", windowMs: 60_000, max: 2, now: 8_000_000 };
  assert.equal(checkRateLimit(requestFrom({}), opts).ok, true);
  assert.equal(checkRateLimit(requestFrom({}), opts).ok, true);
  assert.equal(checkRateLimit(requestFrom({}), opts).ok, false);
});

// --- never the thing that breaks the route -------------------------------

test("rateLimit: an error while reading the request fails open rather than throwing", () => {
  __resetRateLimits();
  const hostile = { get headers(): never { throw new Error("boom"); } } as unknown as VercelRequest;
  const result = checkRateLimit(hostile, { bucket: "t", windowMs: 60_000, max: 1, now: 9_000_000 });
  assert.equal(result.ok, true);
  assert.equal(result.remaining, 1);
});
