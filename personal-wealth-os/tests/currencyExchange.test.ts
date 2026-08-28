import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  exchangeRateOf,
  normalizeCurrencyExchanges,
  resolveExchangeCoverage,
  tradesWithExchangeCost,
  validateCurrencyExchange,
} from "../src/currencyExchange";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { priceMapFrom } from "../src/marketPrices";
import { migrateState } from "../src/state";
import type { CurrencyExchange, Trade, WealthState } from "../src/models";

/**
 * The ringgit cost of a US holding is only knowable from the conversions that
 * funded it. These tests pin what the pool derives from those records, and —
 * just as importantly — what it refuses to derive without them.
 */

// The flat rate a CSV import stamps on every row. It is now only a fallback,
// used for dollars no recorded conversion explains.
const IMPORT_RATE = 4.105;

function buy(id: string, date: string, ticker: string, usd: number, priceUsd: number): Trade {
  return {
    id, date, platform: "moomoo", ticker, type: "DCA",
    amountUsd: usd, amountMyr: usd * IMPORT_RATE, priceUsd, feeMyr: 0,
  };
}

function sell(id: string, date: string, ticker: string, usd: number, priceUsd: number): Trade {
  return { ...buy(id, date, ticker, usd, priceUsd), type: "Sell" };
}

function exchange(id: string, date: string, myr: number, usd: number): CurrencyExchange {
  return { id, date, direction: "myr-to-usd", myrAmount: myr, usdAmount: usd };
}

// --- The core claim --------------------------------------------------------

test("exchange: a buy costs what the conversion that funded it cost, not what its trade date implies", () => {
  // Converted in April at 4.30, spent in June. The June rate is irrelevant —
  // the ringgit left the account in April.
  const exchanges = [exchange("x1", "2026-04-01", 430, 100)];
  const trades = [buy("t1", "2026-06-15", "VOO", 100, 700)];
  const [restated] = tradesWithExchangeCost(trades, exchanges);
  assert.equal(Math.round(restated.amountMyr * 100) / 100, 430);
  assert.equal(restated.exchangeRate, 4.3);
});

test("exchange: one conversion funds several later buys, all at its rate", () => {
  const exchanges = [exchange("x1", "2026-04-01", 860, 200)];
  const trades = [
    buy("t1", "2026-04-10", "VOO", 80, 700),
    buy("t2", "2026-05-10", "QQQM", 70, 290),
    buy("t3", "2026-06-10", "VOO", 50, 710),
  ];
  const restated = tradesWithExchangeCost(trades, exchanges);
  for (const trade of restated) {
    assert.equal(Math.round(trade.amountMyr * 100) / 100, Math.round(trade.amountUsd * 4.3 * 100) / 100);
  }
  // Every ringgit converted is accounted for by the three buys.
  const total = restated.reduce((sum, trade) => sum + trade.amountMyr, 0);
  assert.ok(Math.abs(total - 860) < 0.01);
});

test("exchange: two conversions at different rates blend by weight, not by date order alone", () => {
  // 100 USD at 4.40 then 100 USD at 4.00. A 200 USD buy costs the average.
  const exchanges = [
    exchange("x1", "2026-04-01", 440, 100),
    exchange("x2", "2026-05-01", 400, 100),
  ];
  const [restated] = tradesWithExchangeCost([buy("t1", "2026-06-01", "VOO", 200, 700)], exchanges);
  assert.ok(Math.abs(restated.amountMyr - 840) < 0.01);
  assert.ok(Math.abs((restated.exchangeRate ?? 0) - 4.2) < 0.0001);
});

test("exchange: a conversion that follows a buy still settles it", () => {
  // Malaysian FX rules only permit converting ringgit AFTER a foreign-currency
  // buy order has filled, so buy-then-fund is the ordinary sequence — not a
  // late record to be ignored.
  const exchanges = [exchange("x1", "2026-06-01", 430, 100)];
  const trades = [buy("t1", "2026-04-01", "VOO", 100, 700)];
  const coverage = resolveExchangeCoverage(trades, exchanges);
  assert.equal(coverage.coveredUsd, 100);
  assert.equal(coverage.coverage, 1);
  const [restated] = tradesWithExchangeCost(trades, exchanges);
  assert.equal(Math.round(restated.amountMyr * 100) / 100, 430);
});

