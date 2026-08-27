import assert from "node:assert/strict";
import { test } from "./testHarness";
import { tradeUnits, calculatePositionCostBasis, percent, type CostBasisTrade } from "../src/rules";

function trade(overrides: Partial<CostBasisTrade> & Pick<CostBasisTrade, "date" | "type">): CostBasisTrade {
  return {
    ticker: "VOO",
    amountUsd: 0,
    amountMyr: 0,
    priceUsd: 0,
    units: undefined,
    feeMyr: 0,
    ...overrides,
  };
}

test("tradeUnits: prefers an explicit positive units value over derivation", () => {
  assert.equal(tradeUnits({ priceUsd: 100, amountUsd: 1000, units: 5 }), 5);
});

test("tradeUnits: derives units from amount/price when units is missing", () => {
  assert.equal(tradeUnits({ priceUsd: 50, amountUsd: 500, units: undefined }), 10);
});

test("tradeUnits: returns 0 when price or amount is non-positive", () => {
  assert.equal(tradeUnits({ priceUsd: 0, amountUsd: 500, units: undefined }), 0);
  assert.equal(tradeUnits({ priceUsd: 50, amountUsd: 0, units: undefined }), 0);
});

test("calculatePositionCostBasis: accumulates units and cost basis across buys", () => {
  const trades: CostBasisTrade[] = [
    trade({ date: "2026-01-01", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4250, feeMyr: 5 }),
    trade({ date: "2026-02-01", type: "DCA", units: 5, priceUsd: 110, amountUsd: 550, amountMyr: 2337.5, feeMyr: 5 }),
  ];
  const basis = calculatePositionCostBasis(trades, "VOO");
  assert.equal(basis.units, 15);
  assert.equal(basis.costBasisUsd, 1550);
  assert.equal(basis.costBasisMyr, 4250 + 5 + 2337.5 + 5);
  assert.equal(basis.feesMyr, 10);
  assert.equal(Math.round(basis.averageCostUsd * 100) / 100, Math.round((1550 / 15) * 100) / 100);
});

test("calculatePositionCostBasis: a partial sell removes cost basis proportionally and books realized P&L", () => {
  const trades: CostBasisTrade[] = [
    trade({ date: "2026-01-01", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 0 }),
    // Sell half the position at a higher price.
    trade({ date: "2026-03-01", type: "Sell", units: 5, priceUsd: 120, amountUsd: 600, amountMyr: 2520, feeMyr: 10 }),
  ];
  const basis = calculatePositionCostBasis(trades, "VOO");
  assert.equal(basis.units, 5);
  assert.equal(basis.costBasisUsd, 500); // half of the original 1000 cost basis remains
  assert.equal(basis.costBasisMyr, 2100); // half of the original 4200 MYR cost basis remains
  assert.equal(basis.realizedPnlUsd, 600 - 500); // proceeds minus removed cost
  assert.equal(basis.feesMyr, 10);
});

test("calculatePositionCostBasis: selling the full position zeroes out units and cost basis", () => {
  const trades: CostBasisTrade[] = [
    trade({ date: "2026-01-01", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 0 }),
    trade({ date: "2026-03-01", type: "Sell", units: 10, priceUsd: 90, amountUsd: 900, amountMyr: 3780, feeMyr: 0 }),
  ];
  const basis = calculatePositionCostBasis(trades, "VOO");
  assert.equal(basis.units, 0);
  assert.equal(basis.costBasisUsd, 0);
  assert.equal(basis.costBasisMyr, 0);
  assert.equal(basis.realizedPnlUsd, 900 - 1000);
});

test("calculatePositionCostBasis: a sell with no prior position is ignored (no negative units)", () => {
  const trades: CostBasisTrade[] = [
    trade({ date: "2026-01-01", type: "Sell", units: 5, priceUsd: 100, amountUsd: 500, amountMyr: 2100, feeMyr: 0 }),
  ];
  const basis = calculatePositionCostBasis(trades, "VOO");
  assert.equal(basis.units, 0);
  assert.equal(basis.realizedPnlUsd, 0);
});

test("calculatePositionCostBasis: trades are processed in date order regardless of input order", () => {
  const buyThenSell: CostBasisTrade[] = [
    trade({ date: "2026-01-01", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 0 }),
    trade({ date: "2026-02-01", type: "Sell", units: 10, priceUsd: 120, amountUsd: 1200, amountMyr: 5040, feeMyr: 0 }),
  ];
  const outOfOrder = [...buyThenSell].reverse();
  const basisInOrder = calculatePositionCostBasis(buyThenSell, "VOO");
  const basisReversed = calculatePositionCostBasis(outOfOrder, "VOO");
  assert.deepEqual(basisReversed, basisInOrder);
});

test("percent: formats a fraction as a rounded percentage string", () => {
  assert.equal(percent(0.0821, 1), "8.2%");
  assert.equal(percent(1), "100%");
});

test("percent: guards against non-finite input", () => {
  assert.equal(percent(Infinity), "0%");
  assert.equal(percent(NaN), "0%");
});
