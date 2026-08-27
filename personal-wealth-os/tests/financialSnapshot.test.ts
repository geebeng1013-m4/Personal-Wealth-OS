import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getFinancialSnapshot, monthlyClose, netWorth } from "../src/financialHealth";
import { calculatePositionCostBasis } from "../src/rules";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { priceMapFrom } from "../src/marketPrices";
import { cloneDefaultState, emptyState, migrateState } from "../src/state";
import type { LedgerAccount, LedgerTransaction, Liability, Trade, WealthState } from "../src/models";

// Fixed reference date so every assertion is deterministic.
const NOW = new Date(2026, 7, 15, 12, 0, 0); // 2026-08-15 local
const THIS_MONTH = "2026-08";

function iso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0).toISOString();
}

function stateWith(overrides: Partial<WealthState>): WealthState {
  // migrateState needs a deviceId (localStorage is unavailable under Node).
  return migrateState({ deviceId: "device-test", ...overrides });
}

const accounts: LedgerAccount[] = [
  { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 1000 },
  { id: "acc-wallet", name: "Wallet", type: "wallet", openingBalance: 200 },
  { id: "acc-invest", name: "Brokerage", type: "investment", openingBalance: 5000 },
];

test("snapshot: netWorth is exactly totalAssets - totalLiabilities", () => {
  const liabilities: Liability[] = [
    { id: "l1", name: "Card", balance: 1500, annualRate: 0.18, minimumPayment: 100 },
    { id: "l2", name: "Loan", balance: 800, annualRate: 0.05, minimumPayment: 50 },
  ];
  const snapshot = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts, liabilities }), NOW);
  assert.equal(snapshot.totalLiabilities, 2300);
  assert.equal(snapshot.netWorth, snapshot.totalAssets - snapshot.totalLiabilities);
  assert.equal(snapshot.netWorth, 6200 - 2300);
});

test("snapshot: the netWorth identity holds even with no liabilities", () => {
  const snapshot = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts }), NOW);
  assert.equal(snapshot.totalLiabilities, 0);
  assert.equal(snapshot.netWorth, snapshot.totalAssets);
  assert.equal(snapshot.netWorth, snapshot.totalAssets - snapshot.totalLiabilities);
});

test("snapshot: transfers do not count as income or expense", () => {
  const ledgerTransactions: LedgerTransaction[] = [
    { id: "t1", amount: 500, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
    { id: "t2", amount: 120, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    { id: "t3", amount: 400, type: "transfer", fromAccountId: "acc-bank", toAccountId: "acc-wallet", date: iso(2026, 7, 5) },
  ];
  const snapshot = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts, ledgerTransactions }), NOW);

  assert.equal(snapshot.currentMonthIncome, 500, "transfer must not inflate income");
  assert.equal(snapshot.currentMonthExpenses, 120, "transfer must not inflate expenses");
  assert.equal(snapshot.currentMonthSurplus, 380);
});

test("snapshot: a transfer moves money between accounts without changing net worth", () => {
  const base = stateWith({ ledgerAccounts: accounts });
  const withTransfer = stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "t1", amount: 400, type: "transfer", fromAccountId: "acc-bank", toAccountId: "acc-wallet", date: iso(2026, 7, 5) },
    ],
  });
  const before = getFinancialSnapshot(base, NOW);
  const after = getFinancialSnapshot(withTransfer, NOW);

  assert.equal(after.totalAssets, before.totalAssets);
  assert.equal(after.netWorth, before.netWorth);
  assert.equal(after.liquidCash, before.liquidCash, "bank -400 and wallet +400 cancel out");
});

