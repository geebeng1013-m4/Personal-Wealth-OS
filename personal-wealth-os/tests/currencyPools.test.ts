import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  exchangeRateOf,
  normalizeCurrencyExchanges,
  resolveExchangeCoverage,
  tradesWithExchangeCost,
  validateCurrencyExchange,
} from "../src/currencyExchange";
import type { CurrencyExchange, Dividend, Trade } from "../src/models";

/**
 * MM-2: one pool per currency. A Hong Kong buy is costed only from ringgit
 * converted into Hong Kong dollars; a ringgit buy needs no pool; and a fee in
 * the trade's own currency is converted at that trade's rate.
 */

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} expected ${expected}, got ${actual}`);

function hkBuy(id: string, date: string, hkd: number, overrides: Partial<Trade> = {}): Trade {
  return {
    id, date, platform: "moomoo", ticker: "2800.HK", type: "DCA",
    market: "HK", currency: "HKD", amount: hkd, price: 25, units: hkd / 25,
    amountUsd: 0, priceUsd: 0, amountMyr: 0, feeMyr: 0,
    ...overrides,
  };
}

function usBuy(id: string, date: string, usd: number): Trade {
  return {
    id, date, platform: "moomoo", ticker: "VOO", type: "DCA",
    amountUsd: usd, priceUsd: 600, amountMyr: usd * 4.1, feeMyr: 0,
  };
}

function toHkd(id: string, date: string, myr: number, hkd: number): CurrencyExchange {
  return { id, date, fromCurrency: "MYR", fromAmount: myr, toCurrency: "HKD", toAmount: hkd };
}

function toUsd(id: string, date: string, myr: number, usd: number): CurrencyExchange {
  return { id, date, direction: "myr-to-usd", myrAmount: myr, usdAmount: usd };
}

// --- Records ----------------------------------------------------------------

test("pools: a ringgit → HKD conversion is kept, in general form only", () => {
  const record = validateCurrencyExchange(toHkd("h1", "2026-05-01", 518, 1000))!;
  assert.equal(record.fromCurrency, "MYR");
  assert.equal(record.toCurrency, "HKD");
  assert.equal(record.toAmount, 1000);
  // No dollar fields: an older build must not read this as a dollar conversion.
  assert.equal(record.myrAmount, undefined);
  assert.equal(record.usdAmount, undefined);
  assert.equal(record.direction, undefined);
  close(exchangeRateOf(record), 0.518);
});

test("pools: a conversion with no ringgit side, or one currency on both sides, is dropped", () => {
  assert.equal(validateCurrencyExchange({ id: "a", date: "2026-05-01", fromCurrency: "HKD", fromAmount: 100, toCurrency: "USD", toAmount: 12.8 }), null);
  assert.equal(validateCurrencyExchange({ id: "b", date: "2026-05-01", fromCurrency: "MYR", fromAmount: 100, toCurrency: "MYR", toAmount: 100 }), null);
  assert.equal(validateCurrencyExchange({ id: "c", date: "2026-05-01", fromCurrency: "MYR", fromAmount: 0, toCurrency: "HKD", toAmount: 100 }), null);
});

test("pools: a normalized list keeps dollar and Hong Kong conversions side by side", () => {
  const records = normalizeCurrencyExchanges([toUsd("u1", "2026-04-01", 403, 100), toHkd("h1", "2026-05-01", 518, 1000)]);
  assert.equal(records.length, 2);
});

// --- Separate pools ---------------------------------------------------------

test("pools: a Hong Kong buy costs what the HKD conversion that funded it cost", () => {
  const [trade] = tradesWithExchangeCost(
    [hkBuy("t1", "2026-05-10", 1000)],
    [toHkd("h1", "2026-05-01", 518, 1000)],
  );
  close(trade.amountMyr, 518);
  close(trade.exchangeRate!, 0.518);
});

test("pools: dollars never fund a Hong Kong order", () => {
  const coverage = resolveExchangeCoverage(
    [hkBuy("t1", "2026-05-10", 1000)],
    [toUsd("u1", "2026-05-01", 4030, 1000)],
  );
  const cost = coverage.costs.get("t1")!;
  assert.equal(cost.currency, "HKD");
  assert.equal(cost.uncovered, 1000);
  assert.equal(cost.effectiveRate, null);
  // And the dollar pool still holds every dollar it was given.
  close(coverage.unspentUsd, 1000);
});

test("pools: Hong Kong conversions never fund a dollar order", () => {
  const coverage = resolveExchangeCoverage(
    [usBuy("t1", "2026-05-10", 100)],
    [toHkd("h1", "2026-05-01", 518, 1000)],
  );
  assert.equal(coverage.costs.get("t1")!.uncovered, 100);
  assert.equal(coverage.coverage, 0);
  close(coverage.byCurrency.get("HKD")!.unspent, 1000);
});

test("pools: each currency reports its own coverage and average rate", () => {
  const coverage = resolveExchangeCoverage(
    [usBuy("t1", "2026-05-10", 100), hkBuy("t2", "2026-05-10", 1500)],
    [toUsd("u1", "2026-05-01", 403, 100), toHkd("h1", "2026-05-01", 518, 1000)],
  );
  const hkd = coverage.byCurrency.get("HKD")!;
  close(hkd.totalBuy, 1500);
  close(hkd.covered, 1000);
  close(hkd.coverage, 1000 / 1500);
  close(hkd.averageRecordedRate!, 0.518);
  // The dollar figures the page reports are the dollar pool's alone.
  close(coverage.totalBuyUsd, 100);
  close(coverage.coverage, 1);
  close(coverage.averageRecordedRate!, 4.03);
});

test("pools: a later HKD conversion settles an earlier Hong Kong buy", () => {
  const [trade] = tradesWithExchangeCost(
    [hkBuy("t1", "2026-05-10", 1000)],
    [toHkd("h1", "2026-05-12", 520, 1000)],
  );
  close(trade.amountMyr, 520);
});

test("pools: unexplained Hong Kong dollars are priced off the nearest HKD conversion, not a dollar one", () => {
  const [, trade] = tradesWithExchangeCost(
    [hkBuy("t0", "2026-05-02", 1000), hkBuy("t1", "2026-05-10", 500)],
    [toHkd("h1", "2026-05-01", 518, 1000), toUsd("u1", "2026-05-09", 4030, 1000)],
  );
  close(trade.amountMyr, 500 * 0.518);
});

test("pools: a Hong Kong sale inherits the HKD rate", () => {
  const [, sale] = tradesWithExchangeCost(
    [hkBuy("t1", "2026-05-10", 1000), hkBuy("t2", "2026-06-10", 400, { type: "Sell" })],
    [toHkd("h1", "2026-05-01", 518, 1000)],
  );
  close(sale.amountMyr, 400 * 0.518);
});

// --- Ringgit trades ---------------------------------------------------------

test("pools: a ringgit trade costs its own amount, with or without conversions", () => {
  const maybank: Trade = {
    id: "m1", date: "2026-05-10", platform: "moomoo", ticker: "1155.KL", type: "DCA",
    market: "MY", currency: "MYR", amount: 980, price: 9.8, units: 100,
    amountUsd: 0, priceUsd: 0, amountMyr: 0, feeMyr: 12.4,
  };
  for (const exchanges of [[], [toUsd("u1", "2026-05-01", 403, 100)]]) {
    const [trade] = tradesWithExchangeCost([maybank], exchanges);
    assert.equal(trade.amountMyr, 980);
    assert.equal(trade.exchangeRate, 1);
    assert.equal(trade.feeMyr, 12.4);
  }
  const coverage = resolveExchangeCoverage([maybank], []);
  assert.equal(coverage.costs.size, 0, "a ringgit trade draws on no pool");
});

// --- Fees -------------------------------------------------------------------

test("pools: a fee in the trade's own currency is converted at the trade's rate", () => {
  const [trade] = tradesWithExchangeCost(
    [hkBuy("t1", "2026-05-10", 1000, { fee: 18.5, feeCurrency: "HKD", feeMyr: 0 })],
    [toHkd("h1", "2026-05-01", 518, 1000)],
  );
  close(trade.feeMyr, 18.5 * 0.518);
});

test("pools: a ringgit fee on a Hong Kong trade is left as recorded", () => {
  const [trade] = tradesWithExchangeCost(
    [hkBuy("t1", "2026-05-10", 1000, { fee: 9.6, feeCurrency: "MYR", feeMyr: 9.6 })],
    [toHkd("h1", "2026-05-01", 518, 1000)],
  );
  assert.equal(trade.feeMyr, 9.6);
});

test("pools: a foreign-currency fee with no rate to carry it keeps its stored feeMyr", () => {
  const [trade] = tradesWithExchangeCost(
    [hkBuy("t1", "2026-05-10", 1000, { fee: 18.5, feeCurrency: "HKD", feeMyr: 9.5 })],
    [],
  );
  assert.equal(trade.feeMyr, 9.5);
});

test("pools: a dollar portfolio with no conversions is returned as the same array", () => {
  const trades = [usBuy("t1", "2026-05-10", 100)];
  assert.equal(tradesWithExchangeCost(trades, []), trades);
});

// --- D-5: dividends are money in the same balance ------------------------------

function dividend(overrides: Partial<Dividend> = {}): Dividend {
  return {
    id: "div-VOO-2026-06-26", ticker: "VOO", exDate: "2026-06-26", payDate: "2026-06-30",
    currency: "USD", gross: 100, withholdingTax: 30, rateToMyr: 4.1, status: "confirmed",
    ...overrides,
  };
}

test("pools: a dividend funds a later buy, at the rate it arrived with", () => {
  const [trade] = tradesWithExchangeCost(
    [usBuy("t1", "2026-07-10", 70)],
    [],
    [dividend()],
  );
  // USD 70 net (100 − 30) entered the pool at 4.1 and paid for the whole order.
  close(trade.amountMyr, 70 * 4.1);
  close(trade.exchangeRate!, 4.1);
});

test("pools: dividend dollars count as covered, which is what unexplained dollars often are", () => {
  const coverage = resolveExchangeCoverage([usBuy("t1", "2026-07-10", 70)], [], [dividend()]);
  close(coverage.coverage, 1);
  assert.equal(coverage.costs.get("t1")!.uncovered, 0);
});

test("pools: a dividend mixes with converted money at its own rate", () => {
  const coverage = resolveExchangeCoverage(
    [usBuy("t1", "2026-07-10", 100)],
    [toUsd("x1", "2026-06-01", 420, 100)],
    [dividend({ gross: 100, withholdingTax: 0, rateToMyr: 4.0 })],
  );
  // 100 at 4.20 and 100 at 4.00 in the balance: the order draws the average.
  close(coverage.costs.get("t1")!.effectiveRate!, 4.1);
});

test("pools: a dividend with no rate is left out rather than cheapening the pool", () => {
  const coverage = resolveExchangeCoverage(
    [usBuy("t1", "2026-07-10", 70)],
    [],
    [dividend({ rateToMyr: undefined })],
  );
  assert.equal(coverage.costs.get("t1")!.uncovered, 70);
  assert.equal(coverage.unspentUsd, 0);
});

test("pools: a dismissed suggestion and a ringgit payout put nothing in a pool", () => {
  const dismissed = resolveExchangeCoverage([usBuy("t1", "2026-07-10", 70)], [], [dividend({ status: "dismissed" })]);
  assert.equal(dismissed.costs.get("t1")!.uncovered, 70);
  const ringgit = resolveExchangeCoverage([usBuy("t1", "2026-07-10", 70)], [], [dividend({ currency: "MYR", ticker: "1155.KL" })]);
  assert.equal(ringgit.costs.get("t1")!.uncovered, 70);
});

test("pools: a dividend paid after the buy settles it, like a late conversion", () => {
  const coverage = resolveExchangeCoverage([usBuy("t1", "2026-06-10", 70)], [], [dividend()]);
  close(coverage.costs.get("t1")!.costMyr, 70 * 4.1);
  assert.equal(coverage.costs.get("t1")!.uncovered, 0);
});

test("pools: with no dividends recorded nothing about the pool changes", () => {
  const trades = [usBuy("t1", "2026-07-10", 100)];
  const exchanges = [toUsd("x1", "2026-06-01", 410, 100)];
  assert.deepEqual(
    JSON.stringify([...resolveExchangeCoverage(trades, exchanges, []).costs]),
    JSON.stringify([...resolveExchangeCoverage(trades, exchanges).costs]),
  );
});
