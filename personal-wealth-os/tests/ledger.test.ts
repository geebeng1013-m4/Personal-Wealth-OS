import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  ledgerRange,
  filterLedgerTransactions,
  ledgerTotals,
  accountBalances,
  investmentAssetShare,
  normalizeLedgerAmount,
  type LedgerFilters,
} from "../src/ledger";
import type { LedgerAccount, LedgerTransaction } from "../src/models";

function tx(overrides: Partial<LedgerTransaction> & Pick<LedgerTransaction, "id" | "amount" | "type" | "date">): LedgerTransaction {
  return { ...overrides };
}

function baseFilters(overrides: Partial<LedgerFilters> = {}): LedgerFilters {
  return { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "", ...overrides };
}

test("ledgerRange: 'week' starts on Monday regardless of today's weekday", () => {
  // 2026-08-27 is a Thursday.
  const thursday = new Date(2026, 7, 27, 15, 0, 0);
  const { start } = ledgerRange("week", thursday);
  assert.ok(start);
  assert.equal(start!.getDay(), 1, "week range should start on Monday");
  assert.equal(start!.getDate(), 24);
});

test("ledgerRange: 'custom' returns null for an unparsable date", () => {
  const { start, end } = ledgerRange("custom", new Date(), "not-a-date", "2026-08-27");
  assert.equal(start, null);
  assert.ok(end);
});

test("ledgerRange: 'custom' rejects an out-of-range calendar date like Feb 30", () => {
  const { start } = ledgerRange("custom", new Date(), "2026-02-30", "");
  assert.equal(start, null);
});

test("filterLedgerTransactions: excludes transactions outside the date range", () => {
  const transactions = [
    tx({ id: "1", amount: 10, type: "expense", date: "2026-08-01T00:00:00.000Z", categoryId: "cat-food" }),
    tx({ id: "2", amount: 20, type: "expense", date: "2026-01-01T00:00:00.000Z", categoryId: "cat-food" }),
  ];
  const now = new Date(2026, 7, 27);
  const result = filterLedgerTransactions(transactions, baseFilters({ preset: "month" }), now);
  assert.deepEqual(result.map((t) => t.id), ["1"]);
});

test("filterLedgerTransactions: text query matches on note, category, and account name", () => {
  const transactions = [
    tx({ id: "1", amount: 10, type: "expense", date: "2026-08-05T00:00:00.000Z", note: "Coffee with team" }),
    tx({ id: "2", amount: 15, type: "expense", date: "2026-08-06T00:00:00.000Z", categoryId: "cat-transport" }),
  ];
  const categories = [{ id: "cat-transport", label: "Transport", icon: "🚌", type: "expense" as const }];
  const now = new Date(2026, 7, 27);
  const byNote = filterLedgerTransactions(transactions, baseFilters({ query: "coffee" }), now, categories);
  assert.deepEqual(byNote.map((t) => t.id), ["1"]);
  const byCategory = filterLedgerTransactions(transactions, baseFilters({ query: "transport" }), now, categories);
  assert.deepEqual(byCategory.map((t) => t.id), ["2"]);
});

test("ledgerTotals: sums income/expense/transfer independently and derives balance", () => {
  const transactions = [
    tx({ id: "1", amount: 100, type: "income", date: "2026-08-01" }),
    tx({ id: "2", amount: 40, type: "expense", date: "2026-08-02" }),
    tx({ id: "3", amount: 25, type: "transfer", date: "2026-08-03" }),
  ];
  const totals = ledgerTotals(transactions);
  assert.equal(totals.income, 100);
  assert.equal(totals.expense, 40);
  assert.equal(totals.transfer, 25);
  assert.equal(totals.balance, 60);
});

test("accountBalances: applies opening balance, income/expense, and transfer direction", () => {
  const accounts: LedgerAccount[] = [
    { id: "acc-a", name: "A", type: "bank", openingBalance: 100 },
    { id: "acc-b", name: "B", type: "bank", openingBalance: 0 },
  ];
  const transactions = [
    tx({ id: "1", amount: 50, type: "income", date: "2026-08-01", accountId: "acc-a" }),
    tx({ id: "2", amount: 20, type: "expense", date: "2026-08-02", accountId: "acc-a" }),
    tx({ id: "3", amount: 30, type: "transfer", date: "2026-08-03", fromAccountId: "acc-a", toAccountId: "acc-b" }),
  ];
  const balances = accountBalances(transactions, accounts);
  assert.equal(balances.find((b) => b.account.id === "acc-a")!.balance, 100 + 50 - 20 - 30);
  assert.equal(balances.find((b) => b.account.id === "acc-b")!.balance, 30);
});

test("investmentAssetShare: excludes accounts flagged as money-market funds from the investment share", () => {
  const accounts: LedgerAccount[] = [
    { id: "account-moomoo-mmf", name: "MooMoo MMF", type: "investment", openingBalance: 1000 },
    { id: "acc-brokerage", name: "Brokerage", type: "investment", openingBalance: 500 },
    { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 500 },
  ];
  const share = investmentAssetShare([], accounts);
  assert.equal(share.totalAssets, 2000);
  assert.equal(share.investmentAssets, 500);
  assert.equal(share.ratio, 500 / 2000);
});

test("normalizeLedgerAmount: rejects zero/negative/non-finite, rounds to cents", () => {
  assert.equal(normalizeLedgerAmount(0), null);
  assert.equal(normalizeLedgerAmount(-5), null);
  assert.equal(normalizeLedgerAmount("abc"), null);
  assert.equal(normalizeLedgerAmount(10.005), 10.01);
  assert.equal(normalizeLedgerAmount("42.999"), 43);
});
