/**
 * Currency exchange records — the MYR→USD conversions that actually funded the
 * portfolio.
 *
 * WHY THIS EXISTS
 *
 * A US-share order carries no exchange rate. The broker's order export is pure
 * USD, because turning ringgit into dollars is a separate event with its own
 * record. Without those conversion records the ringgit cost of a holding is
 * unknowable, and every previous attempt to guess it (today's rate, the import
 * day's rate, the trade date's rate) produced a number the user never paid.
 *
 * Conversions usually come first — convert, then buy — but not always, and
 * records carry dates without times. Both orderings are supported and cost the
 * same; see resolveExchangeCoverage.
 *
 * This module holds the missing half of the story and derives from it the one
 * fact that matters: for each buy, how many ringgit were really spent.
 *
 * WHY A WEIGHTED-AVERAGE POOL, NOT FIFO LOTS
 *
 * Dollars in a cash balance are fungible. Once two conversions land in the same
 * account there is no fact of the matter about which dollars a later order
 * spent, so FIFO lot-tracking would invent precision rather than measure it.
 * A weighted-average pool matches how the balance behaves and, unlike FIFO,
 * handles recycled sale proceeds without extra bookkeeping: selling returns
 * dollars at the rate they already carry, which correctly leaves the average
 * untouched — that money was never converted back to ringgit, so its ringgit
 * cost has not changed.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never invents a rate for dollars no recorded conversion can account for.
 * Those dollars are reported as uncovered and the caller keeps whatever figure
 * the trade already had. Coverage is surfaced so the UI can say how much of the
 * cost basis rests on a real rate, rather than quietly implying all of it does.
 *
 * Pure: imports only the domain types. No fetching, no persistence, no UI.
 */
import type { CurrencyExchange, ExchangeDirection, Trade } from "./models";

/** Max records kept, so the list cannot grow without bound. */
export const MAX_CURRENCY_EXCHANGES = 2000;

const DIRECTIONS: ExchangeDirection[] = ["myr-to-usd", "usd-to-myr"];

