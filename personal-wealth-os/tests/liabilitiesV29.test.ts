import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { Liability, WealthState } from "../src/models";
import { CURRENT_VERSION, emptyState, migrateState } from "../src/state";

const at = (version: number, liabilities: unknown[]) => migrateState({ ...emptyState(), version, liabilities } as unknown as WealthState).liabilities;
const debt = (annualRate: number, extra: Record<string, unknown> = {}) => ({ id: "l", name: "Debt", balance: 1000, annualRate, minimumPayment: 50, ...extra });

test("liabilities v29: the schema is v29", () => {
  assert.equal(CURRENT_VERSION, 29);
});

test("liabilities v29: a typed percent from the old forms becomes a fraction", () => {
  assert.equal(at(28, [debt(18)])[0]?.annualRate, 0.18);
  assert.equal(at(28, [debt(1)])[0]?.annualRate, 0.01, "PTPTN typed as 1 means 1%");
  assert.equal(at(28, [debt(4.25)])[0]?.annualRate, 0.0425);
});

test("liabilities v29: a rate already a fraction, or not given, is left alone", () => {
  assert.equal(at(28, [debt(0.18)])[0]?.annualRate, 0.18);
  assert.equal(at(28, [debt(0)])[0]?.annualRate, 0);
  // Written by this version: never divided again.
  assert.equal(at(29, [debt(0.18)])[0]?.annualRate, 0.18);
});

test("liabilities v29: the new fields survive a reload; a bad one drops alone", () => {
  const good = debt(0.05, { kind: "car-loan", endMonth: "2033-09", paidInFull: false });
  assert.deepEqual(at(29, [good])[0], good);
  const bad = at(29, [debt(0.05, { kind: "mortgage", endMonth: "Sept 2033", paidInFull: "no" })])[0] as Liability;
  assert.deepEqual(bad, debt(0.05), "the debt itself is kept");
});

test("liabilities v29: an older build's save (stamped v28) with a percent is caught on the next load", () => {
  // v29 data opened and saved by an older build keeps its fractions, and a
  // card that build added is still a percent: only that one changes.
  const mixed = at(28, [debt(0.18, { id: "a" }), debt(17, { id: "b" })]);
  assert.deepEqual(mixed.map((item) => item.annualRate), [0.18, 0.17]);
});
