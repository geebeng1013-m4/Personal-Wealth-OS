import assert from "node:assert/strict";
import { test } from "./testHarness";
import { planTickers, tradedTickers, withPlannedCustomTickers } from "../src/planTickers";
import type { Trade, WealthState } from "../src/models";

/**
 * T-4: the Settings plan editors list every ticker, not just VOO and QQQM.
 * Saving the old two-box form deleted VXUS's target; these pin the list that
 * replaced it.
 */

const trade = (ticker: string): Trade => ({
  id: ticker, date: "2026-09-01", platform: "Moomoo", ticker, type: "DCA",
  amountMyr: 10, amountUsd: 2, priceUsd: 100, feeMyr: 0,
});

type PlanSource = Pick<WealthState, "dca" | "trades" | "customTickers">;
const source = (targets: Record<string, number>, trades: string[], custom: string[]): PlanSource => ({
  dca: { monthly: 300, targets },
  trades: trades.map(trade),
  customTickers: custom,
});

test("plan tickers: targets first, then traded, then custom — each once", () => {
  const tickers = planTickers(source({ VOO: 0.55, QQQM: 0.25, VXUS: 0.1 }, ["VOO", "AAPL", "vxus"], ["SCHD", "AAPL"]));
  assert.deepEqual(tickers, ["VOO", "QQQM", "VXUS", "AAPL", "SCHD"]);
});

test("plan tickers: a ticker bought but never given a target still gets a box", () => {
  assert.ok(planTickers(source({ VOO: 1 }, ["AAPL"], [])).includes("AAPL"));
});

test("traded tickers: only tickers with a trade are protected from removal", () => {
  const traded = tradedTickers(source({ VOO: 1 }, ["VOO", "aapl"], ["SCHD"]));
  assert.deepEqual([...traded].sort(), ["AAPL", "VOO"]);
});

test("custom tickers: a planned ETF joins the trade form's dropdown, built-ins do not", () => {
  assert.deepEqual(withPlannedCustomTickers(["VXUS"], ["VOO", "QQQM", "VXUS", "SCHD"]), ["VXUS", "SCHD"]);
});
