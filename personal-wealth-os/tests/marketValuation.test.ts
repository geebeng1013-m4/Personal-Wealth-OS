import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  normalizeQuotes, isUsablePrice, isUsableRate, getPrice, priceMapFrom,
} from "../src/marketPrices";
import { getPortfolioSnapshot, getHolding } from "../src/portfolioSummary";
import { buildOverviewModel } from "../src/overview";
import { cloneDefaultState, migrateState, CURRENT_VERSION } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);

/**
 * Step 20: live prices become real valuation, and an absent price stays
 * absent. The rule under test throughout is that unknown is never zero.
 */

// --- Price normalization ---------------------------------------------------

test("prices: only a finite number above zero counts as a price", () => {
  for (const good of [0.01, 1, 704.2, 1e6]) assert.equal(isUsablePrice(good), true, `${good}`);
  for (const bad of [0, -1, -0.01, Number.NaN, Infinity, -Infinity, null, undefined, "10", {}, []]) {
    assert.equal(isUsablePrice(bad), false, `${String(bad)} must not be a price`);
  }
  // FX follows the same rule.
  assert.equal(isUsableRate(4.2), true);
  for (const bad of [0, -4, Number.NaN, Infinity, null, undefined, "4.2"]) {
    assert.equal(isUsableRate(bad), false, `${String(bad)} must not be a rate`);
  }
});

test("prices: a good payload normalises to validated entries", () => {
  const prices = normalizeQuotes({
    quotes: [
      { symbol: "voo", price: 704.2, currency: "USD", marketState: "REGULAR", previousClose: 700, quotedAt: 1234 },
    ],
  });
  const voo = getPrice(prices, "VOO");
  assert.ok(voo);
  assert.equal(voo.ticker, "VOO", "tickers are upper-cased for lookup");
  assert.equal(voo.priceUsd, 704.2);
  assert.equal(voo.previousClose, 700);
  assert.equal(voo.quotedAt, 1234);
  assert.equal(getPrice(prices, "voo")?.priceUsd, 704.2, "lookup is case-insensitive");
});

test("prices: every malformed shape degrades to no prices, never to zero", () => {
  for (const payload of [
    null, undefined, 42, "nope", [], {},
    { quotes: null }, { quotes: "x" }, { quotes: [null, 5, "a"] },
    { quotes: [{ symbol: "VOO" }] },                       // no price
    { quotes: [{ symbol: "VOO", price: 0 }] },             // zero is not a price
    { quotes: [{ symbol: "VOO", price: -3 }] },
    { quotes: [{ symbol: "VOO", price: "704" }] },          // string is not a price
    { quotes: [{ symbol: "", price: 10 }] },                // no ticker
    { quotes: [{ symbol: "VOO", error: "upstream 404" }] }, // explicit failure
  ]) {
    const prices = normalizeQuotes(payload);
    assert.equal(prices.size, 0, `payload produced a price: ${JSON.stringify(payload)}`);
  }
});

test("prices: one bad quote does not discard the good ones", () => {
  const prices = normalizeQuotes({
    quotes: [
      { symbol: "VOO", price: 704.2 },
      { symbol: "QQQM", price: 0 },
      { symbol: "VXUS", error: "timeout" },
      { symbol: "AAPL", price: 313.45 },
    ],
  });
  assert.deepEqual([...prices.keys()].sort(), ["AAPL", "VOO"]);
});

// --- Valuation -------------------------------------------------------------

/** One holding: 10 units at $100, so invested = $1,000 / MYR 4,250. */
function onePosition(): WealthState {
  return migrateState({
    deviceId: "s20",
    dca: { monthly: 300, targets: { TEST: 1 } },
    trades: [{
      id: "t1", date: "2026-01-05", platform: "moomoo", ticker: "TEST", type: "DCA",
      amountMyr: 4250, amountUsd: 1000, priceUsd: 100, feeMyr: 0,
    }],
  });
}

test("valuation: with no market input every valuation field stays unknown", () => {
  const snapshot = getPortfolioSnapshot(onePosition());
  assert.equal(snapshot.valuationStatus, "unavailable");
  assert.equal(snapshot.totalInvestmentValueUsd, null);
  assert.equal(snapshot.totalInvestmentValueMyr, null);
  assert.equal(snapshot.unrealizedPnlUsd, null);
  assert.equal(snapshot.unrealizedPnlMyr, null);
  assert.equal(snapshot.unrealizedPnlPercent, null);
  assert.equal(snapshot.valuedAt, null);
  // Recorded facts are unaffected.
  assert.equal(snapshot.totalInvestedUsd, 1000);
  assert.equal(snapshot.totalInvestedMyr, 4250);
});

