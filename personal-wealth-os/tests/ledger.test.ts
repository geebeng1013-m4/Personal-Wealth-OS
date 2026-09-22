import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  ledgerRange,
  filterLedgerTransactions,
  ledgerTotals,
  accountBalances,
  investmentAssetShare,
  normalizeLedgerAmount,
  buildLedgerTransaction,
  type LedgerFilters,
} from "../src/ledger";
import type { LedgerAccount, LedgerTransaction } from "../src/models";

function tx(overrides: Partial<LedgerTransaction> & Pick<LedgerTransaction, "id" | "amount" | "type" | "date">): LedgerTransaction {
  return { ...overrides };
}

function baseFilters(overrides: Partial<LedgerFilters> = {}): LedgerFilters {
  return { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "", fundingSource: "all", ...overrides };
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

test("filterLedgerTransactions: fundingSource filter splits personal from sponsored", () => {
  const now = new Date(2026, 7, 27);
  const transactions = [
    tx({ id: "personal-absent", amount: 10, type: "expense", date: "2026-08-05T00:00:00.000Z" }),
    tx({ id: "personal-explicit", amount: 12, type: "expense", date: "2026-08-06T00:00:00.000Z", fundingSource: "personal" }),
    tx({ id: "sponsored", amount: 20, type: "expense", date: "2026-08-07T00:00:00.000Z", fundingSource: "sponsored" }),
  ];
  const all = filterLedgerTransactions(transactions, baseFilters({ fundingSource: "all" }), now);
  assert.deepEqual(all.map((t) => t.id).sort(), ["personal-absent", "personal-explicit", "sponsored"]);

  const personal = filterLedgerTransactions(transactions, baseFilters({ fundingSource: "personal" }), now);
  assert.deepEqual(personal.map((t) => t.id).sort(), ["personal-absent", "personal-explicit"]);

  const sponsored = filterLedgerTransactions(transactions, baseFilters({ fundingSource: "sponsored" }), now);
  assert.deepEqual(sponsored.map((t) => t.id), ["sponsored"]);
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

// --- buildLedgerTransaction: the Ledger form's and the Overview sheet's one set of rules (Q-1) ---

const entryAccounts = [
  { id: "account-bank", name: "Bank", type: "bank", openingBalance: 0 },
  { id: "account-wallet", name: "Wallet", type: "wallet", openingBalance: 0 },
] as LedgerAccount[];
const entryCategories = [
  { id: "income-salary", label: "Salary", type: "income" },
  { id: "food", label: "Food", type: "expense" },
] as Parameters<typeof buildLedgerTransaction>[2];
const entry = (overrides: Partial<Parameters<typeof buildLedgerTransaction>[0]> = {}) => buildLedgerTransaction({
  id: "ledger-1", type: "income", amount: "4500", categoryId: "income-salary", accountId: "account-bank",
  fromAccountId: "", toAccountId: "", date: "2026-09-22", note: "  Pay  ", sponsored: false, ...overrides,
}, entryAccounts, entryCategories);

test("buildLedgerTransaction: a valid pay entry lands at local midnight, note trimmed", () => {
  const result = entry();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.transaction.amount, 4500);
  assert.equal(result.transaction.note, "Pay");
  assert.equal(result.transaction.date, new Date("2026-09-22T00:00:00").toISOString());
  assert.equal(result.transaction.fundingSource, undefined);
});

test("buildLedgerTransaction: rejects empty, zero, negative and non-numeric amounts", () => {
  for (const amount of ["", "0", "-5", "abc", "Infinity"]) {
    assert.equal(entry({ amount }).ok, false, `amount ${JSON.stringify(amount)} should be rejected`);
  }
});

test("buildLedgerTransaction: a category of the wrong type, an unknown account or a bad date is rejected", () => {
  assert.equal(entry({ categoryId: "food" }).ok, false);
  assert.equal(entry({ accountId: "account-gone" }).ok, false);
  assert.equal(entry({ date: "2026-02-31x" }).ok, false);
});

test("buildLedgerTransaction: transfers need two different accounts, and say so", () => {
  const same = entry({ type: "transfer", fromAccountId: "account-bank", toAccountId: "account-bank" });
  assert.deepEqual(same, { ok: false, error: "Choose two different accounts for a transfer." });
  const ok = entry({ type: "transfer", fromAccountId: "account-bank", toAccountId: "account-wallet", sponsored: true });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.transaction.fundingSource, undefined, "a transfer is never sponsored");
});
