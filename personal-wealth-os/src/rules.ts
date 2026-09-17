import type { PortfolioPosition, PortfolioSummary, Trade, WealthState } from "./models";
import { tradesWithExchangeCost } from "./currencyExchange";
import { tradeAmounts, type TradeAmountFields } from "./tradeCurrency";

export interface PositionCostBasis {
  ticker: string;
  units: number;
  /** The currency the position was bought in: its newest trade's. */
  currency: string;
  /** Cost of the units held, in `currency`. */
  costBasisLocal: number;
  /** costBasisLocal / units, in `currency`. */
  averageCostLocal: number;
  /** Realised P&L in `currency`. */
  realizedPnlLocal: number;
  /** The Local figures when the position is in dollars; 0 for any other currency. */
  costBasisUsd: number;
  costBasisMyr: number;
  /** averageCostLocal for a dollar position; 0 otherwise. */
  averageCostUsd: number;
  /** realizedPnlLocal for a dollar position; 0 otherwise. */
  realizedPnlUsd: number;
  realizedPnlMyr: number;
  /** Every fee ever paid on this ticker, including on units since sold. */
  feesMyr: number;
  /**
   * The portion of costBasisMyr that is fee rather than shares.
   *
   * Distinct from feesMyr: this follows the units. Selling half a position
   * removes half its fees from the basis, because those fees left with the
   * cost they were part of. feesMyr is the lifetime total and answers a
   * different question — what this ticker has cost to trade.
   */
  feeBasisMyr: number;
}

export type CostBasisTrade = Pick<Trade, "ticker" | "date" | "type" | "amountUsd" | "amountMyr" | "priceUsd" | "units" | "feeMyr">
  & Partial<Pick<Trade, "currency" | "amount" | "price">>;

export function money(value: number, currency = "MYR"): string {
  return `${currency} ${Number(value || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}`;
}

export function percent(value: number, digits = 0): string {
  if (!isFinite(value)) return "0%";
  return `${(value * 100).toFixed(digits)}%`;
}

export function monthlyBasicExpense(state: WealthState): number {
  return state.cashflow.transport + state.cashflow.food + state.cashflow.otherFixed;
}

export function monthlySurplus(state: WealthState): number {
  return state.cashflow.allowance + state.cashflow.irregularIncome - monthlyBasicExpense(state);
}

export function emergencyRatio(state: WealthState): number {
  if (state.emergency.target <= 0) return 0;
  return Math.min(state.emergency.current / state.emergency.target, 1);
}

/**
 * WealthUp's default emergency-fund size: months of ESSENTIAL spending (needs
 * only — transport, food and other fixed costs), within the 3-6 month standard.
 */
export const DEFAULT_EMERGENCY_MONTHS = 6;

/**
 * A suggested emergency target from the essential spending the user has
 * entered, or null when there is nothing to base it on. A suggestion only: the
 * target is the user's decision and is never set without them choosing it.
 */
export function suggestedEmergencyTarget(
  state: Pick<WealthState, "cashflow">,
  months = DEFAULT_EMERGENCY_MONTHS,
): { monthlyEssential: number; months: number; target: number } | null {
  const monthlyEssential = [state.cashflow.transport, state.cashflow.food, state.cashflow.otherFixed]
    .map((value) => (Number.isFinite(value) && value > 0 ? value : 0))
    .reduce((sum, value) => sum + value, 0);
  if (monthlyEssential <= 0) return null;
  return { monthlyEssential, months, target: Math.round(monthlyEssential * months) };
}

export function monthsToEmergencyTarget(state: WealthState): number {
  const gap = Math.max(state.emergency.target - state.emergency.current, 0);
  if (gap === 0) return 0;
  if (state.emergency.monthlyTopUp <= 0) return Infinity;
  return Math.ceil(gap / state.emergency.monthlyTopUp);
}

export function projectedAnnualEmergencyYield(state: WealthState): number {
  return state.emergency.current * state.emergency.annualYield;
}

/** Units a trade moved: as recorded, or its order value over its price, both in its own currency. */
export function tradeUnits(trade: TradeAmountFields & Pick<Trade, "units">): number {
  if (Number.isFinite(trade.units) && Number(trade.units) > 0) return Number(trade.units);
  const { amount, price } = tradeAmounts(trade);
  if (price <= 0 || amount <= 0) return 0;
  return amount / price;
}

