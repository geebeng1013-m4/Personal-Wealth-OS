import assert from "node:assert/strict";
import { test } from "./testHarness";
import { calculatePositionCostBasis } from "../src/rules";
import { getHolding, getPortfolioSnapshot } from "../src/portfolioSummary";
import { priceMapFrom } from "../src/marketPrices";
import { migrateState } from "../src/state";
import type { Trade, WealthState } from "../src/models";

/**
 * Commission is the largest controllable drag on this portfolio, and it was
 * invisible: buried inside the ringgit cost basis with nothing on screen to
 * say so. These tests pin the two returns apart — what every ringgit handed
 * over became, and what the investment itself did — using the user's real
 * trades, where the gap is two percentage points.
 */

const t = (
  id: string, date: string, ticker: string, type: string,
  amountMyr: number, amountUsd: number, priceUsd: number, units: number, feeMyr: number,
): Trade => ({ id, date, platform: "moomoo", ticker, type: type as Trade["type"], amountMyr, amountUsd, priceUsd, units, feeMyr });

/** The real Moomoo history: 20 buys, 2 sells, per-order minimum fees. */
const REAL_TRADES: Trade[] = [
  t("t01", "2026-08-12T16:43:02.000Z", "VOO", "DCA", 36.32, 9.02, 710.2, 0.0127, 1.33),
  t("t02", "2026-08-12T16:29:42.000Z", "QQQM", "DCA", 159.7, 39.66, 298, 0.1331, 2.54),
  t("t03", "2026-07-06T13:52:31.000Z", "QQQM", "DCA", 32.37, 8.04, 297.7, 0.027, 1.33),
  t("t04", "2026-07-06T13:45:37.000Z", "VOO", "DCA", 83.67, 20.78, 688, 0.0302, 1.85),
  t("t05", "2026-06-26T04:00:00.000Z", "QQQM", "DCA", 0.24, 0.06, 290.95, 0.0002, 1.01),
  t("t06", "2026-06-05T16:13:18.000Z", "VOO", "DCA", 135.7, 33.7, 685, 0.0492, 2.34),
  t("t07", "2026-06-05T16:11:50.000Z", "QQQM", "DCA", 59.96, 14.89, 296, 0.0503, 1.61),
  t("t08", "2026-06-03T17:13:11.000Z", "VOO", "DCA", 298.33, 74.09, 693.77, 0.1068, 3.95),
  t("t09", "2026-05-28T14:58:26.000Z", "QQQM", "DCA", 21.86, 5.43, 301.6, 0.018, 1.21),
  t("t10", "2026-05-28T14:47:22.000Z", "VOO", "DCA", 56.53, 14.04, 691.52, 0.0203, 1.57),
  t("t11", "2026-05-12T14:52:00.000Z", "QQQM", "DCA", 106.71, 26.5, 289.61, 0.0915, 2.09),
  t("t12", "2026-05-12T14:49:17.000Z", "VOO", "DCA", 213.33, 52.98, 674.91, 0.0785, 3.14),
  t("t13", "2026-05-05T14:47:01.000Z", "QQQM", "DCA", 91.24, 22.66, 280.16, 0.0809, 1.89),
  t("t14", "2026-05-05T14:32:36.000Z", "VOO", "DCA", 183.61, 45.6, 664.69, 0.0686, 2.82),
  t("t15", "2026-05-04T14:50:59.000Z", "VOO", "DCA", 42.2, 10.48, 663.51, 0.0158, 1.41),
  t("t16", "2026-04-06T15:27:36.000Z", "VOO", "DCA", 189.25, 47, 604.11, 0.0778, 2.9),
  t("t17", "2026-04-06T15:22:37.000Z", "QQQM", "DCA", 65.71, 16.32, 241.73, 0.0675, 1.65),
  t("t18", "2026-04-06T15:13:55.000Z", "VOO", "Sell", 183.69, 45.62, 604.28, 0.0755, 2.82),
  t("t19", "2026-04-06T15:13:55.000Z", "QQQM", "Sell", 65.8, 16.34, 241.75, 0.0676, 1.65),
  t("t20", "2026-04-06T15:07:09.000Z", "QQQM", "DCA", 65.8, 16.34, 241.67, 0.0676, 1.65),
  t("t21", "2026-04-06T15:06:09.000Z", "VOO", "DCA", 164.33, 40.81, 604.54, 0.0675, 2.62),
  t("t22", "2025-10-28T14:17:19.000Z", "VOO", "DCA", 20.29, 5.04, 630.54, 0.008, 1.17),
];

