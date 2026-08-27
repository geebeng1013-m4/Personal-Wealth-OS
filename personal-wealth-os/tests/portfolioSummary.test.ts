import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getHolding, getPortfolioSnapshot } from "../src/portfolioSummary";
import { calculatePositionCostBasis, portfolioSummary } from "../src/rules";
import { advisorRecommendations, ADVISOR_RECOMMENDATION_IDS } from "../src/advisor";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { Trade, WealthState } from "../src/models";

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-portfolio", ...overrides });
}

function trade(overrides: Partial<Trade> & Pick<Trade, "id" | "ticker" | "type">): Trade {
  return {
    date: "2026-01-01", platform: "moomoo",
    amountMyr: 0, amountUsd: 0, priceUsd: 0, feeMyr: 0,
    ...overrides,
  };
}

/**
 * A genuinely empty portfolio. migrateState merges partial dca.targets with
 * the defaults, so the targets are cleared after migration.
 */
function bareState(): WealthState {
  const state = stateWith({ trades: [] });
  return { ...state, trades: [], dca: { ...state.dca, monthly: 0, targets: {} } };
}

test("portfolio: an empty portfolio is safe and all zero", () => {
  const snapshot = getPortfolioSnapshot(bareState());
  assert.deepEqual(snapshot.holdings, []);
  assert.equal(snapshot.totalInvestedMyr, 0);
  assert.equal(snapshot.totalInvestedUsd, 0);
  assert.equal(snapshot.totalUnits, 0);
  assert.equal(snapshot.realizedPnlMyr, 0);
  assert.equal(snapshot.totalFeesMyr, 0);
  assert.equal(snapshot.maxAbsoluteDrift, 0);
  assert.equal(snapshot.tradeCount, 0);
  assert.deepEqual(snapshot.allocation, {});
});

test("portfolio: a single buy produces one holding with the right cost basis", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [trade({ id: "t1", ticker: "VOO", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 5 })],
  });
  const snapshot = getPortfolioSnapshot(state);
  const voo = getHolding(snapshot, "VOO");

  assert.ok(voo);
  assert.equal(voo!.units, 10);
  assert.equal(voo!.investedUsd, 1000);
  assert.equal(voo!.investedMyr, 4205, "MYR cost basis includes the fee");
  assert.equal(voo!.averageCostUsd, 100);
  assert.equal(voo!.feesMyr, 5);
  assert.equal(snapshot.tradeCount, 1);
});

test("portfolio: multiple buys accumulate units and average the cost", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [
      trade({ id: "t1", ticker: "VOO", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 0 }),
      trade({ id: "t2", date: "2026-02-01", ticker: "VOO", type: "DCA", units: 10, priceUsd: 120, amountUsd: 1200, amountMyr: 5040, feeMyr: 0 }),
    ],
  });
  const voo = getHolding(getPortfolioSnapshot(state), "VOO")!;
  assert.equal(voo.units, 20);
  assert.equal(voo.investedUsd, 2200);
  assert.equal(voo.averageCostUsd, 110);
});

test("portfolio: a partial sell reduces the position and books realised P&L", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [
      trade({ id: "buy", ticker: "VOO", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 0 }),
      trade({ id: "sell", date: "2026-03-01", ticker: "VOO", type: "Sell", units: 5, priceUsd: 120, amountUsd: 600, amountMyr: 2520, feeMyr: 0 }),
    ],
  });
  const snapshot = getPortfolioSnapshot(state);
  const voo = getHolding(snapshot, "VOO")!;

  assert.equal(voo.units, 5);
  assert.equal(voo.investedUsd, 500, "half the cost basis is removed");
  assert.equal(voo.realizedPnlUsd, 100, "sold 5 @120 against 500 cost");
  assert.equal(snapshot.realizedPnlUsd, 100, "totals roll up the holdings");
});

