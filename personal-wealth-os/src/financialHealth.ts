import type { Goal, LedgerAccount, LedgerTransaction, Liability, RecurringTransaction, Trade, WealthState } from "./models";
import { accountBalances, ledgerTotals } from "./ledger";
import { calculatePositionCostBasis } from "./rules";

export interface MonthlyClose {
  month: string;
  income: number;
  spending: number;
  netCashflow: number;
  dcaInvested: number;
  dcaDone: boolean;
  disciplineScore: number;
}

export function monthlyClose(state: WealthState, month: string): MonthlyClose {
  const ledger = state.ledgerTransactions.filter((transaction) => transaction.date.slice(0, 7) === month);
  const totals = ledgerTotals(ledger);
  const trades = state.trades.filter((trade) => trade.date.slice(0, 7) === month && trade.type !== "Sell");
  const dcaInvested = trades.reduce((sum, trade) => sum + trade.amountMyr + trade.feeMyr, 0);
  const target = Math.max(state.dca.monthly, 0);
  const savingsScore = totals.income > 0 ? Math.min(40, Math.max(0, totals.balance / totals.income * 40)) : 0;
  const dcaScore = target <= 0 ? 30 : Math.min(30, dcaInvested / target * 30);
  const trackingScore = ledger.length > 0 ? 30 : 0;
  return { month, income: totals.income, spending: totals.expense, netCashflow: totals.balance, dcaInvested, dcaDone: target <= 0 || dcaInvested >= target, disciplineScore: Math.round(savingsScore + dcaScore + trackingScore) };
}

export function forecastRecurring(items: RecurringTransaction[]): { income: number; expense: number; surplus: number } {
  const active = items.filter((item) => item.active);
  const income = active.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const expense = active.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  return { income, expense, surplus: income - expense };
}

export function totalLiabilities(liabilities: Liability[]): number {
  return liabilities.reduce((sum, item) => sum + item.balance, 0);
}

export function netWorth(transactions: LedgerTransaction[], accounts: LedgerAccount[], liabilities: Liability[]): { assets: number; liabilities: number; net: number } {
  const assets = accountBalances(transactions, accounts).reduce((sum, item) => sum + Math.max(item.balance, 0), 0);
  const debt = totalLiabilities(liabilities);
  return { assets, liabilities: debt, net: assets - debt };
}

export function linkedGoalCurrent(goal: Goal, state: WealthState): number {
  if (!goal.accountId) return goal.current;
  return accountBalances(state.ledgerTransactions, state.ledgerAccounts).find((item) => item.account.id === goal.accountId)?.balance ?? goal.current;
}

export function rebalanceContributions(state: WealthState): Array<{ ticker: string; amount: number }> {
  const positions = Object.keys(state.dca.targets).map((ticker) => calculatePositionCostBasis(state.trades, ticker));
  const total = positions.reduce((sum, position) => sum + position.costBasisMyr, 0);
  const gaps = positions.map((position) => ({ ticker: position.ticker, gap: Math.max(0, (state.dca.targets[position.ticker] ?? 0) * (total + state.dca.monthly) - position.costBasisMyr) }));
  const totalGap = gaps.reduce((sum, item) => sum + item.gap, 0);
  return gaps.map((item) => ({ ticker: item.ticker, amount: totalGap > 0 ? state.dca.monthly * item.gap / totalGap : state.dca.monthly * (state.dca.targets[item.ticker] ?? 0) }));
}

export function tradeExchangeRate(trade: Pick<Trade, "exchangeRate" | "amountMyr" | "amountUsd">): number {
  const exchangeRate = trade.exchangeRate ?? 0;
  return exchangeRate > 0 ? exchangeRate : trade.amountUsd > 0 ? trade.amountMyr / trade.amountUsd : 0;
}