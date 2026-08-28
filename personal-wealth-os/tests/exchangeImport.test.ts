import assert from "node:assert/strict";
import { test } from "./testHarness";
import { exchangesFromText, mergeExchanges } from "../src/exchangeImport";
import { exchangeRateOf, resolveExchangeCoverage } from "../src/currencyExchange";

/**
 * Fixture: the user's real conversion history, copied from the broker's
 * exchange list exactly as it appears on screen — newest first, no delimiters,
 * one reverse conversion in the middle. Parsing is only worth trusting against
 * the real thing; a tidied-up sample would not have caught the direction line
 * or the mixed ordering.
 */
const REAL_HISTORY = `MYR
USD
Aug 9, 2026 22:06 MYT
Completed
4.85 USD
20.00 MYR
MYR
USD
Aug 5, 2026 23:04 MYT
Completed
44.84 USD
184.88 MYR
MYR
USD
Jul 6, 2026 00:21 MYT
Completed
14.63 USD
60.00 MYR
MYR
USD
Jun 29, 2026 22:49 MYT
Completed
14.64 USD
60.00 MYR
USD
MYR
Jun 9, 2026 19:09 MYT
Completed
20.12 MYR
4.99 USD
MYR
USD
Jun 7, 2026 19:26 MYT
Completed
4.93 USD
20.02 MYR
MYR
USD
Jun 6, 2026 00:08 MYT
Completed
49.64 USD
201.42 MYR
MYR
USD
May 25, 2026 15:26 MYT
Completed
20.13 USD
80.00 MYR
MYR
USD
May 12, 2026 21:46 MYT
Completed
80.76 USD
320.00 MYR
MYR
USD
May 5, 2026 22:29 MYT
Completed
65.17 USD
260.00 MYR
MYR
USD
May 4, 2026 22:47 MYT
Completed
15.06 USD
60.00 MYR
MYR
USD
Apr 5, 2026 10:27 MYT
Completed
60.80 USD
247.00 MYR
MYR
USD
Oct 28, 2025 11:12 MYT
Completed
0.24 USD
1.00 MYR
MYR
USD
Oct 28, 2025 09:22 MYT
Completed
6.15 USD
26.00 MYR`;

test("import: the real exchange history parses completely", () => {
  const records = exchangesFromText(REAL_HISTORY);
  assert.equal(records.length, 14);
});

test("import: records come back oldest first, whatever order they were listed in", () => {
  const records = exchangesFromText(REAL_HISTORY);
  const dates = records.map((record) => record.date);
  assert.deepEqual([...dates].sort(), dates);
  assert.equal(dates[0], "2025-10-28");
  assert.equal(dates[dates.length - 1], "2026-08-09");
});

test("import: the direction lines are read, not assumed", () => {
  // One of the fourteen went the other way. Reading it as MYR→USD would add
  // dollars that were actually sold, inflating everything downstream.
  const records = exchangesFromText(REAL_HISTORY);
  const reverse = records.filter((record) => record.direction === "usd-to-myr");
  assert.equal(reverse.length, 1);
  assert.equal(reverse[0].date, "2026-06-09");
  assert.equal(reverse[0].usdAmount, 4.99);
  assert.equal(reverse[0].myrAmount, 20.12);
});

test("import: each amount is matched to its own currency, not to its position", () => {
  // The reverse conversion lists ringgit first and dollars second — the
  // opposite of every other row.
  const records = exchangesFromText(REAL_HISTORY);
  const forward = records.find((record) => record.date === "2026-08-05")!;
  assert.equal(forward.myrAmount, 184.88);
  assert.equal(forward.usdAmount, 44.84);
});

test("import: the rates recovered are the ones actually paid", () => {
  const records = exchangesFromText(REAL_HISTORY);
  const rateOn = (myrAmount: number) =>
    exchangeRateOf(records.find((record) => record.myrAmount === myrAmount)!);
  // Ringgit was strongest in May and weakest the previous October.
  assert.ok(Math.abs(rateOn(320.00) - 3.9624) < 0.001);
  assert.ok(Math.abs(rateOn(184.88) - 4.1231) < 0.001);
  assert.ok(Math.abs(rateOn(26.00) - 4.2276) < 0.001);
});

