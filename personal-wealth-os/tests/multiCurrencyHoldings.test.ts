import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getPortfolioExposure, getPortfolioSnapshot, type ValuationInputs } from "../src/portfolioSummary";
import { priceMapFrom } from "../src/marketPrices";
import { calculatePositionCostBasis } from "../src/rules";
import { cloneDefaultState } from "../src/state";
import type { CurrencyExchange, Trade, WealthState } from "../src/models";

/**
 * MM-4: every holding in its own currency, and in ringgit.
 *
 * The portfolio is the example from the multi-market plan preview: US ETFs
 * funded at MYR 4.03, a Hong Kong ETF at 0.518, DBS at 3.12, and Maybank bought
 * straight in ringgit. Its figures are the ones the preview's table shows.
 */

const close = (actual: number | null | undefined, expected: number, label = "") =>
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < 0.005,
    `${label} expected ${expected}, got ${actual}`);

function trade(overrides: Partial<Trade> & Pick<Trade, "id" | "ticker">): Trade {
  return {
    date: "2026-09-10", platform: "moomoo", type: "DCA",
    amountMyr: 0, amountUsd: 0, priceUsd: 0, feeMyr: 0,
    ...overrides,
  };
}

const TRADES: Trade[] = [
  trade({ id: "voo", ticker: "VOO", amountUsd: 307.69, priceUsd: 669.04, units: 0.4599 }),
  trade({ id: "qqqm", ticker: "QQQM", amountUsd: 133.56, priceUsd: 285.08, units: 0.4685 }),
  trade({ id: "vwra", ticker: "VWRA.L", market: "LSE", currency: "USD", amountUsd: 700, priceUsd: 140, units: 5 }),
  trade({ id: "tracker", ticker: "2800.HK", market: "HK", currency: "HKD", amount: 12050, price: 24.1, units: 500 }),
  trade({ id: "maybank", ticker: "1155.KL", market: "MY", currency: "MYR", amount: 2940, price: 9.8, units: 300 }),
  trade({ id: "dbs", ticker: "D05.SI", market: "SG", currency: "SGD", amount: 420, price: 42, units: 10 }),
];

const EXCHANGES: CurrencyExchange[] = [
  { id: "usd", date: "2026-09-01", direction: "myr-to-usd", myrAmount: 1141.25 * 4.03, usdAmount: 1141.25 },
  { id: "hkd", date: "2026-09-01", fromCurrency: "MYR", fromAmount: 12050 * 0.518, toCurrency: "HKD", toAmount: 12050 },
  { id: "sgd", date: "2026-09-01", fromCurrency: "MYR", fromAmount: 420 * 3.12, toCurrency: "SGD", toAmount: 420 },
];

function portfolio(trades = TRADES, exchanges = EXCHANGES): WealthState {
  const state = cloneDefaultState();
  state.trades = trades;
  state.currencyExchanges = exchanges;
  state.dca = { ...state.dca, targets: {} };
  return state;
}

const MARKET: ValuationInputs = {
  prices: priceMapFrom([
    { ticker: "VOO", priceUsd: 690, currency: "USD" },
    { ticker: "QQQM", priceUsd: 295, currency: "USD" },
    { ticker: "VWRA.L", priceUsd: 144, currency: "USD" },
    { ticker: "2800.HK", priceUsd: 25, currency: "HKD" },
    { ticker: "1155.KL", priceUsd: 10.12, currency: "MYR" },
    { ticker: "D05.SI", priceUsd: 43.5, currency: "SGD" },
  ]),
  usdToMyr: 4.03,
  ratesToMyr: new Map([["HKD", 0.518], ["SGD", 3.12], ["MYR", 1]]),
};

const holding = (snapshot: ReturnType<typeof getPortfolioSnapshot>, ticker: string) =>
  snapshot.holdings.find((item) => item.ticker === ticker)!;

// --- Each holding ------------------------------------------------------------

test("holdings: a Hong Kong holding is valued in HKD, then in ringgit at the HKD rate", () => {
  const tracker = holding(getPortfolioSnapshot(portfolio(), new Date(), MARKET), "2800.HK");
  assert.equal(tracker.market, "HK");
  assert.equal(tracker.currency, "HKD");
  close(tracker.investedLocal, 12050);
  close(tracker.averageCostLocal, 24.1);
  close(tracker.priceLocal, 25);
  close(tracker.marketValueLocal, 12500);
  close(tracker.unrealizedPnlLocal, 450);
  close(tracker.investedMyr, 6241.9);
  close(tracker.marketValueMyr, 6475);
  close(tracker.unrealizedPnlMyr, 233.1);
  close(tracker.rateToMyr, 0.518);
});

