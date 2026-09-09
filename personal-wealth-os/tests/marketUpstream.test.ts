import assert from "node:assert/strict";
import { test } from "./testHarness";
import { parseYahooQuote } from "../api/quote";
import { readTopHoldings, parseTradingViewFundamentals, isYahooChartBody } from "../api/market";

/*
 * The api/* handlers pull fields out of Yahoo and TradingView JSON that neither
 * provider promises to keep stable. These lock in the one thing that must never
 * change: an unexpected shape resolves to "no data", never to a fabricated
 * number.
 */

// --- parseYahooQuote (api/quote.ts) --------------------------------------

const goodChart = {
  chart: { result: [{ meta: {
    symbol: "VOO", regularMarketPrice: 620.5, regularMarketTime: 1_788_900_000,
    currency: "USD", marketState: "REGULAR", shortName: "Vanguard S&P 500",
    chartPreviousClose: 615,
  } }] },
};

test("parseYahooQuote: a good chart payload yields a validated quote", () => {
  const q = parseYahooQuote(goodChart, "VOO");
  assert.equal(q.error, undefined);
  assert.equal(q.price, 620.5);
  assert.equal(q.symbol, "VOO");
  assert.equal(q.currency, "USD");
  assert.equal(q.previousClose, 615);
  assert.equal(q.quotedAt, 1_788_900_000 * 1000);
});

test("parseYahooQuote: an exchange-prefixed symbol is stripped", () => {
  const q = parseYahooQuote({ chart: { result: [{ meta: { symbol: "AMEX:QQQM", regularMarketPrice: 200 } }] } }, "QQQM");
  assert.equal(q.symbol, "QQQM");
});

for (const [label, input] of [
  ["null", null],
  ["a bare string (HTML page parsed loosely)", "<!doctype html><title>Error</title>"],
  ["an empty object", {}],
  ["chart present but result missing", { chart: {} }],
  ["result is an empty array", { chart: { result: [] } }],
  ["result[0] has no meta", { chart: { result: [{}] } }],
  ["meta renamed to metadata", { chart: { result: [{ metadata: { regularMarketPrice: 620 } }] } }],
  ["meta is a string", { chart: { result: [{ meta: "nope" }] } }],
] as const) {
  test(`parseYahooQuote: ${label} -> "no data"`, () => {
    const q = parseYahooQuote(input, "VOO");
    assert.equal(q.error, "no data");
    assert.equal(q.price, undefined);
  });
}

for (const [label, price] of [
  ["null", null],
  ["zero", 0],
  ["negative", -5],
  ["a numeric string", "620.5"],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
] as const) {
  test(`parseYahooQuote: regularMarketPrice = ${label} -> "no price", never a value`, () => {
    const q = parseYahooQuote({ chart: { result: [{ meta: { regularMarketPrice: price } }] } }, "VOO");
    assert.equal(q.error, "no price");
    assert.equal(q.price, undefined);
  });
}

test("parseYahooQuote: an absent previousClose is omitted, not set to zero", () => {
  const q = parseYahooQuote({ chart: { result: [{ meta: { regularMarketPrice: 620 } }] } }, "VOO");
  assert.equal("previousClose" in q, false);
});

test("parseYahooQuote: a missing regularMarketTime falls back to a finite timestamp", () => {
  const q = parseYahooQuote({ chart: { result: [{ meta: { regularMarketPrice: 620 } }] } }, "VOO");
  assert.equal(typeof q.quotedAt, "number");
  assert.ok(Number.isFinite(q.quotedAt));
});

// --- readTopHoldings (api/market.ts) -----------------------------------

const goodHoldings = {
  quoteSummary: { result: [{ topHoldings: {
    holdings: [
      { symbol: "AAPL", holdingName: "Apple Inc", holdingPercent: { raw: 0.07 } },
      { symbol: "MSFT", holdingName: "Microsoft", holdingPercent: { raw: 0.065 } },
    ],
    sectorWeightings: [{ technology: { raw: 0.3 } }, { healthcare: { raw: 0.13 } }],
  } }] },
};

