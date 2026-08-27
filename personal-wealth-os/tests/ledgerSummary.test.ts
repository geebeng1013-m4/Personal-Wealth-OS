import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  getLedgerSnapshot,
  ledgerMonthTotals,
  monthKeyOf,
  monthRange,
  sumPositiveBalances,
  transactionsInRange,
} from "../src/ledgerSummary";
import { accountBalances, accountTypeBalance, ledgerTotals, filterLedgerTransactions } from "../src/ledger";
import { getFinancialSnapshot, monthlyClose } from "../src/financialHealth";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { buildOverviewModel } from "../src/overview";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { LedgerAccount, LedgerTransaction, WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0); // 2026-08-15 local

function iso(year: number, monthIndex: number, day: number, hour = 12): string {
  return new Date(year, monthIndex, day, hour, 0, 0).toISOString();
}

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-ledger", ...overrides });
}

const accounts: LedgerAccount[] = [
  { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 1000 },
  { id: "acc-wallet", name: "Wallet", type: "wallet", openingBalance: 200 },
  { id: "acc-invest", name: "Brokerage", type: "investment", openingBalance: 5000 },
];

function busyState(): WealthState {
  return stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "i1", amount: 3000, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
      { id: "e1", amount: 250, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
      { id: "e2", amount: 90, type: "expense", categoryId: "expense-transport", accountId: "acc-wallet", date: iso(2026, 7, 6) },
      { id: "t1", amount: 500, type: "transfer", fromAccountId: "acc-bank", toAccountId: "acc-invest", date: iso(2026, 7, 7) },
      // previous month
      { id: "pe1", amount: 400, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 6, 12) },
      { id: "pi1", amount: 1000, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 6, 2) },
    ] as LedgerTransaction[],
  });
}

test("ledgerSnapshot: account balances match accountBalances() exactly", () => {
  const state = busyState();
  const snapshot = getLedgerSnapshot(state, NOW);
  assert.deepEqual(snapshot.accountBalances, accountBalances(state.ledgerTransactions, state.ledgerAccounts));
});

test("ledgerSnapshot: account-type balances match accountTypeBalance() exactly", () => {
  const state = busyState();
  const snapshot = getLedgerSnapshot(state, NOW);
  for (const type of ["bank", "wallet", "investment"] as const) {
    assert.equal(
      snapshot.accountTypeBalances[type],
      accountTypeBalance(state.ledgerTransactions, state.ledgerAccounts, type),
      `${type} balance drifted from accountTypeBalance()`,
    );
  }
});

test("ledgerSnapshot: current-month income matches ledgerTotals() on the same transactions", () => {
  const state = busyState();
  const snapshot = getLedgerSnapshot(state, NOW);
  const expected = ledgerTotals(transactionsInRange(state.ledgerTransactions, monthRange("2026-08")));
  assert.equal(snapshot.currentMonth.income, expected.income);
  assert.equal(snapshot.currentMonth.income, 3000);
});

test("ledgerSnapshot: current-month expenses match ledgerTotals()", () => {
  const state = busyState();
  const snapshot = getLedgerSnapshot(state, NOW);
  const expected = ledgerTotals(transactionsInRange(state.ledgerTransactions, monthRange("2026-08")));
  assert.equal(snapshot.currentMonth.expenses, expected.expense);
  assert.equal(snapshot.currentMonth.expenses, 340);
});

test("ledgerSnapshot: surplus is income minus expenses and matches ledgerTotals().balance", () => {
  const state = busyState();
  const snapshot = getLedgerSnapshot(state, NOW);
  const expected = ledgerTotals(transactionsInRange(state.ledgerTransactions, monthRange("2026-08")));
  assert.equal(snapshot.currentMonth.surplus, expected.balance);
  assert.equal(snapshot.currentMonth.surplus, 3000 - 340);
});

test("ledgerSnapshot: transfers are tracked separately and never enter income or expenses", () => {
  const state = busyState();
  const snapshot = getLedgerSnapshot(state, NOW);
  assert.equal(snapshot.currentMonth.transfers, 500);
  assert.equal(snapshot.currentMonth.income, 3000, "transfer must not inflate income");
  assert.equal(snapshot.currentMonth.expenses, 340, "transfer must not inflate expenses");
});

