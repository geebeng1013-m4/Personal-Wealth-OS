import assert from "node:assert/strict";
import { test } from "./testHarness";
import { majorCurrency, normalizeQuotes } from "../src/marketPrices";
import {
  QUOTE_BATCH_SIZE,
  fetchLivePrices,
  fetchRatesToMyr,
  fxSymbol,
  resetRatesToMyrCache,
} from "../src/market";
import { isValidSymbol } from "../api/quote";
import type { CurrencyExchange } from "../src/models";

/**
 * MM-3: quotes and rates for markets beyond the US. The figures in these tests
 * are what Yahoo and the FX API actually returned on 2026-09-17.
 */

const close = (actual: number | undefined, expected: number) =>
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

function withFetch<T>(fake: (url: string) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => fake(String(input))) as typeof globalThis.fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

// --- Quotes in pence --------------------------------------------------------

test("quotes: a London price in pence is restated in pounds", () => {
  const prices = normalizeQuotes({
    quotes: [{ symbol: "ISF.L", price: 1050.8, previousClose: 1046.2, currency: "GBp", quotedAt: 1 }],
  });
  const quote = prices.get("ISF.L")!;
  assert.equal(quote.currency, "GBP");
  close(quote.priceUsd, 10.508);
  close(quote.previousClose ?? undefined, 10.462);
});

test("quotes: prices already in a major currency are untouched", () => {
  const prices = normalizeQuotes({
    quotes: [
      { symbol: "VWRL.L", price: 139.125, currency: "GBP" },
      { symbol: "VWRA.L", price: 192.4, currency: "USD" },
      { symbol: "1155.KL", price: 10.36, currency: "MYR" },
      { symbol: "2800.HK", price: 25.22, currency: "HKD" },
      { symbol: "D05.SI", price: 76.94, currency: "SGD" },
    ],
  });
  assert.equal(prices.get("VWRL.L")!.priceUsd, 139.125);
  assert.equal(prices.get("VWRA.L")!.currency, "USD");
  assert.equal(prices.get("1155.KL")!.currency, "MYR");
  assert.equal(prices.get("2800.HK")!.priceUsd, 25.22);
  assert.equal(prices.get("D05.SI")!.currency, "SGD");
});

test("quotes: every minor unit maps to its currency at 100 to 1", () => {
  assert.deepEqual(majorCurrency("GBp"), { currency: "GBP", divisor: 100 });
  assert.deepEqual(majorCurrency("GBX"), { currency: "GBP", divisor: 100 });
  assert.deepEqual(majorCurrency("ZAc"), { currency: "ZAR", divisor: 100 });
  assert.deepEqual(majorCurrency("ILA"), { currency: "ILS", divisor: 100 });
  assert.deepEqual(majorCurrency("HKD"), { currency: "HKD", divisor: 1 });
});

// --- Batching ---------------------------------------------------------------

test("quotes: more symbols than the route accepts are split into batches", async () => {
  localStorage.clear();
  const symbols = Array.from({ length: 27 }, (_, index) => `B${String(index).padStart(2, "0")}.HK`);
  const requested: string[][] = [];
  const prices = await withFetch((url) => {
    const list = decodeURIComponent(url.split("symbols=")[1]).split(",");
    requested.push(list);
    return json({ quotes: list.map((symbol) => ({ symbol, price: 10, currency: "HKD" })) });
  }, () => fetchLivePrices(symbols));

  assert.equal(requested.length, 3);
  assert.ok(requested.every((batch) => batch.length <= QUOTE_BATCH_SIZE));
  assert.equal(prices.size, 27);
});

test("quotes: a failed batch costs only its own symbols", async () => {
  localStorage.clear();
  const symbols = Array.from({ length: 14 }, (_, index) => `F${String(index).padStart(2, "0")}.SI`);
  const prices = await withFetch((url) => {
    const list = decodeURIComponent(url.split("symbols=")[1]).split(",");
    if (list.includes("F00.SI")) return Promise.resolve(new Response("", { status: 429 }));
    return json({ quotes: list.map((symbol) => ({ symbol, price: 5, currency: "SGD" })) });
  }, () => fetchLivePrices(symbols));

  assert.equal(prices.size, 2);
  assert.equal(prices.has("F00.SI"), false);
  assert.ok(prices.has("F13.SI"));
});

// --- Rates to ringgit -------------------------------------------------------

const API_RATES = { result: "success", base_code: "MYR", rates: { MYR: 1, USD: 0.244689, HKD: 1.919401, SGD: 0.311623, GBP: 0.181834 } };

/** Yahoo's live rates as the quote route returns them, minutes old on 2026-09-17. */
const LIVE = { "MYR=X": 4.096, "USDMYR=X": 4.096, "HKDMYR=X": 0.5224, "SGDMYR=X": 3.2134, "GBPMYR=X": 5.4746 } as Record<string, number>;

