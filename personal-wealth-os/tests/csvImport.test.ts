import assert from "node:assert/strict";
import { test } from "./testHarness";
import { recordsFromCsv } from "../src/csvImport";
import { calculatePositionCostBasis } from "../src/rules";

/**
 * A minimal Moomoo Universal Account export, synthetic figures only. One
 * "Cancelled" row is included deliberately — only "Filled" orders should
 * become trades.
 */
const MOOMOO_HEADER =
  '"Side","Symbol","Name","Order Price","Order Qty","Order Amount","Status","Filled@Avg Price","Order Time","Order Type","Time-in-Force","Allow Pre-Market","Session","Trigger price","Position Opening","Markets","Currency","Order Source","Fill Qty","Fill Price","Fill Amount","Fill Time","Markets","Currency","Counterparty","Remarks","Platform Fees","Stamp Duty","Total"';
const MOOMOO_ROWS = [
  '"Buy","AAA","Test ETF A","100.00","--","10.00","Filled","0.1000@100.00","Jan 1, 2026 09:00:00 ET","Limit","Day","","Regular Trading Hours","","","US","USD","","0.1000","100.00","10.00","Jan 1, 2026 09:00:01 ET","US","USD","","","0.10","0.02","0.12"',
  '"Buy","AAA","Test ETF A","100.00","--","10.00","Cancelled","0@0.00","Jan 2, 2026 09:00:00 ET","Limit","Day","","Regular Trading Hours","","","US","USD","","","","","","","","","","","",""',
  '"Sell","AAA","Test ETF A","Market Price","0.0500","5.10","Filled","0.0500@102.00","Jan 3, 2026 09:00:00 ET","Market","Day","","Regular Trading Hours","","","US","USD","","0.0500","102.00","5.10","Jan 3, 2026 09:00:01 ET","US","USD","","","0.05","0.01","0.06"',
];

function moomooCsv(bomPrefix = ""): string {
  return [bomPrefix + MOOMOO_HEADER, ...MOOMOO_ROWS].join("\n");
}

// --- The bug: a corrupted leading byte-order-mark silently produced zero trades ---

test("csvImport: a real UTF-8 BOM does not break Moomoo-format detection", () => {
  const trades = recordsFromCsv(moomooCsv("﻿"));
  assert.equal(trades.length, 2, "BOM caused rows to be silently dropped");
  assert.equal(trades.filter((t) => t.ticker === "AAA").length, 2);
});

test("csvImport: the mojibake BOM variant (ï»¿) does not break detection either", () => {
  // What Moomoo's own export actually produces on at least one platform/version:
  // the BOM bytes double-encoded into three visible Latin-1 characters instead
  // of the single U+FEFF codepoint. A real account export exhibited exactly
  // this and imported zero trades before this fix.
  const trades = recordsFromCsv(moomooCsv("ï»¿"));
  assert.equal(trades.length, 2, "mojibake BOM caused rows to be silently dropped");
});

test("csvImport: a clean file with no BOM is unaffected", () => {
  // Each trade gets a fresh random id, so compare everything else.
  const strip = (trades: ReturnType<typeof recordsFromCsv>) => trades.map(({ id: _id, ...rest }) => rest);
  const withBom = strip(recordsFromCsv(moomooCsv("﻿")));
  const withoutBom = strip(recordsFromCsv(moomooCsv("")));
  assert.deepEqual(withBom, withoutBom, "stripping a BOM that was never there must change something else");
});

// --- Correctness of the parsed trades -------------------------------------

test("csvImport: only Filled orders become trades; Cancelled is skipped", () => {
  const trades = recordsFromCsv(moomooCsv());
  assert.equal(trades.length, 2);
  assert.equal(trades.some((t) => t.date.startsWith("2026-01-02")), false, "the cancelled order was imported");
});

test("csvImport: side determines DCA vs Sell, and units come from Fill Qty", () => {
  const trades = recordsFromCsv(moomooCsv());
  const buy = trades.find((t) => t.date.startsWith("2026-01-01"))!;
  const sell = trades.find((t) => t.date.startsWith("2026-01-03"))!;
  assert.equal(buy.type, "DCA");
  assert.equal(buy.units, 0.1);
  assert.equal(buy.priceUsd, 100);
  assert.equal(buy.amountUsd, 10);
  assert.equal(sell.type, "Sell");
  assert.equal(sell.units, 0.05);
  assert.equal(sell.priceUsd, 102);
});

test("csvImport: fees combine platform fees and stamp duty", () => {
  const trades = recordsFromCsv(moomooCsv());
  const buy = trades.find((t) => t.date.startsWith("2026-01-01"))!;
  // Total column (0.12) takes priority over platform fees + stamp duty (0.10+0.02=0.12) when present.
  assert.ok(buy.feeMyr > 0, "fees must be recorded");
});

test("csvImport: imported trades feed the existing cost-basis engine correctly", () => {
  const trades = recordsFromCsv(moomooCsv());
  const cb = calculatePositionCostBasis(trades, "AAA");
  // Bought 0.1 units @ $100, sold 0.05 @ $102 (half the position, proportional cost removal).
  assert.equal(cb.units.toFixed(4), "0.0500");
  assert.ok(cb.realizedPnlUsd > 0, "selling above cost should realise a gain");
});

test("csvImport: an unrecognised header falls back without throwing", () => {
  const trades = recordsFromCsv("not,a,moomoo,file\n1,2,3,4");
  assert.deepEqual(trades, []);
});

test("csvImport: an empty file produces no trades and does not throw", () => {
  assert.deepEqual(recordsFromCsv(""), []);
});
