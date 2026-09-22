import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getHolding, getPortfolioSnapshot } from "../src/portfolioSummary";
import { estimateUsSellFeeMyr } from "../src/rules";
import { priceMapFrom } from "../src/marketPrices";
import { migrateState } from "../src/state";
import type { Trade, WealthState } from "../src/models";

const close = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 0.005, `${actual} ≈ ${expected}`);

function trade(overrides: Partial<Trade> & Pick<Trade, "id" | "ticker" | "type">): Trade {
  return {
    date: "2026-01-01", platform: "moomoo",
    amountMyr: 0, amountUsd: 0, priceUsd: 0, feeMyr: 0,
    ...overrides,
  };
}

function stateWith(trades: Trade[]): WealthState {
  const state = migrateState({ deviceId: "device-sell-fee", trades });
  return { ...state, trades, dca: { ...state.dca, targets: {} } };
}

test("sell fee: fractional sells match the user's real Moomoo orders", () => {
  // 2026-04-06 sells: VOO USD 45.62 → platform 0.45; QQQM USD 16.34 → 0.16;
  // each with MYR 1 stamp duty.
  close(estimateUsSellFeeMyr(0.0755, 45.62, 4), 0.45 * 4 + 1);
  close(estimateUsSellFeeMyr(0.0676, 16.34, 4), 0.16 * 4 + 1);
});

test("sell fee: the fractional platform fee caps at USD 0.99 and stamp duty steps per MYR 1,000", () => {
  // The user's holdings on 2026-09-23: QQQM USD 193.86 (MYR 790), VOO USD 327.70 (MYR 1,335).
  close(estimateUsSellFeeMyr(0.6322, 193.86, 4.0752), 0.99 * 4.0752 + 1);
  close(estimateUsSellFeeMyr(0.4599, 327.70, 4.0752), 0.99 * 4.0752 + 2);
});

test("sell fee: one share or more uses the whole-share schedule", () => {
  // 10 × USD 500: commission 1.50 + platform 0.99 + settlement 0.03 + activity
  // 0.01 (minimum) + CAT 0.00, then MYR 20 stamp duty on MYR 20,000.
  close(estimateUsSellFeeMyr(10, 5000, 4), 2.53 * 4 + 20);
  // Stamp duty stops at the MYR 1,000 cap.
  const huge = estimateUsSellFeeMyr(1000, 500_000, 4);
  assert.ok(huge !== null && huge < 1000 + 200 * 4);
});

test("sell fee: unusable inputs give no estimate rather than a made-up one", () => {
  assert.equal(estimateUsSellFeeMyr(0, 100, 4), null);
  assert.equal(estimateUsSellFeeMyr(1, 0, 4), null);
  assert.equal(estimateUsSellFeeMyr(1, 100, 0), null);
  assert.equal(estimateUsSellFeeMyr(Number.NaN, 100, 4), null);
  assert.equal(estimateUsSellFeeMyr(1, Infinity, 4), null);
});

test("sell fee: the snapshot totals the estimate and subtracts it from unrealised", () => {
  const state = stateWith([
    trade({ id: "q", ticker: "QQQM", type: "DCA", amountUsd: 182.02, amountMyr: 740, priceUsd: 287.915, units: 0.6322, feeMyr: 10 }),
    trade({ id: "v", ticker: "VOO", type: "DCA", amountUsd: 307.69, amountMyr: 1250, priceUsd: 669.037, units: 0.4599, feeMyr: 12 }),
  ]);
  const snapshot = getPortfolioSnapshot(state, new Date(), {
    prices: priceMapFrom([{ ticker: "QQQM", priceUsd: 306.64 }, { ticker: "VOO", priceUsd: 712.55 }]),
    usdToMyr: 4.0752,
  });
  const expected = 2 * 0.99 * 4.0752 + 3;
  close(snapshot.estimatedSellFeesMyr, expected);
  assert.ok(snapshot.unrealizedPnlMyr !== null);
  close(snapshot.unrealizedPnlMyrAfterSellFees, snapshot.unrealizedPnlMyr - expected);
});

test("sell fee: no estimate for a broker or market whose charges are unchecked", () => {
  const prices = priceMapFrom([{ ticker: "VOO", priceUsd: 700 }, { ticker: "QQQM", priceUsd: 300 }]);
  const mixed = stateWith([
    trade({ id: "v", ticker: "VOO", type: "DCA", amountUsd: 100, amountMyr: 400, priceUsd: 700, units: 0.2 }),
    trade({ id: "q", ticker: "QQQM", type: "DCA", platform: "Interactive Brokers", amountUsd: 100, amountMyr: 400, priceUsd: 300, units: 0.3 }),
  ]);
  const snapshot = getPortfolioSnapshot(mixed, new Date(), { prices, usdToMyr: 4 });
  assert.ok(getHolding(snapshot, "VOO")?.estimatedSellFeeMyr !== null);
  assert.equal(getHolding(snapshot, "QQQM")?.estimatedSellFeeMyr, null);
  // A total that skipped QQQM would look complete while understating the cost.
  assert.equal(snapshot.estimatedSellFeesMyr, null);
  assert.equal(snapshot.unrealizedPnlMyrAfterSellFees, null);
});

test("sell fee: stays null without prices or an FX rate", () => {
  const state = stateWith([trade({ id: "v", ticker: "VOO", type: "DCA", amountUsd: 100, amountMyr: 400, priceUsd: 700, units: 0.2 })]);
  assert.equal(getPortfolioSnapshot(state).estimatedSellFeesMyr, null);
  const noRate = getPortfolioSnapshot(state, new Date(), { prices: priceMapFrom([{ ticker: "VOO", priceUsd: 700 }]) });
  assert.equal(getHolding(noRate, "VOO")?.estimatedSellFeeMyr, null);
  assert.equal(noRate.estimatedSellFeesMyr, null);
});