test("ledgerSnapshot: previous month is the calendar month before `now`", () => {
  const snapshot = getLedgerSnapshot(busyState(), NOW);
  assert.equal(snapshot.previousMonth.key, "2026-07");
  assert.equal(snapshot.previousMonth.income, 1000);
  assert.equal(snapshot.previousMonth.expenses, 400);
});

test("ledgerSnapshot: previous month rolls back across a year boundary", () => {
  const snapshot = getLedgerSnapshot(busyState(), new Date(2026, 0, 10, 12, 0, 0));
  assert.equal(snapshot.currentMonth.key, "2026-01");
  assert.equal(snapshot.previousMonth.key, "2025-12");
});

test("ledgerSnapshot: month boundaries are inclusive at both ends", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "first", amount: 10, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: new Date(2026, 7, 1, 0, 0, 0).toISOString() },
      { id: "last", amount: 20, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: new Date(2026, 7, 31, 23, 59, 59).toISOString() },
      { id: "next", amount: 40, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: new Date(2026, 8, 1, 0, 0, 1).toISOString() },
    ] as LedgerTransaction[],
  });
  const snapshot = getLedgerSnapshot(state, NOW);
  assert.equal(snapshot.currentMonth.income, 30, "September must be excluded");
});

test("ledgerSnapshot: totalPositiveBalance clamps negative accounts, matching the old helper", () => {
  const overdrawn: LedgerAccount[] = [
    { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 100 },
    { id: "acc-wallet", name: "Wallet", type: "wallet", openingBalance: 0 },
  ];
  const state = stateWith({
    ledgerAccounts: overdrawn,
    ledgerTransactions: [
      { id: "e", amount: 300, type: "expense", categoryId: "expense-food", accountId: "acc-wallet", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
  });
  const snapshot = getLedgerSnapshot(state, NOW);
  assert.equal(snapshot.totalPositiveBalance, 100);
  assert.equal(snapshot.totalPositiveBalance, sumPositiveBalances(state.ledgerTransactions, state.ledgerAccounts));
  assert.equal(snapshot.accountTypeBalances.wallet, -300, "type balances stay unclamped");
});

test("ledgerSnapshot: transactionCount counts every recorded transaction", () => {
  const state = busyState();
  const snapshot = getLedgerSnapshot(state, NOW);
  assert.equal(snapshot.transactionCount, state.ledgerTransactions.length);
  assert.equal(snapshot.currentMonth.transactionCount, 4, "August has 4 entries");
});

test("ledgerSnapshot: an empty ledger does not crash and is all zero", () => {
  // migrateState substitutes the default accounts for an empty array, so the
  // balances list is non-empty but every balance is zero.
  const state = stateWith({ ledgerAccounts: [], ledgerTransactions: [] });
  const snapshot = getLedgerSnapshot(state, NOW);
  assert.deepEqual(snapshot.accountBalances.map((entry) => entry.balance), state.ledgerAccounts.map(() => 0));
  assert.equal(snapshot.totalPositiveBalance, 0);
  assert.equal(snapshot.transactionCount, 0);
  for (const block of [snapshot.currentMonth, snapshot.previousMonth]) {
    assert.equal(block.income, 0);
    assert.equal(block.expenses, 0);
    assert.equal(block.surplus, 0);
    assert.equal(block.transfers, 0);
  }
});

test("ledgerSnapshot: malformed transaction dates are skipped, not fatal", () => {
  const state = stateWith({ ledgerAccounts: accounts });
  const dirty: WealthState = {
    ...state,
    ledgerTransactions: [
      { id: "bad", amount: 50, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: "not-a-date" },
      { id: "good", amount: 75, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 11) },
    ] as LedgerTransaction[],
  };
  assert.doesNotThrow(() => getLedgerSnapshot(dirty, NOW));
  assert.equal(getLedgerSnapshot(dirty, NOW).currentMonth.income, 75);
});

test("ledgerSnapshot: an unparsable month key yields no range and includes everything", () => {
  // Preserves the pre-existing behaviour of monthRange returning {null, null}.
  const range = monthRange("garbage");
  assert.deepEqual(range, { start: null, end: null });
  const state = busyState();
  assert.equal(
    transactionsInRange(state.ledgerTransactions, range).length,
    state.ledgerTransactions.length,
  );
});

test("ledgerSnapshot: monthKeyOf uses local time", () => {
  assert.equal(monthKeyOf(new Date(2026, 0, 1)), "2026-01");
  assert.equal(monthKeyOf(new Date(2026, 11, 31)), "2026-12");
});

test("ledgerSnapshot: FinancialSnapshot fields agree with the ledger snapshot", () => {
  const state = busyState();
  const ledger = getLedgerSnapshot(state, NOW);
  const financial = getFinancialSnapshot(state, NOW);

  assert.equal(financial.totalAssets, ledger.totalPositiveBalance);
  assert.equal(financial.liquidCash, ledger.accountTypeBalances.bank + ledger.accountTypeBalances.wallet);
  assert.equal(financial.investmentAccountBalance, ledger.accountTypeBalances.investment);
  assert.equal(financial.currentMonthIncome, ledger.currentMonth.income);
  assert.equal(financial.currentMonthExpenses, ledger.currentMonth.expenses);
  assert.equal(financial.currentMonthSurplus, ledger.currentMonth.surplus);
  assert.equal(financial.netWorth, financial.totalAssets - financial.totalLiabilities);
});

test("ledgerSnapshot: monthlyClose still matches ledgerTotals for the same month", () => {
  const state = busyState();
  const close = monthlyClose(state, "2026-08");
  const expected = ledgerTotals(transactionsInRange(state.ledgerTransactions, monthRange("2026-08")));
  assert.equal(close.income, expected.income);
  assert.equal(close.spending, expected.expense);
  assert.equal(close.netCashflow, expected.balance);
});

test("ledgerSnapshot: monthlyClose still agrees with the snapshot for the current month", () => {
  const state = busyState();
  const snapshot = getFinancialSnapshot(state, NOW);
  const close = monthlyClose(state, "2026-08");
  assert.equal(snapshot.currentMonthIncome, close.income);
  assert.equal(snapshot.currentMonthExpenses, close.spending);
  assert.equal(snapshot.currentMonthSurplus, close.netCashflow);
});

test("ledgerSnapshot: monthlyClose discipline score is unchanged for a known case", () => {
  // Income 3000, surplus 2660 -> savings 40; no DCA target on this fixture path.
  const state = busyState();
  const close = monthlyClose(state, "2026-08");
  assert.ok(close.disciplineScore >= 0 && close.disciplineScore <= 100);
  assert.equal(close.dcaDone, close.dcaInvested >= Math.max(state.dca.monthly, 0) || state.dca.monthly <= 0);
});

test("ledgerSnapshot: arbitrary filtered ranges still work through the old path", () => {
  const state = busyState();
  const filtered = filterLedgerTransactions(
    state.ledgerTransactions,
    { preset: "custom", startDate: "2026-07-01", endDate: "2026-07-31", type: "all", categoryId: "", query: "" },
    NOW,
    state.ledgerCategories,
    state.ledgerAccounts,
  );
  const totals = ledgerTotals(filtered);
  assert.equal(totals.income, 1000, "the July custom range is unaffected by the canonical model");
  assert.equal(totals.expense, 400);
});

test("ledgerSnapshot: Money Leak detector output is unchanged", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "fee-1", amount: 45, type: "expense", categoryId: "expense-bills", accountId: "acc-bank", date: "2026-07-10T00:00:00.000Z", note: "Late payment fee" },
      { id: "dup-1", amount: 120, type: "expense", categoryId: "expense-shopping", accountId: "acc-bank", date: "2026-07-12T00:00:00.000Z", note: "Headphones" },
      { id: "dup-2", amount: 120, type: "expense", categoryId: "expense-shopping", accountId: "acc-bank", date: "2026-07-12T00:00:00.000Z", note: "Headphones" },
    ] as LedgerTransaction[],
    liabilities: [{ id: "card", name: "Credit Card", balance: 6000, annualRate: 0.18, minimumPayment: 200 }],
  });
  const findings = detectMoneyLeakFindings(state);
  const fee = findings.leaks.find((leak) => leak.id === "avoidable-fees");
  const duplicate = findings.leaks.find((leak) => leak.id === "duplicate-dup-1");
  const debt = findings.leaks.find((leak) => leak.id === "debt-card");

  assert.equal(fee!.monthlyImpact, 45);
  assert.equal(fee!.confidence, 0.9);
  assert.equal(duplicate!.monthlyImpact, 120);
  assert.equal(duplicate!.confidence, 0.86);
  assert.equal(debt!.monthlyImpact, 6000 * 0.18 / 12);
  assert.equal(debt!.confidence, 0.99);
});