function isDirection(value: unknown): value is ExchangeDirection {
  return typeof value === "string" && DIRECTIONS.includes(value as ExchangeDirection);
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The rate actually obtained, spread and conversion fee included.
 *
 * Derived rather than stored: the two amounts are what the statement shows, and
 * a stored rate could drift out of agreement with them.
 */
export function exchangeRateOf(exchange: Pick<CurrencyExchange, "myrAmount" | "usdAmount">): number {
  return exchange.usdAmount > 0 ? exchange.myrAmount / exchange.usdAmount : 0;
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
  // rate is the only reason this record exists.
  if (!isPositive(record.myrAmount) || !isPositive(record.usdAmount)) return null;

  return {
    id: record.id.trim().slice(0, 120),
    date: record.date,
    direction: isDirection(record.direction) ? record.direction : "myr-to-usd",
    myrAmount: record.myrAmount,
    usdAmount: record.usdAmount,
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

/** What one buy's dollars really cost in ringgit, and how much of that is known. */
export interface ResolvedTradeCost {
  tradeId: string;
  /** USD the buy spent. */
  usdSpent: number;
  /** MYR drawn from recorded conversions, funding `usdSpent - uncoveredUsd`. */
  costMyr: number;
  /** USD that no recorded conversion could account for. */
  uncoveredUsd: number;
  /** MYR per USD for the covered part, or null when nothing was covered. */
  effectiveRate: number | null;
}

/** The portfolio-wide picture of how well conversions explain the buys. */
export interface ExchangeCoverage {
  /** Per-buy resolution, keyed by trade id. Sells are not included. */
  costs: Map<string, ResolvedTradeCost>;
  /**
   * The ringgit-per-dollar the balance carried when each sale's proceeds
   * returned to it, keyed by trade id.
   *
   * A sale converts nothing: the dollars land in the same cash balance and
   * usually go straight back into shares. But a realised P&L still has to be
   * stated in some currency, and stating it at a rate the user never touched
   * makes it disagree with the unrealised figure beside it. This is the rate
   * those dollars actually cost, which is the only defensible one.
   */
  proceedsRates: Map<string, number>;
  /** USD spent across every buy. */
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

interface Pool {
  usd: number;
  myr: number;
}

/** MYR per USD currently sitting in the pool, or null when it is empty. */
function poolRate(pool: Pool): number | null {
  return pool.usd > 1e-9 ? pool.myr / pool.usd : null;
}

type TimelineEntry =
  | { kind: "exchange"; date: string; order: number; exchange: CurrencyExchange }
  | { kind: "trade"; date: string; order: number; trade: Trade };

/** A buy still waiting to be paid for, oldest first. */
interface Shortfall {
  tradeId: string;
  usd: number;
}

/**
 * Walk conversions and trades together in date order, tracking the USD cash
 * balance and what it cost in ringgit.
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
 * So a buy draws on whatever dollars are already in the balance, and anything
 * it cannot cover becomes a shortfall. Later conversions pay shortfalls off
 * oldest-first before adding to the balance. Both orderings therefore produce
 * the same cost for the same money, and same-date ties do not matter — a
 * property worth keeping, and pinned by a test.
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

  const pool: Pool = { usd: 0, myr: 0 };
  const costs = new Map<string, ResolvedTradeCost>();
  const proceedsRates = new Map<string, number>();
  const shortfalls: Shortfall[] = [];
  let totalBuyUsd = 0;
  let coveredUsd = 0;
  let recordedUsd = 0;
  let recordedMyr = 0;

  /**
   * Apply incoming dollars to the buys still waiting to be paid for, oldest
   * first, and return whatever is left over. Settling backwards is the whole
   * point: it is how a post-fill conversion reaches the order it settles.
   */
  const settleShortfalls = (usdAvailable: number, rate: number): number => {
    let remaining = usdAvailable;
    while (remaining > 1e-9 && shortfalls.length > 0) {
      const oldest = shortfalls[0];
      const applied = Math.min(remaining, oldest.usd);
      const cost = costs.get(oldest.tradeId);
      if (cost) {
        cost.costMyr += applied * rate;
        cost.uncoveredUsd -= applied;
        coveredUsd += applied;
      }
      oldest.usd -= applied;
      remaining -= applied;
      if (oldest.usd <= 1e-9) shortfalls.shift();
    }
    return remaining;
  };

  for (const entry of timeline) {
    if (entry.kind === "exchange") {
      const { exchange } = entry;
      if (exchange.direction === "myr-to-usd") {
        recordedUsd += exchange.usdAmount;
        recordedMyr += exchange.myrAmount;
        const rate = exchangeRateOf(exchange);
        // Settlement first, surplus second.
        const surplus = settleShortfalls(exchange.usdAmount, rate);
        pool.usd += surplus;
        pool.myr += surplus * rate;
        continue;
      }
      // Converting back to ringgit removes dollars at what they cost. Whatever
      // was gained or lost on the currency is realised there; it is not a
      // portfolio cost, so it never touches a holding's basis.
      const rate = poolRate(pool);
      const drawn = Math.min(exchange.usdAmount, pool.usd);
      if (rate !== null && drawn > 0) {
        pool.usd -= drawn;
        pool.myr -= drawn * rate;
      }
      continue;
    }

    const { trade } = entry;
    const usd = Number.isFinite(trade.amountUsd) ? Math.max(trade.amountUsd, 0) : 0;
    if (usd <= 0) continue;

    if (trade.type === "Sell") {
      // Proceeds re-enter the balance carrying the ringgit cost those dollars
      // already had, so recycling them does not restate what was paid.
      //
      // A fully spent balance is the common case here, not an edge one: buy,
      // sell, reinvest leaves the pool empty at the moment of the sale. Falling
      // back to the average of the conversions recorded so far keeps those
      // dollars in the account, where they demonstrably are. Dropping them
      // would make the reinvestment look unfunded and quietly understate
      // coverage; and with a single conversion rate the fallback is not an
      // approximation at all, it is the same number.
      const rate = poolRate(pool)
        ?? (recordedUsd > 0 ? recordedMyr / recordedUsd : null);
      if (rate !== null) {
        proceedsRates.set(trade.id, rate);
        const surplus = settleShortfalls(usd, rate);
        pool.usd += surplus;
        pool.myr += surplus * rate;
      }
      continue;
    }

    const rate = poolRate(pool);
    const drawn = rate === null ? 0 : Math.min(usd, pool.usd);
    const costMyr = rate === null ? 0 : drawn * rate;
    pool.usd -= drawn;
    pool.myr -= costMyr;

    totalBuyUsd += usd;
    coveredUsd += drawn;
    costs.set(trade.id, {
      tradeId: trade.id,
      usdSpent: usd,
      costMyr,
      uncoveredUsd: usd - drawn,
      // Filled in once the walk is over: a conversion that settles this buy has
      // not necessarily happened yet.
      effectiveRate: null,
    });
    if (usd - drawn > 1e-9) shortfalls.push({ tradeId: trade.id, usd: usd - drawn });
  }

  // Only now is each buy's funding final, so the rate it actually paid can be
  // stated. A buy nothing ever settled has no rate — not a rate of zero.
  for (const cost of costs.values()) {
    const covered = cost.usdSpent - cost.uncoveredUsd;
    cost.effectiveRate = covered > 1e-9 ? cost.costMyr / covered : null;
  }

  return {
    costs,
    proceedsRates,
    totalBuyUsd,
    coveredUsd,
    coverage: totalBuyUsd > 0 ? coveredUsd / totalBuyUsd : 0,
    averageRecordedRate: recordedUsd > 0 ? recordedMyr / recordedUsd : null,
    unspentUsd: Math.max(pool.usd, 0),
  };
}

/**
 * Restate each buy's ringgit cost using the conversions that funded it.
 *
 * Trades keep their own `amountMyr` for any dollars no conversion explains, so
 * a portfolio with no records behaves exactly as before, and one with partial
 * records improves only where there is evidence. The figure converges on the
 * truth as more conversions are recorded; it never jumps to it.
 *
 * Sells are restated too, at the rate the returning dollars carried. Their
 * proceeds never became ringgit — the money lands in the same USD balance and
 * is usually spent again within minutes — but a realised P&L has to be quoted
 * in something, and quoting it at the rate stamped by a CSV import leaves the
 * realised and unrealised figures on one page resting on different currencies.
 * A sale with no rate to inherit is left alone rather than guessed at.
 */
export function tradesWithExchangeCost(
  trades: Trade[],
  exchanges: CurrencyExchange[],
): Trade[] {
  if (exchanges.length === 0) return trades;
  const { costs, proceedsRates } = resolveExchangeCoverage(trades, exchanges);

  return trades.map((trade) => {
    if (trade.type === "Sell") {
      const rate = proceedsRates.get(trade.id);
      if (rate === undefined || !(trade.amountUsd > 0)) return trade;
      return { ...trade, amountMyr: trade.amountUsd * rate, exchangeRate: rate };
    }
    const resolved = costs.get(trade.id);
    if (!resolved || resolved.usdSpent <= 0 || resolved.effectiveRate === null) return trade;

    // The unexplained share keeps the trade's existing ringgit figure, scaled
    // to the part of the order it still covers.
    const uncoveredShare = resolved.uncoveredUsd / resolved.usdSpent;
    const amountMyr = resolved.costMyr + uncoveredShare * trade.amountMyr;
    return {
      ...trade,
      amountMyr,
      exchangeRate: trade.amountUsd > 0 ? amountMyr / trade.amountUsd : resolved.effectiveRate,
    };
  });
}
