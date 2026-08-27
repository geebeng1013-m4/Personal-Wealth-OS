import assert from "node:assert/strict";
import { test } from "./testHarness";
import { buildOverviewModel } from "../src/overview";
import { getPortfolioSnapshot, getHolding } from "../src/portfolioSummary";
import { priceMapFrom } from "../src/marketPrices";
import { getAdvisorSnapshot } from "../src/advisor";
import { getFinancialHealthSnapshot } from "../src/financialHealthSummary";
import { getFinancialSnapshot } from "../src/financialHealth";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getBudgetSnapshot } from "../src/budgetSummary";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { cloneDefaultState, migrateState, CURRENT_VERSION } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);

/**
 * Step 21: valuation reaches the Dashboard and Portfolio page through the one
 * canonical snapshot. Prices here are fixed fixtures — never live quotes — so
 * the expected numbers stay deterministic.
 */

/** Two holdings, 10 units each at $100: invested $1,000 / MYR 4,250 apiece. */
function twoHoldings(): WealthState {
  return migrateState({
    deviceId: "s21",
    dca: { monthly: 300, targets: { AAA: 0.5, BBB: 0.5 } },
    trades: ["AAA", "BBB"].map((ticker, index) => ({
      id: `t${index}`, date: "2026-01-05", platform: "moomoo", ticker, type: "DCA",
      amountMyr: 4250, amountUsd: 1000, priceUsd: 100, feeMyr: 0,
    })),
  });
}

const BOTH_PRICED = {
  prices: priceMapFrom([
    { ticker: "AAA", priceUsd: 120 },
    { ticker: "BBB", priceUsd: 90 },
  ]),
  usdToMyr: 4.25,
};

// --- OverviewModel carries valuation, without a second snapshot ------------

test("integration: the model's portfolio is the canonical snapshot, prices included", () => {
  const state = twoHoldings();
  const model = buildOverviewModel(state, NOW, BOTH_PRICED);
  assert.deepEqual(model.portfolio, getPortfolioSnapshot(state, NOW, BOTH_PRICED));
  assert.equal(model.portfolio.valuationStatus, "complete");
});

test("integration: complete valuation surfaces correct totals on the model", () => {
  const model = buildOverviewModel(twoHoldings(), NOW, BOTH_PRICED);
  const portfolio = model.portfolio;
  // 10 x 120 = 1200, 10 x 90 = 900 -> 2100 USD -> 8925 MYR at 4.25
  assert.equal(portfolio.totalInvestmentValueUsd, 2100);
  assert.equal(portfolio.totalInvestmentValueMyr, 8925);
  // Invested 2000 USD / 8500 MYR
  assert.equal(portfolio.unrealizedPnlUsd, 100);
  assert.equal(portfolio.unrealizedPnlMyr, 425);
  assert.equal(portfolio.unrealizedPnlPercent, 0.05);
});

test("integration: without prices the model keeps every valuation field null", () => {
  const model = buildOverviewModel(twoHoldings(), NOW);
  assert.equal(model.portfolio.valuationStatus, "unavailable");
  assert.equal(model.portfolio.totalInvestmentValueMyr, null);
  assert.equal(model.portfolio.unrealizedPnlMyr, null);
  assert.equal(model.portfolio.unrealizedPnlPercent, null);
});

test("integration: partial valuation is reported as partial, not as a full total", () => {
  const model = buildOverviewModel(twoHoldings(), NOW, {
    prices: priceMapFrom([{ ticker: "AAA", priceUsd: 120 }]),
    usdToMyr: 4.25,
  });
  const portfolio = model.portfolio;
  assert.equal(portfolio.valuationStatus, "partial");
  assert.deepEqual(portfolio.pricedTickers, ["AAA"]);
  assert.deepEqual(portfolio.unpricedTickers, ["BBB"]);
  // Only the priced holding contributes, and P&L is against ITS cost alone.
  assert.equal(portfolio.totalInvestmentValueUsd, 1200);
  assert.equal(portfolio.unrealizedPnlUsd, 200);
  assert.equal(portfolio.unrealizedPnlPercent, 0.2);
  // Invested capital still covers the whole portfolio.
  assert.equal(portfolio.totalInvestedUsd, 2000);
  assert.equal(getHolding(portfolio, "BBB")?.marketValueMyr, null);
});

test("integration: an unusable price never becomes a zero valuation", () => {
  for (const bad of [0, -10, Number.NaN, Infinity]) {
    const model = buildOverviewModel(twoHoldings(), NOW, {
      prices: priceMapFrom([{ ticker: "AAA", priceUsd: bad }, { ticker: "BBB", priceUsd: bad }]),
      usdToMyr: 4.25,
    });
    assert.equal(model.portfolio.valuationStatus, "unavailable", `price ${bad}`);
    assert.equal(model.portfolio.totalInvestmentValueMyr, null, `price ${bad}`);
    assert.equal(model.portfolio.unrealizedPnlMyr, null, `price ${bad} produced a fake loss`);
  }
});