test("snapshot: liabilities reduce net worth but never touch assets or cash", () => {
  const liabilities: Liability[] = [
    { id: "l1", name: "Card", balance: 2000, annualRate: 0.18, minimumPayment: 100 },
  ];
  const without = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts }), NOW);
  const with_ = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts, liabilities }), NOW);

  assert.equal(with_.totalAssets, without.totalAssets);
  assert.equal(with_.liquidCash, without.liquidCash);
  assert.equal(with_.totalLiabilities, 2000);
  assert.equal(with_.netWorth, without.netWorth - 2000);
});

test("snapshot: liquidCash is bank + wallet only, excluding investment accounts", () => {
  const snapshot = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts }), NOW);
  assert.equal(snapshot.liquidCash, 1200);
  assert.equal(snapshot.investmentAccountBalance, 5000);
  assert.equal(snapshot.totalAssets, 6200);
});

test("snapshot: investment account balance is independent of portfolio trade cost basis", () => {
  const trades: Trade[] = [
    { id: "tr1", date: iso(2026, 7, 2), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 4200, amountUsd: 1000, priceUsd: 100, units: 10, feeMyr: 0 },
  ];
  const state = stateWith({ ledgerAccounts: accounts, trades });
  const snapshot = getFinancialSnapshot(state, NOW);
  const costBasis = calculatePositionCostBasis(state.trades, "VOO");

  assert.ok(costBasis.costBasisMyr > 0, "the trade should produce a real cost basis");
  assert.equal(snapshot.investmentAccountBalance, 5000, "ledger investment balance must ignore trades");
  assert.notEqual(snapshot.investmentAccountBalance, costBasis.costBasisMyr);
  // The ledger-only figure ignores trades; totalAssets DOES include the
  // portfolio (cost basis, with no live price given) — that inclusion is the
  // whole point of this field, so the two must move differently.
  const withoutTrades = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts }), NOW);
  assert.equal(snapshot.investmentAccountBalance, withoutTrades.investmentAccountBalance,
    "the ledger-only metric must ignore trades");
  assert.equal(snapshot.totalAssets, withoutTrades.totalAssets + costBasis.costBasisMyr,
    "totalAssets must grow by exactly the new cost basis");
  assert.equal(snapshot.netWorth, withoutTrades.netWorth + costBasis.costBasisMyr);
});

test("snapshot: monthly figures come from the ledger, not legacy cashflow planning fields", () => {
  const ledgerTransactions: LedgerTransaction[] = [
    { id: "t1", amount: 250, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 6) },
    { id: "t2", amount: 100, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 7) },
  ];
  // Deliberately loud planning numbers that must not leak into the snapshot.
  const state = stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions,
    cashflow: { allowance: 9999, transport: 888, food: 777, otherFixed: 666, irregularIncome: 5555 },
    dca: { monthly: 4321, targets: { VOO: 1 } },
    emergency: { current: 12345, target: 20000, annualYield: 0.03, monthlyTopUp: 500 },
    opportunity: { total: 8888, used: 0, allocation: { VOO: 8888 }, tranches: [] },
  });
  const snapshot = getFinancialSnapshot(state, NOW);

  assert.equal(snapshot.currentMonthIncome, 250);
  assert.equal(snapshot.currentMonthExpenses, 100);
  assert.equal(snapshot.currentMonthSurplus, 150);
  // Planning buckets must not be mistaken for recorded balances either:
  // 6200 opening + 250 income - 100 expense, with nothing from cashflow/emergency/opportunity.
  assert.equal(snapshot.totalAssets, 6350);
  assert.equal(snapshot.liquidCash, 1350);
});

test("snapshot: only current-month transactions count toward monthly figures", () => {
  const ledgerTransactions: LedgerTransaction[] = [
    { id: "t-prev", amount: 900, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 6, 20) },
    { id: "t-now", amount: 300, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 10) },
    { id: "t-next", amount: 700, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 8, 2) },
  ];
  const snapshot = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts, ledgerTransactions }), NOW);
  assert.equal(snapshot.currentMonthIncome, 300, "July and September income must be excluded");
});

