import assert from "node:assert/strict";
import { test } from "./testHarness";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { cloneDefaultState } from "../src/state";
import type { LedgerTransaction } from "../src/models";

function withTransactions(transactions: LedgerTransaction[]) {
  const state = cloneDefaultState();
  state.ledgerTransactions = transactions;
  return state;
}

test("detectMoneyLeakFindings: flags an expense whose note matches a fee/penalty/interest pattern", () => {
  const state = withTransactions([
    { id: "fee-1", amount: 15, type: "expense", categoryId: "expense-bills", date: "2026-08-10", note: "ATM withdrawal fee" },
  ]);
  const summary = detectMoneyLeakFindings(state);
  const feeLeak = summary.leaks.find((leak) => leak.category === "fee");
  assert.ok(feeLeak, "expected a 'fee' leak to be detected");
  assert.equal(feeLeak!.monthlyImpact, 15);
  assert.deepEqual(feeLeak!.transactionIds, ["fee-1"]);
});

test("detectMoneyLeakFindings: an ordinary expense note does not trigger the fee detector", () => {
  const state = withTransactions([
    { id: "normal-1", amount: 20, type: "expense", categoryId: "expense-food", date: "2026-08-10", note: "Lunch with friends" },
  ]);
  const summary = detectMoneyLeakFindings(state);
  assert.equal(summary.leaks.some((leak) => leak.category === "fee"), false);
});

test("detectMoneyLeakFindings: fee impact is averaged across the distinct months it occurred in", () => {
  const state = withTransactions([
    { id: "fee-1", amount: 30, type: "expense", categoryId: "expense-bills", date: "2026-06-10", note: "Late payment charge" },
    { id: "fee-2", amount: 30, type: "expense", categoryId: "expense-bills", date: "2026-07-10", note: "Late payment charge" },
  ]);
  const summary = detectMoneyLeakFindings(state);
  const feeLeak = summary.leaks.find((leak) => leak.category === "fee");
  assert.ok(feeLeak);
  // 60 total across 2 distinct months -> 30/month, not 60/month.
  assert.equal(feeLeak!.monthlyImpact, 30);
});