test("holdings: a Malaysian holding needs no exchange rate at all", () => {
  const snapshot = getPortfolioSnapshot(portfolio(), new Date(), { ...MARKET, usdToMyr: null, ratesToMyr: new Map() });
  const maybank = holding(snapshot, "1155.KL");
  close(maybank.investedMyr, 2940);
  close(maybank.marketValueMyr, 3036);
  close(maybank.unrealizedPnlMyr, 96);
  assert.equal(maybank.rateToMyr, 1);
});

test("holdings: the dollar fields hold dollars only", () => {
  const snapshot = getPortfolioSnapshot(portfolio(), new Date(), MARKET);
  const tracker = holding(snapshot, "2800.HK");
  assert.equal(tracker.investedUsd, 0);
  assert.equal(tracker.averageCostUsd, 0);
  assert.equal(tracker.priceUsd, null);
  assert.equal(tracker.marketValueUsd, null);
  assert.equal(tracker.unrealizedPnlPercent, null);

  const vwra = holding(snapshot, "VWRA.L");
  assert.equal(vwra.market, "LSE");
  assert.equal(vwra.currency, "USD", "a London listing priced in dollars is a dollar holding");
  close(vwra.marketValueUsd, 720);
  close(vwra.marketValueMyr, 2901.6);
});

test("holdings: a quote in another currency is not a price for the holding", () => {
  const prices = priceMapFrom([{ ticker: "2800.HK", priceUsd: 3.2, currency: "USD" }]);
  const tracker = holding(getPortfolioSnapshot(portfolio(), new Date(), { ...MARKET, prices }), "2800.HK");
  assert.equal(tracker.priceLocal, null);
  assert.equal(tracker.marketValueMyr, null);
});

test("holdings: the cost basis of a position follows its own currency through a sale", () => {
  const trades = [
    trade({ id: "b", ticker: "2800.HK", currency: "HKD", amount: 12050, price: 24.1, units: 500 }),
    trade({ id: "s", ticker: "2800.HK", currency: "HKD", type: "Sell", date: "2026-09-12", amount: 5000, price: 25, units: 200 }),
  ];
  const basis = calculatePositionCostBasis(trades, "2800.HK");
  assert.equal(basis.currency, "HKD");
  close(basis.units, 300);
  close(basis.costBasisLocal, 7230);
  close(basis.realizedPnlLocal, 5000 - 4820);
  assert.equal(basis.costBasisUsd, 0);
  assert.equal(basis.realizedPnlUsd, 0);
});

// --- The portfolio -------------------------------------------------------------

test("portfolio: every currency adds up in ringgit", () => {
  const snapshot = getPortfolioSnapshot(portfolio(), new Date(), MARKET);
  assert.equal(snapshot.valuationStatus, "complete");
  // The preview's table, unrounded: VOO 1,278.84 + QQQM 556.99 + VWRA 2,901.60
  // + Tracker 6,475 + Maybank 3,036 + DBS 1,357.20 = RM 15,605.62.
  const value = (0.4599 * 690 + 0.4685 * 295 + 720) * 4.03 + 12500 * 0.518 + 3036 + 435 * 3.12;
  const invested = 1141.25 * 4.03 + 12050 * 0.518 + 2940 + 420 * 3.12;
  close(snapshot.totalInvestmentValueMyr, value);
  close(snapshot.totalInvestmentValueMyr, 15605.62);
  close(snapshot.totalInvestedMyr, invested);
  close(snapshot.unrealizedPnlMyr, value - invested);
  assert.equal(snapshot.allocationBasis, "market");
});

test("portfolio: the dollar totals cover dollar holdings only", () => {
  const snapshot = getPortfolioSnapshot(portfolio(), new Date(), MARKET);
  close(snapshot.totalInvestedUsd, 1141.25);
  close(snapshot.totalInvestmentValueUsd, 0.4599 * 690 + 0.4685 * 295 + 720);
});