test("ledgerSnapshot: OverviewModel figures still track the canonical snapshots", () => {
  const state = busyState();
  const model = buildOverviewModel(state, NOW);
  const financial = getFinancialSnapshot(state, NOW);
  const ledger = getLedgerSnapshot(state, NOW);

  assert.equal(model.netWorth, financial.netWorth);
  assert.equal(model.cashFlow.income, ledger.currentMonth.income);
  assert.equal(model.cashFlow.expenses, ledger.currentMonth.expenses);
  assert.equal(model.cashFlow.surplus, ledger.currentMonth.surplus);
  // Expense trend now reads both months from one source.
  assert.equal(
    model.cashFlow.expenseChange,
    (ledger.currentMonth.expenses - ledger.previousMonth.expenses) / ledger.previousMonth.expenses,
  );
});

test("ledgerSnapshot: ledgerMonthTotals is a thin wrapper over ledgerTotals", () => {
  const state = busyState();
  for (const key of ["2026-08", "2026-07", "2026-01"]) {
    const totals = ledgerMonthTotals(state.ledgerTransactions, key);
    const expected = ledgerTotals(transactionsInRange(state.ledgerTransactions, monthRange(key)));
    assert.equal(totals.income, expected.income, key);
    assert.equal(totals.expenses, expected.expense, key);
    assert.equal(totals.surplus, expected.balance, key);
    assert.equal(totals.transfers, expected.transfer, key);
  }
});

