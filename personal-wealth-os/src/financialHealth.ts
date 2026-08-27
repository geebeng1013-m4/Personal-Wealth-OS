import type { Goal, LedgerAccount, LedgerTransaction, Liability, RecurringTransaction, Trade, WealthState } from "./models";
import { accountBalances } from "./ledger";
import { getLedgerSnapshot, ledgerMonthTotals, sumPositiveBalances, type LedgerSnapshot } from "./ledgerSummary";
import { calculatePositionCostBasis } from "./rules";
import { getPortfolioSnapshot, type PortfolioSnapshot } from "./portfolioSummary";

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
  // Ledger side of the close comes from the canonical month totals; the trade
  // and discipline scoring below is unchanged.
  const totals = ledgerMonthTotals(state.ledgerTransactions, month);
  const trades = state.trades.filter((trade) => trade.date.slice(0, 7) === month && trade.type !== "Sell");
  const dcaInvested = trades.reduce((sum, trade) => sum + trade.amountMyr + trade.feeMyr, 0);
  const target = Math.max(state.dca.monthly, 0);
  const savingsScore = totals.income > 0 ? Math.min(40, Math.max(0, totals.surplus / totals.income * 40)) : 0;
  const dcaScore = target <= 0 ? 30 : Math.min(30, dcaInvested / target * 30);
  const trackingScore = totals.transactionCount > 0 ? 30 : 0;
  return { month, income: totals.income, spending: totals.expenses, netCashflow: totals.surplus, dcaInvested, dcaDone: target <= 0 || dcaInvested >= target, disciplineScore: Math.round(savingsScore + dcaScore + trackingScore) };
}

export function forecastRecurring(items: RecurringTransaction[]): { income: number; expense: number; surplus: number } {
  const active = items.filter((item) => item.active);
  const income = active.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const expense = active.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  return { income, expense, surplus: income - expense };
}

/**
 * Resolves a monthly schedule without allowing dates such as February 31 to
 * roll into the next month. Days 29-31 fall back only when that month is too
 * short; they remain their requested day in longer months.
 */
export function recurringDayInMonth(year: number, monthIndex: number, dayOfMonth: number): number {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const requestedDay = Number.isFinite(dayOfMonth) ? Math.trunc(dayOfMonth) : 1;
  return Math.min(Math.max(requestedDay, 1), daysInMonth);
}

export function recurringDateForMonth(year: number, monthIndex: number, dayOfMonth: number): Date {
  return new Date(year, monthIndex, recurringDayInMonth(year, monthIndex, dayOfMonth));
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function nextRecurringOccurrence(items: RecurringTransaction[], from = new Date()): { item: RecurringTransaction; date: Date } | null {
  const today = startOfLocalDay(from);
  const candidates = items
    .filter((item) => item.active)
    .map((item) => {
      let date = recurringDateForMonth(today.getFullYear(), today.getMonth(), item.dayOfMonth);
      if (date < today) {
        date = recurringDateForMonth(from.getFullYear(), from.getMonth() + 1, item.dayOfMonth);
      }
      return { item, date };
    })
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  return candidates[0] ?? null;
}

export function totalLiabilities(liabilities: Liability[]): number {
  return liabilities.reduce((sum, item) => sum + item.balance, 0);
}

/**
 * Canonical read model for financial position.
 *
 * Built from ledger accounts, ledger transactions and liabilities, plus the
 * value of what the portfolio actually holds. Planning/allocation data
 * (cashflow, DCA, buckets, goals, emergency fund, opportunity reserve) is
 * deliberately excluded — those answer "what do I intend", not "what do I have".
 *
 * Portfolio holdings ARE included: a live market price is used when one is
 * available, and cost basis otherwise. Cost basis is always known (it needs no
 * network call), so `totalAssets` never silently omits the portfolio just
 * because a quote could not be fetched — it only ever falls back to the most
 * recent number that IS known, never to zero.
 */
export interface FinancialSnapshot {
  /** Ledger positive balances plus the portfolio's contribution (see portfolioValueMyr). */
  totalAssets: number;
  totalLiabilities: number;
  /** Always totalAssets - totalLiabilities. */
  netWorth: number;
  /** Bank + wallet balances (spendable). Not clamped — an overdrawn account reduces liquid cash. */
  liquidCash: number;
  /** Ledger investment-account balance. Unrelated to portfolio trade cost basis. */
  investmentAccountBalance: number;
  /**
   * The portfolio figure folded into totalAssets: live market value when a
   * quote was available, cost basis otherwise. Exposed so the UI can show
   * which one is behind the number, rather than recomputing it.
   */
  portfolioValueMyr: number;
  /** True when portfolioValueMyr is a live market value rather than cost basis. */
  portfolioValueIsLive: boolean;
  currentMonthIncome: number;
  currentMonthExpenses: number;
  /** currentMonthIncome - currentMonthExpenses. Transfers are excluded from both. */
  currentMonthSurplus: number;
}

/**
 * Build the canonical financial snapshot. Pure: same state + same `now` +
 * same market inputs always produce the same result. `now` decides which
 * calendar month counts as "current", using the same local-time month
 * boundaries as the ledger UI.
 *
 * `ledger` lets a caller that has already built the canonical LedgerSnapshot
 * for this same `now` pass it in, instead of paying for a second full scan of
 * every transaction. `portfolio` works the same way for the portfolio
 * snapshot — pass one built WITH live prices to have totalAssets reflect
 * market value; omit it (or pass one built with no prices) to fall back to
 * cost basis. Both defaults reproduce the same figures a bare call always
 * built. Passing a ledger or portfolio built for a DIFFERENT `now`/state would
 * be a caller bug: they must describe the same instant.
 */
export function getFinancialSnapshot(
  state: WealthState,
  now = new Date(),
  ledger: LedgerSnapshot = getLedgerSnapshot(state, now),
  portfolio: PortfolioSnapshot = getPortfolioSnapshot(state, now),
): FinancialSnapshot {
  // Ledger facts come from the canonical ledger read model; this layer adds
  // liabilities, the portfolio's contribution, and the net-worth identity.
  const portfolioValueIsLive = portfolio.totalInvestmentValueMyr !== null;
  const portfolioValueMyr = portfolio.totalInvestmentValueMyr ?? portfolio.totalInvestedMyr;
  const totalAssets = ledger.totalPositiveBalance + portfolioValueMyr;
  const liabilities = totalLiabilities(state.liabilities);

  return {
    totalAssets,
    totalLiabilities: liabilities,
    netWorth: totalAssets - liabilities,
    liquidCash: ledger.accountTypeBalances.bank + ledger.accountTypeBalances.wallet,
    investmentAccountBalance: ledger.accountTypeBalances.investment,
    portfolioValueMyr,
    portfolioValueIsLive,
    currentMonthIncome: ledger.currentMonth.income,
    currentMonthExpenses: ledger.currentMonth.expenses,
    currentMonthSurplus: ledger.currentMonth.surplus,
  };
}

/** @deprecated Compatibility wrapper — prefer getFinancialSnapshot(), which owns this metric. */
export function netWorth(transactions: LedgerTransaction[], accounts: LedgerAccount[], liabilities: Liability[]): { assets: number; liabilities: number; net: number } {
  const assets = sumPositiveBalances(transactions, accounts);
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