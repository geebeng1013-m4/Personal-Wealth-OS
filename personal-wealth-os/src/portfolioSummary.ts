/**
 * Canonical Portfolio read model.
 *
 * Answers one question: WHAT IS MY INVESTMENT POSITION?
 *
 * Facts only — holdings, cost basis, realised P&L, allocation and drift.
 * No advice, no recommendations, no HTML. Turning a drift number into
 * "you should rebalance" is the Advisor's job, not this module's.
 *
 * This layer does not define new investment arithmetic. It composes the
 * existing primitives (portfolioSummary, calculatePositionCostBasis) so
 * behaviour is unchanged; it only stops each consumer re-deriving the same
 * facts, and surfaces realised P&L that portfolioSummary() computes internally
 * but previously discarded.
 *
 * Runtime read model: never persisted to WealthState.
 */
import type { Ticker, WealthState } from "./models";
import { calculatePositionCostBasis, portfolioSummary, type PositionCostBasis } from "./rules";
import { getPrice, isUsableRate, type PriceMap, type UsdToMyr } from "./marketPrices";

export interface PortfolioHolding {
  ticker: Ticker;
  /** Units currently held. Sells reduce this; it never goes negative. */
  units: number;
  investedMyr: number;
  investedUsd: number;
  averageCostUsd: number;
  /** Share of total invested cost, 0 when nothing is invested. */
  actualAllocation: number;
  /** Configured DCA target weight, 0 when this ticker has no target. */
  targetAllocation: number;
  /** actualAllocation - targetAllocation. Signed: negative means underweight. */
  drift: number;
  realizedPnlUsd: number;
  realizedPnlMyr: number;
  feesMyr: number;

  // --- Live valuation. Null means UNKNOWN, never zero. ---
  /** Live price used for this holding, or null when no usable quote exists. */
  priceUsd: number | null;
  /** units x priceUsd. Null when the price is unknown. */
  marketValueUsd: number | null;
  /** marketValueUsd converted at a known FX rate. Null when either is unknown. */
  marketValueMyr: number | null;
  /** marketValueUsd - investedUsd. Null when the price is unknown. */
  unrealizedPnlUsd: number | null;
  /** marketValueMyr - investedMyr. Null when price or FX is unknown. */
  unrealizedPnlMyr: number | null;
  /** unrealizedPnlUsd / investedUsd. Null when unknown or nothing was invested. */
  unrealizedPnlPercent: number | null;
  /**
   * unrealizedPnlMyr / investedMyr — the RINGGIT return, which differs from the
   * USD return because invested MYR was recorded at the exchange rates of the
   * day and market value uses today's rate. Never pair a MYR amount with the
   * USD percentage.
   */
  unrealizedPnlPercentMyr: number | null;
}

/** Whether a portfolio could be valued, and how completely. */
export type ValuationStatus = "complete" | "partial" | "unavailable";

export interface PortfolioSnapshot {
  holdings: PortfolioHolding[];
  totalInvestedMyr: number;
  totalInvestedUsd: number;
  totalUnits: number;
  realizedPnlMyr: number;
  realizedPnlUsd: number;
  totalFeesMyr: number;
  /** Actual weight per ticker, keyed for direct lookup. */
  allocation: Record<Ticker, number>;
  /** Configured target weight per ticker. */
  targetAllocation: Record<Ticker, number>;
  /** The single canonical drift figure. Never recompute this elsewhere. */
  maxAbsoluteDrift: number;
  tradeCount: number;
  /**
   * Market valuation requires live quotes, which are only available
   * asynchronously (see market.ts). When no prices are supplied these stay
   * null rather than being invented from stale or zero prices. Consumers must
   * treat null as "unknown", not "zero".
   *
   * Totals cover only the holdings that could actually be priced, so they are
   * never silently deflated by treating an unpriced holding as worthless.
   * `valuationStatus` says whether that is the whole portfolio or part of it.
   */
  totalInvestmentValueMyr: number | null;
  unrealizedPnlMyr: number | null;
  totalInvestmentValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  /** USD unrealised P&L over the USD cost of the PRICED holdings only. */
  unrealizedPnlPercent: number | null;
  /** The same ratio in ringgit. Differs from the USD figure by the FX move. */
  unrealizedPnlPercentMyr: number | null;

