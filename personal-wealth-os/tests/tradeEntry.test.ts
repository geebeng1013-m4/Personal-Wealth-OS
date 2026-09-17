import assert from "node:assert/strict";
import { test } from "./testHarness";
import { currenciesFor, normalizeTicker, tradeFromEntry, type TradeEntry } from "../src/tradeEntry";
import { calculatePositionCostBasis } from "../src/rules";

/** MM-6: the Record-trade form, from typed fields to the stored trade. */

const close = (actual: number | undefined, expected: number, label = "") =>
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${label} expected ${expected}, got ${actual}`);

function entry(overrides: Partial<TradeEntry>): TradeEntry {
  return {
    id: "t1", date: "2026-09-17", platform: "Moomoo", ticker: "VOO", market: "US", currency: "USD",
    type: "DCA", amount: 0, price: 0, units: 0, amountMyr: 0, fee: 0, feeCurrency: "MYR", notes: "",
    ...overrides,
  };
}

// --- Tickers ------------------------------------------------------------------

test("entry: the market's suffix is added to a bare code", () => {
  assert.equal(normalizeTicker("1155", "MY"), "1155.KL");
  assert.equal(normalizeTicker(" d05 ", "SG"), "D05.SI");
  assert.equal(normalizeTicker("vwra", "LSE"), "VWRA.L");
  assert.equal(normalizeTicker("aapl", "US"), "AAPL");
});

test("entry: Hong Kong codes are padded to four digits", () => {
  assert.equal(normalizeTicker("700", "HK"), "0700.HK");
  assert.equal(normalizeTicker("2800", "HK"), "2800.HK");
});

test("entry: a ticker that already has a suffix is kept as typed", () => {
  assert.equal(normalizeTicker("1155.KL", "MY"), "1155.KL");
  assert.equal(normalizeTicker("0700.HK", "US"), "0700.HK");
});

test("entry: London offers dollars and sterling; every other market one currency", () => {
  assert.deepEqual(currenciesFor("LSE"), ["USD", "GBP"]);
  assert.deepEqual(currenciesFor("HK"), ["HKD"]);
  assert.deepEqual(currenciesFor("MY"), ["MYR"]);
  assert.deepEqual(currenciesFor("US"), ["USD"]);
});

// --- Building the trade ---------------------------------------------------------

test("entry: a Hong Kong fill is stored in HKD, with no dollars in the dollar fields", () => {
  const trade = tradeFromEntry(entry({
    ticker: "2800", market: "HK", currency: "HKD", units: 500, price: 24.1, fee: 18.5, feeCurrency: "HKD",
  }), 0.5224)!;
  assert.equal(trade.ticker, "2800.HK");
  assert.equal(trade.market, "HK");
  assert.equal(trade.currency, "HKD");
  close(trade.amount, 12050, "a blank amount is price × quantity");
  assert.equal(trade.price, 24.1);
  assert.equal(trade.amountUsd, 0);
  assert.equal(trade.priceUsd, 0);
  close(trade.amountMyr, 12050 * 0.5224, "a blank ringgit amount uses today's rate");
  assert.equal(trade.fee, 18.5);
  assert.equal(trade.feeCurrency, "HKD");
  close(trade.feeMyr, 18.5 * 0.5224, "feeMyr always holds ringgit, at the trade's own rate");
});

test("entry: a ringgit amount the user typed wins over today's rate, and sets the fee's rate", () => {
  const trade = tradeFromEntry(entry({
    ticker: "2800", market: "HK", currency: "HKD", units: 500, amount: 12050, amountMyr: 6241.9, fee: 18.5, feeCurrency: "HKD",
  }), 0.6)!;
  close(trade.amountMyr, 6241.9);
  close(trade.exchangeRate, 0.518);
  close(trade.feeMyr, 18.5 * 0.518);
});

test("entry: a Malaysian trade costs its own amount and its fee is ringgit", () => {
  const trade = tradeFromEntry(entry({
    ticker: "1155", market: "MY", currency: "MYR", units: 300, price: 9.8, amountMyr: 999, fee: 12.4, feeCurrency: "HKD",
  }), null)!;
  assert.equal(trade.ticker, "1155.KL");
  close(trade.amount, 2940);
  close(trade.amountMyr, 2940, "the ringgit amount is the amount, whatever else was typed");
  assert.equal(trade.exchangeRate, 1);
  assert.equal(trade.feeCurrency, "MYR");
  assert.equal(trade.feeMyr, 12.4);
});

test("entry: a US trade keeps its dollar fields and a ringgit fee", () => {
  const trade = tradeFromEntry(entry({ units: 0.01, price: 690, amount: 6.9, amountMyr: 28.3, fee: 1.99 }), 4.1)!;
  assert.equal(trade.amountUsd, 6.9);
  assert.equal(trade.priceUsd, 690);
  assert.equal(trade.amount, 6.9);
  close(trade.amountMyr, 28.3);
  assert.equal(trade.feeMyr, 1.99);
  assert.equal(trade.feeCurrency, "MYR");
});

test("entry: a US fee in dollars is converted for feeMyr at the trade's rate", () => {
  const trade = tradeFromEntry(entry({ units: 0.01, price: 690, amountMyr: 28.29, fee: 0.99, feeCurrency: "USD" }), null)!;
  close(trade.amount, 6.9);
  assert.equal(trade.fee, 0.99);
  assert.equal(trade.feeCurrency, "USD");
  close(trade.feeMyr, 0.99 * (28.29 / 6.9));
});

test("entry: London sterling is kept when chosen; an unsupported currency falls back", () => {
  const vwrl = tradeFromEntry(entry({ ticker: "VWRL", market: "LSE", currency: "GBP", units: 2, price: 139 }), 5.47)!;
  assert.equal(vwrl.currency, "GBP");
  const odd = tradeFromEntry(entry({ ticker: "2800", market: "HK", currency: "SGD", units: 1, price: 25 }), null)!;
  assert.equal(odd.currency, "HKD");
});

test("entry: with no ringgit amount and no rate, the ringgit cost waits for conversions", () => {
  const trade = tradeFromEntry(entry({ ticker: "D05", market: "SG", currency: "SGD", units: 10, price: 72, fee: 3, feeCurrency: "SGD" }), null)!;
  assert.equal(trade.amountMyr, 0);
  assert.equal(trade.exchangeRate, undefined);
  assert.equal(trade.feeMyr, 0);
  assert.equal(trade.fee, 3);
});

test("entry: nothing is recorded without a ticker or a value", () => {
  assert.equal(tradeFromEntry(entry({ ticker: " ", units: 1, price: 1 }), 4), null);
  assert.equal(tradeFromEntry(entry({ units: 3 }), 4), null);
});

test("entry: a recorded Hong Kong trade feeds the cost basis in HKD", () => {
  const trade = tradeFromEntry(entry({ ticker: "2800", market: "HK", currency: "HKD", units: 500, price: 24.1 }), 0.5224)!;
  const basis = calculatePositionCostBasis([trade], "2800.HK");
  assert.equal(basis.currency, "HKD");
  close(basis.costBasisLocal, 12050);
  close(basis.units, 500);
});
