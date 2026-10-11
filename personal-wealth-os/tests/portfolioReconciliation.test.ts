import assert from "node:assert/strict";
import { test } from "./testHarness";
import { resolveExchangeCoverage, tradesWithExchangeCost } from "../src/currencyExchange";
import { calculatePositionCostBasis } from "../src/rules";
import { recordsFromCsv } from "../src/csvImport";
import type { CurrencyExchange, Trade } from "../src/models";

function trade(id: string, date: string, amount: number, fee: number, type: Trade["type"] = "DCA"): Trade {
  return { id, date, type, ticker: "TEST", platform: "moomoo", amountUsd: amount,
    amountMyr: amount * 4, priceUsd: 10, units: amount / 10, feeMyr: fee * 4,
    fee, feeCurrency: "USD", exchangeRate: 4 };
}

function conversion(id: string, date: string, usd: number, rate = 4): CurrencyExchange {
  return { id, date, direction: "myr-to-usd", myrAmount: usd * rate, usdAmount: usd };
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}

test("reconciliation: unlinked foreign buy fees consume the cash pool", () => {
  const trades = [trade("buy", "2026-01-02", 10, 1)];
  const exchanges = [conversion("fx", "2026-01-01", 11.5)];
  close(resolveExchangeCoverage(trades, exchanges).unspentUsd, 0.5);
  close(tradesWithExchangeCost(trades, exchanges)[0].feeMyr, 4);
});

test("reconciliation: later conversions pay fees before funding the next buy", () => {
  const trades = [trade("first", "2026-01-01", 10, 1), trade("second", "2026-01-04", 10, 0)];
  const exchanges = [conversion("first-fx", "2026-01-02", 10, 4), conversion("fee-fx", "2026-01-03", 1, 5)];
  const coverage = resolveExchangeCoverage(trades, exchanges);
  close(coverage.costs.get("first")!.feeMyr!, 5);
  close(coverage.costs.get("first")!.feeUncovered!, 0);
  close(coverage.costs.get("second")!.uncovered, 10);
  close(coverage.unspentUsd, 0);
});

test("reconciliation: a sell returns net proceeds, with its fee deducted once", () => {
  const trades = [trade("buy", "2026-01-02", 10, 1), trade("sell", "2026-01-03", 12, 0.5, "Sell")];
  close(resolveExchangeCoverage(trades, [conversion("fx", "2026-01-01", 11)]).unspentUsd, 11.5);
});

test("reconciliation: a fee paid separately in MYR never draws dollars", () => {
  const buy = { ...trade("buy", "2026-01-02", 10, 1), feeCurrency: "MYR", fee: 4 };
  close(resolveExchangeCoverage([buy], [conversion("fx", "2026-01-01", 11)]).unspentUsd, 1);
});

test("reconciliation: explicit settlements do not double-deduct fees", () => {
  const buy = trade("buy", "2026-01-02", 10, 1);
  const fx = { ...conversion("fx", "2026-01-03", 12), tradeId: buy.id };
  close(resolveExchangeCoverage([buy], [fx]).unspentUsd, 1);
  close(tradesWithExchangeCost([buy], [fx])[0].feeMyr, 4);
});

test("reconciliation: both cost currencies include buy and sell fees", () => {
  const buy = trade("buy", "2026-01-01", 10, 1);
  const sell = { ...trade("sell", "2026-01-02", 12, 0.5, "Sell"), units: 1, priceUsd: 12 };
  const position = calculatePositionCostBasis([buy, sell], "TEST");
  close(position.realizedPnlUsd, 0.5);
  close(position.realizedPnlMyr, 2);
  close(position.units, 0);
});

test("reconciliation: broker fill amount controls cost without changing recorded units", () => {
  const buy = { ...trade("buy", "2026-01-01", 10, 0.25), units: 0.0999, priceUsd: 100 };
  const position = calculatePositionCostBasis([buy], "TEST");
  close(position.units, 0.0999);
  close(position.costBasisUsd, 10.25);
});

test("reconciliation: short Moomoo exports use quantity@price and retain USD fees", () => {
  const csv = 'Side,Symbol,Status,Filled@Avg Price,Order Amount,Order Time,Total\nBuy,TEST,Filled,0.0999@100.00,10.50,"May 4, 2026 10:00:00 ET",0.25\nBuy,TEST,Cancelled,0@0.00,10.50,"May 4, 2026 10:00:00 ET",0';
  const trades = recordsFromCsv(csv);
  assert.equal(trades.length, 1);
  close(trades[0].units!, 0.0999);
  close(trades[0].amountUsd, 9.99);
  assert.equal(trades[0].feeCurrency, "USD");
  close(trades[0].fee!, 0.25);
});
