import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  MAX_DIVIDENDS,
  dividendId,
  netDividend,
  normalizeDividends,
  validateDividend,
  withholdingRate,
} from "../src/dividends";
import { CURRENT_VERSION, cloneDefaultState, migrateState } from "../src/state";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { demoState } from "../src/demoData";
import { priceMapFrom } from "../src/marketPrices";

/**
 * D-1: the dividend record. The figures are the user's own last quarter:
 * VOO 0.4599 units at USD 1.962 on the 2026-06-26 ex-date, 30% withheld.
 */

const VOO_JUNE = {
  id: "div-VOO-2026-06-26", ticker: "VOO", exDate: "2026-06-26", payDate: "2026-06-30", currency: "USD",
  units: 0.4599, perShare: 1.962, gross: 0.9023, withholdingTax: 0.2707, status: "confirmed",
};

test("dividends: v24 is the schema that carries them", () => {
  assert.ok(CURRENT_VERSION >= 24);
});

test("dividends: a statement payout is kept as written, net derived", () => {
  const record = validateDividend(VOO_JUNE)!;
  assert.deepEqual(record, VOO_JUNE);
  assert.ok(Math.abs(netDividend(record) - 0.6316) < 1e-9);
  assert.ok(Math.abs(withholdingRate(record)! - 0.3) < 0.001);
});

test("dividends: ids are stable per ticker and ex-date", () => {
  assert.equal(dividendId("voo", "2026-06-26"), "div-VOO-2026-06-26");
});

test("dividends: missing optional fields take safe defaults", () => {
  const record = validateDividend({ id: "d1", ticker: " qqqm ", exDate: "2026-06-22", gross: 0.165 })!;
  assert.equal(record.ticker, "QQQM");
  assert.equal(record.payDate, "2026-06-22", "pay date defaults to the ex-date");
  assert.equal(record.currency, "USD");
  assert.equal(record.withholdingTax, 0);
  assert.equal(record.status, "confirmed");
  assert.equal("units" in record, false);
});

test("dividends: a received payout needs money, and tax cannot exceed it", () => {
  assert.equal(validateDividend({ ...VOO_JUNE, gross: 0 }), null);
  assert.equal(validateDividend({ ...VOO_JUNE, gross: -1 }), null);
  assert.equal(validateDividend({ ...VOO_JUNE, withholdingTax: 1 }), null);
});

test("dividends: malformed records are dropped, not repaired", () => {
  assert.equal(validateDividend(null), null);
  assert.equal(validateDividend([]), null);
  assert.equal(validateDividend({ ...VOO_JUNE, id: "" }), null);
  assert.equal(validateDividend({ ...VOO_JUNE, exDate: "26/06/2026" }), null);
  assert.equal(validateDividend({ ...VOO_JUNE, ticker: "VO O" }), null);
});

test("dividends: a dismissed suggestion is kept with no money", () => {
  const record = validateDividend({ id: "d2", ticker: "VOO", exDate: "2026-03-27", status: "dismissed" })!;
  assert.equal(record.status, "dismissed");
  assert.equal(record.gross, 0);
});

test("dividends: one record per ticker and ex-date, the later entry wins, sorted by date", () => {
  const list = normalizeDividends([
    { ...VOO_JUNE, id: "a", gross: 0.9 },
    { id: "q", ticker: "QQQM", exDate: "2026-03-23", gross: 0.15 },
    { ...VOO_JUNE, id: "b", gross: 0.9023 },
    { id: "bad", ticker: "VOO", exDate: "nope", gross: 1 },
  ]);
  assert.deepEqual(list.map((record) => record.id), ["q", "b"]);
});

test("dividends: the list is capped", () => {
  const many = Array.from({ length: MAX_DIVIDENDS + 5 }, (_, index) => ({
    id: `d${index}`, ticker: `T${index}`, exDate: "2026-01-02", gross: 1,
  }));
  assert.equal(normalizeDividends(many).length, MAX_DIVIDENDS);
});

// --- State --------------------------------------------------------------------

test("dividends: data from before v24 starts with none", () => {
  const legacy = { ...structuredClone(cloneDefaultState()), version: 23 } as Record<string, unknown>;
  delete legacy.dividends;
  const migrated = migrateState(legacy);
  assert.deepEqual(migrated.dividends, []);
  assert.equal(migrated.version, CURRENT_VERSION);
});

test("dividends: stored records survive migration, normalized and idempotent", () => {
  const state = { ...cloneDefaultState(), dividends: [VOO_JUNE, { id: "junk" }] } as unknown as Parameters<typeof migrateState>[0];
  const once = migrateState(state);
  assert.equal(once.dividends.length, 1);
  assert.deepEqual(migrateState(structuredClone(once)).dividends, once.dividends);
});

test("dividends: recording them moves no portfolio figure yet", () => {
  const market = { prices: priceMapFrom([{ ticker: "VOO", priceUsd: 690 }, { ticker: "QQQM", priceUsd: 295 }, { ticker: "VXUS", priceUsd: 72 }]), usdToMyr: 4.1 };
  const now = new Date("2026-09-18T00:00:00Z");
  const without = migrateState(structuredClone(demoState));
  const withDividends = migrateState({ ...structuredClone(demoState), dividends: [VOO_JUNE] });
  assert.deepEqual(getPortfolioSnapshot(withDividends, now, market), getPortfolioSnapshot(without, now, market));
});
