import assert from "node:assert/strict";
import { test } from "./testHarness";
import { dailyLimitMessage, describeReset } from "../src/components/assistant/quotaMessage";

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
  assert.match(text, /used today's assistant allowance/);
  assert.doesNotMatch(text, /free/i, "the allowance is this account's, not a free tier's");
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

// --- which allowance ran out, and what still works -----------------------

test("quota: running out of Ask says so, and says Record still works", () => {
  const now = new Date(2026, 8, 23, 20, 0, 0);
  const text = dailyLimitMessage(new Date(2026, 8, 24, 0, 0, 0).getTime(), now, "en-MY", "help");
  assert.match(text, /today's Ask allowance/);
  assert.match(text, /Record still works/);
});

test("quota: running out of Record says so, and never claims Ask is gone too", () => {
  const now = new Date(2026, 8, 23, 20, 0, 0);
  const text = dailyLimitMessage(new Date(2026, 8, 24, 0, 0, 0).getTime(), now, "en-MY", "fill");
  assert.match(text, /today's Record allowance/);
  assert.match(text, /Ask still works/);
  assert.doesNotMatch(text, /Record still works/);
});

test("quota: with no mode given it stays general rather than naming the wrong one", () => {
  const now = new Date(2026, 8, 23, 20, 0, 0);
  const text = dailyLimitMessage(new Date(2026, 8, 24, 0, 0, 0).getTime(), now, "en-MY");
  assert.match(text, /today's assistant allowance/);
  assert.match(text, /rest of WealthUp works as usual/);
});
