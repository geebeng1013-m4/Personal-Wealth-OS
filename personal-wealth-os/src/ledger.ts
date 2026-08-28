import type { LedgerAccount, LedgerCategory, LedgerTransaction, LedgerTransactionType } from "./models";

export type LedgerRangePreset = "today" | "week" | "month" | "year" | "custom";

export interface LedgerFilters {
  preset: LedgerRangePreset;
  startDate: string;
  endDate: string;
  type: LedgerTransactionType | "all";
  categoryId: string;
  query: string;
}

export interface LedgerTotals {
  income: number;
  expense: number;
  balance: number;
  transfer: number;
}

export interface AccountBalance {
  account: LedgerAccount;
  balance: number;
}

export interface CategoryTotal {
  category: LedgerCategory;
  amount: number;
  share: number;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function parseLocalDate(value: string, end = false): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return end ? endOfLocalDay(date) : startOfLocalDay(date);
}

export function ledgerRange(preset: LedgerRangePreset, now = new Date(), customStart = "", customEnd = ""): { start: Date | null; end: Date | null } {
  if (preset === "custom") return { start: parseLocalDate(customStart), end: parseLocalDate(customEnd, true) };
  if (preset === "today") return { start: startOfLocalDay(now), end: endOfLocalDay(now) };
  const end = endOfLocalDay(now);
  if (preset === "week") {
    const start = startOfLocalDay(now);
    const dayFromMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayFromMonday);
    return { start, end };
  }
  if (preset === "year") return { start: new Date(now.getFullYear(), 0, 1), end };
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
}

