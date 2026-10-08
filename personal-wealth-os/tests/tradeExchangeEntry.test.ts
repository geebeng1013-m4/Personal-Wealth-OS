import assert from "node:assert/strict";
import { test } from "./testHarness";
import type { CurrencyExchange, Trade, WealthState } from "../src/models";
import { CURRENT_VERSION, emptyState, importStateFromFile, migrateState } from "../src/state";
import { tradeFromEntry } from "../src/tradeEntry";
import { exchangeFromTrade, withExchangeForTrade, withTradeAndExchange, withoutExchangeLinks } from "../src/tradeExchangeEntry";
import { exchangesFromText, mergeExchanges } from "../src/exchangeImport";
import { resolveExchangeCoverage, tradesWithExchangeCost, validateCurrencyExchange } from "../src/currencyExchange";
import { calculatePositionCostBasis } from "../src/rules";

const TODAY = "2026-10-08";
function buy(overrides: Partial<Trade> = {}): Trade {
  return { id: "new-buy", date: "2026-10-05", platform: "Moomoo", ticker: "VOO", type: "Manual Buy",
    amountUsd: 100, priceUsd: 100, units: 1, amountMyr: 425, feeMyr: 0, ...overrides };
}
const input = { date: "2026-10-06", myrAmount: "410.00", usdAmount: "100.00" };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function settlement(trade: Trade, myr = "410.00", usd = "100.00", existing: CurrencyExchange[] = []): CurrencyExchange {
  const result = exchangeFromTrade(trade, { ...input, myrAmount: myr, usdAmount: usd }, existing, TODAY);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.exchange;
}

test("trade settlement: one save records a buy and linked exchange with the actual MYR cost", () => {
  const state = emptyState();
  const original = JSON.stringify(state);
  const trade = buy();
  const next = withTradeAndExchange(state, trade, settlement(trade));
  assert.equal(next.trades.length, 1);
  assert.equal(next.currencyExchanges.length, 1);
  assert.equal(next.currencyExchanges[0].tradeId, trade.id);
  close(next.trades[0].amountMyr, 410);
  close(next.trades[0].exchangeRate ?? 0, 4.1);
  assert.equal(next.ledgerAccounts, state.ledgerAccounts);
  assert.equal(next.ledgerTransactions, state.ledgerTransactions);
  assert.equal(JSON.stringify(state), original);
});

test("trade settlement: mixed existing USD and new exchange keep their separate costs", () => {
  const trade = buy();
  const old: CurrencyExchange = { id: "old-usd", date: "2026-10-01", direction: "myr-to-usd", myrAmount: 200, usdAmount: 50 };
  const exchanges = [old, settlement(trade, "205", "50")];
  const [priced] = tradesWithExchangeCost([trade], exchanges);
  close(priced.amountMyr, 405);
  const coverage = resolveExchangeCoverage([trade], exchanges);
  assert.equal(coverage.coverage, 1);
  assert.equal(coverage.unspentUsd, 0);
});

test("trade settlement: a USD fee is funded once and excluded from the share amount", () => {
  const trade = buy({ fee: 1, feeCurrency: "USD", feeMyr: 4.25 });
  const [priced] = tradesWithExchangeCost([trade], [settlement(trade, "414.10", "101")]);
  close(priced.amountMyr, 410);
  close(priced.feeMyr, 4.1);
  close(calculatePositionCostBasis([priced], "VOO").costBasisMyr, 414.1);
  assert.equal(resolveExchangeCoverage([trade], [settlement(trade, "414.10", "101")]).unspentUsd, 0);
});

test("trade settlement: a mixed USD buy and fee consume only the real old and new cash", () => {
  const trade = buy({ fee: 1, feeCurrency: "USD", feeMyr: 4.25 });
  const old: CurrencyExchange = { id: "old-usd", date: "2026-10-01", direction: "myr-to-usd", myrAmount: 200, usdAmount: 50 };
  const exchanges = [old, settlement(trade, "209.10", "51")];
  const [priced] = tradesWithExchangeCost([trade], exchanges);
  close(priced.amountMyr, 405);
  close(priced.feeMyr, 4.1);
  close(calculatePositionCostBasis([priced], "VOO").costBasisMyr, 409.1);
  assert.equal(resolveExchangeCoverage([trade], exchanges).unspentUsd, 0);
});

test("trade settlement: MYR fees are preserved separately from the linked conversion", () => {
  const trade = buy({ feeMyr: 2 });
  const [priced] = tradesWithExchangeCost([trade], [settlement(trade)]);
  close(priced.amountMyr, 410);
  assert.equal(priced.feeMyr, 2);
});

test("trade settlement: a linked conversion cannot be stolen by an older unfunded buy", () => {
  const older = buy({ id: "older", date: "2026-10-01", amountUsd: 50, units: 0.5 });
  const trade = buy();
  const result = resolveExchangeCoverage([older, trade], [settlement(trade)]);
  assert.equal(result.costs.get(older.id)?.uncovered, 50);
  assert.equal(result.costs.get(trade.id)?.uncovered, 0);
  close(result.costs.get(trade.id)?.costMyr ?? 0, 410);
});