const realState = (): WealthState => migrateState({
  deviceId: "device-trading-costs",
  trades: REAL_TRADES,
  dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } },
});

const snapshot = () => getPortfolioSnapshot(realState(), new Date(2026, 7, 28), {
  prices: priceMapFrom([
    { ticker: "VOO", priceUsd: 707.878 },
    { ticker: "QQQM", priceUsd: 296.288 },
  ]),
  usdToMyr: 4.0294,
});

// --- The two returns are different facts -----------------------------------

test("costs: the return before commission is the better one, and the gap is the commission", () => {
  const p = snapshot();
  assert.ok(p.unrealizedPnlMyr !== null && p.unrealizedPnlMyrExFees !== null);
  assert.ok(p.unrealizedPnlMyrExFees > p.unrealizedPnlMyr);
  // The gap is exactly the fee sitting in the basis — nothing else moved.
  assert.ok(Math.abs((p.unrealizedPnlMyrExFees - p.unrealizedPnlMyr) - p.feesInCostBasisMyr) < 0.01);
});

test("costs: on the real portfolio, commission is worth two percentage points", () => {
  // No conversions recorded on this state, so the figures are the fee effect
  // alone — the currency work is deliberately not in the way here.
  const p = snapshot();
  assert.ok(Math.abs(p.feesInCostBasisMyr - 34.64) < 0.05, `fees ${p.feesInCostBasisMyr}`);
  assert.ok(Math.abs(p.unrealizedPnlPercentMyr! - 0.0330) < 0.0005);
  assert.ok(Math.abs(p.unrealizedPnlPercentMyrExFees! - 0.0531) < 0.0005);
  const drag = p.unrealizedPnlPercentMyrExFees! - p.unrealizedPnlPercentMyr!;
  assert.ok(drag > 0.019 && drag < 0.021, `drag ${drag}`);
});

test("costs: the fee drag is the same whatever the exchange rate turns out to be", () => {
  // Commission is charged in ringgit and does not move with FX, so recording
  // conversions must shift both returns together and leave the gap alone.
  const withFx = getPortfolioSnapshot(
    migrateState({
      deviceId: "device-trading-costs-fx",
      trades: REAL_TRADES,
      dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } },
      currencyExchanges: [
        { id: "fx1", date: "2025-10-01", direction: "myr-to-usd", myrAmount: 2200, usdAmount: 550 },
      ],
    }),
    new Date(2026, 7, 28),
    {
      prices: priceMapFrom([
        { ticker: "VOO", priceUsd: 707.878 },
        { ticker: "QQQM", priceUsd: 296.288 },
      ]),
      usdToMyr: 4.0294,
    },
  );
  const plain = snapshot();
  assert.ok(Math.abs(withFx.feesInCostBasisMyr - plain.feesInCostBasisMyr) < 0.01);
  const dragWithFx = withFx.unrealizedPnlMyrExFees! - withFx.unrealizedPnlMyr!;
  const dragPlain = plain.unrealizedPnlMyrExFees! - plain.unrealizedPnlMyr!;
  assert.ok(Math.abs(dragWithFx - dragPlain) < 0.01, `${dragWithFx} vs ${dragPlain}`);
});

test("costs: commission never touches the dollar figures", () => {
  // The fee is charged in ringgit and the USD side is priced from units, so a
  // fee-aware split must leave every dollar figure exactly as it was.
  const p = snapshot();
  assert.ok(Math.abs(p.unrealizedPnlPercent! - 0.0524) < 0.0005);
  assert.ok(Math.abs(p.totalInvestedUsd - 441.25) < 0.05);
});