test("portfolio: one currency with no rate leaves the ringgit total unknown, not smaller", () => {
  const snapshot = getPortfolioSnapshot(portfolio(), new Date(), { ...MARKET, ratesToMyr: new Map([["SGD", 3.12]]) });
  const tracker = holding(snapshot, "2800.HK");
  assert.notEqual(tracker.marketValueLocal, null, "the Hong Kong price is still known");
  assert.equal(tracker.marketValueMyr, null);
  assert.equal(snapshot.totalInvestmentValueMyr, null);
  assert.equal(snapshot.allocationBasis, "cost", "weights cannot be taken from values that are not all known");
});

test("portfolio: holdings are grouped by currency, in that currency and in ringgit", () => {
  const snapshot = getPortfolioSnapshot(portfolio(), new Date(), MARKET);
  const byCurrency = new Map(snapshot.byCurrency.map((group) => [group.currency, group]));
  assert.deepEqual([...byCurrency.keys()].sort(), ["HKD", "MYR", "SGD", "USD"]);

  const usd = byCurrency.get("USD")!;
  assert.deepEqual(usd.tickers.sort(), ["QQQM", "VOO", "VWRA.L"]);
  close(usd.investedLocal, 1141.25);
  close(usd.marketValueLocal, 0.4599 * 690 + 0.4685 * 295 + 720);

  const hkd = byCurrency.get("HKD")!;
  close(hkd.marketValueLocal, 12500);
  close(hkd.marketValueMyr, 6475);
  close(hkd.unrealizedPnlMyr, 233.1);
  assert.equal(hkd.valuationStatus, "complete");

  // Largest ringgit cost first.
  assert.equal(snapshot.byCurrency[0].currency, "HKD");
});

test("portfolio: a US-only portfolio has a single dollar group", () => {
  const snapshot = getPortfolioSnapshot(portfolio(TRADES.slice(0, 2)), new Date(), MARKET);
  assert.equal(snapshot.byCurrency.length, 1);
  assert.equal(snapshot.byCurrency[0].currency, "USD");
});

// --- MM-7: where the money is ------------------------------------------------------

test("exposure: the portfolio splits by market and, separately, by currency", () => {
  const exposure = getPortfolioExposure(getPortfolioSnapshot(portfolio(), new Date(), MARKET));
  assert.equal(exposure.basis, "market");
  const us = (0.4599 * 690 + 0.4685 * 295) * 4.03;
  const london = 720 * 4.03;
  const hk = 12500 * 0.518;
  const my = 3036;
  const sg = 435 * 3.12;
  const total = us + london + hk + my + sg;
  close(exposure.totalMyr, total);

  const market = new Map(exposure.markets.map((slice) => [slice.key, slice.share]));
  close(market.get("US"), us / total);
  close(market.get("LSE"), london / total);
  close(market.get("HK"), hk / total);
  close(market.get("MY"), my / total);
  close(market.get("SG"), sg / total);

  const currency = new Map(exposure.currencies.map((slice) => [slice.key, slice.share]));
  // The London ETF is priced in dollars, so it is dollar exposure.
  close(currency.get("USD"), (us + london) / total);
  close(currency.get("MYR"), my / total);
  assert.equal(exposure.currencies.length, 4);
  assert.equal(exposure.markets.length, 5);
  close(exposure.markets.reduce((sum, slice) => sum + slice.share, 0), 1);
  assert.equal(exposure.markets[0].key, "HK", "largest first");
});

test("exposure: without every ringgit value it splits by cost, as the allocation does", () => {
  const exposure = getPortfolioExposure(getPortfolioSnapshot(portfolio(), new Date(), { ...MARKET, ratesToMyr: new Map() }));
  assert.equal(exposure.basis, "cost");
  const invested = 1141.25 * 4.03 + 12050 * 0.518 + 2940 + 420 * 3.12;
  close(exposure.totalMyr, invested);
  close(new Map(exposure.currencies.map((slice) => [slice.key, slice.share])).get("MYR"), 2940 / invested);
});

test("exposure: a US-only portfolio is one market and one currency", () => {
  const exposure = getPortfolioExposure(getPortfolioSnapshot(portfolio(TRADES.slice(0, 2)), new Date(), MARKET));
  assert.deepEqual(exposure.markets.map((slice) => slice.key), ["US"]);
  assert.deepEqual(exposure.currencies.map((slice) => slice.key), ["USD"]);
  close(exposure.markets[0].share, 1);
});
