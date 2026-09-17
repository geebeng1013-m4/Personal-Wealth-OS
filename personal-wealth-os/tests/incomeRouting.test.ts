import assert from "node:assert/strict";
import { test } from "./testHarness";
import { previewIncomeRouting } from "../src/incomeRouting";
import { migrateState } from "../src/state";
import type { LedgerTransaction, WealthState } from "../src/models";

/**
 * The preview answers "where does this payment go" while it is being typed.
 * The answer depends on the month so far, so the cases that matter are the
 * ones where the same MYR 400 goes somewhere different depending on what came
 * before it — and the edit case, where the payment must not count itself.
 */

function income(id: string, amount: number, date: string, sponsored = false): LedgerTransaction {
  return {
    id, amount, type: "income", categoryId: "income-other", accountId: "bank",
    date: new Date(`${date}T12:00:00`).toISOString(),
    ...(sponsored ? { fundingSource: "sponsored" as const } : {}),
  };
}

function freelancer(transactions: LedgerTransaction[] = [], withOverflow = true): WealthState {
  return migrateState({
    deviceId: "income-routing",
    ledgerAccounts: [{ id: "bank", name: "Bank", type: "bank", openingBalance: 0 }],
    ledgerTransactions: transactions,
    allocation: {
      incomeType: "variable",
      steps: [
        { id: "survival", name: "Survival", kind: "fill", value: 1500 },
        { id: "growth", name: "Growth", kind: "pct", value: 60 },
        { id: "freedom", name: "Freedom", kind: "pct", value: 40 },
      ],
      ...(withOverflow ? { overflowStepId: "growth" } : {}),
    },
  });
}

const split = (state: WealthState, amount: number, date = "2026-09-20") =>
  previewIncomeRouting(state, { amount, date, sponsored: false });

test("income routing: the month's first payment fills living costs first", () => {
  const preview = split(freelancer(), 1000)!;
  assert.equal(preview.receivedBefore, 0);
  assert.deepEqual(preview.parts.map((part) => [part.name, part.amount]), [["Survival", 1000]]);
  assert.equal(preview.stillShort, 500);
  assert.equal(preview.essentialName, "Survival");
});

test("income routing: a later payment continues from where the month stopped", () => {
  // Three weekly payments already covered 1,200 of Survival. The fourth MYR 400
  // finishes it with 300 and the remaining 100 is split — it is not split as
  // though it were the month's only money.
  const state = freelancer([
    income("w1", 400, "2026-09-02"),
    income("w2", 400, "2026-09-09"),
    income("w3", 400, "2026-09-16"),
  ]);
  const preview = split(state, 400)!;
  assert.equal(preview.receivedBefore, 1200);
  assert.deepEqual(preview.parts.map((part) => [part.name, part.amount]), [
    ["Survival", 300],
    ["Growth", 60],
    ["Freedom", 40],
  ]);
  assert.equal(preview.stillShort, 0);
});

test("income routing: once living costs are covered, a payment skips that layer", () => {
  const state = freelancer([income("big", 2000, "2026-09-01")]);
  const preview = split(state, 1000)!;
  assert.equal(preview.parts.some((part) => part.stepId === "survival"), false);
  const total = preview.parts.reduce((sum, part) => sum + part.amount, 0);
  assert.equal(total, 1000, "every ringgit of the payment is accounted for");
});

test("income routing: editing a payment does not count it against itself", () => {
  const state = freelancer([income("salary", 1500, "2026-09-05")]);
  // Correcting the 1,500 to 1,600: the month so far is empty, not 1,500.
  const preview = previewIncomeRouting(state, {
    amount: 1600, date: "2026-09-05", sponsored: false, excludeTransactionId: "salary",
  })!;
  assert.equal(preview.receivedBefore, 0);
  assert.equal(preview.parts[0].name, "Survival");
  assert.equal(preview.parts[0].amount, 1500);
});

test("income routing: only the payment's own month counts as the month so far", () => {
  const state = freelancer([income("august", 3000, "2026-08-28")]);
  const preview = split(state, 1000, "2026-09-01")!;
  assert.equal(preview.receivedBefore, 0, "August's income did not cover September's rent");
  assert.equal(preview.parts[0].name, "Survival");
});

test("income routing: sponsored money is kept out of the plan", () => {
  const state = freelancer([income("parent", 500, "2026-09-03", true)]);
  const preview = previewIncomeRouting(state, { amount: 300, date: "2026-09-10", sponsored: true })!;
  assert.equal(preview.sponsored, true);
  assert.deepEqual(preview.parts, []);
  // And earlier sponsored money never counted toward the month so far either.
  assert.equal(split(state, 100)!.receivedBefore, 0);
});

test("income routing: money no layer takes is reported, not hidden", () => {
  // A stored plan always has an overflow layer — migration repairs a missing
  // one — so the gap is built directly on the state, past that repair, to pin
  // what the preview does if a plan ever reaches it without one.
  const gappy: WealthState = {
    ...migrateState({ deviceId: "gappy" }),
    allocation: {
      incomeType: "fixed",
      steps: [{ id: "survival", name: "Survival", kind: "fill", value: 1000 }],
    },
  };
  const preview = previewIncomeRouting(gappy, { amount: 1500, date: "2026-09-10", sponsored: false })!;
  assert.deepEqual(preview.parts.map((part) => part.amount), [1000]);
  assert.equal(preview.unclaimed, 500);
});

test("income routing: nothing to say without an amount, a date or a plan", () => {
  const state = freelancer();
  assert.equal(split(state, 0), null);
  assert.equal(split(state, Number.NaN), null);
  assert.equal(previewIncomeRouting(state, { amount: 100, date: "", sponsored: false }), null);
  const planless = migrateState({ deviceId: "planless", buckets: [], allocation: { incomeType: "fixed", steps: [] } });
  assert.equal(previewIncomeRouting(planless, { amount: 100, date: "2026-09-10", sponsored: false }), null);
});
