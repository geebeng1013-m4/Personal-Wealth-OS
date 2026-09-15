import assert from "node:assert/strict";
import { test } from "./testHarness";
import { readUpstreamLimit } from "../functions/src/openrouterRequest";
import { dailyLimitMessage, describeReset } from "../src/components/assistant/quotaMessage";

const NOW_MS = Date.UTC(2026, 8, 15, 10, 0, 0); // 2026-09-15 10:00 UTC
const RESET_MS = Date.UTC(2026, 8, 16, 0, 0, 0); // next UTC midnight

/** The body OpenRouter actually returned when the allowance ran out. */
const DAILY_BODY = {
  error: {
    message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
    code: 429,
    metadata: {
      headers: { "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(RESET_MS) },
      limit_source: "openrouter_free_tier_daily",
    },
  },
};

// --- reading OpenRouter's 429 -------------------------------------------

test("quota: the real daily-limit body is read as daily, with its reset time", () => {
  const limit = readUpstreamLimit(DAILY_BODY, String(RESET_MS), NOW_MS);
  assert.deepEqual(limit, { kind: "daily", resetAt: RESET_MS });
});

test("quota: the reset time falls back to the one inside the body", () => {
  assert.deepEqual(readUpstreamLimit(DAILY_BODY, null, NOW_MS), { kind: "daily", resetAt: RESET_MS });
});

test("quota: a reset given in seconds is converted to ms", () => {
  const limit = readUpstreamLimit(DAILY_BODY, String(RESET_MS / 1000), NOW_MS);
  assert.deepEqual(limit, { kind: "daily", resetAt: RESET_MS });
});

test("quota: a daily limit with an absurd reset keeps 'daily' but drops the time", () => {
  const body = { error: { message: "free-models-per-day", metadata: {} } };
  assert.deepEqual(readUpstreamLimit(body, "12345", NOW_MS), { kind: "daily", resetAt: null }, "in the past");
  assert.deepEqual(readUpstreamLimit(body, String(NOW_MS + 30 * 86_400_000), NOW_MS), { kind: "daily", resetAt: null }, "a month out");
});

test("quota: anything unrecognised is a short-term limit, never a promise about tomorrow", () => {
  for (const body of [null, "Too Many Requests", {}, { error: "slow down" }, { error: { message: "Rate limit exceeded: 20 requests per minute" } }]) {
    assert.deepEqual(readUpstreamLimit(body, String(RESET_MS), NOW_MS), { kind: "burst" }, JSON.stringify(body));
  }
});

// --- the words the user sees --------------------------------------------

test("quota: a reset on the next day says tomorrow", () => {
  const now = new Date(2026, 8, 15, 20, 0, 0);
  const reset = new Date(2026, 8, 16, 8, 0, 0).getTime();
  assert.match(describeReset(reset, now, "en-MY"), /^tomorrow at /);
});

test("quota: a reset later the same day says later today", () => {
  const now = new Date(2026, 8, 15, 6, 0, 0);
  const reset = new Date(2026, 8, 15, 8, 0, 0).getTime();
  assert.match(describeReset(reset, now, "en-MY"), /^later today at /);
});

test("quota: a reset further out names the date", () => {
  const now = new Date(2026, 8, 15, 20, 0, 0);
  const reset = new Date(2026, 8, 17, 8, 0, 0).getTime();
  assert.match(describeReset(reset, now, "en-MY"), /^on .*17.* at /);
});

test("quota: the full message says what happened, when it returns, and that nothing else is affected", () => {
  const now = new Date(2026, 8, 15, 20, 0, 0);
  const text = dailyLimitMessage(new Date(2026, 8, 16, 8, 0, 0).getTime(), now, "en-MY");
  assert.match(text, /used up today's free allowance/);
  assert.match(text, /available again tomorrow at /);
  assert.match(text, /rest of WealthUp works as usual/);
  assert.doesNotMatch(text, /shortly/i, "never 'try again shortly' for a limit that lasts hours");
});

test("quota: a missing or broken reset still gives a useful sentence", () => {
  const now = new Date(2026, 8, 15, 20, 0, 0);
  for (const retryAt of [undefined, null, "soon", Number.NaN, 5]) {
    assert.match(dailyLimitMessage(retryAt, now), /available again tomorrow\./, String(retryAt));
  }
});
