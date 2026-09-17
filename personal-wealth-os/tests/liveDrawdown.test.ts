import assert from "node:assert/strict";
import { test } from "./testHarness";
import { assetDrawdownBelow, drawdownBelow } from "../src/drawdowns";

/**
 * "From all-time high" is measured against the live quote, not only the cached
 * daily series. Figures are VOO on 2026-09-18: highest close USD 714.95
 * (2026-08-13), last close USD 700.77.
 */

const close = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `expected ${expected}, got ${actual}`);

function withHistory<T>(closes: number[], run: () => Promise<T>): Promise<T> {
  localStorage.clear();
  const original = globalThis.fetch;
  const start = Date.parse("2016-09-19");
  const body = JSON.stringify({ chart: { result: [{
    timestamp: closes.map((_, index) => (start + index * 86_400_000) / 1000),
    indicators: { quote: [{ close: closes }] },
  }] } });
  globalThis.fetch = (() => Promise.resolve(new Response(body, { status: 200 }))) as typeof globalThis.fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

test("drawdown: percentage points below the highest close", () => {
  close(drawdownBelow(714.95, 700.77), (1 - 700.77 / 714.95) * 100);
});

test("drawdown: a price above the old high is a new high, not a negative drop", () => {
  close(drawdownBelow(714.95, 720), 0);
});

test("drawdown: no figure without two real prices", () => {
  assert.equal(drawdownBelow(0, 700), null);
  assert.equal(drawdownBelow(714.95, 0), null);
});

test("drawdown: the live quote is what 'now' is measured with", async () => {
  const below = await withHistory([600, 714.95, 700.77], () => assetDrawdownBelow("VOO", 680));
  close(below, (1 - 680 / 714.95) * 100);
});

test("drawdown: without a live quote the last close is used, as before", async () => {
  const below = await withHistory([600, 714.95, 700.77], () => assetDrawdownBelow("VOO"));
  close(below, (1 - 700.77 / 714.95) * 100);
});

test("drawdown: a live quote in a different unit is ignored, not read as a crash", async () => {
  // History in pence (1050.8), live quote restated in pounds (10.508).
  const below = await withHistory([1000, 1060, 1050.8], () => assetDrawdownBelow("ISF.L", 10.508));
  close(below, (1 - 1050.8 / 1060) * 100);
});
