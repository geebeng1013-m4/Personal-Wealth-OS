import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  exchangeSides,
  isCurrencyCode,
  marketOfTicker,
  normalizeTradeMarket,
} from "../src/tradeCurrency";
import { normalizeCurrencyExchanges, validateCurrencyExchange } from "../src/currencyExchange";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { priceMapFrom } from "../src/marketPrices";
import { demoState } from "../src/demoData";
import { CURRENT_VERSION, migrateState } from "../src/state";
import type { CurrencyExchange, Trade, WealthState } from "../src/models";

/**
 * Task 1 of multi-market support adds the shape — market, currency, amounts in
 * that currency, fee currency — and must change no figure anywhere. These tests
 * pin both halves, and the one constraint that shaped the design: production
 * may still be an older build reading the same cloud document.
 */

function dollarTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1", date: "2026-03-02", platform: "moomoo", ticker: "VOO", type: "DCA",
    amountMyr: 20.16, amountUsd: 5, priceUsd: 540.5, units: 0.00925, feeMyr: 1.2,
    ...overrides,
  };
}

// --- The shape ---------------------------------------------------------------

test("tradeCurrency: v23 is the schema that carries market and currency", () => {
  assert.ok(CURRENT_VERSION >= 23);
});

test("tradeCurrency: a trade from before v23 is a US dollar trade with a ringgit fee", () => {
  const trade = normalizeTradeMarket(dollarTrade());
  assert.equal(trade.market, "US");
  assert.equal(trade.currency, "USD");
  assert.equal(trade.amount, 5);
  assert.equal(trade.price, 540.5);
  assert.equal(trade.fee, 1.2);
  assert.equal(trade.feeCurrency, "MYR");
});

test("tradeCurrency: every original field is kept untouched", () => {
  const before = dollarTrade({ exchangeRate: 4.032, notes: "March DCA" });
  const after = normalizeTradeMarket(before);
  for (const [key, value] of Object.entries(before)) {
    assert.deepEqual((after as unknown as Record<string, unknown>)[key], value, key);
  }
});

test("tradeCurrency: normalizing is idempotent", () => {
  const once = normalizeTradeMarket(dollarTrade());
  assert.deepEqual(normalizeTradeMarket(once), once);
});

test("tradeCurrency: the market comes from the ticker suffix", () => {
  assert.equal(marketOfTicker("VOO"), "US");
  assert.equal(marketOfTicker("1155.KL"), "MY");
  assert.equal(marketOfTicker("0700.hk"), "HK");
  assert.equal(marketOfTicker("D05.SI"), "SG");
  assert.equal(marketOfTicker("VWRA.L"), "LSE");
});

test("tradeCurrency: a currency is any three-letter code, not a closed list", () => {
  assert.ok(isCurrencyCode("HKD"));
  assert.ok(isCurrencyCode("JPY"));
  assert.ok(!isCurrencyCode("usd"));
  assert.ok(!isCurrencyCode("GBp"));
  assert.ok(!isCurrencyCode(""));
});

test("tradeCurrency: a non-dollar trade keeps its own amounts and fee currency", () => {
  const trade = normalizeTradeMarket(dollarTrade({
    ticker: "2800.HK", market: "HK", currency: "HKD",
    amount: 12050, price: 24.1, units: 500, fee: 18.5, feeCurrency: "HKD",
    amountUsd: 0, priceUsd: 0, feeMyr: 0,
  }));
  assert.equal(trade.currency, "HKD");
  assert.equal(trade.amount, 12050);
  assert.equal(trade.price, 24.1);
  assert.equal(trade.fee, 18.5);
  assert.equal(trade.feeCurrency, "HKD");
});

test("tradeCurrency: a fee in any currency other than the trade's or ringgit falls back to feeMyr", () => {
  const trade = normalizeTradeMarket(dollarTrade({
    ticker: "2800.HK", currency: "HKD", amount: 100, price: 25, fee: 3, feeCurrency: "SGD", feeMyr: 1.6,
  }));
  assert.equal(trade.feeCurrency, "MYR");
  assert.equal(trade.fee, 1.6);
});

test("tradeCurrency: a ringgit trade's fee is always read from feeMyr", () => {
  const trade = normalizeTradeMarket(dollarTrade({
    ticker: "1155.KL", currency: "MYR", amount: 980, price: 9.8, units: 100, fee: 99, feeCurrency: "MYR", feeMyr: 12.4,
  }));
  assert.equal(trade.fee, 12.4);
  assert.equal(trade.feeCurrency, "MYR");
});

// --- Older production builds share the cloud document --------------------------

test("tradeCurrency: a dollar trade edited by an older build takes the edit, not its stale copy", () => {
  // Normalized once by this build, then an older build — which only knows the
  // dollar fields — corrects the amount and fee and saves. Its spread keeps the
  // stale general fields alongside.
  const saved = normalizeTradeMarket(dollarTrade());
  const editedByOlderBuild: Trade = { ...saved, amountUsd: 6, priceUsd: 541, feeMyr: 1.5 };
  const reloaded = normalizeTradeMarket(editedByOlderBuild);
  assert.equal(reloaded.amount, 6);
  assert.equal(reloaded.price, 541);
  assert.equal(reloaded.fee, 1.5);
});