test("import: a tiny conversion carries a rate too rounded to trust on its own", () => {
  // 1.00 MYR → 0.24 USD implies anything from about 4.08 to 4.26 once the
  // broker's two decimal places are accounted for. It is kept because the money
  // is real, and it is harmless because the pool weights by size — one ringgit
  // out of fifteen hundred cannot move the average. Nothing should ever read a
  // single record's rate as authoritative.
  const records = exchangesFromText(REAL_HISTORY);
  const tiny = records.find((record) => record.myrAmount === 1.00)!;
  assert.equal(tiny.usdAmount, 0.24);
  const implied = exchangeRateOf(tiny);
  assert.ok(implied > 4.16 && implied < 4.17, `${implied}`);

  const forward = records.filter((record) => record.direction === "myr-to-usd");
  const withTiny = forward.reduce((sum, r) => sum + r.myrAmount, 0)
    / forward.reduce((sum, r) => sum + r.usdAmount, 0);
  const without = forward.filter((r) => r.myrAmount !== 1.00);
  const withoutTiny = without.reduce((sum, r) => sum + r.myrAmount, 0)
    / without.reduce((sum, r) => sum + r.usdAmount, 0);
  assert.ok(Math.abs(withTiny - withoutTiny) < 0.0005, "one ringgit cannot move the average");
});

test("import: the weighted average is what the portfolio will be costed at", () => {
  const records = exchangesFromText(REAL_HISTORY);
  const forward = records.filter((record) => record.direction === "myr-to-usd");
  const myr = forward.reduce((sum, record) => sum + record.myrAmount, 0);
  const usd = forward.reduce((sum, record) => sum + record.usdAmount, 0);
  assert.ok(Math.abs(myr - 1540.32) < 0.01, `MYR converted: ${myr}`);
  assert.ok(Math.abs(usd - 381.84) < 0.01, `USD received: ${usd}`);
  // Far from the 4.105 a CSV import stamped on the trades, and far from any
  // single day's rate: it is the average of fourteen separate decisions.
  assert.ok(Math.abs(myr / usd - 4.0339) < 0.001, `average rate: ${myr / usd}`);
});

test("import: re-pasting an overlapping history updates rather than duplicates", () => {
  const all = exchangesFromText(REAL_HISTORY);
  // A later paste covering only the most recent few, as a user topping up would.
  const recent = exchangesFromText(REAL_HISTORY.split("MYR\nUSD\nJul 6").slice(0, 1).join(""));
  assert.ok(recent.length > 0 && recent.length < all.length);
  const merged = mergeExchanges(all, recent);
  assert.equal(merged.length, all.length);
});

test("import: incomplete or unparseable blocks are skipped, not guessed", () => {
  const messy = `MYR
USD
Aug 9, 2026 22:06 MYT
Pending
4.85 USD
20.00 MYR
MYR
USD
Aug 5, 2026 23:04 MYT
Completed
44.84 USD
184.88 MYR
Some heading nobody asked for
MYR
USD
Not a date at all
Completed
1.00 USD`;
  const records = exchangesFromText(messy);
  assert.equal(records.length, 1);
  assert.equal(records[0].date, "2026-08-05");
});

test("import: parsed history feeds the coverage pool without further translation", () => {
  const records = exchangesFromText(REAL_HISTORY);
  const coverage = resolveExchangeCoverage([], records);
  // Every dollar converted, minus the one conversion back to ringgit.
  assert.ok(Math.abs(coverage.unspentUsd - (381.84 - 4.99)) < 0.05, `${coverage.unspentUsd}`);
  assert.ok(Math.abs((coverage.averageRecordedRate ?? 0) - 4.0339) < 0.001);
});