/** A network where the quote route answers only the symbols in `live`, and the daily API answers `daily`. */
function network(live: Record<string, number>, daily: unknown, counts = { quote: 0, daily: 0 }) {
  return (url: string) => {
    if (url.includes("/api/quote")) {
      counts.quote += 1;
      const list = decodeURIComponent(url.split("symbols=")[1]).split(",");
      return json({ quotes: list.map((symbol) => symbol in live
        ? { symbol, price: live[symbol], currency: "MYR" }
        : { symbol, error: "no data" }) });
    }
    counts.daily += 1;
    return daily === null ? Promise.reject(new Error("offline")) : json(daily);
  };
}

test("rates: live quotes come first, for the dollar too", async () => {
  localStorage.clear();
  resetRatesToMyrCache();
  const counts = { quote: 0, daily: 0 };
  const rates = await withFetch(network(LIVE, API_RATES, counts), () => fetchRatesToMyr(["USD", "HKD", "SGD", "GBP", "MYR"]));
  close(rates.get("USD"), 4.096);
  close(rates.get("HKD"), 0.5224);
  close(rates.get("SGD"), 3.2134);
  close(rates.get("GBP"), 5.4746);
  assert.equal(rates.get("MYR"), 1);
  assert.equal(counts.daily, 0, "the daily API is not asked when every rate is live");
});

test("rates: the live symbol for a currency is <CODE>MYR=X", () => {
  assert.equal(fxSymbol("HKD"), "HKDMYR=X");
});

test("rates: the quote route accepts exchange-rate symbols", () => {
  assert.ok(isValidSymbol("HKDMYR=X"));
  assert.ok(isValidSymbol("1155.KL"));
  assert.ok(!isValidSymbol("HKD MYR"));
  assert.ok(!isValidSymbol("A&B"));
});

test("rates: a live quote not in ringgit is not a ringgit rate", async () => {
  localStorage.clear();
  resetRatesToMyrCache();
  const fake = (url: string) => url.includes("/api/quote")
    ? json({ quotes: [{ symbol: "HKDMYR=X", price: 0.128, currency: "USD" }] })
    : json(API_RATES);
  const rates = await withFetch(fake, () => fetchRatesToMyr(["HKD"]));
  close(rates.get("HKD"), 1 / 1.919401);
});

test("rates: without a live quote, the daily API's units-per-ringgit are inverted", async () => {
  localStorage.clear();
  resetRatesToMyrCache();
  const rates = await withFetch(network({}, API_RATES), () => fetchRatesToMyr(["HKD", "SGD", "GBP", "MYR"]));
  close(rates.get("HKD"), 1 / 1.919401);
  close(rates.get("SGD"), 1 / 0.311623);
  close(rates.get("GBP"), 1 / 0.181834);
  assert.equal(rates.get("MYR"), 1);
});

test("rates: without a live quote the dollar is left to its own path", async () => {
  localStorage.clear();
  resetRatesToMyrCache();
  const rates = await withFetch(network({}, API_RATES), () => fetchRatesToMyr(["USD", "HKD"]));
  assert.equal(rates.has("USD"), false);
  assert.ok(rates.has("HKD"));
});

test("rates: offline, a currency falls back on the newest conversion into it", async () => {
  localStorage.clear();
  resetRatesToMyrCache();
  const exchanges: CurrencyExchange[] = [
    { id: "h1", date: "2026-05-01", fromCurrency: "MYR", fromAmount: 518, toCurrency: "HKD", toAmount: 1000 },
    { id: "h2", date: "2026-08-01", fromCurrency: "MYR", fromAmount: 525, toCurrency: "HKD", toAmount: 1000 },
    { id: "u1", date: "2026-09-01", direction: "myr-to-usd", myrAmount: 403, usdAmount: 100 },
  ];
  const rates = await withFetch(
    () => Promise.reject(new Error("offline")),
    () => fetchRatesToMyr(["HKD", "SGD"], exchanges),
  );
  close(rates.get("HKD"), 0.525);
  // No quote, no API and no conversion: unknown, never a guessed constant.
  assert.equal(rates.has("SGD"), false);
});

test("rates: the daily API is reused for the hour rather than fetched again", async () => {
  localStorage.clear();
  resetRatesToMyrCache();
  const counts = { quote: 0, daily: 0 };
  await withFetch(network({}, API_RATES, counts), () => fetchRatesToMyr(["HKD"]));
  await withFetch(network({}, API_RATES, counts), () => fetchRatesToMyr(["SGD"]));
  assert.equal(counts.daily, 1);
});

test("rates: nothing but ringgit asks the network nothing", async () => {
  resetRatesToMyrCache();
  let calls = 0;
  const rates = await withFetch(() => { calls += 1; return json(API_RATES); }, () => fetchRatesToMyr(["MYR"]));
  assert.equal(calls, 0);
  assert.deepEqual([...rates], [["MYR", 1]]);
});
