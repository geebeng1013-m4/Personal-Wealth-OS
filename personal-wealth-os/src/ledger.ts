import type { LedgerCategory, LedgerTransaction, LedgerTransactionType } from "./models";

export type LedgerRangePreset = "week" | "month" | "year" | "custom";

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

export function filterLedgerTransactions(transactions: LedgerTransaction[], filters: LedgerFilters, now = new Date()): LedgerTransaction[] {
  const { start, end } = ledgerRange(filters.preset, now, filters.startDate, filters.endDate);
  const query = filters.query.trim().toLocaleLowerCase();
  return transactions
    .filter((transaction) => {
      const timestamp = new Date(transaction.date).getTime();
      if (!Number.isFinite(timestamp) || (start && timestamp < start.getTime()) || (end && timestamp > end.getTime())) return false;
      if (filters.type !== "all" && transaction.type !== filters.type) return false;
      if (filters.categoryId && transaction.categoryId !== filters.categoryId) return false;
      return !query || (transaction.note ?? "").toLocaleLowerCase().includes(query);
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function ledgerTotals(transactions: LedgerTransaction[]): LedgerTotals {
  const totals = transactions.reduce((result, transaction) => {
    result[transaction.type] += transaction.amount;
    return result;
  }, { income: 0, expense: 0 });
  return { ...totals, balance: totals.income - totals.expense };
}

export function categoryTotals(transactions: LedgerTransaction[], categories: LedgerCategory[], type: LedgerTransactionType): CategoryTotal[] {
  const amounts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type === type) amounts.set(transaction.categoryId, (amounts.get(transaction.categoryId) ?? 0) + transaction.amount);
  }
  const total = [...amounts.values()].reduce((sum, amount) => sum + amount, 0);
  return categories
    .filter((category) => category.type === type && (amounts.get(category.id) ?? 0) > 0)
    .map((category) => ({ category, amount: amounts.get(category.id) ?? 0, share: total > 0 ? (amounts.get(category.id) ?? 0) / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function monthlyLedgerTotals(transactions: LedgerTransaction[], year: number): Array<{ month: number; income: number; expense: number }> {
  const months = Array.from({ length: 12 }, (_, month) => ({ month, income: 0, expense: 0 }));
  for (const transaction of transactions) {
    const date = new Date(transaction.date);
    if (Number.isFinite(date.getTime()) && date.getFullYear() === year) months[date.getMonth()][transaction.type] += transaction.amount;
  }
  return months;
}

export function normalizeLedgerAmount(value: string | number): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}