test("readTopHoldings: a good payload yields holdings and sectors", () => {
  const h = readTopHoldings(goodHoldings);
  assert.ok(h);
  assert.deepEqual(h.holdings.map((x) => x.symbol), ["AAPL", "MSFT"]);
  assert.equal(h.holdings[0].weight, 0.07);
  assert.equal(h.sectors[0].sector, "technology");
});

for (const [label, input] of [
  ["null", null],
  ["a string", "error page"],
  ["quoteSummary.result missing", { quoteSummary: {} }],
  ["result is not an array", { quoteSummary: { result: {} } }],
  ["result[0] has no topHoldings", { quoteSummary: { result: [{}] } }],
  ["holdings and sectorWeightings not arrays", { quoteSummary: { result: [{ topHoldings: { holdings: {}, sectorWeightings: 3 } }] } }],
  ["every holding lacks a numeric .raw", { quoteSummary: { result: [{ topHoldings: { holdings: [{ symbol: "AAPL", holdingPercent: { raw: "7%" } }], sectorWeightings: [] } }] } }],
] as const) {
  test(`readTopHoldings: ${label} -> null`, () => {
    assert.equal(readTopHoldings(input), null);
  });
}

test("readTopHoldings: a holding without a valid weight is dropped, not weighted zero", () => {
  const h = readTopHoldings({ quoteSummary: { result: [{ topHoldings: {
    holdings: [
      { symbol: "AAPL", holdingPercent: { raw: 0.07 } },
      { symbol: "BAD", holdingPercent: null },
    ],
    sectorWeightings: [],
  } }] } });
  assert.deepEqual(h?.holdings.map((x) => x.symbol), ["AAPL"]);
});

// --- parseTradingViewFundamentals (api/market.ts) ---------------------

// columns order: dividends_yield, expense_ratio, aum, close, currency
const goodTv = { data: [{ s: "AMEX:VOO", d: [1.04, 0.03, 5.6e11, 620.5, "USD"] }] };

test("parseTradingViewFundamentals: a good payload maps the requested columns", () => {
  const f = parseTradingViewFundamentals(goodTv, "VOO");
  assert.deepEqual(f, { dividends_yield: 1.04, expense_ratio: 0.03, aum: 5.6e11, close: 620.5, currency: "USD" });
});

for (const [label, input] of [
  ["null", null],
  ["a string", "<html>"],
  ["data missing", {}],
  ["data is not an array", { data: {} }],
  ["no row matches the symbol", { data: [{ s: "NASDAQ:AAPL", d: [1, 2, 3, 4, "USD"] }] }],
  ["the matching row has no d array", { data: [{ s: "AMEX:VOO" }] }],
  ["every cell is null", { data: [{ s: "AMEX:VOO", d: [null, null, null, null, null] }] }],
] as const) {
  test(`parseTradingViewFundamentals: ${label} -> null`, () => {
    assert.equal(parseTradingViewFundamentals(input, "VOO"), null);
  });
}

test("parseTradingViewFundamentals: null cells are omitted, not mapped to null", () => {
  const f = parseTradingViewFundamentals({ data: [{ s: "AMEX:VOO", d: [1.04, null, null, 620, "USD"] }] }, "VOO");
  assert.deepEqual(f, { dividends_yield: 1.04, close: 620, currency: "USD" });
});

// --- isYahooChartBody (api/market.ts history passthrough gate) --------

test("isYahooChartBody: a real chart JSON body passes", () => {
  assert.equal(isYahooChartBody(JSON.stringify(goodChart)), true);
});

test("isYahooChartBody: a chart error body (valid shape, no result) still passes through", () => {
  assert.equal(isYahooChartBody(JSON.stringify({ chart: { result: null, error: { code: "Not Found" } } })), true);
});

for (const body of [
  "<!doctype html><title>Blocked</title>",
  "",
  "not json at all",
  JSON.stringify({ quoteSummary: { result: [] } }),
  JSON.stringify({ chart: "wrong type" }),
  JSON.stringify(null),
]) {
  test(`isYahooChartBody: rejects ${JSON.stringify(body.slice(0, 30))}`, () => {
    assert.equal(isYahooChartBody(body), false);
  });
}
