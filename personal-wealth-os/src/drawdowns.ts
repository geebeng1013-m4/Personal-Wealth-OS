/**
 * Historical context for a single asset: how far it has fallen, how long it
 * took to come back, and what holding it for a year or three has been worth.
 *
 * WHY THIS AND NOT AN EVENT CALENDAR
 *
 * The Market page states its own purpose — understand ownership and risk,
 * "not to react to daily noise" — and then offered a calendar of upcoming
 * economic releases, which is an invitation to do exactly that. What actually
 * helps someone deciding whether to keep buying through a decline is evidence
 * about declines: that they have happened five times in ten years, that the
 * worst took fifteen months to recover, and that the odds of being down shrink
 * from one-in-six over a year to almost nothing over three.
 *
 * It also connects to the user's own rules. A plan with tranches at -10%, -15%
 * and -20% is a plan about events whose real frequency is knowable, and knowing
 * it is the difference between reserving cash for something that happens every
 * few years and reserving it for something that never comes.
 *
 * The core is pure: a price series in, facts out — no formatting, no clock
 * beyond the timestamps supplied. The one exception is assetDrawdownBelow()
 * at the end, a convenience that fetches the series first.
 */

import { fetchHistoricalPrices } from "./market";

/** One close, as the price history provides it. */
export interface PricePoint {
  /** Epoch milliseconds. */
  time: number;
  close: number;
}

/** A peak-to-trough decline, and how long the round trip took. */
export interface Drawdown {
  /** When the prior high was set. */
  startedAt: number;
  /** Deepest point, as a negative fraction: -0.343 = -34.3%. */
  depth: number;
  troughAt: number;
  /**
   * When the prior high was regained, or null while still under water.
   * Null is the honest answer for a decline that has not ended, and callers
   * must not read it as "recovered instantly".
   */
  recoveredAt: number | null;
  /** Calendar days from the high to the trough. */
  daysToTrough: number;
  /** Calendar days from the trough back to the high, or null if not yet. */
  daysToRecover: number | null;
}

/** What holding for a fixed span has produced, across every start date on file. */
export interface HoldingOutcome {
  years: number;
  /** How many distinct start dates the window fits in. */
  samples: number;
  /** Share of those that ended below where they started, 0..1. */
  lossRate: number;
  worst: number;
  median: number;
  best: number;
}

export interface AssetHistory {
  /** Declines of at least the requested threshold, oldest first. */
  drawdowns: Drawdown[];
  /** How far below the running high the last close sits. 0 when at a high. */
  currentDrawdown: number;
  /** Outcomes for each holding period requested, in the order requested. */
  outcomes: HoldingOutcome[];
  firstAt: number;
  lastAt: number;
  /** Trading days in the series. */
  observations: number;
}

const DAY_MS = 86_400_000;

const days = (from: number, to: number): number => Math.max(0, Math.round((to - from) / DAY_MS));

/**
 * Every decline of at least `threshold` below a running high.
 *
 * A new high closes whatever decline was open, which is what makes the periods
 * non-overlapping: one recovery ends one drawdown, and the next peak starts the
 * clock again. A decline still under water at the end of the series is reported
 * with a null recovery rather than being dropped, because an unfinished
 * drawdown is the one a holder is most likely to be sitting in.
 */
export function findDrawdowns(points: PricePoint[], threshold = 0.10): Drawdown[] {
  if (points.length === 0) return [];
  const found: Drawdown[] = [];
  let peak = points[0].close;
  let peakAt = points[0].time;
  let depth = 0;
  let troughAt = points[0].time;

  for (const point of points) {
    if (point.close >= peak) {
      if (depth <= -threshold) {
        found.push({
          startedAt: peakAt,
          depth,
          troughAt,
          recoveredAt: point.time,
          daysToTrough: days(peakAt, troughAt),
          daysToRecover: days(troughAt, point.time),
        });
      }
      peak = point.close;
      peakAt = point.time;
      depth = 0;
      troughAt = point.time;
      continue;
    }
    const fall = point.close / peak - 1;
    if (fall < depth) {
      depth = fall;
      troughAt = point.time;
    }
  }

  if (depth <= -threshold) {
    found.push({
      startedAt: peakAt,
      depth,
      troughAt,
      recoveredAt: null,
      daysToTrough: days(peakAt, troughAt),
      daysToRecover: null,
    });
  }
  return found;
}

