import assert from "node:assert/strict";
import { test } from "./testHarness";
import { fetchUsdToMyr, getUsdToMyr, resetUsdToMyrCache, type FxEvidence } from "../src/market";

/**
 * The FX rate is the quietest thing in the app that can be wrong. A stale or
 * invented rate looks exactly like a live one, and it multiplies every ringgit
 * figure on every page. These tests pin the order of evidence, and pin that the
 * synchronous and asynchronous paths can never hand out different answers —
 * they did, and the synchronous one was the one returning a hard-coded 4.25
 * while the market sat at 4.03.
 */

const FAILING_FETCH = () => Promise.reject(new Error("offline"));

/** The user's real conversions: newest is 2026-08-09 at 20.00 / 4.85. */
const exchanges: FxEvidence[] = [
  { date: "2026-04-05", direction: "myr-to-usd", myrAmount: 247, usdAmount: 60.8 },
  { date: "2026-08-05", direction: "myr-to-usd", myrAmount: 184.88, usdAmount: 44.84 },
  { date: "2026-08-09", direction: "myr-to-usd", myrAmount: 20.00, usdAmount: 4.85 },
];

const trades = [
  { date: "2026-08-12", exchangeRate: 4.026629 },
  { date: "2025-10-28", exchangeRate: 4.2 },
];

function offline<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = FAILING_FETCH as typeof globalThis.fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

test("fx: a failed request falls back on the user's newest conversion, not a constant", async () => {
  resetUsdToMyrCache();
  const rate = await offline(() => fetchUsdToMyr(trades, exchanges));
  // 20.00 / 4.85 = 4.1237 — the rate they actually got on 2026-08-09.
  assert.ok(Math.abs(rate - 20.00 / 4.85) < 1e-9, `got ${rate}`);
  assert.notEqual(rate, 4.25);
});

test("fx: a conversion outranks a trade's stamped rate", async () => {
  // A trade's exchangeRate is whatever a CSV import wrote on it, possibly from
  // the wrong day. A conversion is two amounts the broker really moved.
  resetUsdToMyrCache();
  const rate = await offline(() => fetchUsdToMyr(trades, exchanges));
  assert.ok(Math.abs(rate - 20.00 / 4.85) < 1e-9);
  assert.notEqual(rate, 4.026629);
});

test("fx: with no conversions it still prefers a trade over the constant", async () => {
  resetUsdToMyrCache();
  const rate = await offline(() => fetchUsdToMyr(trades, []));
  assert.equal(rate, 4.026629, "the newest trade's rate");
});

test("fx: the constant is reached only when nothing else is known", async () => {
  resetUsdToMyrCache();
  const rate = await offline(() => fetchUsdToMyr([], []));
  assert.equal(rate, 4.25);
});

test("fx: the synchronous getter agrees with the asynchronous one", async () => {
  // The bug this pins: fetchUsdToMyr() returned a good derived rate while
  // getUsdToMyr() kept handing out 4.25, so two figures on one page could be
  // computed at rates 5% apart.
  resetUsdToMyrCache();
  assert.equal(getUsdToMyr(), 4.25, "knows nothing yet");
  const rate = await offline(() => fetchUsdToMyr(trades, exchanges));
  assert.equal(getUsdToMyr(), rate);
});

test("fx: a derived rate never blocks the next attempt at a live one", async () => {
  // Caching the fallback into the live slot would suppress retries for an hour,
  // pinning a whole session to an old rate after one network blip.
  resetUsdToMyrCache();
  await offline(() => fetchUsdToMyr(trades, exchanges));

  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ rates: { MYR: 4.0311 } }),
  })) as unknown as typeof globalThis.fetch;
  try {
    const live = await fetchUsdToMyr(trades, exchanges);
    assert.equal(live, 4.0311, "the API is retried and wins");
    assert.equal(getUsdToMyr(), 4.0311);
  } finally {
    globalThis.fetch = original;
  }
});

test("fx: records are remembered even when the request succeeds", async () => {
  // So a later synchronous read is never left with only the constant just
  // because the API happened to answer first and expire later.
  resetUsdToMyrCache();
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ rates: { MYR: 4.0311 } }),
  })) as unknown as typeof globalThis.fetch;
  try {
    await fetchUsdToMyr(trades, exchanges);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(getUsdToMyr(), 4.0311);
});

test("fx: a malformed conversion cannot poison the rate", async () => {
  resetUsdToMyrCache();
  const rate = await offline(() => fetchUsdToMyr([], [
    { date: "2026-08-20", direction: "myr-to-usd", myrAmount: 100, usdAmount: 0 },
    { date: "2026-08-09", direction: "myr-to-usd", myrAmount: 20.00, usdAmount: 4.85 },
  ]));
  assert.ok(Number.isFinite(rate) && rate > 0);
  assert.ok(Math.abs(rate - 20.00 / 4.85) < 1e-9, "the zero-dollar record is skipped, not divided by");
});