test("snapshot: month boundaries are inclusive at both ends", () => {
  const ledgerTransactions: LedgerTransaction[] = [
    { id: "first", amount: 10, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: new Date(2026, 7, 1, 0, 0, 0).toISOString() },
    { id: "last", amount: 20, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: new Date(2026, 7, 31, 23, 59, 59).toISOString() },
  ];
  const snapshot = getFinancialSnapshot(stateWith({ ledgerAccounts: accounts, ledgerTransactions }), NOW);
  assert.equal(snapshot.currentMonthIncome, 30);
});

test("snapshot: agrees with monthlyClose for the current month", () => {
  const ledgerTransactions: LedgerTransaction[] = [
    { id: "t1", amount: 640, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 8) },
    { id: "t2", amount: 190, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 9) },
    { id: "t3", amount: 250, type: "transfer", fromAccountId: "acc-bank", toAccountId: "acc-invest", date: iso(2026, 7, 9) },
  ];
  const state = stateWith({ ledgerAccounts: accounts, ledgerTransactions });
  const snapshot = getFinancialSnapshot(state, NOW);
  const close = monthlyClose(state, THIS_MONTH);

  assert.equal(snapshot.currentMonthIncome, close.income);
  assert.equal(snapshot.currentMonthExpenses, close.spending);
  assert.equal(snapshot.currentMonthSurplus, close.netCashflow);
});

test("snapshot: negative account balances are clamped out of totalAssets but still reduce liquidCash", () => {
  const overdrawn: LedgerAccount[] = [
    { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 100 },
    { id: "acc-wallet", name: "Wallet", type: "wallet", openingBalance: 0 },
  ];
  const ledgerTransactions: LedgerTransaction[] = [
    { id: "t1", amount: 300, type: "expense", categoryId: "expense-food", accountId: "acc-wallet", date: iso(2026, 7, 4) },
  ];
  const snapshot = getFinancialSnapshot(stateWith({ ledgerAccounts: overdrawn, ledgerTransactions }), NOW);

  assert.equal(snapshot.totalAssets, 100, "the -300 wallet is clamped to 0");
  assert.equal(snapshot.liquidCash, -200, "liquid cash reflects the overdraft");
  assert.equal(snapshot.netWorth, snapshot.totalAssets - snapshot.totalLiabilities);
});

test("snapshot: empty state is safe and all-zero", () => {
  const snapshot = getFinancialSnapshot(stateWith({ ledgerAccounts: [], ledgerTransactions: [], liabilities: [] }), NOW);
  assert.equal(snapshot.totalAssets, 0);
  assert.equal(snapshot.totalLiabilities, 0);
  assert.equal(snapshot.netWorth, 0);
  assert.equal(snapshot.liquidCash, 0);
  assert.equal(snapshot.investmentAccountBalance, 0);
  assert.equal(snapshot.currentMonthIncome, 0);
  assert.equal(snapshot.currentMonthExpenses, 0);
  assert.equal(snapshot.currentMonthSurplus, 0);
});

test("snapshot: default and empty WealthState do not crash and satisfy the identity", () => {
  for (const [label, state] of [["default", cloneDefaultState()], ["empty", emptyState()]] as const) {
    const snapshot = getFinancialSnapshot(state, NOW);
    for (const [key, value] of Object.entries(snapshot)) {
      if (typeof value === "boolean") continue; // portfolioValueIsLive
      assert.ok(Number.isFinite(value), `${label} state produced a non-finite ${key}`);
    }
    assert.equal(snapshot.netWorth, snapshot.totalAssets - snapshot.totalLiabilities, `${label} state broke the identity`);
    assert.equal(snapshot.currentMonthSurplus, snapshot.currentMonthIncome - snapshot.currentMonthExpenses);
  }
});

