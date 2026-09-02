import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getHolding, getPortfolioSnapshot } from "../src/portfolioSummary";
import { priceMapFrom } from "../src/marketPrices";
import { migrateState } from "../src/state";
import type { Trade, WealthState } from "../src/models";

/**
 * Allocation describes the risk carried NOW, so it is weighed by what the
 * holdings are worth, not by what they cost. The two agree only while every
 * holding has moved by the same amount — which is exactly the case a cost-based
 * measure quietly assumes and real markets never honour.
 */

const trades: Trade[] = [
  { id: "voo", date: "2026-04-10", platform: "moomoo", ticker: "VOO", type: "DCA",
    units: 0.4599, priceUsd: 669.037, amountUsd: 307.69, amountMyr: 1263.26, feeMyr: 0 },
  { id: "qqqm", date: "2026-04-10", platform: "moomoo", ticker: "QQQM", type: "DCA",
    units: 0.4685, priceUsd: 285.08, amountUsd: 133.56, amountMyr: 550.11, feeMyr: 0 },
];

const state = (): WealthState => migrateState({
  deviceId: "device-allocation",
  trades,
  dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } },
});

const priced = (voo: number, qqqm: number, usdToMyr: number | null = 4.0294) =>
  getPortfolioSnapshot(state(), new Date(2026, 7, 28), {
    prices: priceMapFrom([{ ticker: "VOO", priceUsd: voo }, { ticker: "QQQM", priceUsd: qqqm }]),
    ...(usdToMyr === null ? {} : { usdToMyr }),
  });

test("allocation: a fully priced portfolio is weighed by market value", () => {
  const p = priced(707.878, 296.288);
  assert.equal(p.allocationBasis, "market");
  // VOO is worth MYR 1,311.78 of MYR 1,871.11 — 70.1%, not the 69.7% its cost
  // share implies.
  assert.ok(Math.abs(getHolding(p, "VOO")!.actualAllocation - 0.7011) < 0.0005);
  assert.ok(Math.abs(getHolding(p, "QQQM")!.actualAllocation - 0.2989) < 0.0005);
});

test("allocation: the two measures diverge exactly when the holdings do", () => {
  // Same shares, same cost. VOO doubles and QQQM does not: cost weights cannot
  // see that, market weights must.
  const p = priced(1338.074, 296.288);
  const voo = getHolding(p, "VOO")!;
  assert.ok(voo.actualAllocation > 0.8, `cost says 69.7%, market says ${voo.actualAllocation}`);
  // And the drift that drives rebalancing follows the same weights.
  assert.ok(Math.abs(voo.drift - (voo.actualAllocation - 0.7)) < 1e-12);
  assert.ok(p.maxAbsoluteDrift > 0.1, "a doubled holding is badly overweight, and must say so");
});

test("allocation: drift and maxAbsoluteDrift never disagree with the weights they came from", () => {
  const p = priced(707.878, 296.288);
  const worst = p.holdings.reduce((max, h) => Math.max(max, Math.abs(h.drift)), 0);
  assert.ok(Math.abs(p.maxAbsoluteDrift - worst) < 1e-12);
  for (const holding of p.holdings) {
    assert.ok(Math.abs(holding.drift - (holding.actualAllocation - holding.targetAllocation)) < 1e-12);
  }
});

// --- Falling back honestly -------------------------------------------------

test("allocation: with no prices at all it falls back to cost, and says so", () => {
  const p = getPortfolioSnapshot(state());
  assert.equal(p.allocationBasis, "cost");
  assert.ok(Math.abs(getHolding(p, "VOO")!.actualAllocation - 0.6966) < 0.0005);
});

test("allocation: a partial valuation stays on cost rather than mixing the two", () => {
  // Weighing one holding at today's value and the other at what it cost would
  // produce percentages describing no portfolio that exists.
  const p = getPortfolioSnapshot(state(), new Date(2026, 7, 28), {
    prices: priceMapFrom([{ ticker: "VOO", priceUsd: 707.878 }]),
    usdToMyr: 4.0294,
  });
  assert.equal(p.valuationStatus, "partial");
  assert.equal(p.allocationBasis, "cost");
  assert.ok(Math.abs(getHolding(p, "VOO")!.actualAllocation - 0.6966) < 0.0005);
});

test("allocation: prices without an FX rate cannot weigh in ringgit, and the label admits it", () => {
  // Every marketValueMyr is null here. Claiming a market basis would be a lie,
  // and dividing by their total would be a divide by zero.
  const p = priced(707.878, 296.288, null);
  assert.equal(p.valuationStatus, "complete");
  assert.equal(p.allocationBasis, "cost");
  assert.ok(Math.abs(getHolding(p, "VOO")!.actualAllocation - 0.6966) < 0.0005);
});

test("allocation: weights always sum to one, on either basis", () => {
  for (const p of [priced(707.878, 296.288), getPortfolioSnapshot(state())]) {
    const total = p.holdings.reduce((sum, h) => sum + h.actualAllocation, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${p.allocationBasis} basis summed to ${total}`);
  }
});

test("allocation: a sold-out holding carries no weight and no drift of its own", () => {
  const closed = migrateState({
    deviceId: "device-allocation-closed",
    trades: [
      ...trades,
      { id: "sell", date: "2026-05-01", platform: "moomoo", ticker: "QQQM", type: "Sell",
        units: 0.4685, priceUsd: 296.288, amountUsd: 138.81, amountMyr: 559.32, feeMyr: 0 },
    ],
    dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } },
  });
  const p = getPortfolioSnapshot(closed, new Date(2026, 7, 28), {
    prices: priceMapFrom([{ ticker: "VOO", priceUsd: 707.878 }, { ticker: "QQQM", priceUsd: 296.288 }]),
    usdToMyr: 4.0294,
  });
  assert.equal(getHolding(p, "QQQM")!.actualAllocation, 0);
  assert.equal(getHolding(p, "VOO")!.actualAllocation, 1);
});

test("allocation: switching basis never disturbs cost, units or returns", () => {
  const flat = getPortfolioSnapshot(state());
  const market = priced(707.878, 296.288);
  assert.equal(market.totalInvestedMyr, flat.totalInvestedMyr);
  assert.equal(market.totalInvestedUsd, flat.totalInvestedUsd);
  assert.equal(market.totalUnits, flat.totalUnits);
  assert.equal(market.totalFeesMyr, flat.totalFeesMyr);
  for (const holding of market.holdings) {
    const before = getHolding(flat, holding.ticker)!;
    assert.equal(holding.investedMyr, before.investedMyr);
    assert.equal(holding.units, before.units);
    assert.equal(holding.averageCostUsd, before.averageCostUsd);
  }
});