/**
 * What every possible start date would have produced over a fixed holding span.
 *
 * Windows overlap heavily, so these are not independent samples and the loss
 * rate is not a probability in any strict sense — it is "how often, in this
 * history, a buyer at a random moment was still down after N years". That is
 * the question someone paying in monthly is actually asking.
 *
 * Returns null when the series is too short to contain even one full window,
 * rather than reporting a rate computed from nothing.
 */
export function holdingOutcome(
  points: PricePoint[],
  years: number,
  tradingDaysPerYear = 252,
): HoldingOutcome | null {
  const span = Math.round(tradingDaysPerYear * years);
  if (span <= 0 || points.length <= span) return null;

  const returns: number[] = [];
  for (let index = 0; index + span < points.length; index++) {
    const start = points[index].close;
    if (start > 0) returns.push(points[index + span].close / start - 1);
  }
  if (returns.length === 0) return null;

  const sorted = [...returns].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    years,
    samples: sorted.length,
    lossRate: sorted.filter((value) => value < 0).length / sorted.length,
    worst: sorted[0],
    median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    best: sorted[sorted.length - 1],
  };
}

/**
 * How often a decline reached a given depth, and how long those took to mend.
 *
 * Built for the tranche thresholds a user has configured: a reserve earmarked
 * for a 20% fall is worth sizing differently depending on whether that happens
 * every few years or once a generation.
 */
export function triggerHistory(
  drawdowns: Drawdown[],
  threshold: number,
): { threshold: number; occurrences: number; medianRecoveryDays: number | null } {
  const hits = drawdowns.filter((item) => item.depth <= -threshold);
  const recoveries = hits
    .map((item) => item.daysToRecover)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    threshold,
    occurrences: hits.length,
    medianRecoveryDays: recoveries.length === 0
      ? null
      : recoveries[Math.floor(recoveries.length / 2)],
  };
}

/** Everything the Context panel needs, from one price series. */
export function buildAssetHistory(
  points: PricePoint[],
  options: { threshold?: number; holdingYears?: number[] } = {},
): AssetHistory | null {
  const clean = points
    .filter((point) => Number.isFinite(point.close) && point.close > 0 && Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);
  if (clean.length < 2) return null;

  const drawdowns = findDrawdowns(clean, options.threshold ?? 0.10);
  const outcomes = (options.holdingYears ?? [1, 3, 5])
    .map((years) => holdingOutcome(clean, years))
    .filter((outcome): outcome is HoldingOutcome => outcome !== null);

  // Distance below the highest close seen, which is what a holder feels today.
  const high = clean.reduce((max, point) => Math.max(max, point.close), clean[0].close);
  const last = clean[clean.length - 1].close;

  return {
    drawdowns,
    currentDrawdown: high > 0 ? Math.min(0, last / high - 1) : 0,
    outcomes,
    firstAt: clean[0].time,
    lastAt: clean[clean.length - 1].time,
    observations: clean.length,
  };
}

// --- One-call helper for pages that only need the current drawdown ---------

/**
 * How far an asset is below its all-time high right now, as a positive number
 * of percentage points (2.1 = 2.1% below the peak). null on a failed fetch or
 * too little history. Same series the Context panel reads; used by the
 * Advisor dip-buy ladder and the Dashboard's dip-buy watch.
 */
export async function assetDrawdownBelow(symbol: string): Promise<number | null> {
  try {
    const prices = await fetchHistoricalPrices(symbol, "10y");
    const history = buildAssetHistory(
      prices.map((point) => ({ time: Date.parse(point.date), close: point.close })),
      { threshold: 0.1 },
    );
    return history ? -history.currentDrawdown * 100 : null;
  } catch {
    return null;
  }
}