export function calculatePositionCostBasis(trades: CostBasisTrade[], ticker: string): PositionCostBasis {
  const matchingTrades = trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => trade.ticker === ticker)
    .sort((a, b) => a.trade.date.localeCompare(b.trade.date) || a.index - b.index);
  let units = 0;
  // In the position's own currency. A ticker trades in one currency, so every
  // trade's price is in the same unit; the newest trade names it.
  let costBasisLocal = 0;
  let costBasisMyr = 0;
  let realizedPnlLocal = 0;
  let realizedPnlMyr = 0;
  let feesMyr = 0;
  let feeBasisMyr = 0;
  let currency = "USD";

  matchingTrades.forEach(({ trade }) => {
    const unitsTraded = tradeUnits(trade);
    const { currency: tradeCurrency, price } = tradeAmounts(trade);
    currency = tradeCurrency;
    feesMyr += trade.feeMyr;
    if (unitsTraded <= 0) return;

    if (trade.type !== "Sell") {
      units += unitsTraded;
      costBasisLocal += unitsTraded * price;
      costBasisMyr += trade.amountMyr + trade.feeMyr;
      feeBasisMyr += trade.feeMyr;
      return;
    }

    if (units <= 0) return;
    const unitsSold = Math.min(unitsTraded, units);
    const soldFraction = unitsSold / units;
    const removedCostLocal = costBasisLocal * soldFraction;
    const removedCostMyr = costBasisMyr * soldFraction;
    const proceedsFraction = unitsSold / unitsTraded;
    const proceedsLocal = unitsSold * price;
    const proceedsMyr = Math.max(trade.amountMyr - trade.feeMyr, 0) * proceedsFraction;

    realizedPnlLocal += proceedsLocal - removedCostLocal;
    realizedPnlMyr += proceedsMyr - removedCostMyr;
    units -= unitsSold;
    costBasisLocal -= removedCostLocal;
    costBasisMyr -= removedCostMyr;
    // Fees ride out with the cost they are part of, at the same fraction.
    feeBasisMyr -= feeBasisMyr * soldFraction;

    if (units < 1e-10) {
      units = 0;
      costBasisLocal = 0;
      costBasisMyr = 0;
      feeBasisMyr = 0;
    }
  });

  const averageCostLocal = units > 0 ? costBasisLocal / units : 0;
  const isUsd = currency === "USD";
  return {
    ticker,
    units,
    currency,
    costBasisLocal,
    averageCostLocal,
    realizedPnlLocal,
    costBasisUsd: isUsd ? costBasisLocal : 0,
    costBasisMyr,
    averageCostUsd: isUsd ? averageCostLocal : 0,
    realizedPnlUsd: isUsd ? realizedPnlLocal : 0,
    realizedPnlMyr,
    feesMyr,
    feeBasisMyr,
  };
}

/**
 * `costBases` lets a caller that needs the per-ticker cost bases anyway receive
 * the same map back instead of recomputing it. Pass an empty Map: it is filled
 * in here and left populated for the caller. Omitting it behaves as before.
 */
export function portfolioSummary(
  state: WealthState,
  costBases: Map<string, PositionCostBasis> = new Map(),
): PortfolioSummary {
  // Ringgit costs are restated from the conversions that actually funded each
  // buy, so every figure below rests on a rate the user really got rather than
  // one inferred from a trade date. With no conversions recorded this hands
  // back the trades untouched and nothing changes.
  const trades = tradesWithExchangeCost(state.trades, state.currencyExchanges ?? [], state.dividends ?? []);
  const tickerSet = new Set<string>(Object.keys(state.dca.targets));
  trades.forEach((trade) => tickerSet.add(trade.ticker));
  const tickers = Array.from(tickerSet);
  for (const ticker of tickers) {
    if (!costBases.has(ticker)) costBases.set(ticker, calculatePositionCostBasis(trades, ticker));
  }
  const totalInvestedMyr = tickers.reduce((sum, ticker) => sum + costBases.get(ticker)!.costBasisMyr, 0);
  const totalInvestedUsd = tickers.reduce((sum, ticker) => sum + costBases.get(ticker)!.costBasisUsd, 0);
  // Drift compares where money actually sits against where it was meant to
  // sit. With nothing invested there is no actual allocation to compare, so
  // drift is not "100% off target" — it does not exist yet. Reporting
  // 0 - target here told a brand-new user their allocation was badly broken
  // before they had bought anything.
  const hasAllocation = totalInvestedMyr > 0;
  const positions: PortfolioPosition[] = tickers.map((ticker) => {
    const costBasis = costBases.get(ticker)!;
    const actualAllocation = hasAllocation ? costBasis.costBasisMyr / totalInvestedMyr : 0;
    const targetAllocation = state.dca.targets[ticker] ?? 0;
    return {
      ticker,
      investedMyr: costBasis.costBasisMyr,
      investedUsd: costBasis.costBasisUsd,
      units: costBasis.units,
      averageCostUsd: costBasis.averageCostUsd,
      actualAllocation,
      targetAllocation,
      drift: hasAllocation ? actualAllocation - targetAllocation : 0,
    };
  });

  return {
    totalInvestedMyr,
    totalInvestedUsd,
    totalUnits: positions.reduce((sum, position) => sum + position.units, 0),
    positions,
    maxAbsoluteDrift: positions.reduce((max, position) => Math.max(max, Math.abs(position.drift)), 0),
  };
}

// advisorMessages() and nextActions() moved to advisor.ts, which layers the
// FACT → RULE → IMPACT → ACTION contract over these calculations. They cannot
// live here: financialHealth.ts imports this module, so importing
// getFinancialSnapshot() from here would create a cycle.