test("portfolio: a full sell zeroes the position but keeps realised P&L", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [
      trade({ id: "buy", ticker: "VOO", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 0 }),
      trade({ id: "sell", date: "2026-03-01", ticker: "VOO", type: "Sell", units: 10, priceUsd: 90, amountUsd: 900, amountMyr: 3780, feeMyr: 0 }),
    ],
  });
  const snapshot = getPortfolioSnapshot(state);
  const voo = getHolding(snapshot, "VOO")!;

  assert.equal(voo.units, 0);
  assert.equal(voo.investedUsd, 0);
  assert.equal(voo.investedMyr, 0);
  assert.equal(voo.realizedPnlUsd, -100, "a loss is still realised");
  assert.equal(snapshot.realizedPnlUsd, -100);
});

test("portfolio: realised P&L and fees match calculatePositionCostBasis exactly", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 0.5, QQQM: 0.5 } },
    trades: [
      trade({ id: "b1", ticker: "VOO", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 3 }),
      trade({ id: "s1", date: "2026-03-01", ticker: "VOO", type: "Sell", units: 4, priceUsd: 130, amountUsd: 520, amountMyr: 2184, feeMyr: 2 }),
      trade({ id: "b2", ticker: "QQQM", type: "DCA", units: 5, priceUsd: 200, amountUsd: 1000, amountMyr: 4200, feeMyr: 4 }),
    ],
  });
  const snapshot = getPortfolioSnapshot(state);
  for (const ticker of ["VOO", "QQQM"]) {
    const expected = calculatePositionCostBasis(state.trades, ticker);
    const holding = getHolding(snapshot, ticker)!;
    assert.equal(holding.realizedPnlUsd, expected.realizedPnlUsd, `${ticker} realised USD`);
    assert.equal(holding.realizedPnlMyr, expected.realizedPnlMyr, `${ticker} realised MYR`);
    assert.equal(holding.feesMyr, expected.feesMyr, `${ticker} fees`);
    assert.equal(holding.units, expected.units, `${ticker} units`);
    assert.equal(holding.averageCostUsd, expected.averageCostUsd, `${ticker} avg cost`);
  }
  assert.equal(snapshot.totalFeesMyr, 3 + 2 + 4);
});

test("portfolio: unrealised P&L and market value stay null without live prices", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [trade({ id: "t1", ticker: "VOO", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 4200, feeMyr: 0 })],
  });
  const snapshot = getPortfolioSnapshot(state);
  // Null means "unknown", never 0 — no valuation is invented from stale prices.
  assert.equal(snapshot.unrealizedPnlMyr, null);
  assert.equal(snapshot.totalInvestmentValueMyr, null);
});

test("portfolio: actual allocation is each holding's share of total invested cost", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 0.5, QQQM: 0.5 } },
    trades: [
      trade({ id: "b1", ticker: "VOO", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 3000, feeMyr: 0 }),
      trade({ id: "b2", ticker: "QQQM", type: "DCA", units: 5, priceUsd: 200, amountUsd: 1000, amountMyr: 1000, feeMyr: 0 }),
    ],
  });
  const snapshot = getPortfolioSnapshot(state);
  assert.equal(snapshot.totalInvestedMyr, 4000);
  assert.equal(snapshot.allocation.VOO, 0.75);
  assert.equal(snapshot.allocation.QQQM, 0.25);
});

test("portfolio: target allocation comes from the configured DCA targets", () => {
  const state = stateWith({ dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } }, trades: [] });
  const snapshot = getPortfolioSnapshot(state);
  assert.equal(snapshot.targetAllocation.VOO, 0.7);
  assert.equal(snapshot.targetAllocation.QQQM, 0.3);
  assert.equal(getHolding(snapshot, "VOO")!.targetAllocation, 0.7);
});