test("trade settlement: later unrelated conversions cannot overwrite the linked portion", () => {
  const trade = buy();
  const other: CurrencyExchange = { id: "later", date: "2026-10-07", direction: "myr-to-usd", myrAmount: 300, usdAmount: 100 };
  close(tradesWithExchangeCost([trade], [settlement(trade), other])[0].amountMyr, 410);
});

test("trade settlement: an unknown mixed remainder is still uncovered, not claimed as actual", () => {
  const trade = buy();
  const exchange = settlement(trade, "205", "50");
  const coverage = resolveExchangeCoverage([trade], [exchange]);
  assert.equal(coverage.coverage, 0.5);
  close(coverage.costs.get(trade.id)?.costMyr ?? 0, 205);
  assert.equal(coverage.costs.get(trade.id)?.uncovered, 50);
});

test("trade settlement: a pending buy saves alone, then gains one exchange without a duplicate trade", () => {
  const state = emptyState();
  const trade = buy();
  const pending = withTradeAndExchange(state, trade);
  assert.equal(pending.currencyExchanges.length, 0);
  assert.equal(pending.trades[0], trade);
  const settled = withExchangeForTrade(pending, trade.id, settlement(trade));
  assert.equal(settled.trades.length, 1);
  assert.equal(settled.currencyExchanges.length, 1);
  close(settled.trades[0].amountMyr, 410);
  assert.equal(pending.trades[0].amountMyr, 425);
});

test("trade settlement: invalid money writes no exchange", () => {
  for (const raw of ["", "0", "-1", "NaN", "Infinity", "1e309", "1e2", "1.001", "9007199254740991"]) {
    for (const field of ["myrAmount", "usdAmount"] as const) {
      const result = exchangeFromTrade(buy(), { ...input, [field]: raw }, [], TODAY);
      assert.equal(result.ok, false, `${field}: ${raw}`);
    }
  }
});

test("trade settlement: impossible, future or pre-fill dates are rejected", () => {
  for (const date of ["", "2026-02-30", "2026-10-09", "2026-10-04", "2026-13-01"]) {
    assert.equal(exchangeFromTrade(buy(), { ...input, date }, [], TODAY).ok, false, date);
  }
});

test("trade settlement: unrelated amounts, sells and non-USD trades are rejected", () => {
  assert.equal(exchangeFromTrade(buy(), { ...input, usdAmount: "101" }, [], TODAY).ok, false);
  assert.equal(exchangeFromTrade(buy({ type: "Sell" }), input, [], TODAY).ok, false);
  assert.equal(exchangeFromTrade(buy({ currency: "HKD", market: "HK", amount: 100 }), input, [], TODAY).ok, false);
  assert.ok(exchangeFromTrade(buy({ market: "LSE", currency: "USD", ticker: "VWRA.L" }), input, [], TODAY).ok);
});

test("trade settlement: an existing matching exchange is reused rather than counted twice", () => {
  const trade = buy();
  const unlinked: CurrencyExchange = { ...settlement(trade), tradeId: undefined, notes: "Statement" };
  const next = withTradeAndExchange({ ...emptyState(), currencyExchanges: [unlinked] }, trade, settlement(trade, "410", "100", [unlinked]));
  assert.equal(next.currencyExchanges.length, 1);
  assert.equal(next.currencyExchanges[0].notes, "Statement");
});

test("trade settlement: a repeated paste preserves the link and cash count", () => {
  const trade = buy();
  const exchange = settlement(trade);
  const pasted = exchangesFromText("MYR\nUSD\nOct 6, 2026 10:00 MYT\nCompleted\n100.00 USD\n410.00 MYR");
  const merged = mergeExchanges([exchange], pasted);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].tradeId, trade.id);
  close(tradesWithExchangeCost([trade], merged)[0].amountMyr, 410);
});

test("trade settlement: re-pasting a reused record with an older custom id does not duplicate it", () => {
  const trade = buy();
  const old: CurrencyExchange = { ...settlement(trade), id: "legacy-custom-id", tradeId: undefined };
  const linked = settlement(trade, "410", "100", [old]);
  const pasted = exchangesFromText("MYR\nUSD\nOct 6, 2026 10:00 MYT\nCompleted\n100.00 USD\n410.00 MYR");
  const merged = mergeExchanges([linked], pasted);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, old.id);
  assert.equal(merged[0].tradeId, trade.id);
});

test("trade settlement: identical separate statement entries can use the unlinked occurrence", () => {
  const trade = buy();
  const linked = settlement(trade);
  const second: CurrencyExchange = { ...linked, id: linked.id + "-2", tradeId: undefined };
  const other = settlement(buy({ id: "other" }), "410", "100", [linked, second]);
  assert.equal(other.id, second.id);
  assert.equal(other.tradeId, "other");
});