// --- Fees follow the units -------------------------------------------------

test("costs: selling half a position takes half its fees out of the basis", () => {
  const basis = calculatePositionCostBasis([
    t("b1", "2026-01-01", "VOO", "DCA", 400, 100, 500, 1, 10),
    t("s1", "2026-02-01", "VOO", "Sell", 220, 55, 550, 0.5, 5),
  ], "VOO");
  // Lifetime fees count both orders; the basis keeps only the half still held.
  assert.ok(Math.abs(basis.feesMyr - 15) < 1e-9);
  assert.ok(Math.abs(basis.feeBasisMyr - 5) < 1e-9);
  assert.ok(Math.abs(basis.costBasisMyr - 205) < 1e-9);
});

test("costs: closing a position clears its fee basis rather than stranding it", () => {
  const basis = calculatePositionCostBasis([
    t("b1", "2026-01-01", "VOO", "DCA", 400, 100, 500, 1, 10),
    t("s1", "2026-02-01", "VOO", "Sell", 550, 137.5, 550, 1, 5),
  ], "VOO");
  assert.equal(basis.units, 0);
  assert.equal(basis.costBasisMyr, 0);
  assert.equal(basis.feeBasisMyr, 0);
  assert.ok(Math.abs(basis.feesMyr - 15) < 1e-9, "lifetime fees survive the close");
});

test("costs: the real portfolio's lifetime fees exceed the fees still in the basis", () => {
  // Two positions were partly sold in April, so their fees partly left with them.
  const p = snapshot();
  const lifetime = p.holdings.reduce((sum, holding) => sum + holding.feesMyr, 0);
  assert.ok(Math.abs(lifetime - 44.55) < 0.05, `lifetime ${lifetime}`);
  assert.ok(lifetime > p.feesInCostBasisMyr);
});

// --- Honest when unknown ---------------------------------------------------

test("costs: with no price there is no fee-free return to state, only the fee", () => {
  const p = getPortfolioSnapshot(realState(), new Date(2026, 7, 28));
  assert.equal(p.unrealizedPnlMyrExFees, null);
  assert.equal(p.unrealizedPnlPercentMyrExFees, null);
  assert.equal(p.feesInCostBasisMyr, 0, "no priced holdings means no fees counted for them");
});

test("costs: a fee-free portfolio reports the same return twice, not a spurious gap", () => {
  const free = migrateState({
    deviceId: "device-no-fees",
    trades: [t("b1", "2026-01-01", "VOO", "DCA", 400, 100, 500, 1, 0)],
    dca: { monthly: 0, targets: { VOO: 1 } },
  });
  const p = getPortfolioSnapshot(free, new Date(2026, 7, 28), {
    prices: priceMapFrom([{ ticker: "VOO", priceUsd: 550 }]),
    usdToMyr: 4.0294,
  });
  assert.equal(p.feesInCostBasisMyr, 0);
  assert.equal(p.unrealizedPnlMyrExFees, p.unrealizedPnlMyr);
  assert.equal(p.unrealizedPnlPercentMyrExFees, p.unrealizedPnlPercentMyr);
});

test("costs: a per-holding fee basis is available, and the smallest order is the worst", () => {
  // A MYR 0.24 order that paid MYR 1.01 in commission. Per-holding fee data is
  // what any future warning about order size will have to read.
  const p = snapshot();
  const qqqm = getHolding(p, "QQQM");
  assert.ok(qqqm && qqqm.feesInCostBasisMyr > 0);
  const worst = REAL_TRADES
    .filter((trade) => trade.type !== "Sell")
    .map((trade) => ({ id: trade.id, ratio: trade.feeMyr / trade.amountMyr }))
    .sort((a, b) => b.ratio - a.ratio)[0];
  assert.equal(worst.id, "t05");
  assert.ok(worst.ratio > 4, `a ${worst.ratio * 100}% fee on one order`);
});