test("tradeCurrency: a conversion carries both forms, so an older build still reads it", () => {
  const record = validateCurrencyExchange({
    id: "x1", date: "2026-02-01", direction: "myr-to-usd", myrAmount: 403.39, usdAmount: 100,
  })!;
  assert.equal(record.myrAmount, 403.39);
  assert.equal(record.usdAmount, 100);
  assert.deepEqual(exchangeSides(record), { fromCurrency: "MYR", fromAmount: 403.39, toCurrency: "USD", toAmount: 100 });
  assert.equal(record.fromCurrency, "MYR");
  assert.equal(record.toAmount, 100);
});

test("tradeCurrency: converting back to ringgit reverses the sides", () => {
  const record = validateCurrencyExchange({
    id: "x2", date: "2026-02-01", direction: "usd-to-myr", myrAmount: 400, usdAmount: 100,
  })!;
  assert.equal(record.fromCurrency, "USD");
  assert.equal(record.fromAmount, 100);
  assert.equal(record.toCurrency, "MYR");
  assert.equal(record.toAmount, 400);
});

test("tradeCurrency: the ringgit and dollar amounts win over stale general fields", () => {
  const record = validateCurrencyExchange({
    id: "x3", date: "2026-02-01", direction: "myr-to-usd", myrAmount: 410, usdAmount: 100,
    fromCurrency: "MYR", fromAmount: 999, toCurrency: "USD", toAmount: 1,
  })!;
  assert.equal(record.fromAmount, 410);
  assert.equal(record.toAmount, 100);
});

test("tradeCurrency: a ringgit ↔ dollar conversion stored only in general form is still read", () => {
  const record = validateCurrencyExchange({
    id: "x4", date: "2026-02-01", fromCurrency: "USD", fromAmount: 50, toCurrency: "MYR", toAmount: 201,
  })!;
  assert.equal(record.direction, "usd-to-myr");
  assert.equal(record.usdAmount, 50);
  assert.equal(record.myrAmount, 201);
});

test("tradeCurrency: an older build's round trip of the conversions loses nothing", () => {
  const stored = normalizeCurrencyExchanges(demoState.currencyExchanges);
  // What an older build writes back: only the fields it knows.
  const writtenByOlderBuild = stored.map(({ id, date, direction, myrAmount, usdAmount, notes }) =>
    ({ id, date, direction, myrAmount, usdAmount, ...(notes ? { notes } : {}) }));
  assert.deepEqual(normalizeCurrencyExchanges(writtenByOlderBuild), stored);
  assert.equal(stored.length, demoState.currencyExchanges.length);
});

// --- No figure moves ---------------------------------------------------------

function legacyCopy(state: WealthState): WealthState {
  // A pre-v23 document: no general fields anywhere.
  const copy = structuredClone(state);
  copy.version = 22;
  copy.trades = copy.trades.map(({ market: _m, currency: _c, amount: _a, price: _p, fee: _f, feeCurrency: _fc, ...rest }) => rest);
  copy.currencyExchanges = copy.currencyExchanges.map(({ fromCurrency: _a, fromAmount: _b, toCurrency: _c, toAmount: _d, ...rest }): CurrencyExchange => rest);
  return copy;
}

test("tradeCurrency: migrating to v23 moves no portfolio figure", () => {
  const legacy = legacyCopy(demoState);
  const migrated = migrateState(structuredClone(legacy));
  const market = {
    prices: priceMapFrom([
      { ticker: "VOO", priceUsd: 690 },
      { ticker: "QQQM", priceUsd: 295 },
      { ticker: "VXUS", priceUsd: 72 },
    ]),
    usdToMyr: 4.03,
  };
  const now = new Date("2026-09-17T00:00:00Z");
  // The calculations never read the new fields, so the legacy document valued
  // as it is must agree with the migrated one to the last digit.
  const before = getPortfolioSnapshot(legacy, now, market);
  const after = getPortfolioSnapshot(migrated, now, market);
  assert.deepEqual(after, before);
  assert.ok(migrated.trades.every((trade) => trade.currency === "USD" && trade.market === "US"));
});

test("tradeCurrency: the trades' original fields survive migration exactly", () => {
  const legacy = legacyCopy(demoState);
  const migrated = migrateState(structuredClone(legacy));
  migrated.trades.forEach((trade, index) => {
    const original = legacy.trades[index];
    assert.equal(trade.amountUsd, original.amountUsd);
    assert.equal(trade.priceUsd, original.priceUsd);
    assert.equal(trade.amountMyr, original.amountMyr);
    assert.equal(trade.feeMyr, original.feeMyr);
    assert.equal(trade.amount, original.amountUsd);
    assert.equal(trade.fee, original.feeMyr);
  });
});