test("portfolio: drift is signed and maxAbsoluteDrift is the largest magnitude", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 0.5, QQQM: 0.5 } },
    trades: [
      trade({ id: "b1", ticker: "VOO", type: "DCA", units: 10, priceUsd: 100, amountUsd: 1000, amountMyr: 3000, feeMyr: 0 }),
      trade({ id: "b2", ticker: "QQQM", type: "DCA", units: 5, priceUsd: 200, amountUsd: 1000, amountMyr: 1000, feeMyr: 0 }),
    ],
  });
  const snapshot = getPortfolioSnapshot(state);
  assert.equal(getHolding(snapshot, "VOO")!.drift, 0.25, "overweight is positive");
  assert.equal(getHolding(snapshot, "QQQM")!.drift, -0.25, "underweight is negative");
  assert.equal(snapshot.maxAbsoluteDrift, 0.25);
});

test("portfolio: maxAbsoluteDrift is the single canonical drift figure", () => {
  const state = cloneDefaultState();
  assert.equal(getPortfolioSnapshot(state).maxAbsoluteDrift, portfolioSummary(state).maxAbsoluteDrift);
});

test("portfolio: the snapshot agrees with the existing portfolioSummary() primitive", () => {
  const state = cloneDefaultState();
  const snapshot = getPortfolioSnapshot(state);
  const summary = portfolioSummary(state);

  assert.equal(snapshot.totalInvestedMyr, summary.totalInvestedMyr);
  assert.equal(snapshot.totalInvestedUsd, summary.totalInvestedUsd);
  assert.equal(snapshot.totalUnits, summary.totalUnits);
  assert.equal(snapshot.maxAbsoluteDrift, summary.maxAbsoluteDrift);
  assert.equal(snapshot.holdings.length, summary.positions.length);
  summary.positions.forEach((position, index) => {
    const holding = snapshot.holdings[index];
    assert.equal(holding.ticker, position.ticker);
    assert.equal(holding.units, position.units);
    assert.equal(holding.investedMyr, position.investedMyr);
    assert.equal(holding.investedUsd, position.investedUsd);
    assert.equal(holding.averageCostUsd, position.averageCostUsd);
    assert.equal(holding.actualAllocation, position.actualAllocation);
    assert.equal(holding.targetAllocation, position.targetAllocation);
    assert.equal(holding.drift, position.drift);
  });
});

test("portfolio: a ticker with a target but no trades still appears", () => {
  const state = stateWith({ dca: { monthly: 100, targets: { VOO: 0.6, QQQM: 0.4 } }, trades: [] });
  const snapshot = getPortfolioSnapshot(state);
  assert.equal(snapshot.holdings.length, 2, "configured targets are holdings with zero units");
  assert.equal(getHolding(snapshot, "QQQM")!.units, 0);
});

test("portfolio: a traded ticker with no target still appears", () => {
  const state = stateWith({
    dca: { monthly: 100, targets: { VOO: 1 } },
    trades: [
      trade({ id: "b1", ticker: "VOO", type: "DCA", units: 1, priceUsd: 100, amountUsd: 100, amountMyr: 420, feeMyr: 0 }),
      trade({ id: "b2", ticker: "AAPL", type: "Manual Buy", units: 2, priceUsd: 50, amountUsd: 100, amountMyr: 420, feeMyr: 0 }),
    ],
  });
  const snapshot = getPortfolioSnapshot(state);
  const aapl = getHolding(snapshot, "AAPL");
  assert.ok(aapl, "an untargeted holding is still a fact");
  assert.equal(aapl!.targetAllocation, 0);
});

test("portfolio: a sell with no prior position never produces negative units", () => {
  const state = stateWith({
    dca: { monthly: 0, targets: {} },
    trades: [trade({ id: "s", ticker: "VOO", type: "Sell", units: 5, priceUsd: 100, amountUsd: 500, amountMyr: 2100, feeMyr: 0 })],
  });
  const voo = getHolding(getPortfolioSnapshot(state), "VOO")!;
  assert.equal(voo.units, 0);
  assert.equal(voo.realizedPnlUsd, 0);
});

