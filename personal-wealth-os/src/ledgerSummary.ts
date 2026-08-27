/**
 * Canonical Ledger read model.
 *
 * One place that interprets recorded ledger data into the basic facts every
 * consumer needs: account balances, balances by account type, and monthly
 * income / expenses / surplus.
 *
 * This module does not define new arithmetic. It composes the existing
 * primitives in ledger.ts (accountBalances, accountTypeBalance, ledgerTotals)
 * so behaviour is unchanged; it only removes the need for each consumer to
 * re-derive the same facts in slightly different ways.
 *
 * Scope: facts only. No HTML, no advice, no planning data, and never persisted
 * — this is a runtime read model, not part of WealthState.
 */
import type { LedgerAccount, LedgerAccountType, LedgerTransaction, WealthState } from "./models";
import { accountBalances, accountTypeBalance, ledgerTotals, type AccountBalance } from "./ledger";

/** Local-time bounds of a "YYYY-MM" month, matching ledgerRange("month") semantics. */
export function monthRange(month: string): { start: Date | null; end: Date | null } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return { start: null, end: null };
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return { start: null, end: null };
  return {
    start: new Date(year, monthIndex, 1),
    end: new Date(year, monthIndex + 1, 0, 23, 59, 59, 999),
  };
}

/** "YYYY-MM" for a date, using local time. */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Ledger transactions falling inside `range`. Unparsable dates are dropped
 * rather than throwing, matching the existing filtering behaviour.
 */
export function transactionsInRange(
  transactions: LedgerTransaction[],
  range: { start: Date | null; end: Date | null },
): LedgerTransaction[] {
  return transactions.filter((transaction) => {
    const timestamp = new Date(transaction.date).getTime();
    if (!Number.isFinite(timestamp)) return false;
    return (!range.start || timestamp >= range.start.getTime()) && (!range.end || timestamp <= range.end.getTime());
  });
}

/**
 * Total assets: positive account balances only. An overdrawn account is
 * debt-like, not a negative asset.
 */
export function sumPositiveBalances(
  transactions: LedgerTransaction[],
  accounts: LedgerAccount[],
  balances: AccountBalance[] = accountBalances(transactions, accounts),
): number {
  return balances.reduce((sum, item) => sum + Math.max(item.balance, 0), 0);
}

export interface LedgerMonthTotals {
  /** "YYYY-MM" this block describes. */
  key: string;
  income: number;
  expenses: number;
  /** income - expenses. Transfers are excluded from all three. */
  surplus: number;
  /** Transfer volume, tracked separately so it never inflates income or expenses. */
  transfers: number;
  transactionCount: number;
}

export interface LedgerSnapshot {
  accountBalances: AccountBalance[];
  /** Balance per account type. Not clamped — an overdraft reduces the total. */
  accountTypeBalances: Record<LedgerAccountType, number>;
  /** Sum of positive balances only. */
  totalPositiveBalance: number;
  /**
   * Positive balance held in accounts flagged holdsTrackedPortfolio — money the
   * portfolio ALSO reports as the value of its holdings.
   *
   * Reported separately rather than removed here: the Ledger page still shows
   * these accounts at their recorded balance, and this is the ledger's own
   * total. Only net worth nets it out, so the same money is not counted twice.
   */
  portfolioMirroredBalance: number;
  currentMonth: LedgerMonthTotals;
  previousMonth: LedgerMonthTotals;
  /** Every recorded transaction, regardless of date. */
  transactionCount: number;
}

/** Month totals for one "YYYY-MM", composed from the existing ledgerTotals(). */
export function ledgerMonthTotals(transactions: LedgerTransaction[], key: string): LedgerMonthTotals {
  const inMonth = transactionsInRange(transactions, monthRange(key));
  const totals = ledgerTotals(inMonth);
  return {
    key,
    income: totals.income,
    expenses: totals.expense,
    surplus: totals.balance,
    transfers: totals.transfer,
    transactionCount: inMonth.length,
  };
}

/**
 * Build the canonical ledger snapshot.
 * Pure: same state + same `now` always produces the same result.
 *
 * `now` selects the current calendar month; the previous month is the calendar
 * month immediately before it. Both use the same local-time month bounds, so
 * every consumer agrees on where a month starts and ends.
 */
export function getLedgerSnapshot(state: WealthState, now = new Date()): LedgerSnapshot {
  const transactions = state.ledgerTransactions;
  const accounts = state.ledgerAccounts;

  const currentKey = monthKeyOf(now);
  const previousKey = monthKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  // Every balance figure below is derived from one pass over the transactions.
  // Recomputing it per figure replayed the whole ledger five times for five
  // views of the same numbers.
  const balances = accountBalances(transactions, accounts);

  return {
    accountBalances: balances,
    accountTypeBalances: {
      bank: accountTypeBalance(transactions, accounts, "bank", balances),
      wallet: accountTypeBalance(transactions, accounts, "wallet", balances),
      investment: accountTypeBalance(transactions, accounts, "investment", balances),
    },
    totalPositiveBalance: sumPositiveBalances(transactions, accounts, balances),
    // Clamped the same way totalPositiveBalance is, so subtracting it from that
    // total can never produce a negative or overshoot.
    portfolioMirroredBalance: balances
      .filter(({ account }) => account.holdsTrackedPortfolio === true)
      .reduce((sum, { balance }) => sum + Math.max(balance, 0), 0),
    currentMonth: ledgerMonthTotals(transactions, currentKey),
    previousMonth: ledgerMonthTotals(transactions, previousKey),
    transactionCount: transactions.length,
  };
}