test("valuation: a known price produces market value and P&L", () => {
  const snapshot = getPortfolioSnapshot(onePosition(), NOW, {
    prices: priceMapFrom([{ ticker: "TEST", priceUsd: 120, quotedAt: 555 }]),
    usdToMyr: 4.25,
  });
  const holding = getHolding(snapshot, "TEST");
  assert.ok(holding);
  assert.equal(holding.priceUsd, 120);
  assert.equal(holding.marketValueUsd, 1200, "10 units x 120");
  assert.equal(holding.marketValueMyr, 5100, "1200 x 4.25");
  assert.equal(holding.unrealizedPnlUsd, 200, "1200 - 1000 invested");
  assert.equal(holding.unrealizedPnlMyr, 850, "5100 - 4250 invested");
  assert.equal(holding.unrealizedPnlPercent, 0.2);

  assert.equal(snapshot.valuationStatus, "complete");
  assert.equal(snapshot.totalInvestmentValueUsd, 1200);
  assert.equal(snapshot.totalInvestmentValueMyr, 5100);
  assert.equal(snapshot.unrealizedPnlUsd, 200);
  assert.equal(snapshot.unrealizedPnlPercent, 0.2);
  assert.equal(snapshot.valuedAt, 555);
  assert.equal(snapshot.usdToMyrUsed, 4.25);
});

test("valuation: a loss is reported as a loss, not as a missing price", () => {
  const snapshot = getPortfolioSnapshot(onePosition(), NOW, {
    prices: priceMapFrom([{ ticker: "TEST", priceUsd: 80 }]),
    usdToMyr: 4.25,
  });
  assert.equal(snapshot.unrealizedPnlUsd, -200);
  assert.equal(snapshot.unrealizedPnlPercent, -0.2);
  assert.equal(snapshot.valuationStatus, "complete");
});

test("valuation: a flat price yields exactly zero P&L", () => {
  const snapshot = getPortfolioSnapshot(onePosition(), NOW, {
    prices: priceMapFrom([{ ticker: "TEST", priceUsd: 100 }]),
    usdToMyr: 4.25,
  });
  assert.equal(snapshot.unrealizedPnlUsd, 0);
  assert.equal(snapshot.unrealizedPnlPercent, 0);
  assert.equal(snapshot.valuationStatus, "complete", "zero P&L is a valuation, not a failure");
});

test("valuation: an unusable price is ignored rather than valuing at zero", () => {
  for (const bad of [0, -5, Number.NaN, Infinity]) {
    const snapshot = getPortfolioSnapshot(onePosition(), NOW, {
      prices: priceMapFrom([{ ticker: "TEST", priceUsd: bad }]),
      usdToMyr: 4.25,
    });
    assert.equal(snapshot.valuationStatus, "unavailable", `price ${bad} was accepted`);
    assert.equal(snapshot.totalInvestmentValueUsd, null);
    assert.equal(snapshot.unrealizedPnlUsd, null, `price ${bad} produced a fake loss`);
  }
});

// --- Partial valuation -----------------------------------------------------

/** Three holdings, each 10 units at $100. */
function threePositions(): WealthState {
  return migrateState({
    deviceId: "s20p",
    dca: { monthly: 300, targets: { AAA: 0.4, BBB: 0.3, CCC: 0.3 } },
    trades: ["AAA", "BBB", "CCC"].map((ticker, index) => ({
      id: `t${index}`, date: "2026-01-05", platform: "moomoo", ticker, type: "DCA",
      amountMyr: 4250, amountUsd: 1000, priceUsd: 100, feeMyr: 0,
    })),
  });
}

test("valuation: an unpriced holding is excluded, never counted as worthless", () => {
  const snapshot = getPortfolioSnapshot(threePositions(), NOW, {
    prices: priceMapFrom([
      { ticker: "AAA", priceUsd: 120 },
      { ticker: "BBB", priceUsd: 110 },
      // CCC has no quote.
    ]),
    usdToMyr: 4.25,
  });

  assert.equal(snapshot.valuationStatus, "partial");
  assert.deepEqual(snapshot.pricedTickers.sort(), ["AAA", "BBB"]);
  assert.deepEqual(snapshot.unpricedTickers, ["CCC"]);

  // Totals cover the priced holdings only: 1200 + 1100.
  assert.equal(snapshot.totalInvestmentValueUsd, 2300);
  // P&L is measured against the cost of those same two holdings (2000), not
  // against all three (3000) — otherwise the missing quote would read as a loss.
  assert.equal(snapshot.unrealizedPnlUsd, 300);
  assert.equal(snapshot.unrealizedPnlPercent, 0.15);

  const ccc = getHolding(snapshot, "CCC");
  assert.equal(ccc?.marketValueUsd, null);
  assert.equal(ccc?.unrealizedPnlUsd, null);
  assert.equal(ccc?.investedUsd, 1000, "its recorded cost is still known");
});