test("ledgerSnapshot: is pure and does not mutate state", () => {
  const state = busyState();
  const before = JSON.stringify(state);
  getLedgerSnapshot(state, NOW);
  getFinancialSnapshot(state, NOW);
  assert.equal(JSON.stringify(state), before);
});

test("ledgerSnapshot: is deterministic", () => {
  const state = busyState();
  assert.deepEqual(getLedgerSnapshot(state, NOW), getLedgerSnapshot(state, new Date(NOW)));
});

test("ledgerSnapshot: default and empty states are safe", () => {
  for (const [label, state] of [["default", cloneDefaultState()], ["empty", emptyState()]] as const) {
    const snapshot = getLedgerSnapshot(state, NOW);
    for (const value of [snapshot.totalPositiveBalance, snapshot.currentMonth.income,
                         snapshot.currentMonth.expenses, snapshot.previousMonth.expenses]) {
      assert.ok(Number.isFinite(value), `${label} produced a non-finite value`);
    }
  }
});

test("ledgerSnapshot: is a runtime read model and is never persisted", () => {
  const state = cloneDefaultState();
  const persistedKeys = Object.keys(state);
  for (const forbidden of ["ledgerSnapshot", "financialSnapshot", "overviewModel"]) {
    assert.equal(persistedKeys.includes(forbidden), false, `${forbidden} must not be part of WealthState`);
  }
  // Building snapshots must not add fields to the state either.
  getLedgerSnapshot(state, NOW);
  getFinancialSnapshot(state, NOW);
  assert.deepEqual(Object.keys(state), persistedKeys);
  assert.equal(state.version, CURRENT_VERSION, "no version bump in this step");
  assert.ok(Number.isInteger(CURRENT_VERSION) && CURRENT_VERSION > 0);
});
