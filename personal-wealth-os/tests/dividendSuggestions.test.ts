import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  DEFAULT_WITHHOLDING,
  dismissedFromSuggestion,
  dividendFromSuggestion,
  rateOnOrBefore,
  suggestDividends,
  unitsHeldBefore,
  type DividendEvent,
  type RatePoint,
} from "../src/dividendSuggestions";
import { validateDividend } from "../src/dividends";
import { loadDividendSuggestions, parseDividendEvents, rangeSince } from "../src/market";
import { upstreamFor } from "../api/market";
import { cloneDefaultState } from "../src/state";
import type { Dividend, Trade } from "../src/models";

/**
 * D-3: suggestions from dividend history. Per-share figures and rates are what
 * Yahoo returned on 2026-09-18 (VOO 1.962 on 2026-06-26; USDMYR 4.0855 on the
 * last close before it).
 */

const close = (actual: number | undefined | null, expected: number, label = "") =>
  assert.ok(actual !== undefined && actual !== null && Math.abs(actual - expected) < 1e-9, `${label} expected ${expected}, got ${actual}`);

function buy(id: string, date: string, ticker: string, units: number, overrides: Partial<Trade> = {}): Trade {
  return { id, date, platform: "moomoo", ticker, type: "DCA", amountUsd: units * 600, priceUsd: 600, units, amountMyr: 0, feeMyr: 0, ...overrides };
}

const NOW = new Date("2026-09-18T00:00:00Z");
const VOO_EVENTS: DividendEvent[] = [
  { exDate: "2026-03-27", perShare: 1.872, currency: "USD" },
  { exDate: "2026-06-26", perShare: 1.962, currency: "USD" },
  { exDate: "2026-09-29", perShare: 2.0, currency: "USD" },
];
const USD_RATES: RatePoint[] = [
  { date: "2026-03-26", close: 4.21 },
  { date: "2026-06-25", close: 4.0855 },
  { date: "2026-06-29", close: 4.07 },
];

function suggest(trades: Trade[], dividends: Dividend[] = [], events = new Map([["VOO", VOO_EVENTS]])) {
  return suggestDividends({ trades, dividends, events, rateHistory: new Map([["USD", USD_RATES]]), now: NOW });
}

// --- Units held ----------------------------------------------------------------

test("suggest: shares count only when bought before the ex-date", () => {
  const trades = [buy("a", "2026-06-01", "VOO", 0.3), buy("b", "2026-06-26", "VOO", 0.1), buy("c", "2026-06-27T01:00:00Z", "VOO", 0.2)];
  close(unitsHeldBefore(trades, "VOO", "2026-06-26"), 0.3, "bought on the ex-date misses the payout");
});

test("suggest: a sale before the ex-date reduces what earns the payout", () => {
  const trades = [buy("a", "2026-05-01", "VOO", 0.5), buy("s", "2026-06-10", "VOO", 0.2, { type: "Sell" })];
  close(unitsHeldBefore(trades, "VOO", "2026-06-26"), 0.3);
});

// --- Suggestions -----------------------------------------------------------------

test("suggest: a US payout is units × per share, 30% withheld, at the rate before the pay date", () => {
  const [june, march] = suggest([buy("a", "2026-01-05", "VOO", 0.4599)]);
  assert.equal(june.exDate, "2026-06-26");
  close(june.units, 0.4599);
  close(june.gross, 0.4599 * 1.962);
  close(june.withholdingTax, 0.4599 * 1.962 * 0.3);
  assert.equal(june.taxRate, 0.3);
  close(june.rateToMyr, 4.0855, "the close before the date, never one after it");
  assert.equal(june.id, "div-VOO-2026-06-26");
  assert.equal(june.caution, undefined);
  assert.equal(march.exDate, "2026-03-27", "newest first");
});

test("suggest: nothing for a payout still ahead, or before anything was held", () => {
  const list = suggest([buy("a", "2026-04-01", "VOO", 1)]);
  assert.deepEqual(list.map((item) => item.exDate), ["2026-06-26"]);
});

test("suggest: a payout already confirmed or dismissed is not offered again", () => {
  const trades = [buy("a", "2026-01-05", "VOO", 1)];
  const [june, march] = suggest(trades);
  const recorded = [dividendFromSuggestion(june), dismissedFromSuggestion(march)];
  assert.deepEqual(suggest(trades, recorded), []);
});

test("suggest: a Malaysian payout needs no rate and has no tax withheld", () => {
  const trades = [buy("m", "2026-01-10", "1155.KL", 300, { market: "MY", currency: "MYR", amount: 2940, price: 9.8, amountUsd: 0, priceUsd: 0 })];
  const [payout] = suggest(trades, [], new Map([["1155.KL", [{ exDate: "2026-03-12", perShare: 0.33, currency: "MYR" }]]]));
  close(payout.gross, 99);
  assert.equal(payout.withholdingTax, 0);
  assert.equal(payout.rateToMyr, 1);
  assert.equal(payout.caution, undefined);
});