  /** complete = every holding priced; partial = some; unavailable = none. */
  valuationStatus: ValuationStatus;
  /** Tickers with a usable live price. */
  pricedTickers: Ticker[];
  /** Held tickers with no usable price. These are excluded from the totals. */
  unpricedTickers: Ticker[];
  /** Newest quote timestamp behind the valuation, or null. */
  valuedAt: number | null;
  /** FX rate used for the MYR figures, or null when none was available. */
  usdToMyrUsed: number | null;
}

/** Live market inputs. Everything is optional; anything missing means unknown. */
export interface ValuationInputs {
  /** Validated live prices. Absent ticker = unknown price for that holding. */
  prices?: PriceMap;
  /** USD→MYR rate. Null/absent means MYR valuation stays unknown. */
  usdToMyr?: UsdToMyr;
}

/**
 * Build the canonical portfolio snapshot.
 * Pure: the same state and the same market inputs always produce the same result.
 *
 * `now` is accepted for signature consistency with the other snapshots; no
 * portfolio fact currently depends on the current time.
 *
 * `market` is optional. Omitting it reproduces the previous behaviour exactly:
 * every valuation field is null, because no price is known. Live prices are
 * passed in rather than fetched here so this stays pure, and so a price never
 * reaches WealthState.
 */
export function getPortfolioSnapshot(
  state: WealthState,
  _now = new Date(),
  market: ValuationInputs = {},
): PortfolioSnapshot {
  // Positions, allocation and drift come from the existing primitive. It also
  // computes each ticker's cost basis internally but does not carry the
  // realised P&L through, so we take the same map back rather than recomputing
  // every position's cost basis a second time.
  const costBases = new Map<string, PositionCostBasis>();
  const summary = portfolioSummary(state, costBases);

  // FX is only applied when a real rate was supplied. No rate means the MYR
  // valuation stays unknown rather than being converted at an invented number.
  const usdToMyr = isUsableRate(market.usdToMyr) ? market.usdToMyr : null;

  const holdings: PortfolioHolding[] = summary.positions.map((position) => {
    const costBasis = costBases.get(position.ticker)
      ?? calculatePositionCostBasis(state.trades, position.ticker);

    // A holding is valued only when a usable price exists AND units are held.
    // Zero units is not a valuation failure — it is genuinely worth nothing.
    const live = getPrice(market.prices, position.ticker);
    const priceUsd = live?.priceUsd ?? null;
    const valued = priceUsd !== null;

    const marketValueUsd = valued ? position.units * priceUsd : null;
    const marketValueMyr = marketValueUsd !== null && usdToMyr !== null
      ? marketValueUsd * usdToMyr
      : null;
    const unrealizedPnlUsd = marketValueUsd !== null ? marketValueUsd - position.investedUsd : null;
    const unrealizedPnlMyr = marketValueMyr !== null ? marketValueMyr - position.investedMyr : null;

    return {
      ticker: position.ticker,
      units: position.units,
      investedMyr: position.investedMyr,
      investedUsd: position.investedUsd,
      averageCostUsd: position.averageCostUsd,
      actualAllocation: position.actualAllocation,
      targetAllocation: position.targetAllocation,
      drift: position.drift,
      realizedPnlUsd: costBasis.realizedPnlUsd,
      realizedPnlMyr: costBasis.realizedPnlMyr,
      feesMyr: costBasis.feesMyr,
      priceUsd,
      marketValueUsd,
      marketValueMyr,
      unrealizedPnlUsd,
      unrealizedPnlMyr,
      // Percentage return needs a cost to divide by; with none it is undefined,
      // not zero.
      unrealizedPnlPercent: unrealizedPnlUsd !== null && position.investedUsd > 0
        ? unrealizedPnlUsd / position.investedUsd
        : null,
      unrealizedPnlPercentMyr: unrealizedPnlMyr !== null && position.investedMyr > 0
        ? unrealizedPnlMyr / position.investedMyr
        : null,
    };
  });

  // --- Portfolio-level valuation ---
  // Only holdings that were actually priced contribute. An unpriced holding is
  // excluded from the totals and reported in unpricedTickers, so it can never
  // be silently counted as worth zero.
  const heldHoldings = holdings.filter((holding) => holding.units > 0);
  const priced = heldHoldings.filter((holding) => holding.marketValueUsd !== null);
  const unpriced = heldHoldings.filter((holding) => holding.marketValueUsd === null);

  const valuationStatus: ValuationStatus = priced.length === 0
    ? "unavailable"
    : unpriced.length === 0 ? "complete" : "partial";

  const hasValuation = priced.length > 0;
  const totalInvestmentValueUsd = hasValuation
    ? priced.reduce((sum, holding) => sum + (holding.marketValueUsd ?? 0), 0)
    : null;
  const totalInvestmentValueMyr = hasValuation && usdToMyr !== null
    ? priced.reduce((sum, holding) => sum + (holding.marketValueMyr ?? 0), 0)
    : null;
  // Compared against the cost of the priced holdings only, so a partial
  // valuation is not measured against the whole portfolio's cost.
  const pricedInvestedUsd = priced.reduce((sum, holding) => sum + holding.investedUsd, 0);
  const pricedInvestedMyr = priced.reduce((sum, holding) => sum + holding.investedMyr, 0);
  const unrealizedPnlUsd = totalInvestmentValueUsd !== null
    ? totalInvestmentValueUsd - pricedInvestedUsd
    : null;
  const unrealizedPnlMyr = totalInvestmentValueMyr !== null
    ? totalInvestmentValueMyr - pricedInvestedMyr
    : null;
  const quoteTimes = priced
    .map((holding) => getPrice(market.prices, holding.ticker)?.quotedAt ?? 0)
    .filter((time) => time > 0);

  const allocation: Record<Ticker, number> = {};
  const targetAllocation: Record<Ticker, number> = {};
  for (const holding of holdings) {
    allocation[holding.ticker] = holding.actualAllocation;
    targetAllocation[holding.ticker] = holding.targetAllocation;
  }

  return {
    holdings,
    totalInvestedMyr: summary.totalInvestedMyr,
    totalInvestedUsd: summary.totalInvestedUsd,
    totalUnits: summary.totalUnits,
    realizedPnlMyr: holdings.reduce((sum, holding) => sum + holding.realizedPnlMyr, 0),
    realizedPnlUsd: holdings.reduce((sum, holding) => sum + holding.realizedPnlUsd, 0),
    totalFeesMyr: holdings.reduce((sum, holding) => sum + holding.feesMyr, 0),
    allocation,
    targetAllocation,
    maxAbsoluteDrift: summary.maxAbsoluteDrift,
    tradeCount: state.trades.length,
    totalInvestmentValueMyr,
    unrealizedPnlMyr,
    totalInvestmentValueUsd,
    unrealizedPnlUsd,
    unrealizedPnlPercent: unrealizedPnlUsd !== null && pricedInvestedUsd > 0
      ? unrealizedPnlUsd / pricedInvestedUsd
      : null,
    unrealizedPnlPercentMyr: unrealizedPnlMyr !== null && pricedInvestedMyr > 0
      ? unrealizedPnlMyr / pricedInvestedMyr
      : null,
    valuationStatus,
    pricedTickers: priced.map((holding) => holding.ticker),
    unpricedTickers: unpriced.map((holding) => holding.ticker),
    valuedAt: quoteTimes.length > 0 ? Math.max(...quoteTimes) : null,
    usdToMyrUsed: hasValuation ? usdToMyr : null,
  };
}

/** One holding by ticker, or undefined. */
export function getHolding(snapshot: PortfolioSnapshot, ticker: Ticker): PortfolioHolding | undefined {
  return snapshot.holdings.find((holding) => holding.ticker === ticker);
}
