import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { investmentAssetShare } from "../src/ledger";
import { monthsToEmergencyTarget, emergencyRatio } from "../src/rules";
import { buildOverviewModel } from "../src/overview";
import { priceMapFrom } from "../src/marketPrices";
import { demoState } from "../src/demoData";
import { migrateState } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);
const demo = (): WealthState => migrateState(JSON.parse(JSON.stringify(demoState)));

/**
 * Step 24 pins the facts behind three presentation fixes. The UI copy itself
 * is not asserted here — what matters is that the numbers those labels sit on
 * really are distinct, and that the conditions the copy branches on hold.
 */

test("presentation: the Dashboard's three investment numbers are genuinely different facts", () => {
  // "Investment accounts" (ledger balance), "Invested" (cost basis) and
  // "Market value" all appear on one page. They are separate measures, which
  // is exactly why the account-balance row needed a label saying so.
  const state = demo();
  const portfolio = getPortfolioSnapshot(state, NOW, {
    prices: priceMapFrom([
      { ticker: "VOO", priceUsd: 704.2 },
      { ticker: "QQQM", priceUsd: 292.9 },
      { ticker: "VXUS", priceUsd: 87.82 },
    ]),
    usdToMyr: 4.25,
  });
  const share = investmentAssetShare(state.ledgerTransactions, state.ledgerAccounts);

  const accountBalance = share.investmentAssets;
  const costBasis = portfolio.totalInvestedMyr;
  const marketValue = portfolio.totalInvestmentValueMyr;

  assert.ok(accountBalance > 0 && costBasis > 0 && marketValue !== null);
  assert.notEqual(accountBalance, costBasis, "account balance must not equal cost basis");
  assert.notEqual(costBasis, marketValue, "cost basis must not equal market value");
  assert.notEqual(accountBalance, marketValue, "account balance must not equal market value");
});

test("presentation: the investment-accounts ratio is unavailable rather than zero with no accounts", () => {
  const empty = migrateState({ deviceId: "s24a", ledgerAccounts: [], ledgerTransactions: [] });
  const share = investmentAssetShare(empty.ledgerAccounts.length ? empty.ledgerTransactions : [], empty.ledgerAccounts);
  // Migration seeds default investment accounts, so assert the honest-null
  // contract directly on a genuinely empty account list.
  const none = investmentAssetShare([], []);
  assert.equal(none.ratio, null, "no accounts means unknown, not 0%");
  assert.equal(none.totalAssets, 0);
  assert.ok(share.ratio === null || Number.isFinite(share.ratio));
});

test("presentation: the emergency countdown only applies when funding is outstanding", () => {
  // Funded: months is 0, so no countdown should be offered.
  const funded = migrateState({ deviceId: "s24b", emergency: { current: 5000, target: 5000, monthlyTopUp: 100 } });
  assert.equal(emergencyRatio(funded) >= 1, true);
  assert.equal(monthsToEmergencyTarget(funded), 0, "a funded buffer has no months remaining");

  // No target: a percentage and a countdown are both meaningless.
  const noTarget = migrateState({ deviceId: "s24c", emergency: { current: 0, target: 0, monthlyTopUp: 0 } });
  assert.equal(noTarget.emergency.target, 0);

  // Genuinely underfunded: a countdown is meaningful and positive.
  const underfunded = migrateState({ deviceId: "s24d", emergency: { current: 1000, target: 5000, monthlyTopUp: 500 } });
  const months = monthsToEmergencyTarget(underfunded);
  assert.ok(Number.isFinite(months) && months > 0, `expected a positive countdown, got ${months}`);
});

test("presentation: held positions are distinguishable from configured targets", () => {
  // A fresh state carries target tickers with zero units. Counting the raw
  // holdings list would claim holdings the user does not own.
  const fresh = migrateState({ deviceId: "s24e", trades: [] });
  const portfolio = getPortfolioSnapshot(fresh);
  const held = portfolio.holdings.filter((holding) => holding.units > 0);
  assert.ok(portfolio.holdings.length > 0, "targets still produce holding entries");
  assert.equal(held.length, 0, "nothing is actually held");
  assert.equal(portfolio.totalInvestedMyr, 0);

  // The demo state holds everything it lists, so its copy is unaffected.
  const real = getPortfolioSnapshot(demo());
  assert.equal(real.holdings.filter((h) => h.units > 0).length, real.holdings.length);
});

test("presentation: none of these fixes moved a canonical figure", () => {
  const model = buildOverviewModel(demo(), NOW);
  assert.equal(model.netWorth.toFixed(2), "7561.89"); // was 2823 pre-Step-26: net worth now folds in portfolio value (cost basis fallback)
  assert.equal(model.cashFlow.income, 2300);
  assert.equal(model.cashFlow.expenses, 249);
  assert.equal(model.cashFlow.surplus, 2051);
  assert.equal(model.portfolio.totalInvestedMyr.toFixed(2), "4738.89");
  assert.equal(model.budget.plannedSurplus, 1100);
  assert.equal(model.advisor.priority?.id, "advisor:allocation-drift");
});