test("portfolio: malformed and partial states do not crash", () => {
  const partial = migrateState({ deviceId: "d", trades: [], goals: [], dca: { monthly: 0, targets: {} } });
  for (const [label, state] of [["empty", emptyState()], ["partial", partial], ["default", cloneDefaultState()]] as const) {
    const snapshot = getPortfolioSnapshot(state);
    for (const value of [snapshot.totalInvestedMyr, snapshot.totalInvestedUsd, snapshot.totalUnits,
                         snapshot.realizedPnlMyr, snapshot.totalFeesMyr, snapshot.maxAbsoluteDrift]) {
      assert.ok(Number.isFinite(value), `${label} produced a non-finite value`);
    }
    for (const holding of snapshot.holdings) {
      assert.ok(Number.isFinite(holding.units), `${label}: ${holding.ticker} units`);
      assert.ok(Number.isFinite(holding.drift), `${label}: ${holding.ticker} drift`);
    }
  }
});

test("portfolio: the snapshot is pure and does not mutate state", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  getPortfolioSnapshot(state);
  assert.equal(JSON.stringify(state), before);
});

test("portfolio: the snapshot is deterministic", () => {
  const state = cloneDefaultState();
  assert.deepEqual(getPortfolioSnapshot(state), getPortfolioSnapshot(state));
});

test("portfolio: the snapshot is a runtime read model and never persisted", () => {
  const state = cloneDefaultState();
  const keysBefore = Object.keys(state);
  getPortfolioSnapshot(state);
  assert.deepEqual(Object.keys(state), keysBefore);
  for (const forbidden of ["portfolioSnapshot", "holdings", "maxAbsoluteDrift"]) {
    assert.equal(keysBefore.includes(forbidden), false, `${forbidden} must not be part of WealthState`);
  }
  assert.equal(state.version, CURRENT_VERSION);
  // Read models never migrate: the version is whatever the schema says.
  assert.ok(Number.isInteger(CURRENT_VERSION) && CURRENT_VERSION > 0);
});

test("portfolio: the snapshot contains no advice or recommendation fields", () => {
  const serialized = JSON.stringify(getPortfolioSnapshot(cloneDefaultState()));
  for (const forbidden of ["severity", "impact", "recommendation", "destination", "actionLabel", "ruleId"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} belongs to the Advisor, not the portfolio model`);
  }
});

test("portfolio: Advisor drift advice still reads the canonical drift", () => {
  const state = stateWith({ dca: { monthly: 100, targets: { VOO: 0.99, QQQM: 0.01 } } });
  const snapshot = getPortfolioSnapshot(state);
  const drift = advisorRecommendations(state).find((r) => r.id === ADVISOR_RECOMMENDATION_IDS.allocationDrift);
  assert.ok(drift);
  assert.equal(drift!.ruleId, "allocation-drift-tolerance");
  // The Advisor quotes the same number the snapshot reports.
  const quoted = drift!.evidence.find((e) => e.label === "Largest drift");
  assert.ok(quoted);
  assert.equal(quoted!.value, `${(snapshot.maxAbsoluteDrift * 100).toFixed(0)}%`);
});

test("portfolio: Advisor remains the only source of recommendations", () => {
  const state = cloneDefaultState();
  const recommendations = advisorRecommendations(state);
  assert.ok(recommendations.length > 0);
  for (const recommendation of recommendations) {
    assert.ok(["positive", "watch", "action"].includes(recommendation.severity));
  }
});

test("portfolio: Money Leak detector output is unchanged", () => {
  const state = stateWith({
    liabilities: [{ id: "card", name: "Credit Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
    goals: [{ id: "travel", name: "Travel", label: "Travel", current: 0, target: 2400, monthlyContribution: 0, note: "" }],
  });
  const findings = detectMoneyLeakFindings(state);
  const debt = findings.leaks.find((leak) => leak.id === "debt-card");
  const goal = findings.leaks.find((leak) => leak.id === "goal-travel");
  assert.equal(debt!.monthlyImpact, 6000 * 0.18 / 12);
  assert.equal(debt!.confidence, 0.99);
  assert.equal(goal!.monthlyImpact, 2400 / 12);
  assert.equal(goal!.confidence, 0.95);
});