export function filterLedgerTransactions(transactions: LedgerTransaction[], filters: LedgerFilters, now = new Date(), categories: LedgerCategory[] = [], accounts: LedgerAccount[] = []): LedgerTransaction[] {
  const { start, end } = ledgerRange(filters.preset, now, filters.startDate, filters.endDate);
  const query = filters.query.trim().toLocaleLowerCase();
  const categoryNames = new Map(categories.map((category) => [category.id, category.label.toLocaleLowerCase()]));
  const accountNames = new Map(accounts.map((account) => [account.id, account.name.toLocaleLowerCase()]));
  return transactions
    .filter((transaction) => {
      const timestamp = new Date(transaction.date).getTime();
      if (!Number.isFinite(timestamp) || (start && timestamp < start.getTime()) || (end && timestamp > end.getTime())) return false;
      if (filters.type !== "all" && transaction.type !== filters.type) return false;
      if (filters.categoryId && transaction.categoryId !== filters.categoryId) return false;
      const searchable = [transaction.note ?? "", categoryNames.get(transaction.categoryId ?? "") ?? "", accountNames.get(transaction.accountId ?? "") ?? "", accountNames.get(transaction.fromAccountId ?? "") ?? "", accountNames.get(transaction.toAccountId ?? "") ?? ""].join(" ").toLocaleLowerCase();
      return !query || searchable.includes(query);
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Round a money total to the cent.
 *
 * Amounts like 757.89 have no exact binary representation, so adding a few
 * dozen of them drifts into the thirteenth decimal: a real month of the user's
 * ledger summed to 757.8900000000002 and 681.3999999999999, and those went
 * straight into the Monthly Review's number inputs — and would have been saved
 * to the review record on submit.
 *
 * Rounding once at the end of a sum is safe. Rounding each addend would not be:
 * the inputs are already cent-precise, and the drift only appears in the
 * accumulator.
 */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function ledgerTotals(transactions: LedgerTransaction[]): LedgerTotals {
  const totals = transactions.reduce((result, transaction) => {
    if (transaction.type === "income") result.income += transaction.amount;
    if (transaction.type === "expense") result.expense += transaction.amount;
    if (transaction.type === "transfer") result.transfer += transaction.amount;
    return result;
  }, { income: 0, expense: 0, transfer: 0 });
  const income = toCents(totals.income);
  const expense = toCents(totals.expense);
  // Derived from the rounded halves, so the three figures always agree on
  // screen: a balance rounded independently could differ from income − expense
  // by a cent.
  return { income, expense, transfer: toCents(totals.transfer), balance: toCents(income - expense) };
}

export function openingFunds(accounts: LedgerAccount[]): number {
  return accounts.reduce((total, account) => total + account.openingBalance, 0);
}

// currentNetAssets() removed in Step 15: it had no consumer in src or tests,
// and LedgerSnapshot.totalPositiveBalance / accountTypeBalances supersede it.

export function categoryTotals(transactions: LedgerTransaction[], categories: LedgerCategory[], type: LedgerTransactionType): CategoryTotal[] {
  const amounts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type === type && transaction.categoryId) amounts.set(transaction.categoryId, (amounts.get(transaction.categoryId) ?? 0) + transaction.amount);
  }
  const total = [...amounts.values()].reduce((sum, amount) => sum + amount, 0);
  return categories
    .filter((category) => category.type === type && (amounts.get(category.id) ?? 0) > 0)
    .map((category) => ({ category, amount: amounts.get(category.id) ?? 0, share: total > 0 ? (amounts.get(category.id) ?? 0) / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function accountBalances(transactions: LedgerTransaction[], accounts: LedgerAccount[]): AccountBalance[] {
  const balances = new Map(accounts.map((account) => [account.id, account.openingBalance]));
  for (const transaction of transactions) {
    if (transaction.type === "income" && transaction.accountId) balances.set(transaction.accountId, (balances.get(transaction.accountId) ?? 0) + transaction.amount);
    if (transaction.type === "expense" && transaction.accountId) balances.set(transaction.accountId, (balances.get(transaction.accountId) ?? 0) - transaction.amount);
    if (transaction.type === "transfer") {
      if (transaction.fromAccountId) balances.set(transaction.fromAccountId, (balances.get(transaction.fromAccountId) ?? 0) - transaction.amount);
      if (transaction.toAccountId) balances.set(transaction.toAccountId, (balances.get(transaction.toAccountId) ?? 0) + transaction.amount);
    }
  }
  return accounts.map((account) => ({ account, balance: balances.get(account.id) ?? 0 }));
}

/**
 * `balances` lets a caller that already ran accountBalances() over the same
 * transactions and accounts reuse the result instead of replaying every
 * transaction again. Omitting it computes them exactly as before.
 */
export function accountTypeBalance(
  transactions: LedgerTransaction[],
  accounts: LedgerAccount[],
  type: LedgerAccount["type"],
  balances: AccountBalance[] = accountBalances(transactions, accounts),
): number {
  return balances
    .filter(({ account }) => account.type === type)
    .reduce((total, { balance }) => total + balance, 0);
}

export interface InvestmentAssetShare {
  totalAssets: number;
  investmentAssets: number;
  ratio: number | null;
}

function isMoneyMarketFundAccount(account: LedgerAccount): boolean {
  const normalizedName = account.name.trim().toLowerCase();
  return account.id === "account-moomoo-mmf"
    || /(^|\s)mmf($|\s)/i.test(account.name)
    || normalizedName.includes("money market fund");
}

export function investmentAssetShare(transactions: LedgerTransaction[], accounts: LedgerAccount[]): InvestmentAssetShare {
  const balances = accountBalances(transactions, accounts);
  const totalAssets = balances.reduce((total, { balance }) => total + balance, 0);
  const investmentAssets = balances
    .filter(({ account }) => account.type === "investment" && !isMoneyMarketFundAccount(account))
    .reduce((total, { balance }) => total + balance, 0);

  return {
    totalAssets,
    investmentAssets,
    ratio: totalAssets > 0 ? Math.max(investmentAssets, 0) / totalAssets : null,
  };
}

export function monthlyLedgerTotals(transactions: LedgerTransaction[], year: number): Array<{ month: number; income: number; expense: number }> {
  const months = Array.from({ length: 12 }, (_, month) => ({ month, income: 0, expense: 0 }));
  for (const transaction of transactions) {
    const date = new Date(transaction.date);
    if (Number.isFinite(date.getTime()) && date.getFullYear() === year && transaction.type !== "transfer") months[date.getMonth()][transaction.type] += transaction.amount;
  }
  return months;
}

export function normalizeLedgerAmount(value: string | number): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}