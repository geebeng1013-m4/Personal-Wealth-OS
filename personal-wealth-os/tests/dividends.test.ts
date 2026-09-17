import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  MAX_DIVIDENDS,
  dividendIncome,
  dividendRateToMyr,
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
import type { CurrencyExchange, Dividend } from "../src/models";

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

// --- D-2: what they add up to -----------------------------------------------------

const close = (actual: number | null | undefined, expected: number, label = "") =>
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-6, `${label} expected ${expected}, got ${actual}`);

const confirmed = (overrides: Partial<Dividend>): Dividend => ({ ...(validateDividend(VOO_JUNE) as Dividend), ...overrides });
const USD_FX: CurrencyExchange[] = [
  { id: "x1", date: "2026-06-01", direction: "myr-to-usd", myrAmount: 410, usdAmount: 100 },
  { id: "x2", date: "2026-07-05", direction: "myr-to-usd", myrAmount: 408, usdAmount: 100 },
];
const NOW = new Date("2026-09-18T00:00:00Z");

test("income: a payout is worth its rate on the record, before any conversion", () => {
  close(dividendRateToMyr(confirmed({ rateToMyr: 4.25 }), USD_FX), 4.25);
});

test("income: without one, the nearest conversion to the pay date is used", () => {
  // Paid 2026-06-30: the 2026-07-05 conversion (4.08) is closer than 2026-06-01 (4.10).
  close(dividendRateToMyr(confirmed({}), USD_FX), 4.08);
});

test("income: a ringgit payout needs no rate", () => {
  close(dividendRateToMyr(confirmed({ currency: "MYR", ticker: "1155.KL" }), []), 1);
});

test("income: with no rate anywhere the payout is counted but not converted", () => {
  const income = dividendIncome([confirmed({})], [], NOW);
  assert.equal(income.count, 1);
  assert.equal(income.withoutRate, 1);
  assert.equal(income.netMyr, 0);
  close(income.byTicker.get("VOO")!.netLocal, 0.6316);
});

test("income: net, gross and tax add up in ringgit; dismissed suggestions are not income", () => {
  const income = dividendIncome([
    confirmed({ rateToMyr: 4.1 }),
    confirmed({ id: "q", ticker: "QQQM", exDate: "2026-06-22", payDate: "2026-06-25", units: 0.4685, perShare: 0.352, gross: 0.1649, withholdingTax: 0.0495, rateToMyr: 4.1 }),
    { id: "old", ticker: "VOO", exDate: "2026-03-27", payDate: "2026-03-31", currency: "USD", gross: 0, withholdingTax: 0, status: "dismissed" },
  ], [], NOW);
  assert.equal(income.count, 2);
  close(income.grossMyr, (0.9023 + 0.1649) * 4.1);
  close(income.withheldMyr, (0.2707 + 0.0495) * 4.1);
  close(income.netMyr, (0.6316 + 0.1154) * 4.1);
});

test("income: the twelve-month figures count pay dates in the year up to now", () => {
  const income = dividendIncome([
    confirmed({ rateToMyr: 4 }),
    confirmed({ id: "a", exDate: "2025-06-27", payDate: "2025-07-01", rateToMyr: 4 }),
    confirmed({ id: "b", exDate: "2025-09-18", payDate: "2025-09-18", rateToMyr: 4 }),
  ], [], NOW);
  close(income.netMyr, 0.6316 * 4 * 3);
  close(income.netMyrLast12Months, 0.6316 * 4, "a year ago to the day is outside");
  close(income.withheldMyrLast12Months, 0.2707 * 4);
});

test("snapshot: dividends are added beside the unrealised figure, over the same holdings", () => {
  const market = { prices: priceMapFrom([{ ticker: "VOO", priceUsd: 690 }, { ticker: "QQQM", priceUsd: 295 }, { ticker: "VXUS", priceUsd: 72 }]), usdToMyr: 4.1 };
  const state = migrateState({ ...structuredClone(demoState), dividends: [{ ...VOO_JUNE, rateToMyr: 4.1 }] });
  const snapshot = getPortfolioSnapshot(state, NOW, market);
  const net = 0.6316 * 4.1;
  close(snapshot.dividendsNetMyr, net);
  close(snapshot.dividendsWithheldMyr, 0.2707 * 4.1);
  assert.equal(snapshot.dividendCount, 1);
  close(snapshot.holdings.find((holding) => holding.ticker === "VOO")!.dividendsNetMyr, net);
  close(snapshot.unrealizedPnlMyrWithDividends, snapshot.unrealizedPnlMyr! + net);
  const pricedInvested = snapshot.holdings.filter((holding) => snapshot.pricedTickers.includes(holding.ticker))
    .reduce((sum, holding) => sum + holding.investedMyr, 0);
  close(snapshot.unrealizedPnlPercentMyrWithDividends, (snapshot.unrealizedPnlMyr! + net) / pricedInvested);
});

test("snapshot: without prices the with-dividends return is unknown, the income is not", () => {
  const state = migrateState({ ...structuredClone(demoState), dividends: [{ ...VOO_JUNE, rateToMyr: 4.1 }] });
  const snapshot = getPortfolioSnapshot(state, NOW, {});
  assert.equal(snapshot.unrealizedPnlMyrWithDividends, null);
  close(snapshot.dividendsNetMyr, 0.6316 * 4.1);
});

test("snapshot: dividends move no figure that existed before them", () => {
  const market = { prices: priceMapFrom([{ ticker: "VOO", priceUsd: 690 }, { ticker: "QQQM", priceUsd: 295 }, { ticker: "VXUS", priceUsd: 72 }]), usdToMyr: 4.1 };
  const strip = (snapshot: ReturnType<typeof getPortfolioSnapshot>) => {
    const copy = JSON.parse(JSON.stringify(snapshot));
    for (const key of Object.keys(copy)) if (/dividend/i.test(key)) delete copy[key];
    copy.holdings = copy.holdings.map((holding: Record<string, unknown>) => {
      for (const key of Object.keys(holding)) if (/dividend/i.test(key)) delete holding[key];
      return holding;
    });
    return copy;
  };
  const without = migrateState(structuredClone(demoState));
  const withDividends = migrateState({ ...structuredClone(demoState), dividends: [VOO_JUNE] });
  assert.deepEqual(strip(getPortfolioSnapshot(withDividends, NOW, market)), strip(getPortfolioSnapshot(without, NOW, market)));
  // And with none recorded, the with-dividends return is the unrealised one.
  const plain = getPortfolioSnapshot(without, NOW, market);
  assert.equal(plain.unrealizedPnlMyrWithDividends, plain.unrealizedPnlMyr);
});