test("exchange: settlement pays the oldest unfunded buy first", () => {
  // Two fills, then one conversion that can only cover the first. The older
  // order is the one it settles; the newer one is left without evidence.
  const trades = [
    buy("t1", "2026-04-01", "VOO", 100, 700),
    buy("t2", "2026-04-20", "QQQM", 100, 290),
  ];
  const exchanges = [exchange("x1", "2026-05-01", 430, 100)];
  const coverage = resolveExchangeCoverage(trades, exchanges);
  assert.equal(coverage.costs.get("t1")!.uncoveredUsd, 0, "the older order is settled");
  assert.equal(coverage.costs.get("t2")!.uncoveredUsd, 100, "the newer one is not");
  assert.ok(Math.abs(coverage.coverage - 0.5) < 1e-9);

  const restated = tradesWithExchangeCost(trades, exchanges);
  assert.equal(Math.round(restated[0].amountMyr * 100) / 100, 430);
  // The unsettled order is still priced off that conversion — it is the nearest
  // real rate on file — but coverage above keeps saying it is an estimate.
  assert.equal(Math.round(restated[1].amountMyr * 100) / 100, 430);
  assert.notEqual(Math.round(restated[1].amountMyr * 100) / 100, Math.round(100 * IMPORT_RATE * 100) / 100);
});

test("exchange: unexplained dollars are priced off the nearest conversion, not the import", () => {
  // The cross-currency case: the broker converts at settlement and files no
  // exchange record, so these dollars have no conversion of their own. The
  // conversion five days away is the same market; the import rate is not.
  const exchanges = [exchange("x1", "2026-08-05", 41.20, 10)];
  const trades = [buy("t1", "2026-08-10", "QQQM", 100, 290)];
  const coverage = resolveExchangeCoverage(trades, exchanges);
  assert.ok(Math.abs(coverage.costs.get("t1")!.uncoveredUsd - 90) < 1e-9);

  const [restated] = tradesWithExchangeCost(trades, exchanges);
  assert.ok(Math.abs(restated.amountMyr - 100 * 4.12) < 0.01, `${restated.amountMyr}`);
});

test("exchange: a partly funded order blends the rate it paid with the nearest one", () => {
  // The pool still holds dollars bought in January at 4.30 when an August order
  // arrives; August's own conversion went at 4.12. The covered part costs what
  // it cost, the rest is estimated at August's rate, and the answer is neither
  // extreme.
  const exchanges = [
    exchange("x1", "2026-01-05", 430, 100),
    exchange("x2", "2026-08-05", 41.20, 10),
  ];
  const trades = [buy("t1", "2026-08-10", "VOO", 150, 700)];
  const [restated] = tradesWithExchangeCost(trades, exchanges);

  const pooled = (430 + 41.20) / 110;          // what the 110 covered dollars cost
  const nearest = 41.20 / 10;                   // August's rate, for the other 40
  const expected = 110 * pooled + 40 * nearest;
  assert.ok(Math.abs(restated.amountMyr - expected) < 0.01, `${restated.amountMyr} vs ${expected}`);
  assert.ok(restated.amountMyr > 150 * nearest, "above a flat August rate");
  assert.ok(restated.amountMyr < 150 * pooled, "below a flat pool rate");
});

test("exchange: recording the funding conversion turns an estimate into evidence", () => {
  // The figure barely moves — the estimate was already drawn from a nearby real
  // rate — but coverage goes from partial to complete, which is the fact the UI
  // reports. Convergence is about confidence, not only about the number.
  const trades = [buy("t1", "2026-04-10", "VOO", 100, 700)];
  const partial = [exchange("x1", "2026-04-01", 215, 50)];
  const complete = [exchange("x1", "2026-04-01", 430, 100)];

  assert.ok(Math.abs(resolveExchangeCoverage(trades, partial).coverage - 0.5) < 1e-9);
  assert.ok(Math.abs(resolveExchangeCoverage(trades, complete).coverage - 1) < 1e-9);

  // Both land on 4.30, because the estimate was that same conversion's rate.
  for (const exchanges of [partial, complete]) {
    const [restated] = tradesWithExchangeCost(trades, exchanges);
    assert.ok(Math.abs(restated.amountMyr - 430) < 0.01, `${restated.amountMyr}`);
  }
});

test("exchange: with no usable conversion at all, the trade keeps what it arrived with", () => {
  // A conversion list holding only a sale back into ringgit offers no rate to
  // price a purchase at, and inventing one is what this module refuses to do.
  const trades = [buy("t1", "2026-04-10", "VOO", 100, 700)];
  const onlyReverse: CurrencyExchange[] = [
    { id: "x1", date: "2026-04-01", direction: "usd-to-myr", myrAmount: 20.12, usdAmount: 4.99 },
  ];
  const [restated] = tradesWithExchangeCost(trades, onlyReverse);
  assert.equal(restated.amountMyr, 100 * IMPORT_RATE);
});

// --- Recycled dollars ------------------------------------------------------

