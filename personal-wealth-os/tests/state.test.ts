import assert from "node:assert/strict";
import { test } from "./testHarness";
import { migrateState, CURRENT_VERSION } from "../src/state";
import type { LedgerTransaction, WealthState } from "../src/models";

// migrateState calls deviceId() -> localStorage when input.deviceId is missing,
// and localStorage doesn't exist in this Node test environment, so every
// fixture below supplies a deviceId explicitly.

test("migrateState: fills in defaults and stamps the current version for a near-empty input", () => {
  const result = migrateState({ deviceId: "device-1" });
  assert.equal(result.version, CURRENT_VERSION);
  assert.equal(result.deviceId, "device-1");
  assert.deepEqual(result.trades, []);
  assert.ok(result.ledgerAccounts.length > 0, "should seed default ledger accounts");
  assert.ok(result.ledgerCategories.length > 0, "should seed default ledger categories");
});

test("migrateState: a partial dca override is merged with default targets rather than replacing them", () => {
  const result = migrateState({ deviceId: "device-1", dca: { monthly: 500, targets: { VOO: 0.4 } } });
  assert.equal(result.dca.monthly, 500);
  assert.equal(result.dca.targets.VOO, 0.4, "explicit override should win");
  assert.equal(result.dca.targets.QQQM, migrateState({ deviceId: "device-1" }).dca.targets.QQQM, "unspecified targets should fall back to the default");
});

test("migrateState: two transactions referencing the same account by name (different case) resolve to one recovered account", () => {
  const rawTransactions = [
    { id: "t1", amount: 12, type: "expense", categoryId: "expense-food", date: "2026-08-01", accountName: "Cash Wallet Old" },
    { id: "t2", amount: 8, type: "expense", categoryId: "expense-food", date: "2026-08-02", accountName: "cash wallet old" },
  ];
  const result = migrateState({
    deviceId: "device-1",
    ledgerTransactions: rawTransactions as unknown as LedgerTransaction[],
  });

  assert.equal(result.ledgerTransactions.length, 2);
  const [tx1, tx2] = result.ledgerTransactions;
  assert.ok(tx1.accountId);
  assert.equal(tx1.accountId, tx2.accountId, "same account referenced with different casing should resolve to the same id");

  const recovered = result.ledgerAccounts.filter((account) => account.name === "Cash Wallet Old");
  assert.equal(recovered.length, 1, "the recovered account should only be created once, not duplicated per transaction");
});

test("migrateState: a transfer with the same source and destination account is dropped", () => {
  const rawTransactions = [
    { id: "t3", amount: 50, type: "transfer", date: "2026-08-03", fromAccountId: "account-bank", toAccountId: "account-bank" },
  ];
  const result = migrateState({
    deviceId: "device-1",
    ledgerTransactions: rawTransactions as unknown as LedgerTransaction[],
  });
  assert.equal(result.ledgerTransactions.length, 0);
});

test("migrateState: a valid transfer between two distinct default accounts is kept", () => {
  const rawTransactions = [
    { id: "t4", amount: 50, type: "transfer", date: "2026-08-03", fromAccountId: "account-bank", toAccountId: "account-wallet" },
  ];
  const result = migrateState({
    deviceId: "device-1",
    ledgerTransactions: rawTransactions as unknown as LedgerTransaction[],
  });
  assert.equal(result.ledgerTransactions.length, 1);
  assert.equal(result.ledgerTransactions[0].fromAccountId, "account-bank");
  assert.equal(result.ledgerTransactions[0].toAccountId, "account-wallet");
});

test("migrateState: ledger transactions with missing id, bad amount, bad type, or bad date are all filtered out", () => {
  const rawTransactions = [
    { amount: 10, type: "expense", categoryId: "expense-food", date: "2026-08-01" }, // no id
    { id: "bad-amount", amount: 0, type: "expense", categoryId: "expense-food", date: "2026-08-01" },
    { id: "bad-type", amount: 10, type: "yeet", categoryId: "expense-food", date: "2026-08-01" },
    { id: "bad-date", amount: 10, type: "expense", categoryId: "expense-food", date: "not-a-date" },
  ];
  const result = migrateState({
    deviceId: "device-1",
    ledgerTransactions: rawTransactions as unknown as LedgerTransaction[],
  });
  assert.equal(result.ledgerTransactions.length, 0);
});

test("migrateState: customTickers are uppercased, deduped, invalid symbols dropped, and VOO/QQQM excluded", () => {
  const result = migrateState({
    deviceId: "device-1",
    customTickers: ["voo", "aapl", "AAPL", "bad ticker!", "qqqm", "tsla"],
  } as Partial<WealthState>);
  assert.deepEqual(result.customTickers, ["AAPL", "TSLA"]);
});

test("migrateState: hiddenRuleIds keeps only known rule ids and dedups them", () => {
  const result = migrateState({
    deviceId: "device-1",
    hiddenRuleIds: ["dca-mandate", "not-a-real-id", "dca-mandate", "emergency-fund"],
  } as unknown as Partial<WealthState>);
  assert.deepEqual(result.hiddenRuleIds, ["dca-mandate", "emergency-fund"]);
});
