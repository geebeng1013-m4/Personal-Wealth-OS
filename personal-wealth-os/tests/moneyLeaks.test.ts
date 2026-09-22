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

// --- Goal drift reads the goal's canonical amount ----------------------------
// A linked goal's progress is its account's balance; the typed goal.current is
// ignored everywhere else, so it must not drive this finding either.

function laptopGoalState(openingBalance: number, typedCurrent: number) {
  const state = cloneDefaultState();
  state.ledgerTransactions = [];
  state.ledgerAccounts = [{ id: "acc-wallet", name: "Wallet", type: "wallet", openingBalance }];
  state.goals = [{ id: "laptop", name: "Laptop", label: "Gaming laptop", current: typedCurrent, target: 4000, monthlyContribution: 0, note: "", accountId: "acc-wallet" }];
  return state;
}

test("detectMoneyLeakFindings: a linked goal's shortfall uses the account balance, not the typed current", () => {
  const leak = detectMoneyLeakFindings(laptopGoalState(28, 5)).leaks.find((item) => item.id === "goal-laptop");
  assert.ok(leak, "an unfunded goal with no monthly amount is flagged");
  assert.equal(leak!.monthlyImpact, (4000 - 28) / 12);
  assert.equal(leak!.evidence.find((item) => item.label === "Amount remaining")?.value, "MYR 3972.00");
  assert.equal(leak!.title, "Gaming laptop has no active contribution", "titled by the goal's Name");
});

test("detectMoneyLeakFindings: a linked goal its account already funds is not flagged", () => {
  const summary = detectMoneyLeakFindings(laptopGoalState(4200, 0));
  assert.equal(summary.leaks.some((item) => item.id === "goal-laptop"), false);
});