test("exchange: sale proceeds stay in the account and fund the next buy", () => {
  // Convert once, spend it all, sell half, reinvest. The reinvestment is funded
  // by dollars already in the account — it is not an unfunded purchase.
  const exchanges = [exchange("x1", "2026-04-01", 430, 100)];
  const trades = [
    buy("t1", "2026-04-02", "VOO", 100, 700),
    sell("t2", "2026-05-01", "VOO", 50, 720),
    buy("t3", "2026-05-02", "QQQM", 50, 290),
  ];
  const coverage = resolveExchangeCoverage(trades, exchanges);
  assert.ok(Math.abs(coverage.coverage - 1) < 1e-9, `expected full coverage, got ${coverage.coverage}`);
  const restated = tradesWithExchangeCost(trades, exchanges);
  const reinvestment = restated.find((trade) => trade.id === "t3")!;
  // Recycled dollars carry the rate they were bought at, not a new one.
  assert.ok(Math.abs(reinvestment.amountMyr - 215) < 0.01);
});

test("exchange: a sell is stated at the rate its own dollars carried", () => {
  // Those proceeds never became ringgit — they land in the same USD balance and
  // are usually spent again the same afternoon. But a realised P&L has to be
  // quoted in some currency, and quoting it at the CSV import's rate would put
  // the realised and unrealised figures on one page in different currencies.
  const exchanges = [exchange("x1", "2026-04-01", 430, 100)];
  const trades = [buy("t1", "2026-04-02", "VOO", 100, 700), sell("t2", "2026-05-01", "VOO", 50, 720)];
  const restated = tradesWithExchangeCost(trades, exchanges);
  const sold = restated.find((trade) => trade.id === "t2")!;
  assert.ok(Math.abs(sold.amountMyr - 50 * 4.3) < 0.01, `${sold.amountMyr}`);
  assert.ok(Math.abs((sold.exchangeRate ?? 0) - 4.3) < 1e-9);
});

test("exchange: realised and unrealised P&L end up on the same rate", () => {
  // The gap this closes: a buy costed at 4.30 sitting beside a sale costed at
  // whatever rate happened to be live on import day.
  const exchanges = [exchange("x1", "2026-04-01", 430, 100)];
  const trades = [buy("t1", "2026-04-02", "VOO", 100, 700), sell("t2", "2026-05-01", "VOO", 40, 720)];
  const restated = tradesWithExchangeCost(trades, exchanges);
  const bought = restated.find((trade) => trade.id === "t1")!;
  const sold = restated.find((trade) => trade.id === "t2")!;
  assert.ok(Math.abs((bought.exchangeRate ?? 0) - (sold.exchangeRate ?? 0)) < 1e-9);
});

test("exchange: a sale with no conversions behind it is left alone, not guessed at", () => {
  // Nothing recorded, nothing to inherit — inventing a rate here is exactly
  // what this module exists to stop.
  const trades = [buy("t1", "2026-04-02", "VOO", 100, 700), sell("t2", "2026-05-01", "VOO", 50, 720)];
  const restated = tradesWithExchangeCost(trades, [exchange("x1", "2026-09-01", 430, 100)]);
  const sold = restated.find((trade) => trade.id === "t2")!;
  assert.equal(sold.amountMyr, 50 * IMPORT_RATE);
});

test("exchange: a round trip in one afternoon keeps every dollar accounted for", () => {
  // The real shape of 2026-04-06: buy, sell, buy back within twenty minutes.
  // The dollars never leave, so coverage must stay complete throughout.
  const exchanges = [exchange("x1", "2026-04-05", 247, 60.8)];
  const trades = [
    buy("t1", "2026-04-06", "VOO", 40.81, 604.54),
    sell("t2", "2026-04-06", "VOO", 45.62, 604.28),
    buy("t3", "2026-04-06", "VOO", 47.00, 604.11),
  ];
  const coverage = resolveExchangeCoverage(trades, exchanges);
  assert.ok(Math.abs(coverage.coverage - 1) < 1e-9, `coverage ${coverage.coverage}`);
  // And the sale is priced off the same conversion that funded the buys.
  const rate = 247 / 60.8;
  assert.ok(Math.abs((coverage.proceedsRates.get("t2") ?? 0) - rate) < 1e-9);
});

test("exchange: converting back to ringgit drains the balance without disturbing its rate", () => {
  const exchanges: CurrencyExchange[] = [
    exchange("x1", "2026-04-01", 430, 100),
    { id: "x2", date: "2026-04-15", direction: "usd-to-myr", myrAmount: 200, usdAmount: 50 },
  ];
  const [restated] = tradesWithExchangeCost([buy("t1", "2026-05-01", "VOO", 50, 700)], exchanges);
  // 50 dollars left, still costing 4.30 each. The 4.00 withdrawal rate is a
  // realised currency loss, not a change in what the remaining dollars cost.
  assert.ok(Math.abs(restated.amountMyr - 215) < 0.01);
});

