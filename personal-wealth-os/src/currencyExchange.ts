/**
 * Currency exchange records — the conversions out of ringgit that actually
 * funded the portfolio.
 *
 * WHY THIS EXISTS
 *
 * A foreign-share order carries no exchange rate. The broker's order export is
 * priced purely in the listing's currency, because turning ringgit into dollars
 * (or Hong Kong or Singapore dollars) is a separate event with its own record.
 * Without those conversion records the ringgit cost of a holding is unknowable,
 * and every previous attempt to guess it (today's rate, the import day's rate,
 * the trade date's rate) produced a number the user never paid.
 *
 * Conversions usually come first — convert, then buy — but not always, and
 * records carry dates without times. Both orderings are supported and cost the
 * same; see resolveExchangeCoverage.
 *
 * This module holds the missing half of the story and derives from it the one
 * fact that matters: for each buy, how many ringgit were really spent.
 *
 * ONE POOL PER CURRENCY
 *
 * Each foreign currency is its own cash balance at the broker, so each gets its
 * own pool, fed only by conversions into that currency and drawn only by trades
 * priced in it. Dollars never fund a Hong Kong order and vice versa. Ringgit
 * trades need no pool at all: their ringgit cost is the amount itself.
 * Conversions between two foreign currencies are not pooled in V1.
 *
 * WHY A WEIGHTED-AVERAGE POOL, NOT FIFO LOTS
 *
 * Money in a cash balance is fungible. Once two conversions land in the same
 * account there is no fact of the matter about which dollars a later order
 * spent, so FIFO lot-tracking would invent precision rather than measure it.
 * A weighted-average pool matches how the balance behaves and, unlike FIFO,
 * handles recycled sale proceeds without extra bookkeeping: selling returns
 * money at the rate it already carries, which correctly leaves the average
 * untouched — that money was never converted back to ringgit, so its ringgit
 * cost has not changed.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never invents a rate for money no recorded conversion can account for.
 * That money is reported as uncovered and the caller keeps whatever figure the
 * trade already had. Coverage is surfaced so the UI can say how much of the
 * cost basis rests on a real rate, rather than quietly implying all of it does.
 *
 * Pure: imports only the domain types. No fetching, no persistence, no UI.
 */
import type { CurrencyExchange, ExchangeDirection, Trade } from "./models";
import { exchangeSides, normalizeTradeMarket, ringgitLeg, sidesOf } from "./tradeCurrency";

/** Max records kept, so the list cannot grow without bound. */
export const MAX_CURRENCY_EXCHANGES = 2000;

/**
 * The rate actually obtained — ringgit per unit of the foreign currency, spread
 * and conversion fee included. 0 when the record has no usable ringgit side.
 *
 * Derived rather than stored: the two amounts are what the statement shows, and
 * a stored rate could drift out of agreement with them.
 */
export function exchangeRateOf(exchange: Partial<CurrencyExchange>): number {
  const sides = sidesOf(exchange);
  const leg = sides ? ringgitLeg(sides) : null;
  return leg ? leg.myrAmount / leg.foreignAmount : 0;
}

/**
 * Validate and normalize one persisted record.
 * Returns null for anything malformed, so a single bad entry can be dropped
 * without taking the rest of the state down with it.
 */
export function validateCurrencyExchange(candidate: unknown): CurrencyExchange | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;

  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (typeof record.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return null;

  // Both sides must be real money. A zero on either side carries no rate, and a
  // rate is the only reason this record exists. One side must be ringgit: that
  // is what makes it a cost, and a foreign-to-foreign swap is not pooled in V1.
  const sides = sidesOf(record);
  if (!sides || !ringgitLeg(sides)) return null;

  // A ringgit ↔ dollar conversion keeps the fields every build reads, so an
  // older production build still sees it. See tradeCurrency.ts.
  const legacy = sides.fromCurrency === "MYR" && sides.toCurrency === "USD"
    ? { direction: "myr-to-usd" as ExchangeDirection, myrAmount: sides.fromAmount, usdAmount: sides.toAmount }
    : sides.fromCurrency === "USD" && sides.toCurrency === "MYR"
      ? { direction: "usd-to-myr" as ExchangeDirection, myrAmount: sides.toAmount, usdAmount: sides.fromAmount }
      : null;

  return {
    id: record.id.trim().slice(0, 120),
    date: record.date,
    ...(legacy ?? {}),
    ...(legacy ? exchangeSides(legacy) : sides),
    ...(typeof record.notes === "string" && record.notes.trim()
      ? { notes: record.notes.trim().slice(0, 200) }
      : {}),
  };
}