test("snapshot: malformed transaction dates are ignored rather than crashing", () => {
  const state = stateWith({ ledgerAccounts: accounts });
  // migrateState strips invalid dates, so inject past it to exercise the guard directly.
  const dirty: WealthState = {
    ...state,
    ledgerTransactions: [
      { id: "bad", amount: 50, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: "not-a-date" },
      { id: "good", amount: 75, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 11) },
    ],
  };
  const snapshot = getFinancialSnapshot(dirty, NOW);
  assert.equal(snapshot.currentMonthIncome, 75);
});

test("snapshot: the legacy netWorth() wrapper still agrees with the snapshot", () => {
  const liabilities: Liability[] = [
    { id: "l1", name: "Card", balance: 1500, annualRate: 0.18, minimumPayment: 100 },
  ];
  const ledgerTransactions: LedgerTransaction[] = [
    { id: "t1", amount: 500, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
  ];
  const state = stateWith({ ledgerAccounts: accounts, ledgerTransactions, liabilities });
  const snapshot = getFinancialSnapshot(state, NOW);
  const legacy = netWorth(state.ledgerTransactions, state.ledgerAccounts, state.liabilities);

  assert.equal(legacy.assets, snapshot.totalAssets);
  assert.equal(legacy.liabilities, snapshot.totalLiabilities);
  assert.equal(legacy.net, snapshot.netWorth);
});

test("snapshot: is pure — same state and same date give the same result", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "t1", amount: 500, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
    ],
    liabilities: [{ id: "l1", name: "Card", balance: 300, annualRate: 0.1, minimumPayment: 30 }],
  });
  assert.deepEqual(getFinancialSnapshot(state, NOW), getFinancialSnapshot(state, new Date(NOW)));
});

// --- Step 26: Net Worth includes the portfolio's value ---------------------
//
// The portfolio was previously absent from Net Worth entirely (not double
// counted with the ledger's investment-account balance, which is cash sitting
// on the platform — genuinely a different pool of money). This is the explicit,
// user-confirmed contract for what replaced that gap: live price when one is
// known, cost basis otherwise, and never zero.

test("networth: with no trades, the portfolio contributes exactly nothing", () => {
  const state = stateWith({ ledgerAccounts: accounts, trades: [] });
  const snapshot = getFinancialSnapshot(state, NOW);
  assert.equal(snapshot.portfolioValueMyr, 0);
  assert.equal(snapshot.portfolioValueIsLive, false);
  assert.equal(snapshot.totalAssets, netWorth(state.ledgerTransactions, state.ledgerAccounts, state.liabilities).assets,
    "with nothing invested, totalAssets must equal the plain ledger total");
});

test("networth: with trades but no live price, cost basis is used — never zero", () => {
  const trades: Trade[] = [
    { id: "t1", date: iso(2026, 7, 2), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 4200, amountUsd: 1000, priceUsd: 100, feeMyr: 0 },
  ];
  const state = stateWith({ ledgerAccounts: accounts, trades });
  const snapshot = getFinancialSnapshot(state, NOW);
  const costBasis = calculatePositionCostBasis(state.trades, "VOO").costBasisMyr;

  assert.ok(costBasis > 0);
  assert.equal(snapshot.portfolioValueIsLive, false, "no price was supplied");
  assert.equal(snapshot.portfolioValueMyr, costBasis);
  assert.ok(snapshot.portfolioValueMyr > 0, "the fallback must never collapse to zero");
});

test("networth: a live price replaces cost basis with market value", () => {
  const trades: Trade[] = [
    { id: "t1", date: iso(2026, 7, 2), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 4200, amountUsd: 1000, priceUsd: 100, feeMyr: 0 },
  ];
  const state = stateWith({ ledgerAccounts: accounts, trades });
  const portfolio = getPortfolioSnapshot(state, NOW, {
    prices: priceMapFrom([{ ticker: "VOO", priceUsd: 120 }]),
    usdToMyr: 4.5,
  });
  const snapshot = getFinancialSnapshot(state, NOW, undefined, portfolio);

  assert.equal(snapshot.portfolioValueIsLive, true);
  assert.equal(snapshot.portfolioValueMyr, portfolio.totalInvestmentValueMyr);
  assert.notEqual(snapshot.portfolioValueMyr, portfolio.totalInvestedMyr, "fixture must actually move the price");
  assert.equal(snapshot.totalAssets, netWorth(state.ledgerTransactions, state.ledgerAccounts, []).assets + portfolio.totalInvestmentValueMyr!);
});