// --- Reporting -------------------------------------------------------------

test("exchange: coverage reports what is known and what is left over", () => {
  const exchanges = [exchange("x1", "2026-04-01", 430, 100)];
  const trades = [buy("t1", "2026-04-02", "VOO", 60, 700)];
  const coverage = resolveExchangeCoverage(trades, exchanges);
  assert.equal(coverage.totalBuyUsd, 60);
  assert.equal(coverage.coveredUsd, 60);
  assert.ok(Math.abs(coverage.unspentUsd - 40) < 1e-9);
  assert.ok(Math.abs((coverage.averageRecordedRate ?? 0) - 4.3) < 1e-9);
});

test("exchange: the rate is derived from the two amounts, spread included", () => {
  assert.ok(Math.abs(exchangeRateOf({ myrAmount: 430, usdAmount: 100 }) - 4.3) < 1e-9);
  assert.equal(exchangeRateOf({ myrAmount: 430, usdAmount: 0 }), 0);
});

// --- Persistence hygiene ---------------------------------------------------

test("exchange: malformed records are dropped one by one, not in bulk", () => {
  const records = normalizeCurrencyExchanges([
    exchange("good", "2026-04-01", 430, 100),
    { id: "", date: "2026-04-01", direction: "myr-to-usd", myrAmount: 1, usdAmount: 1 },
    { id: "bad-date", date: "06/04/2026", direction: "myr-to-usd", myrAmount: 1, usdAmount: 1 },
    { id: "zero-usd", date: "2026-04-01", direction: "myr-to-usd", myrAmount: 430, usdAmount: 0 },
    null,
    "nonsense",
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, "good");
});

test("exchange: records are de-duplicated and returned in date order", () => {
  const records = normalizeCurrencyExchanges([
    exchange("x2", "2026-05-01", 400, 100),
    exchange("x1", "2026-04-01", 430, 100),
    exchange("x1", "2026-04-01", 430, 100),
  ]);
  assert.deepEqual(records.map((record) => record.id), ["x1", "x2"]);
});

test("exchange: an unspecified direction is read as money going into dollars", () => {
  const record = validateCurrencyExchange({ id: "x", date: "2026-04-01", myrAmount: 430, usdAmount: 100 });
  assert.equal(record?.direction, "myr-to-usd");
});

// --- End to end through the canonical snapshot -----------------------------

test("exchange: recorded conversions change what the portfolio says the ringgit return is", () => {
  // The real holdings, funded by one conversion at 4.30 — a rate that is
  // deliberately not the 4.105 the CSV import stamped on the trades.
  const trades: Trade[] = [
    { id: "voo", date: "2026-04-10", platform: "moomoo", ticker: "VOO", type: "DCA",
      units: 0.4599, priceUsd: 669.037, amountUsd: 307.69, amountMyr: 307.69 * IMPORT_RATE, feeMyr: 0 },
    { id: "qqqm", date: "2026-04-10", platform: "moomoo", ticker: "QQQM", type: "DCA",
      units: 0.4685, priceUsd: 285.08, amountUsd: 133.56, amountMyr: 133.56 * IMPORT_RATE, feeMyr: 0 },
  ];
  const withRecords = (exchanges: CurrencyExchange[]): WealthState => migrateState({
    deviceId: "device-exchange", trades, currencyExchanges: exchanges,
    dca: { monthly: 0, targets: { VOO: 0.7, QQQM: 0.3 } },
  });
  const snapshotOf = (state: WealthState) => getPortfolioSnapshot(state, new Date(2026, 7, 28), {
    prices: priceMapFrom([
      { ticker: "VOO", priceUsd: 707.878 },
      { ticker: "QQQM", priceUsd: 296.288 },
    ]),
    usdToMyr: 4.0327,
  });

  const guessed = snapshotOf(withRecords([]));
  const known = snapshotOf(withRecords([exchange("x1", "2026-04-01", 441.25 * 4.3, 441.25)]));

  // Dollars are untouched: the same shares, the same prices, the same USD return.
  assert.ok(Math.abs(known.unrealizedPnlUsd! - guessed.unrealizedPnlUsd!) < 0.01);
  assert.equal(known.totalInvestedUsd, guessed.totalInvestedUsd);

  // Ringgit changes, because the cost is now the money that actually left the
  // bank. A higher purchase rate means a worse ringgit return than the import
  // rate implied — and that loss is real, not an artefact.
  assert.ok(known.totalInvestedMyr > guessed.totalInvestedMyr);
  assert.ok(known.unrealizedPnlPercentMyr! < guessed.unrealizedPnlPercentMyr!);
  assert.ok(Math.abs(known.totalInvestedMyr - 441.25 * 4.3) < 0.01);
});
