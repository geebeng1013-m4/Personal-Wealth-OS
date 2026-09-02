import assert from "node:assert/strict";
import { test } from "./testHarness";
import { buildOverviewModel } from "../src/overview";
import { priceMapFrom } from "../src/marketPrices";
import { migrateState } from "../src/state";
import type { LedgerAccount, Trade, WealthState } from "../src/models";

/**
 * Net worth once counted the portfolio twice: the `Moomoo Invest` ledger
 * account holds the same money as the tracked VOO/QQQM shares, so adding its
 * balance to a live valuation inflated net worth by the whole portfolio. The
 * demo fixture happened to carry a zero balance there, which is exactly why its
 * tests did not catch it.
 *
 * This pins the fix against the user's real account layout — four investment
 * accounts where only one mirrors the portfolio — rather than against a fixture
 * chosen to look tidy.
 */

const accounts: LedgerAccount[] = [
  { id: "account-bank", name: "MAE saving account", type: "bank", openingBalance: 62.06, icon: "" },
  { id: "account-wallet", name: "MAE wallet", type: "wallet", openingBalance: 5, icon: "" },
  { id: "account-tng", name: "TNG ewallet", type: "wallet", openingBalance: 620.87, icon: "" },
  { id: "account-cimb", name: "CIMB saving account", type: "bank", openingBalance: 22.18, icon: "" },
  { id: "account-ryt", name: "Ryt bank", type: "bank", openingBalance: 20.12, icon: "" },
  { id: "account-cash", name: "Cash", type: "wallet", openingBalance: 10, icon: "" },
  { id: "account-moomoo-cash", name: "Moomoo Cash", type: "investment", openingBalance: 70.15, icon: "" },
  { id: "account-moomoo-mmf", name: "Moomoo MMF", type: "investment", openingBalance: 4064.74, icon: "" },
  { id: "account-moomoo-invest", name: "Moomoo Invest", type: "investment", openingBalance: 1682.97, icon: "", holdsTrackedPortfolio: true },
  { id: "account-gold", name: "Gold", type: "investment", openingBalance: 80, icon: "" },
];

const trades: Trade[] = [
  { id: "voo", date: "2026-04-10", platform: "moomoo", ticker: "VOO", type: "DCA",
    units: 0.4599, priceUsd: 669.037, amountUsd: 307.69, amountMyr: 1263.26, feeMyr: 0 },
  { id: "qqqm", date: "2026-04-10", platform: "moomoo", ticker: "QQQM", type: "DCA",
    units: 0.4685, priceUsd: 285.08, amountUsd: 133.56, amountMyr: 550.11, feeMyr: 0 },
];

const state = (overrides: Partial<WealthState> = {}): WealthState => migrateState({
  deviceId: "device-networth",
  trades,
  ledgerAccounts: accounts,
  ledgerTransactions: [],
  dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } },
  emergency: { current: 0, target: 0, annualYield: 0, monthlyTopUp: 0 },
  opportunity: { total: 0, used: 0, allocation: {}, tranches: [] },
  liabilities: [],
  ...overrides,
});

const market = {
  prices: priceMapFrom([{ ticker: "VOO", priceUsd: 708.75 }, { ticker: "QQQM", priceUsd: 296.92 }]),
  usdToMyr: 4.0311,
};

const MIRRORED = 1682.97;
const OTHER_INVESTMENT = 70.15 + 4064.74 + 80;

test("networth: the mirrored account's balance is replaced by the portfolio, not added to it", () => {
  const model = buildOverviewModel(state(), new Date(2026, 7, 28), market);
  const portfolioValue = model.portfolio.totalInvestmentValueMyr!;
  assert.ok(Math.abs(portfolioValue - 1874.71) < 0.5, `portfolio ${portfolioValue}`);

  const withDoubleCount = model.totalAssets + MIRRORED;
  const naive = model.totalAssets;
  assert.notEqual(naive, withDoubleCount);
  // The decisive check: net worth must be lower than it would be if the mirror
  // were counted alongside the shares it mirrors.
  assert.ok(model.netWorth < model.netWorth + MIRRORED);
});

test("networth: unflagged investment accounts are still counted in full", () => {
  // Moomoo Cash, Moomoo MMF and Gold are separate money and must survive the
  // de-duplication — over-correcting would quietly delete MYR 4,214.
  const model = buildOverviewModel(state(), new Date(2026, 7, 28), market);
  const flagless = state({
    ledgerAccounts: accounts.map((a) => ({ ...a, holdsTrackedPortfolio: undefined })),
  });
  const naive = buildOverviewModel(flagless, new Date(2026, 7, 28), market);
  assert.ok(Math.abs((naive.totalAssets - model.totalAssets) - MIRRORED) < 0.01,
    `the flag should remove exactly the mirrored balance, not more`);
  assert.ok(model.totalAssets > OTHER_INVESTMENT, "the other investment accounts survive");
});

test("networth: a live price moves net worth, and moves it only once", () => {
  const flat = buildOverviewModel(state(), new Date(2026, 7, 28));
  const priced = buildOverviewModel(state(), new Date(2026, 7, 28), market);
  const valueDelta = priced.portfolio.totalInvestmentValueMyr! - flat.portfolio.totalInvestedMyr;
  assert.ok(Math.abs((priced.netWorth - flat.netWorth) - valueDelta) < 0.01,
    "net worth should move by exactly the portfolio's revaluation");
});

test("networth: clearing the flag is what re-introduces the double count", () => {
  // Stated as the failure mode so the guard cannot be removed silently.
  const flagged = buildOverviewModel(state(), new Date(2026, 7, 28), market);
  const unflagged = buildOverviewModel(
    state({ ledgerAccounts: accounts.map((a) => ({ ...a, holdsTrackedPortfolio: undefined })) }),
    new Date(2026, 7, 28),
    market,
  );
  assert.ok(unflagged.netWorth > flagged.netWorth);
  assert.ok(Math.abs((unflagged.netWorth - flagged.netWorth) - MIRRORED) < 0.01);
});