test("networth: an unusable price falls back to cost basis, never to zero", () => {
  const trades: Trade[] = [
    { id: "t1", date: iso(2026, 7, 2), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 4200, amountUsd: 1000, priceUsd: 100, feeMyr: 0 },
  ];
  const state = stateWith({ ledgerAccounts: accounts, trades });
  const costBasis = calculatePositionCostBasis(state.trades, "VOO").costBasisMyr;

  for (const badPrice of [0, -5, Number.NaN, Infinity]) {
    const portfolio = getPortfolioSnapshot(state, NOW, {
      prices: priceMapFrom([{ ticker: "VOO", priceUsd: badPrice }]),
      usdToMyr: 4.5,
    });
    const snapshot = getFinancialSnapshot(state, NOW, undefined, portfolio);
    assert.equal(snapshot.portfolioValueIsLive, false, `price ${badPrice} was wrongly treated as live`);
    assert.equal(snapshot.portfolioValueMyr, costBasis, `price ${badPrice} did not fall back to cost basis`);
    assert.notEqual(snapshot.portfolioValueMyr, 0, `price ${badPrice} collapsed the portfolio to zero`);
  }
});

test("networth: the ledger's investment-account balance is not the same pool as portfolio value", () => {
  // The two can legitimately both be non-zero without double counting: the
  // ledger balance is cash sitting on the brokerage platform; portfolioValueMyr
  // is the value of the actual share positions bought with money that never
  // passed through a recorded ledger transfer (e.g. imported trade history).
  const trades: Trade[] = [
    { id: "t1", date: iso(2026, 7, 2), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 4200, amountUsd: 1000, priceUsd: 100, feeMyr: 0 },
  ];
  const investAccount: LedgerAccount = { id: "acc-invest-extra", name: "Moomoo Cash", type: "investment", openingBalance: 900 };
  const state = stateWith({ ledgerAccounts: [...accounts, investAccount], trades });
  const snapshot = getFinancialSnapshot(state, NOW);

  assert.ok(snapshot.investmentAccountBalance > 0, "ledger cash balance");
  assert.ok(snapshot.portfolioValueMyr > 0, "portfolio value");
  assert.notEqual(snapshot.investmentAccountBalance, snapshot.portfolioValueMyr, "the two pools must stay distinct");
  // Both are included in totalAssets, additively, with nothing dropped.
  const ledgerOnly = netWorth(state.ledgerTransactions, state.ledgerAccounts, []).assets;
  assert.equal(snapshot.totalAssets, ledgerOnly + snapshot.portfolioValueMyr);
});

// --- Portfolio mirrored by a brokerage account (no double counting) --------
//
// A user who records their brokerage account's balance in the ledger AND has
// the underlying trades in the portfolio holds ONE pot of money described
// twice. Net worth previously added both, inflating it by the whole portfolio.

/** Brokerage layout: separate cash + money-market, plus the share account. */
const brokerageAccounts: LedgerAccount[] = [
  { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 1000 },
  { id: "acc-mm-cash", name: "Moomoo Cash", type: "investment", openingBalance: 500 },
  { id: "acc-mm-mmf", name: "Moomoo MMF", type: "investment", openingBalance: 4000 },
  { id: "acc-mm-invest", name: "Moomoo Invest", type: "investment", openingBalance: 1900, holdsTrackedPortfolio: true },
];
const oneTrade: Trade[] = [
  { id: "tr1", date: iso(2026, 7, 2), platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 1800, amountUsd: 420, priceUsd: 100, units: 4.2, feeMyr: 0 },
];