test("suggest: Hong Kong, Singapore and London suggestions ask for a look at the statement", () => {
  const hk = suggest(
    [buy("h", "2026-01-10", "2800.HK", 500, { market: "HK", currency: "HKD", amount: 12050, price: 24.1, amountUsd: 0, priceUsd: 0 })],
    [], new Map([["2800.HK", [{ exDate: "2026-04-29", perShare: 0.19, currency: "HKD" }]]]),
  )[0];
  assert.match(hk.caution ?? "", /REIT/);
  assert.equal(hk.rateToMyr, undefined, "no HKD history supplied, so no rate");

  const vwrl = suggest(
    [buy("l", "2026-01-10", "VWRL.L", 10, { market: "LSE", currency: "GBP", amount: 1390, price: 139, amountUsd: 0, priceUsd: 0 })],
    [], new Map([["VWRL.L", [{ exDate: "2026-06-18", perShare: 0.683298, currency: "GBP" }]]]),
  )[0];
  assert.match(vwrl.caution ?? "", /statement/);

  const mismatch = suggest(
    [buy("v", "2026-01-10", "VWRA.L", 5, { market: "LSE", currency: "USD" })],
    [], new Map([["VWRA.L", [{ exDate: "2026-06-18", perShare: 0.5, currency: "GBP" }]]]),
  )[0];
  assert.match(mismatch.caution ?? "", /listed in GBP while you bought in USD/);
});

test("suggest: default withholding follows the verified table", () => {
  assert.deepEqual(DEFAULT_WITHHOLDING, { US: 0.3, MY: 0, HK: 0, SG: 0, LSE: 0 });
});

test("suggest: a confirmed suggestion is a valid record, edits applied", () => {
  const [june] = suggest([buy("a", "2026-01-05", "VOO", 0.4599)]);
  const record = dividendFromSuggestion(june, { payDate: "2026-06-30", gross: 0.9, withholdingTax: 0.27 });
  assert.deepEqual(validateDividend(record), record);
  assert.equal(record.payDate, "2026-06-30");
  assert.equal(record.gross, 0.9);
  assert.deepEqual(validateDividend(dismissedFromSuggestion(june))?.status, "dismissed");
});

test("rates: the rate on or before a date, never after it", () => {
  close(rateOnOrBefore(USD_RATES, "2026-06-26"), 4.0855);
  close(rateOnOrBefore(USD_RATES, "2026-06-29"), 4.07);
  assert.equal(rateOnOrBefore(USD_RATES, "2026-01-01"), null);
});

// --- Feed parsing ------------------------------------------------------------------

test("feed: dividend events are read from the chart's events block", () => {
  const events = parseDividendEvents({ chart: { result: [{ meta: { currency: "USD" }, events: { dividends: {
    "1782480600": { amount: 1.962, date: 1782480600 },
    "1774618200": { amount: 1.872, date: 1774618200 },
  } } }] } });
  assert.deepEqual(events.map((event) => event.currency), ["USD", "USD"]);
  assert.equal(events[0].perShare, 1.872, "oldest first");
});

test("feed: a fund priced in pence pays in pence, restated in pounds", () => {
  const [event] = parseDividendEvents({ chart: { result: [{ meta: { currency: "GBp" }, events: { dividends: {
    "1": { amount: 5.2799997, date: 1765440000 },
  } } }] } });
  assert.equal(event.currency, "GBP");
  close(event.perShare, 0.052799997);
});

test("feed: anything malformed yields no events", () => {
  assert.deepEqual(parseDividendEvents(null), []);
  assert.deepEqual(parseDividendEvents({ chart: { result: [{ meta: {}, events: { dividends: { x: { amount: "1", date: 1 } } } }] } }), []);
});

test("feed: the server asks for dividends on the monthly chart", () => {
  assert.equal(upstreamFor("dividends", "VOO", "5y"),
    "https://query1.finance.yahoo.com/v8/finance/chart/VOO?range=5y&interval=1mo&events=div");
});

test("feed: history reaches back to the first trade", () => {
  assert.equal(rangeSince("2026-01-05", NOW), "1y");
  assert.equal(rangeSince("2025-07-15", NOW), "2y");
  assert.equal(rangeSince("2022-01-01", NOW), "5y");
});

test("load: suggestions come from each ticker's feed and its currency's rate history", async () => {
  localStorage.clear();
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("kind=dividends")) {
      return Promise.resolve(new Response(JSON.stringify({ chart: { result: [{ meta: { currency: "USD" }, events: { dividends: {
        a: { amount: 1.962, date: Date.parse("2026-06-26T13:30:00Z") / 1000 },
      } } }] } }), { status: 200 }));
    }
    const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
    return Promise.resolve(new Response(JSON.stringify({ chart: { result: [{
      timestamp: [day("2026-06-25"), day("2026-06-29")],
      indicators: { quote: [{ close: [4.0855, 4.07] }] },
    }] } }), { status: 200 }));
  }) as typeof globalThis.fetch;
  try {
    const state = { ...cloneDefaultState(), trades: [buy("a", "2026-01-05", "VOO", 0.4599)], dividends: [] };
    const [june] = await loadDividendSuggestions(state, NOW);
    close(june.gross, 0.4599 * 1.962);
    close(june.rateToMyr, 4.0855);
  } finally {
    globalThis.fetch = original;
  }
});