/** Normalize a persisted array: drop malformed entries, de-duplicate, sort by date. */
export function normalizeCurrencyExchanges(value: unknown): CurrencyExchange[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const records: CurrencyExchange[] = [];
  for (const candidate of value) {
    const record = validateCurrencyExchange(candidate);
    if (!record || seen.has(record.id)) continue;
    if (records.length >= MAX_CURRENCY_EXCHANGES) break;
    seen.add(record.id);
    records.push(record);
  }
  return records.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** What one buy really cost in ringgit, and how much of that is known. */
export interface ResolvedTradeCost {
  tradeId: string;
  /** The currency the buy was priced in, and so the pool it drew on. */
  currency: string;
  /** Amount of `currency` the buy spent. */
  spent: number;
  /** MYR drawn from recorded conversions, funding `spent - uncovered`. */
  costMyr: number;
  /** Amount of `currency` that no recorded conversion could account for. */
  uncovered: number;
  /** MYR per unit of `currency` for the covered part, or null when nothing was covered. */
  effectiveRate: number | null;
}

/** How well recorded conversions explain the buys in one currency. */
export interface CurrencyCoverage {
  currency: string;
  /** Spent across every buy in this currency. */
  totalBuy: number;
  /** How much of that was funded by a recorded conversion. */
  covered: number;
  /** covered / totalBuy, 0..1. 1 means every unit is traced. */
  coverage: number;
  /** Weighted MYR per unit across every conversion into this currency, or null. */
  averageRecordedRate: number | null;
  /** Converted but not yet invested. */
  unspent: number;
}

/** The portfolio-wide picture of how well conversions explain the buys. */
export interface ExchangeCoverage {
  /** Per-buy resolution, keyed by trade id. Sells and ringgit trades are not included. */
  costs: Map<string, ResolvedTradeCost>;
  /**
   * The ringgit per unit the balance carried when each sale's proceeds
   * returned to it, keyed by trade id.
   *
   * A sale converts nothing: the money lands in the same cash balance and
   * usually goes straight back into shares. But a realised P&L still has to be
   * stated in some currency, and stating it at a rate the user never touched
   * makes it disagree with the unrealised figure beside it. This is the rate
   * that money actually cost, which is the only defensible one.
   */
  proceedsRates: Map<string, number>;
  /** Coverage for every foreign currency that was bought in or converted into. */
  byCurrency: Map<string, CurrencyCoverage>;

  // --- The dollar pool, as the Portfolio page reports it. ---
  /** USD spent across every dollar buy. */
  totalBuyUsd: number;
  /** How much of that was funded by a recorded conversion. */
  coveredUsd: number;
  /** coveredUsd / totalBuyUsd, 0..1. 1 means every dollar is traced. */
  coverage: number;
  /** Weighted MYR/USD across every recorded MYR→USD conversion, or null. */
  averageRecordedRate: number | null;
  /** Dollars converted but not yet invested. */
  unspentUsd: number;
}

/** A buy still waiting to be paid for, oldest first. */
interface Shortfall {
  tradeId: string;
  amount: number;
}

/** One foreign currency's cash balance and everything tracked against it. */
interface Pool {
  /** Units of the currency in the balance. */
  units: number;
  /** What those units cost in ringgit. */
  myr: number;
  shortfalls: Shortfall[];
  totalBuy: number;
  covered: number;
  recordedUnits: number;
  recordedMyr: number;
}

function emptyPool(): Pool {
  return { units: 0, myr: 0, shortfalls: [], totalBuy: 0, covered: 0, recordedUnits: 0, recordedMyr: 0 };
}

/** MYR per unit currently sitting in the pool, or null when it is empty. */
function poolRate(pool: Pool): number | null {
  return pool.units > 1e-9 ? pool.myr / pool.units : null;
}

type TimelineEntry =
  | { kind: "exchange"; date: string; order: number; exchange: CurrencyExchange }
  | { kind: "trade"; date: string; order: number; trade: Trade };

/**
 * Walk conversions and trades together in date order, tracking each foreign
 * cash balance and what it cost in ringgit.
 *
 * EITHER ORDERING WORKS
 *
 * The usual sequence is fund-then-buy: convert ringgit, then place the order.
 * But the reverse happens too — Moomoo's own exchange screen notes that
 * Malaysian rules may only permit converting ringgit once a foreign-currency
 * buy order has filled, which makes the conversion a settlement that follows
 * the fill. Records also arrive with dates but no times, so a conversion and
 * the order it paid for can land on one day in either order.
 *
 * So a buy draws on whatever its currency's balance already holds, and anything
 * it cannot cover becomes a shortfall. Later conversions into that currency pay
 * shortfalls off oldest-first before adding to the balance. Both orderings
 * therefore produce the same cost for the same money, and same-date ties do not
 * matter — a property worth keeping, and pinned by a test.
 */
export function resolveExchangeCoverage(
  trades: Trade[],
  exchanges: CurrencyExchange[],
): ExchangeCoverage {
  const timeline: TimelineEntry[] = [
    ...exchanges.map((exchange, index): TimelineEntry =>
      ({ kind: "exchange", date: exchange.date, order: index, exchange })),
    ...trades.map((trade, index): TimelineEntry =>
      ({ kind: "trade", date: trade.date, order: index, trade })),
  ].sort((a, b) =>
    a.date.localeCompare(b.date)
    // Conversions first on a shared date: funding before buying is the usual
    // sequence. The shortfall settlement below makes this tie-break immaterial
    // to the resulting cost, so it is a statement of intent, not a load-bearing
    // rule.
    || (a.kind === b.kind ? a.order - b.order : a.kind === "exchange" ? -1 : 1));

  const pools = new Map<string, Pool>();
  const poolFor = (currency: string): Pool => {
    let pool = pools.get(currency);
    if (!pool) {
      pool = emptyPool();
      pools.set(currency, pool);
    }
    return pool;
  };
  const costs = new Map<string, ResolvedTradeCost>();
  const proceedsRates = new Map<string, number>();

  /**
   * Apply incoming money to the buys still waiting to be paid for, oldest
   * first, and return whatever is left over. Settling backwards is the whole
   * point: it is how a post-fill conversion reaches the order it settles.
   */
  const settleShortfalls = (pool: Pool, available: number, rate: number): number => {
    let remaining = available;
    while (remaining > 1e-9 && pool.shortfalls.length > 0) {
      const oldest = pool.shortfalls[0];
      const applied = Math.min(remaining, oldest.amount);
      const cost = costs.get(oldest.tradeId);
      if (cost) {
        cost.costMyr += applied * rate;
        cost.uncovered -= applied;
        pool.covered += applied;
      }
      oldest.amount -= applied;
      remaining -= applied;
      if (oldest.amount <= 1e-9) pool.shortfalls.shift();
    }
    return remaining;
  };

  for (const entry of timeline) {
    if (entry.kind === "exchange") {
      const sides = sidesOf(entry.exchange);
      const leg = sides ? ringgitLeg(sides) : null;
      if (!leg) continue;
      const pool = poolFor(leg.currency);
      if (leg.intoForeign) {
        pool.recordedUnits += leg.foreignAmount;
        pool.recordedMyr += leg.myrAmount;
        const rate = leg.myrAmount / leg.foreignAmount;
        // Settlement first, surplus second.
        const surplus = settleShortfalls(pool, leg.foreignAmount, rate);
        pool.units += surplus;
        pool.myr += surplus * rate;
        continue;
      }
      // Converting back to ringgit removes money at what it cost. Whatever was
      // gained or lost on the currency is realised there; it is not a portfolio
      // cost, so it never touches a holding's basis.
      const rate = poolRate(pool);
      const drawn = Math.min(leg.foreignAmount, pool.units);
      if (rate !== null && drawn > 0) {
        pool.units -= drawn;
        pool.myr -= drawn * rate;
      }
      continue;
    }

    const trade = normalizeTradeMarket(entry.trade);
    const currency = trade.currency ?? "USD";
    // A ringgit trade's cost is its own amount. There is nothing to trace.
    if (currency === "MYR") continue;
    const spent = Number.isFinite(trade.amount) ? Math.max(trade.amount as number, 0) : 0;
    if (spent <= 0) continue;
    const pool = poolFor(currency);

    if (trade.type === "Sell") {
      // Proceeds re-enter the balance carrying the ringgit cost that money
      // already had, so recycling it does not restate what was paid.
      //
      // A fully spent balance is the common case here, not an edge one: buy,
      // sell, reinvest leaves the pool empty at the moment of the sale. Falling
      // back to the average of the conversions recorded so far keeps that money
      // in the account, where it demonstrably is. Dropping it would make the
      // reinvestment look unfunded and quietly understate coverage; and with a
      // single conversion rate the fallback is not an approximation at all, it
      // is the same number.
      const rate = poolRate(pool)
        ?? (pool.recordedUnits > 0 ? pool.recordedMyr / pool.recordedUnits : null);
      if (rate !== null) {
        proceedsRates.set(trade.id, rate);
        const surplus = settleShortfalls(pool, spent, rate);
        pool.units += surplus;
        pool.myr += surplus * rate;
      }
      continue;
    }

    const rate = poolRate(pool);
    const drawn = rate === null ? 0 : Math.min(spent, pool.units);
    const costMyr = rate === null ? 0 : drawn * rate;
    pool.units -= drawn;
    pool.myr -= costMyr;

    pool.totalBuy += spent;
    pool.covered += drawn;
    costs.set(trade.id, {
      tradeId: trade.id,
      currency,
      spent,
      costMyr,
      uncovered: spent - drawn,
      // Filled in once the walk is over: a conversion that settles this buy has
      // not necessarily happened yet.
      effectiveRate: null,
    });
    if (spent - drawn > 1e-9) pool.shortfalls.push({ tradeId: trade.id, amount: spent - drawn });
  }

  // Only now is each buy's funding final, so the rate it actually paid can be
  // stated. A buy nothing ever settled has no rate — not a rate of zero.
  for (const cost of costs.values()) {
    const covered = cost.spent - cost.uncovered;
    cost.effectiveRate = covered > 1e-9 ? cost.costMyr / covered : null;
  }

  const byCurrency = new Map<string, CurrencyCoverage>();
  for (const [currency, pool] of pools) {
    byCurrency.set(currency, {
      currency,
      totalBuy: pool.totalBuy,
      covered: pool.covered,
      coverage: pool.totalBuy > 0 ? pool.covered / pool.totalBuy : 0,
      averageRecordedRate: pool.recordedUnits > 0 ? pool.recordedMyr / pool.recordedUnits : null,
      unspent: Math.max(pool.units, 0),
    });
  }
  const usd = byCurrency.get("USD");

  return {
    costs,
    proceedsRates,
    byCurrency,
    totalBuyUsd: usd?.totalBuy ?? 0,
    coveredUsd: usd?.covered ?? 0,
    coverage: usd?.coverage ?? 0,
    averageRecordedRate: usd?.averageRecordedRate ?? null,
    unspentUsd: usd?.unspent ?? 0,
  };
}

/**
 * The rate from the recorded conversion into `currency` closest in time to a
 * given date.
 *
 * This is what prices money no conversion explains — cross-currency orders,
 * where the broker converts at settlement and files no separate exchange
 * record. Those conversions happen the same day as the fill, so the nearest
 * manual conversion is a close read of the same market. It is an estimate, but
 * an estimate from the user's own statement, which beats the rate that happened
 * to be live when a CSV was imported months later.
 */
function nearestConversionRate(date: string, currency: string, exchanges: CurrencyExchange[]): number | null {
  const when = Date.parse(date.slice(0, 10));
  if (Number.isNaN(when)) return null;
  let best: number | null = null;
  let bestGap = Infinity;
  for (const exchange of exchanges) {
    const sides = sidesOf(exchange);
    const leg = sides ? ringgitLeg(sides) : null;
    if (!leg || !leg.intoForeign || leg.currency !== currency) continue;
    const gap = Math.abs(Date.parse(exchange.date) - when);
    if (!Number.isNaN(gap) && gap < bestGap) {
      bestGap = gap;
      best = leg.myrAmount / leg.foreignAmount;
    }
  }
  return best;
}

/**
 * A fee recorded in the trade's own currency, stated in ringgit at the rate the
 * trade itself was costed at — never at a rate of its own. A ringgit fee, or
 * one with no rate to carry it, keeps the feeMyr it arrived with.
 */
function withFeeInRinggit(trade: Trade, rate: number | null): Trade {
  const normalized = normalizeTradeMarket(trade);
  if (normalized.feeCurrency === "MYR" || normalized.feeCurrency !== normalized.currency) return trade;
  if (rate === null || !(rate > 0) || !Number.isFinite(normalized.fee)) return trade;
  return { ...trade, feeMyr: (normalized.fee as number) * rate };
}

/**
 * Restate each trade's ringgit cost using the conversions that funded it.
 *
 * A ringgit trade costs its own amount, and its fee is already in ringgit.
 *
 * For a foreign trade, money a conversion funded is costed at what that
 * conversion cost. Money none explains — cross-currency orders, settled by the
 * broker without a separate record — is costed at the nearest conversion into
 * the same currency instead, which is the same market days apart rather than a
 * rate from an unrelated month. With no conversion to reach for at all, the
 * trade keeps the ringgit figure it arrived with.
 *
 * Coverage still reports that money as uncovered: a better estimate is not the
 * same as evidence, and the UI should keep saying which is which.
 *
 * Sells are restated too, at the rate the returning money carried. Their
 * proceeds never became ringgit — the money lands in the same balance and is
 * usually spent again within minutes — but a realised P&L has to be quoted in
 * something, and quoting it at the rate stamped by a CSV import leaves the
 * realised and unrealised figures on one page resting on different currencies.
 * A sale with no rate to inherit is left alone rather than guessed at.
 *
 * A portfolio of dollar trades with no conversions recorded is returned as the
 * very same array: there is nothing to restate.
 */
export function tradesWithExchangeCost(
  trades: Trade[],
  exchanges: CurrencyExchange[],
): Trade[] {
  const needsWork = exchanges.length > 0
    || trades.some((trade) => normalizeTradeMarket(trade).currency !== "USD");
  if (!needsWork) return trades;
  const { costs, proceedsRates } = resolveExchangeCoverage(trades, exchanges);

  return trades.map((original) => {
    const trade = normalizeTradeMarket(original);
    const currency = trade.currency ?? "USD";
    const amount = trade.amount ?? 0;

    if (currency === "MYR") {
      return { ...original, amountMyr: amount, exchangeRate: 1 };
    }

    if (trade.type === "Sell") {
      const rate = proceedsRates.get(trade.id);
      if (rate === undefined || !(amount > 0)) return original;
      return withFeeInRinggit({ ...original, amountMyr: amount * rate, exchangeRate: rate }, rate);
    }
    const resolved = costs.get(trade.id);
    if (!resolved || resolved.spent <= 0) return original;

    // Price the unexplained money off the nearest conversion. With no
    // conversion to reach for, the trade keeps the figure it arrived with,
    // scaled to the part of the order still unexplained.
    const nearest = nearestConversionRate(trade.date, currency, exchanges);
    const uncoveredMyr = nearest !== null
      ? resolved.uncovered * nearest
      : (resolved.uncovered / resolved.spent) * trade.amountMyr;
    if (resolved.effectiveRate === null && nearest === null) return original;
    const amountMyr = resolved.costMyr + uncoveredMyr;
    const rate = amount > 0 ? amountMyr / amount : (resolved.effectiveRate ?? nearest ?? undefined);
    return withFeeInRinggit({ ...original, amountMyr, exchangeRate: rate }, rate ?? null);
  });
}
