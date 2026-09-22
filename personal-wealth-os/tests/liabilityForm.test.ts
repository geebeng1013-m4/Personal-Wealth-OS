import assert from "node:assert/strict";
import { test } from "./testHarness";
import { debtSummary, readLiabilityForm } from "../src/components/liabilityForm";

const TODAY = "2026-09-22";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};
const read = (fields: Record<string, string>) => readLiabilityForm(form(fields), "l1", TODAY);
const ok = (fields: Record<string, string>) => {
  const result = read(fields);
  if (!result.ok) assert.fail(result.error);
  return result.liability;
};
const error = (fields: Record<string, string>) => {
  const result = read(fields);
  return result.ok ? "" : result.error;
};
const close = (actual: number, expected: number, within: number) => assert.ok(Math.abs(actual - expected) <= within, `${actual} ≈ ${expected}`);

test("debt form: the kind comes first", () => {
  assert.match(error({}), /kind of debt/);
  assert.match(error({ kind: "mortgage" }), /kind of debt/);
});

test("debt form: a card paid in part, at Bank Negara's 15% tier", () => {
  assert.deepEqual(ok({ kind: "credit-card", "credit-card:amount": "3000", "credit-card:paid": "part", "credit-card:rate": "15" }), {
    id: "l1", name: "Credit card", balance: 3000, annualRate: 0.15, minimumPayment: 150, kind: "credit-card", paidInFull: false,
  });
});

test("debt form: a card cleared every month needs no rate, and is marked paid in full", () => {
  const card = ok({ kind: "credit-card", "credit-card:amount": "3000", "credit-card:paid": "full" });
  assert.equal(card.paidInFull, true);
  assert.equal(card.annualRate, 0.18, "the typical rate is kept for reference");
  assert.match(error({ kind: "credit-card", "credit-card:amount": "3000" }), /how you pay/);
});

test("debt form: BNPL paid on time charges nothing", () => {
  assert.equal(ok({ kind: "bnpl", "bnpl:amount": "1000", "bnpl:paid": "full" }).paidInFull, true);
  assert.equal(ok({ kind: "bnpl", "bnpl:amount": "1000", "bnpl:paid": "part", "bnpl:rate": "18" }).paidInFull, false);
});

test("debt form: a flat car loan gets its real rate, last month and instalment", () => {
  const car = ok({ kind: "car-loan", "car-loan:amount": "30000", "car-loan:rate": "3", "car-loan:basis": "flat", "car-loan:term": "84" });
  close(car.annualRate, 0.0557, 0.0005);
  assert.equal(car.endMonth, "2033-09");
  close(car.minimumPayment, 432.5, 1.5);
  assert.equal(car.name, "Car loan");
  const effective = ok({ kind: "car-loan", "car-loan:amount": "30000", "car-loan:rate": "3", "car-loan:basis": "effective", "car-loan:term": "84" });
  assert.equal(effective.annualRate, 0.03);
});

test("debt form: 'type your own' reads what was typed", () => {
  const typed = ok({
    kind: "personal-loan", "personal-loan:amount": "custom", "personal-loan:amount:custom": "RM 12,500",
    "personal-loan:rate": "custom", "personal-loan:rate:custom": "13.5%", "personal-loan:basis": "effective",
    "personal-loan:term": "custom", "personal-loan:term:custom": "6",
  });
  assert.equal(typed.balance, 12500);
  assert.equal(typed.annualRate, 0.135);
  assert.equal(typed.endMonth, "2032-09", "6 years");
  assert.match(error({ kind: "personal-loan", "personal-loan:amount": "custom", "personal-loan:amount:custom": "", "personal-loan:rate": "6", "personal-loan:term": "60" }), /owed/);
  assert.match(error({ kind: "personal-loan", "personal-loan:amount": "5000", "personal-loan:rate": "custom", "personal-loan:rate:custom": "150", "personal-loan:term": "60" }), /percent/);
  assert.match(error({ kind: "personal-loan", "personal-loan:amount": "5000", "personal-loan:rate": "6", "personal-loan:term": "custom", "personal-loan:term:custom": "0" }), /years left/);
});

test("debt form: time left 'not sure' leaves no end month and no instalment", () => {
  const loan = ok({ kind: "ptptn", "ptptn:amount": "10000", "ptptn:rate": "1", "ptptn:term": "unknown" });
  assert.equal(loan.endMonth, undefined);
  assert.equal(loan.minimumPayment, 0);
  assert.equal(loan.annualRate, 0.01);
});

test("debt form: something else takes a name, and 'not sure' as its rate", () => {
  const other = ok({ kind: "other", "other:name": "Loan from family", "other:amount": "5000", "other:rate": "unknown", "other:term": "unknown" });
  assert.equal(other.name, "Loan from family");
  assert.equal(other.annualRate, 0);
  assert.equal(ok({ kind: "other", "other:name": " ", "other:amount": "5000", "other:rate": "unknown", "other:term": "unknown" }).name, "Debt");
});

test("debt form: the line under it says what the answers mean", () => {
  const card = ok({ kind: "credit-card", "credit-card:amount": "3000", "credit-card:paid": "part", "credit-card:rate": "18" });
  assert.equal(debtSummary(card, TODAY), "18% a year is about RM45 of interest a month, so WealthUp puts this first. About RM150 a month.");
  const car = ok({ kind: "car-loan", "car-loan:amount": "30000", "car-loan:rate": "3", "car-loan:basis": "flat", "car-loan:term": "84" });
  assert.match(debtSummary(car, TODAY), /^5\.6% a year: pay it on schedule, your safety buffer comes first\. About RM43\d a month, cleared around September 2033\.$/);
  assert.match(debtSummary(ok({ kind: "credit-card", "credit-card:amount": "3000", "credit-card:paid": "full" }), TODAY), /No interest/);
  assert.match(debtSummary(ok({ kind: "other", "other:amount": "5000", "other:rate": "unknown", "other:term": "unknown" }), TODAY), /Without a rate/);
});