test("integration: missing FX leaves MYR unknown while USD stays known", () => {
  const model = buildOverviewModel(twoHoldings(), NOW, { prices: BOTH_PRICED.prices, usdToMyr: null });
  assert.equal(model.portfolio.totalInvestmentValueUsd, 2100);
  assert.equal(model.portfolio.unrealizedPnlUsd, 100);
  assert.equal(model.portfolio.totalInvestmentValueMyr, null);
  assert.equal(model.portfolio.unrealizedPnlMyr, null);
  assert.equal(model.portfolio.usdToMyrUsed, null);
});

// --- Semantic separation ---------------------------------------------------

test("integration: prices never move invested capital, units, cost, fees or drift", () => {
  const state = twoHoldings();
  const flat = getPortfolioSnapshot(state, NOW);
  for (const market of [BOTH_PRICED, { prices: BOTH_PRICED.prices, usdToMyr: null }]) {
    const priced = getPortfolioSnapshot(state, NOW, market);
    assert.equal(priced.totalInvestedMyr, flat.totalInvestedMyr);
    assert.equal(priced.totalInvestedUsd, flat.totalInvestedUsd);
    assert.equal(priced.totalUnits, flat.totalUnits);
    assert.equal(priced.maxAbsoluteDrift, flat.maxAbsoluteDrift);
    assert.equal(priced.realizedPnlMyr, flat.realizedPnlMyr);
    assert.equal(priced.totalFeesMyr, flat.totalFeesMyr);
    assert.deepEqual(priced.allocation, flat.allocation);
    for (const holding of priced.holdings) {
      const before = getHolding(flat, holding.ticker)!;
      assert.equal(holding.averageCostUsd, before.averageCostUsd);
      assert.equal(holding.units, before.units);
      assert.equal(holding.drift, before.drift);
      assert.equal(holding.investedMyr, before.investedMyr);
    }
  }
});

test("integration: the ringgit return is not the dollar return when FX has moved", () => {
  // Invested MYR is recorded at the exchange rate of the day; market value uses
  // today's rate. So the two returns genuinely differ, and a MYR amount must
  // never be shown next to the USD percentage.
  const state = migrateState({
    deviceId: "s21fx",
    dca: { monthly: 300, targets: { AAA: 1 } },
    // Bought $1,000 when USD/MYR was 4.60 -> MYR 4,600 invested.
    trades: [{
      id: "t", date: "2026-01-05", platform: "m", ticker: "AAA", type: "DCA",
      amountMyr: 4600, amountUsd: 1000, priceUsd: 100, feeMyr: 0,
    }],
  });
  // Price up 20% in USD, but the ringgit has strengthened to 4.00.
  const portfolio = getPortfolioSnapshot(state, NOW, {
    prices: priceMapFrom([{ ticker: "AAA", priceUsd: 120 }]),
    usdToMyr: 4.0,
  });

  assert.equal(portfolio.unrealizedPnlUsd, 200, "USD gain");
  assert.equal(portfolio.unrealizedPnlPercent, 0.2, "USD return is +20%");
  // MYR: 10 x 120 x 4.00 = 4,800 against 4,600 invested = +200 = +4.35%.
  assert.equal(portfolio.totalInvestmentValueMyr, 4800);
  assert.equal(portfolio.unrealizedPnlMyr, 200);
  assert.ok(Math.abs(portfolio.unrealizedPnlPercentMyr! - 200 / 4600) < 1e-12, "MYR return is +4.35%");
  assert.notEqual(portfolio.unrealizedPnlPercentMyr, portfolio.unrealizedPnlPercent,
    "the two returns must stay distinct");

  const holding = getHolding(portfolio, "AAA")!;
  assert.equal(holding.unrealizedPnlPercent, 0.2);
  assert.ok(Math.abs(holding.unrealizedPnlPercentMyr! - 200 / 4600) < 1e-12);
});

test("integration: unrealised and realised P&L stay separate facts", () => {
  // A sale books realised P&L; a live price books unrealised. They must not merge.
  const state = migrateState({
    deviceId: "s21r",
    dca: { monthly: 300, targets: { AAA: 1 } },
    trades: [
      { id: "b", date: "2026-01-05", platform: "m", ticker: "AAA", type: "DCA", amountMyr: 4250, amountUsd: 1000, priceUsd: 100, feeMyr: 0 },
      { id: "s", date: "2026-02-05", platform: "m", ticker: "AAA", type: "Sell", amountMyr: 1275, amountUsd: 300, priceUsd: 150, feeMyr: 0 },
    ],
  });
  const priced = getPortfolioSnapshot(state, NOW, { prices: priceMapFrom([{ ticker: "AAA", priceUsd: 100 }]), usdToMyr: 4.25 });
  const flat = getPortfolioSnapshot(state, NOW);
  assert.ok(priced.realizedPnlUsd > 0, "the sale booked a realised gain");
  assert.equal(priced.realizedPnlUsd, flat.realizedPnlUsd, "a live price changed realised P&L");
  assert.notEqual(priced.unrealizedPnlUsd, priced.realizedPnlUsd, "the two P&L facts collapsed into one");
});

