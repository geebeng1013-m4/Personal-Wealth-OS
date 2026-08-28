import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getHolding, getPortfolioSnapshot } from "../src/portfolioSummary";
import { priceMapFrom } from "../src/marketPrices";
import { recordsFromCsv } from "../src/csvImport";
import { migrateState } from "../src/state";
import type { Trade, WealthState } from "../src/models";

/**
 * The ringgit return and the dollar return are two different facts, and the
 * gap between them is what makes WealthUp's headline disagree with the broker
 * app the data came from. These tests pin that gap using the REAL portfolio
 * shape (two Moomoo holdings, fractional units) rather than the demo fixture,
 * whose tidy numbers hide the mismatch.
 *
 * Moomoo, 2026-08-28: MV MYR 1,872.63, position P/L +96.09.
 * WealthUp on the same holdings showed +MYR 61.26 (+3.38%).
 */

// Cost side as recorded: one flat FX rate across every trade, which is what
// recordsFromCsv() produces today.
const IMPORT_RATE = 4.105;
const TODAY_RATE = 4.0327;

const realTrades: Trade[] = [
  { id: "voo", date: "2026-04-06", platform: "moomoo", ticker: "VOO", type: "DCA",
    units: 0.4599, priceUsd: 669.037, amountUsd: 307.69, amountMyr: 307.69 * IMPORT_RATE, feeMyr: 0 },
  { id: "qqqm", date: "2026-04-06", platform: "moomoo", ticker: "QQQM", type: "DCA",
    units: 0.4685, priceUsd: 285.08, amountUsd: 133.56, amountMyr: 133.56 * IMPORT_RATE, feeMyr: 0 },
];

const realState = (): WealthState => migrateState({
  deviceId: "device-currency-return",
  trades: realTrades,
  dca: { monthly: 0, targets: { VOO: 0.7, QQQM: 0.3 } },
});

const priced = () => getPortfolioSnapshot(realState(), new Date(2026, 7, 28), {
  prices: priceMapFrom([
    { ticker: "VOO", priceUsd: 707.878 },
    { ticker: "QQQM", priceUsd: 296.288 },
  ]),
  usdToMyr: TODAY_RATE,
});

test("currency: the dollar return matches the broker's own arithmetic exactly", () => {
  // Units and prices come straight off the broker, so this side has no FX in
  // it and must reconcile to the cent with what Moomoo shows.
  const snapshot = priced();
  const brokerPnlUsd = 0.4599 * (707.878 - 669.037) + 0.4685 * (296.288 - 285.08);
  assert.ok(snapshot.unrealizedPnlUsd !== null);
  assert.ok(Math.abs(snapshot.unrealizedPnlUsd - brokerPnlUsd) < 0.01,
    `USD P&L ${snapshot.unrealizedPnlUsd} should match broker ${brokerPnlUsd}`);
  assert.ok(Math.abs(snapshot.unrealizedPnlUsd - 23.11) < 0.02);
});

test("currency: the ringgit return is a materially different number, not a rounding difference", () => {
  // This is why both are now shown. Reporting only the ringgit figure left the
  // user comparing +3.38% against a broker screen reading roughly +5.2%.
  const snapshot = priced();
  assert.ok(snapshot.unrealizedPnlPercent !== null && snapshot.unrealizedPnlPercentMyr !== null);
  const gap = snapshot.unrealizedPnlPercent - snapshot.unrealizedPnlPercentMyr;
  assert.ok(gap > 0.015, `expected a gap of more than 1.5 percentage points, got ${gap}`);
  assert.ok(Math.abs(snapshot.unrealizedPnlMyr! - 61.3) < 1);
});

test("currency: the whole gap is the FX rate, not the holdings", () => {
  // Value the same portfolio with the cost recorded at today's rate and the
  // ringgit return collapses onto the dollar return. Nothing else moved.
  const state = realState();
  const atTodaysRate: WealthState = {
    ...state,
    trades: state.trades.map((t) => ({ ...t, amountMyr: t.amountUsd * TODAY_RATE })),
  };
  const snapshot = getPortfolioSnapshot(atTodaysRate, new Date(2026, 7, 28), {
    prices: priceMapFrom([
      { ticker: "VOO", priceUsd: 707.878 },
      { ticker: "QQQM", priceUsd: 296.288 },
    ]),
    usdToMyr: TODAY_RATE,
  });
  assert.ok(snapshot.unrealizedPnlPercent !== null && snapshot.unrealizedPnlPercentMyr !== null);
  assert.ok(Math.abs(snapshot.unrealizedPnlPercent - snapshot.unrealizedPnlPercentMyr) < 0.001,
    "with one rate on both sides the two returns are the same fact");
});

test("currency: per-holding, the dollar return is exact while the ringgit one carries the FX", () => {
  const snapshot = priced();
  const voo = getHolding(snapshot, "VOO");
  assert.ok(voo && voo.unrealizedPnlPercent !== null && voo.unrealizedPnlPercentMyr !== null);
  assert.ok(Math.abs(voo.unrealizedPnlPercent - (707.878 / 669.037 - 1)) < 0.0001);
  assert.ok(voo.unrealizedPnlPercentMyr < voo.unrealizedPnlPercent);
});

/**
 * Characterisation test for a KNOWN LIMITATION, not an endorsement of it.
 * recordsFromCsv() has no per-trade FX rate to work from, so it stamps the
 * whole file with one rate. That is the root cause of the gap above. When
 * imported trades start carrying their own historical rate, this test should
 * be rewritten to assert the rates differ by date.
 */
test("currency: a Moomoo CSV import stamps every trade with the same FX rate", () => {
  const csv = [
    "Symbol,Side,Status,Order Time,Filled@Avg Price,Fill Qty,Fill Amount,Platform Fees,Stamp Duty",
    "VOO,Buy,Filled,2025/10/28 21:30:00,630.54,0.034,21.42,0,0",
    "QQQM,Buy,Filled,2026/06/26 21:30:00,290.95,0.0002,0.06,0,0",
  ].join("\n");
  const trades = recordsFromCsv(csv);
  assert.equal(trades.length, 2);
  const rates = new Set(trades.map((t) => t.exchangeRate));
  assert.equal(rates.size, 1,
    "today's importer cannot vary the rate by trade date — see csvImport.ts");
});
