import assert from "node:assert/strict";
import { test } from "./testHarness";
import { majorCurrency, normalizeQuotes } from "../src/marketPrices";
import {
  QUOTE_BATCH_SIZE,
  fetchLivePrices,
  fetchRatesToMyr,
  resetRatesToMyrCache,
} from "../src/market";
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

test("rates: the API's units-per-ringgit are inverted to ringgit per unit", async () => {
  resetRatesToMyrCache();
  const rates = await withFetch(() => json(API_RATES), () => fetchRatesToMyr(["HKD", "SGD", "GBP", "MYR"]));
  close(rates.get("HKD"), 1 / 1.919401);
  close(rates.get("SGD"), 1 / 0.311623);
  close(rates.get("GBP"), 1 / 0.181834);
  assert.equal(rates.get("MYR"), 1);
});

test("rates: the dollar is left to its own path, so no dollar figure can move", async () => {
  resetRatesToMyrCache();
  const rates = await withFetch(() => json(API_RATES), () => fetchRatesToMyr(["USD", "HKD"]));
  assert.equal(rates.has("USD"), false);
  assert.ok(rates.has("HKD"));
});

test("rates: offline, a currency falls back on the newest conversion into it", async () => {
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
  // No API and no conversion: unknown, never a guessed constant.
  assert.equal(rates.has("SGD"), false);
});

test("rates: a successful answer is reused rather than fetched again", async () => {
  resetRatesToMyrCache();
  let calls = 0;
  const fake = () => { calls += 1; return json(API_RATES); };
  await withFetch(fake, () => fetchRatesToMyr(["HKD"]));
  await withFetch(fake, () => fetchRatesToMyr(["SGD"]));
  assert.equal(calls, 1);
});

test("rates: nothing but ringgit and dollars asks the network nothing", async () => {
  resetRatesToMyrCache();
  let calls = 0;
  const rates = await withFetch(() => { calls += 1; return json(API_RATES); }, () => fetchRatesToMyr(["USD", "MYR"]));
  assert.equal(calls, 0);
  assert.deepEqual([...rates], [["MYR", 1]]);
});