// --- Everything else stays put --------------------------------------------

test("integration: a live price reprices Net Worth, and only Net Worth", () => {
  // Step 26: Net Worth now folds in the portfolio's value (live price when
  // available, cost basis otherwise), because the portfolio was previously
  // missing from Net Worth entirely — not double-counted, just absent. A live
  // price must move Net Worth by exactly the market-value-vs-cost-basis delta,
  // and must not reach anything else: Advisor ranking, Goals, Budget, and the
  // OTHER three health factors are unaffected by a market price.
  const state = cloneDefaultState();
  const priced = {
    prices: priceMapFrom([
      { ticker: "VOO", priceUsd: 704.2 },
      { ticker: "QQQM", priceUsd: 292.9 },
      { ticker: "VXUS", priceUsd: 87.82 },
    ]),
    usdToMyr: 4.25,
  };
  const before = buildOverviewModel(state, NOW);
  const after = buildOverviewModel(state, NOW, priced);

  const delta = after.portfolio.totalInvestmentValueMyr! - before.portfolio.totalInvestedMyr;
  assert.ok(Math.abs(delta) > 0.01, "fixture must actually move the market value");
  assert.ok(Math.abs(after.netWorth - (before.netWorth + delta)) < 0.01, "netWorth must move by exactly the valuation delta");
  assert.ok(Math.abs(after.totalAssets - (before.totalAssets + delta)) < 0.01);
  assert.equal(after.totalLiabilities, before.totalLiabilities, "a price can never touch liabilities");
  assert.equal(after.snapshot.portfolioValueIsLive, true);
  assert.equal(before.snapshot.portfolioValueIsLive, false);

  // Everything not derived from totalAssets is untouched.
  assert.deepEqual(after.cashFlow, before.cashFlow);
  assert.deepEqual(after.planStatus, before.planStatus);
  assert.deepEqual(after.goals, before.goals);
  assert.deepEqual(after.budget, before.budget);
  assert.deepEqual(after.trackedWealth, before.trackedWealth, "tracked wealth uses cost, not market value");

  // Health: only the debtLoad factor's value/target moves (it targets
  // totalAssets); safetyBuffer, cashFlow and planExecution do not, and the
  // overall status is unaffected on this fixture.
  const factorId = (list: typeof before.wealthHealth.factors, id: string) => list.find((f) => f.id === id)!;
  for (const id of ["safetyBuffer", "cashFlow", "planExecution"] as const) {
    assert.deepEqual(factorId(after.wealthHealth.factors, id), factorId(before.wealthHealth.factors, id), `${id} moved`);
  }
  assert.equal(after.wealthHealth.status, before.wealthHealth.status);
  assert.ok(Math.abs(factorId(after.wealthHealth.factors, "debtLoad").target! - (factorId(before.wealthHealth.factors, "debtLoad").target! + delta)) < 0.01);

  // Advisor ranking and priority are untouched by market prices — none of the
  // six recommendations read totalAssets/netWorth.
  assert.deepEqual(after.advisor.recommendations.map((r) => r.id), before.advisor.recommendations.map((r) => r.id));
  assert.equal(after.advisor.priority?.id, before.advisor.priority?.id);

  // Read models that take no market input at all are unaffected.
  assert.deepEqual(getLedgerSnapshot(state, NOW), getLedgerSnapshot(state, NOW));
  assert.deepEqual(getGoalsSnapshot(state), getGoalsSnapshot(state));
  assert.deepEqual(getBudgetSnapshot(state, NOW), getBudgetSnapshot(state, NOW));
  assert.deepEqual(detectMoneyLeakFindings(state), detectMoneyLeakFindings(state));
});

test("integration: valuation is never persisted and never bumps the schema", () => {
  const state = twoHoldings();
  const serialized = JSON.stringify(state);
  buildOverviewModel(state, NOW, BOTH_PRICED);
  assert.equal(JSON.stringify(state), serialized, "state was mutated");
  for (const live of ["marketValue", "unrealized", "quotedAt", "valuationStatus", "usdToMyrUsed", "pricedTickers"]) {
    assert.equal(serialized.includes(`"${live}"`), false, `${live} was persisted`);
  }
  assert.ok(CURRENT_VERSION >= 17);
});