test("networth: a flagged account is replaced by the portfolio, not added to it", () => {
  const state = stateWith({ ledgerAccounts: brokerageAccounts, trades: oneTrade });
  const snapshot = getFinancialSnapshot(state, NOW);
  const costBasis = calculatePositionCostBasis(state.trades, "VOO").costBasisMyr;

  // Bank 1000 + cash 500 + MMF 4000 = 5500 of genuinely separate money,
  // plus the portfolio. The flagged 1900 balance is NOT added on top.
  assert.equal(snapshot.totalAssets, 5500 + costBasis);
  assert.notEqual(snapshot.totalAssets, 5500 + 1900 + costBasis, "the portfolio was counted twice");
});

test("networth: unflagged brokerage cash and money-market stay in the total", () => {
  // Only the share account mirrors the portfolio. Cash and MMF are real,
  // separate assets and must never be dropped.
  const state = stateWith({ ledgerAccounts: brokerageAccounts, trades: oneTrade });
  const snapshot = getFinancialSnapshot(state, NOW);
  assert.ok(snapshot.totalAssets > 5000, "separate brokerage money was wrongly excluded");
  const withoutFlag = getFinancialSnapshot(stateWith({
    ledgerAccounts: brokerageAccounts.map((a) => ({ ...a, holdsTrackedPortfolio: undefined })),
    trades: oneTrade,
  }), NOW);
  // Removing the flag adds exactly the mirrored balance back.
  assert.equal(withoutFlag.totalAssets, snapshot.totalAssets + 1900);
});

test("networth: the flagged balance is reported so it can be reconciled", () => {
  const state = stateWith({ ledgerAccounts: brokerageAccounts, trades: oneTrade });
  const ledger = getLedgerSnapshot(state, NOW);
  assert.equal(ledger.portfolioMirroredBalance, 1900);
  // The ledger's own total still includes it — only net worth nets it out, so
  // the Ledger page keeps showing the account at its recorded balance.
  assert.equal(ledger.totalPositiveBalance, 1000 + 500 + 4000 + 1900);
});

test("networth: with no flagged account nothing is netted out", () => {
  const state = stateWith({ ledgerAccounts: accounts, trades: oneTrade });
  const ledger = getLedgerSnapshot(state, NOW);
  assert.equal(ledger.portfolioMirroredBalance, 0);
  const snapshot = getFinancialSnapshot(state, NOW);
  assert.equal(snapshot.totalAssets, ledger.totalPositiveBalance + snapshot.portfolioValueMyr);
});

test("networth: the flag only applies to investment accounts", () => {
  // A bank account must never remove itself from net worth, however the flag
  // arrived in the persisted data.
  const state = migrateState({
    deviceId: "device-test",
    ledgerAccounts: [
      { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 3000, holdsTrackedPortfolio: true },
    ],
    trades: [],
  });
  assert.equal(state.ledgerAccounts[0]!.holdsTrackedPortfolio, undefined, "the flag must be stripped from a bank account");
  assert.equal(getLedgerSnapshot(state, NOW).portfolioMirroredBalance, 0);
  assert.equal(getFinancialSnapshot(state, NOW).totalAssets, 3000);
});

test("networth: the flag survives a persistence round trip", () => {
  const state = stateWith({ ledgerAccounts: brokerageAccounts, trades: oneTrade });
  const reloaded = migrateState(JSON.parse(JSON.stringify(state)));
  const flagged = reloaded.ledgerAccounts.filter((a) => a.holdsTrackedPortfolio === true);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]!.id, "acc-mm-invest");
  assert.equal(getFinancialSnapshot(reloaded, NOW).totalAssets, getFinancialSnapshot(state, NOW).totalAssets);
});
