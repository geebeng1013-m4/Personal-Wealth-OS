import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { Liability } from "../src/models";
import {
  addMonths, buildLiability, cardMinimumPayment, DEBT_KIND_IDS, DEBT_KINDS, debtComesFirst, debtTier, flatToEffectiveRate, isDebtKind, isMonth,
  monthlyInstalment, monthlyInterest, monthsUntil, priorityDebts, starterBufferTarget, type LiabilityInput,
} from "../src/debtPriority";

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

// --- L-2: loan arithmetic and the debt form --------------------------------------

const close = (actual: number, expected: number, within = 0.0005) => assert.ok(Math.abs(actual - expected) <= within, `${actual} ≈ ${expected}`);

test("flat rate: converted over the real term, longer terms a little lower", () => {
  close(flatToEffectiveRate(0.06, 36), 0.1108);
  close(flatToEffectiveRate(0.06, 60), 0.1085);
  close(flatToEffectiveRate(0.06, 108), 0.1033);
  close(flatToEffectiveRate(0.03, 84), 0.0557);
  // No term given: 5 years. No rate: nothing to convert.
  assert.equal(flatToEffectiveRate(0.06, Number.NaN), flatToEffectiveRate(0.06, 60));
  assert.equal(flatToEffectiveRate(0, 60), 0);
});

test("instalment: the fixed monthly amount; at 0% the balance split evenly", () => {
  close(monthlyInstalment(30000, 0.0557, 84), 432.5, 1);
  close(monthlyInstalment(12000, 0.01, 120), 105.12, 0.01);
  assert.equal(monthlyInstalment(1200, 0, 12), 100);
  assert.equal(monthlyInstalment(1200, 0.05, 0), 1200, "no months left: all of it now");
  assert.equal(monthlyInstalment(0, 0.05, 12), 0);
});

test("interest and card minimum: 5% or RM50, never above the balance", () => {
  assert.equal(monthlyInterest(3000, 0.18), 45);
  assert.equal(monthlyInterest(3000, 0), 0);
  assert.equal(cardMinimumPayment(3000), 150);
  assert.equal(cardMinimumPayment(600), 50);
  assert.equal(cardMinimumPayment(30), 30);
});

test("months: adding across years, counting down, and a month already past", () => {
  assert.equal(addMonths("2026-09-22", 57), "2031-06");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(monthsUntil("2031-06", "2026-09-22"), 57);
  assert.equal(monthsUntil("2026-05", "2026-09-22"), 0);
  assert.equal(monthsUntil("not a month", "2026-09-22"), 0);
  assert.equal(isMonth("2026-13"), false);
});

test("kinds: every kind has a label and phrase; loans with a term have a typical time left", () => {
  for (const id of DEBT_KIND_IDS) {
    assert.ok(DEBT_KINDS[id].label && DEBT_KINDS[id].phrase, id);
    assert.ok(isDebtKind(id));
  }
  assert.equal(isDebtKind("mortgage"), false);
  assert.equal(DEBT_KINDS["credit-card"].hasTerm, false);
  assert.equal(DEBT_KINDS["car-loan"].quotedFlat, true);
});

const input = (extra: Partial<LiabilityInput> = {}): LiabilityInput => ({
  name: "Card", balance: 3000, ratePercent: 18, rateFlat: false, minimumPayment: 150, kind: "credit-card", endMonth: "", paidInFull: false, ...extra,
});

test("form: the typed percent is stored as a fraction", () => {
  const result = buildLiability("l1", input(), "2026-09-22");
  assert.deepEqual(result, { ok: true, liability: { id: "l1", name: "Card", balance: 3000, annualRate: 0.18, minimumPayment: 150, kind: "credit-card", paidInFull: false } });
  const ptptn = buildLiability("l2", input({ name: "PTPTN", ratePercent: 1, kind: "ptptn", endMonth: "2036-09" }), "2026-09-22");
  assert.ok(ptptn.ok && ptptn.liability.annualRate === 0.01 && ptptn.liability.endMonth === "2036-09" && ptptn.liability.paidInFull === undefined);
});

test("form: a flat rate is converted over the months to the last payment, else 5 years", () => {
  const car = buildLiability("c", input({ name: "Car", ratePercent: 3, rateFlat: true, kind: "car-loan", endMonth: "2033-09" }), "2026-09-22");
  assert.ok(car.ok);
  if (car.ok) close(car.liability.annualRate, 0.0557);
  const loan = buildLiability("p", input({ name: "Loan", ratePercent: 6, rateFlat: true, kind: "personal-loan" }), "2026-09-22");
  if (loan.ok) close(loan.liability.annualRate, 0.1085); else assert.fail(loan.error);
});

test("form: blank rate is 0 (not given); bad input explains itself", () => {
  const blank = buildLiability("b", input({ ratePercent: Number.NaN, kind: null }), "2026-09-22");
  assert.ok(blank.ok && blank.liability.annualRate === 0 && blank.liability.kind === undefined);
  const error = (extra: Partial<LiabilityInput>) => {
    const result = buildLiability("x", input(extra), "2026-09-22");
    return result.ok ? "" : result.error;
  };
  assert.match(error({ name: "  " }), /name/);
  assert.match(error({ balance: Number.NaN }), /owed/);
  assert.match(error({ balance: -1 }), /owed/);
  assert.match(error({ ratePercent: 100 }), /percent/);
  assert.match(error({ ratePercent: -2 }), /percent/);
  assert.match(error({ minimumPayment: -1 }), /negative/);
  assert.match(error({ endMonth: "2026-09" }), /after this month/);
  assert.match(error({ endMonth: "Sept" }), /month/);
});