test("valuation: no holdings at all is unavailable, not a zero valuation", () => {
  const snapshot = getPortfolioSnapshot(migrateState({ deviceId: "s20e", trades: [] }), NOW, {
    prices: priceMapFrom([{ ticker: "VOO", priceUsd: 704 }]),
    usdToMyr: 4.25,
  });
  assert.equal(snapshot.valuationStatus, "unavailable");
  assert.equal(snapshot.totalInvestmentValueUsd, null);
  assert.equal(snapshot.unrealizedPnlUsd, null);
});

// --- Currency --------------------------------------------------------------

test("valuation: without a usable FX rate the MYR figures stay unknown", () => {
  for (const rate of [undefined, null, 0, -1, Number.NaN, Infinity]) {
    const snapshot = getPortfolioSnapshot(onePosition(), NOW, {
      prices: priceMapFrom([{ ticker: "TEST", priceUsd: 120 }]),
      usdToMyr: rate as number | null,
    });
    // USD is still known — only the conversion is missing.
    assert.equal(snapshot.totalInvestmentValueUsd, 1200, `rate ${String(rate)}`);
    assert.equal(snapshot.unrealizedPnlUsd, 200, `rate ${String(rate)}`);
    assert.equal(snapshot.totalInvestmentValueMyr, null, `rate ${String(rate)} invented a MYR value`);
    assert.equal(snapshot.unrealizedPnlMyr, null, `rate ${String(rate)} invented a MYR P&L`);
    assert.equal(snapshot.usdToMyrUsed, null);
  }
});

// --- Nothing else moved ----------------------------------------------------

test("valuation: prices never change cost basis, allocation or drift", () => {
  const state = cloneDefaultState();
  const without = getPortfolioSnapshot(state);
  const withPrices = getPortfolioSnapshot(state, NOW, {
    prices: priceMapFrom([
      { ticker: "VOO", priceUsd: 704.2 },
      { ticker: "QQQM", priceUsd: 250.1 },
      { ticker: "VXUS", priceUsd: 70.5 },
    ]),
    usdToMyr: 4.25,
  });

  assert.equal(withPrices.totalInvestedMyr, without.totalInvestedMyr);
  assert.equal(withPrices.totalInvestedUsd, without.totalInvestedUsd);
  assert.equal(withPrices.totalUnits, without.totalUnits);
  assert.equal(withPrices.maxAbsoluteDrift, without.maxAbsoluteDrift);
  assert.equal(withPrices.realizedPnlUsd, without.realizedPnlUsd);
  assert.equal(withPrices.totalFeesMyr, without.totalFeesMyr);
  assert.deepEqual(withPrices.allocation, without.allocation);
  assert.deepEqual(withPrices.targetAllocation, without.targetAllocation);
  for (const holding of withPrices.holdings) {
    const before = getHolding(without, holding.ticker)!;
    assert.equal(holding.averageCostUsd, before.averageCostUsd, `${holding.ticker} average cost`);
    assert.equal(holding.units, before.units, `${holding.ticker} units`);
    assert.equal(holding.drift, before.drift, `${holding.ticker} drift`);
  }
});

test("valuation: the Dashboard model is unaffected while prices are unknown", () => {
  // buildOverviewModel takes no market input, so the Dashboard keeps its
  // pre-Step-20 figures exactly.
  const state = cloneDefaultState();
  const model = buildOverviewModel(state, NOW);
  assert.equal(model.portfolio.valuationStatus, "unavailable");
  assert.equal(model.portfolio.totalInvestmentValueMyr, null);
  assert.equal(model.trackedWealth.invested, model.portfolio.totalInvestedMyr);
});

// --- Persistence -----------------------------------------------------------

test("valuation: a live price never reaches persisted state", () => {
  const state = onePosition();
  const before = JSON.stringify(state);
  const keys = Object.keys(state);

  getPortfolioSnapshot(state, NOW, {
    prices: priceMapFrom([{ ticker: "TEST", priceUsd: 120 }]),
    usdToMyr: 4.25,
  });

  assert.equal(JSON.stringify(state), before, "state was mutated by valuation");
  assert.deepEqual(Object.keys(state), keys, "valuation added a persisted field");
  // Live-only fields must never appear in persisted state. `priceUsd` is
  // deliberately absent from this list: trades legitimately record the price
  // paid at the time, which is a recorded fact, not a live quote.
  const serialized = JSON.stringify(state);
  for (const leaked of ["marketValue", "unrealized", "quotedAt", "usdToMyrUsed", "valuationStatus", "pricedTickers"]) {
    assert.equal(serialized.includes(`"${leaked}"`), false, `${leaked} was persisted`);
  }
  // And the recorded trade price is untouched by valuation.
  assert.equal(state.trades[0]!.priceUsd, 100, "the recorded trade price changed");
  assert.ok(CURRENT_VERSION >= 17, "valuation must not require a schema bump");
});