test("trade settlement: an exchange already linked to a buy cannot be attached again", () => {
  const exchange = settlement(buy());
  assert.equal(exchangeFromTrade(buy(), input, [exchange], TODAY).ok, false);
  assert.equal(exchangeFromTrade(buy({ id: "other" }), input, [exchange], TODAY).ok, false);
});

test("trade settlement: invalid old trade amounts cannot create a misleading settlement link", () => {
  for (const amountUsd of [0, Number.NaN, Infinity]) {
    assert.equal(exchangeFromTrade(buy({ amountUsd }), input, [], TODAY).ok, false);
  }
});

test("trade settlement: a full exchange history refuses a new record without dropping old entries", () => {
  const records: CurrencyExchange[] = Array.from({ length: 2000 }, (_, index) => ({
    id: `old-${index}`, date: "2026-10-01", direction: "myr-to-usd", myrAmount: 4, usdAmount: 1,
  }));
  assert.equal(exchangeFromTrade(buy(), input, records, TODAY).ok, false);
  assert.equal(records.length, 2000);
});

test("trade settlement: sale proceeds after settlement can be reinvested without counting the exchange twice", () => {
  const first = buy({ date: "2026-10-05" });
  const sold = buy({ id: "sale", type: "Sell", date: "2026-10-07", amountUsd: 50, units: 0.5 });
  const reinvested = buy({ id: "reinvest", date: "2026-10-08", amountUsd: 50, units: 0.5 });
  const exchanges = [settlement(first)];
  const coverage = resolveExchangeCoverage([first, sold, reinvested], exchanges);
  close(coverage.costs.get(reinvested.id)?.costMyr ?? 0, 205);
  assert.equal(coverage.coverage, 1);
  assert.equal(coverage.unspentUsd, 0);
});

test("v32: v31 records keep their money and get no inferred trade links", () => {
  assert.equal(CURRENT_VERSION, 32);
  const legacy = migrateState({ ...emptyState(), version: 31, trades: [buy()], currencyExchanges: [
    { id: "old", date: "2026-10-01", direction: "myr-to-usd", myrAmount: 400, usdAmount: 100 },
  ] });
  assert.equal(legacy.version, 32);
  assert.equal(legacy.trades[0].amountMyr, 425);
  assert.equal(legacy.currencyExchanges[0].tradeId, undefined);
  assert.equal(legacy.currencyExchanges[0].myrAmount, 400);
  assert.equal(tradesWithExchangeCost(legacy.trades, legacy.currencyExchanges)[0].amountMyr, 400);
});

test("v32: links and costs survive JSON export/import and repeated migration", async () => {
  const trade = buy();
  const next = withTradeAndExchange(emptyState(), trade, settlement(trade));
  const file = new File([JSON.stringify(next)], "synthetic.json", { type: "application/json" });
  const imported = await importStateFromFile(file);
  const twice = migrateState(imported);
  assert.equal(twice.currencyExchanges[0].tradeId, trade.id);
  close(twice.trades[0].amountMyr, 410);
  assert.deepEqual(twice.currencyExchanges, imported.currencyExchanges);
});

test("v32: a bad or dangling link loses only the link, not the actual conversion", () => {
  const exchange = settlement(buy());
  const invalid = validateCurrencyExchange({ ...exchange, tradeId: { invalid: true } });
  assert.ok(invalid);
  assert.equal(invalid.tradeId, undefined);
  assert.equal(invalid.myrAmount, 410);
  const orphan = migrateState({ ...emptyState(), currencyExchanges: [exchange] });
  assert.equal(orphan.currencyExchanges.length, 1);
  assert.equal(orphan.currencyExchanges[0].tradeId, undefined);
});

test("trade settlement: deleting a buy keeps its actual conversion as unlinked history", () => {
  const exchange = settlement(buy());
  const records = withoutExchangeLinks([exchange], new Set(["new-buy"]));
  assert.equal(records.length, 1);
  assert.equal(records[0].myrAmount, 410);
  assert.equal(records[0].tradeId, undefined);
  assert.equal(exchange.tradeId, "new-buy");
});

test("trade settlement: resolving never mutates the old trades, links or balances", () => {
  const state: WealthState = { ...emptyState(), trades: [buy()], currencyExchanges: [settlement(buy())] };
  const before = JSON.stringify(state);
  tradesWithExchangeCost(state.trades, state.currencyExchanges);
  resolveExchangeCoverage(state.trades, state.currencyExchanges);
  assert.equal(JSON.stringify(state), before);
});

test("trade entry: finite inputs cannot persist an overflowing computed amount", () => {
  assert.equal(tradeFromEntry({ id: "overflow", date: TODAY, platform: "Moomoo", ticker: "VOO", market: "US", currency: "USD", type: "DCA", amount: 0,
    units: 1e308, price: 1e308, amountMyr: 0, fee: 0, feeCurrency: "USD", notes: "" }, 4), null);
});
