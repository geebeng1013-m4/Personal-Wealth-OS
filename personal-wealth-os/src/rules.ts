import type { PortfolioPosition, PortfolioSummary, Trade, WealthState } from "./models";

export interface PositionCostBasis {
  ticker: string;
  units: number;
  costBasisUsd: number;
  costBasisMyr: number;
  averageCostUsd: number;
  realizedPnlUsd: number;
  realizedPnlMyr: number;
  feesMyr: number;
}

export type CostBasisTrade = Pick<Trade, "ticker" | "date" | "type" | "amountUsd" | "amountMyr" | "priceUsd" | "units" | "feeMyr">;

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

export function monthsToEmergencyTarget(state: WealthState): number {
  const gap = Math.max(state.emergency.target - state.emergency.current, 0);
  if (gap === 0) return 0;
  if (state.emergency.monthlyTopUp <= 0) return Infinity;
  return Math.ceil(gap / state.emergency.monthlyTopUp);
}

export function projectedAnnualEmergencyYield(state: WealthState): number {
  return state.emergency.current * state.emergency.annualYield;
}

export function tradeUnits(trade: Pick<Trade, "priceUsd" | "amountUsd" | "units">): number {
  if (Number.isFinite(trade.units) && Number(trade.units) > 0) return Number(trade.units);
  if (trade.priceUsd <= 0 || trade.amountUsd <= 0) return 0;
  return trade.amountUsd / trade.priceUsd;
}

export function calculatePositionCostBasis(trades: CostBasisTrade[], ticker: string): PositionCostBasis {
  const matchingTrades = trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => trade.ticker === ticker)
    .sort((a, b) => a.trade.date.localeCompare(b.trade.date) || a.index - b.index);
  let units = 0;
  let costBasisUsd = 0;
  let costBasisMyr = 0;
  let realizedPnlUsd = 0;
  let realizedPnlMyr = 0;
  let feesMyr = 0;

  matchingTrades.forEach(({ trade }) => {
    const unitsTraded = tradeUnits(trade);
    feesMyr += trade.feeMyr;
    if (unitsTraded <= 0) return;

    if (trade.type !== "Sell") {
      units += unitsTraded;
      costBasisUsd += unitsTraded * trade.priceUsd;
      costBasisMyr += trade.amountMyr + trade.feeMyr;
      return;
    }

    if (units <= 0) return;
    const unitsSold = Math.min(unitsTraded, units);
    const soldFraction = unitsSold / units;
    const removedCostUsd = costBasisUsd * soldFraction;
    const removedCostMyr = costBasisMyr * soldFraction;
    const proceedsFraction = unitsSold / unitsTraded;
    const proceedsUsd = unitsSold * trade.priceUsd;
    const proceedsMyr = Math.max(trade.amountMyr - trade.feeMyr, 0) * proceedsFraction;

    realizedPnlUsd += proceedsUsd - removedCostUsd;
    realizedPnlMyr += proceedsMyr - removedCostMyr;
    units -= unitsSold;
    costBasisUsd -= removedCostUsd;
    costBasisMyr -= removedCostMyr;

    if (units < 1e-10) {
      units = 0;
      costBasisUsd = 0;
      costBasisMyr = 0;
    }
  });

  return {
    ticker,
    units,
    costBasisUsd,
    costBasisMyr,
    averageCostUsd: units > 0 ? costBasisUsd / units : 0,
    realizedPnlUsd,
    realizedPnlMyr,
    feesMyr,
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
  const tickerSet = new Set<string>(Object.keys(state.dca.targets));
  state.trades.forEach((trade) => tickerSet.add(trade.ticker));
  const tickers = Array.from(tickerSet);
  for (const ticker of tickers) {
    if (!costBases.has(ticker)) costBases.set(ticker, calculatePositionCostBasis(state.trades, ticker));
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

export function trancheStatus(state: WealthState, drawdown: number) {
  return state.opportunity.tranches.map((tranche) => {
    const triggered = drawdown >= tranche.drawdown;
    return {
      ...tranche,
      status: tranche.deployed ? "Deployed" : triggered ? "Triggered" : "Not Triggered",
      suggestedVoo: tranche.amount / 2,
      suggestedQqqm: tranche.amount / 2,
    };
  });
}

// advisorMessages() and nextActions() moved to advisor.ts, which layers the
// FACT → RULE → IMPACT → ACTION contract over these calculations. They cannot
// live here: financialHealth.ts imports this module, so importing
// getFinancialSnapshot() from here would create a cycle.
