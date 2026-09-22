import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { Liability } from "../src/models";
import { debtComesFirst, debtTier, priorityDebts, starterBufferTarget } from "../src/debtPriority";

const debt = (name: string, balance: number, annualRate: number): Liability => ({ id: name, name, balance, annualRate, minimumPayment: 0 });

test("debt tier: 8% and up is high, 4–8% medium, under 4% low", () => {
  assert.equal(debtTier(0.18), "high");
  assert.equal(debtTier(0.08), "high", "exactly 8% is high");
  assert.equal(debtTier(0.0799), "medium");
  assert.equal(debtTier(0.04), "medium");
  assert.equal(debtTier(0.01), "low");
});

test("debt tier: a missing, zero or broken rate is unknown", () => {
  for (const rate of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(debtTier(rate), "unknown", String(rate));
});

test("debt comes first: high always; unknown only when the user put debt first", () => {
  assert.equal(debtComesFirst(0.18, false), true);
  assert.equal(debtComesFirst(0.05, true), false);
  assert.equal(debtComesFirst(0.01, true), false);
  assert.equal(debtComesFirst(0, true), true);
  assert.equal(debtComesFirst(0, false), false);
});

test("priority debts: highest rate first, unknown last, paid-off and cheap ones left out", () => {
  const list = [debt("PTPTN", 12000, 0.01), debt("Loan", 8000, 0.11), debt("Card", 3000, 0.18), debt("Old card", 0, 0.18), debt("Family", 500, 0)];
  assert.deepEqual(priorityDebts(list, false).map((item) => item.name), ["Card", "Loan"]);
  assert.deepEqual(priorityDebts(list, true).map((item) => item.name), ["Card", "Loan", "Family"]);
  // Same rate: the larger balance first.
  assert.deepEqual(priorityDebts([debt("A", 100, 0.18), debt("B", 900, 0.18)], false).map((item) => item.name), ["B", "A"]);
});

test("starter buffer: a month of spending, else RM1,000", () => {
  assert.equal(starterBufferTarget(2400), 2400);
  for (const spending of [null, undefined, 0, -5, Number.NaN]) assert.equal(starterBufferTarget(spending), 1000, String(spending));
});
