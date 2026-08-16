import type { AdvisorMessage, PortfolioPosition, PortfolioSummary, Trade, WealthState } from "./models";

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

export type CostBasisTrade = Pick<Trade, "ticker" | "date" | "type" | "amountUsd" | "amountMyr" | "priceUsd" | "feeMyr">;

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

export function tradeUnits(trade: Pick<Trade, "priceUsd" | "amountUsd">): number {
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
      costBasisUsd += trade.amountUsd;
      costBasisMyr += trade.amountMyr + trade.feeMyr;
      return;
    }

    if (units <= 0) return;
    const unitsSold = Math.min(unitsTraded, units);
    const soldFraction = unitsSold / units;
    const removedCostUsd = costBasisUsd * soldFraction;
    const removedCostMyr = costBasisMyr * soldFraction;
    const proceedsFraction = unitsSold / unitsTraded;
    const proceedsUsd = trade.amountUsd * proceedsFraction;
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

export function portfolioSummary(state: WealthState): PortfolioSummary {
  const tickerSet = new Set<string>(Object.keys(state.dca.targets));
  state.trades.forEach((trade) => tickerSet.add(trade.ticker));
  const tickers = Array.from(tickerSet);
  const costBases = new Map(tickers.map((ticker) => [ticker, calculatePositionCostBasis(state.trades, ticker)]));
  const totalInvestedMyr = tickers.reduce((sum, ticker) => sum + costBases.get(ticker)!.costBasisMyr, 0);
  const totalInvestedUsd = tickers.reduce((sum, ticker) => sum + costBases.get(ticker)!.costBasisUsd, 0);
  const positions: PortfolioPosition[] = tickers.map((ticker) => {
    const costBasis = costBases.get(ticker)!;
    const actualAllocation = totalInvestedMyr > 0 ? costBasis.costBasisMyr / totalInvestedMyr : 0;
    const targetAllocation = state.dca.targets[ticker] ?? 0;
    return {
      ticker,
      investedMyr: costBasis.costBasisMyr,
      investedUsd: costBasis.costBasisUsd,
      units: costBasis.units,
      averageCostUsd: costBasis.averageCostUsd,
      actualAllocation,
      targetAllocation,
      drift: actualAllocation - targetAllocation,
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

export function advisorMessages(state: WealthState): AdvisorMessage[] {
  const emergency = emergencyRatio(state);
  const months = monthsToEmergencyTarget(state);
  const portfolio = portfolioSummary(state);
  const surplus = monthlySurplus(state);
  const targetEntries = Object.entries(state.dca.targets).filter(([, allocation]) => allocation > 0);
  const allocationLabel = targetEntries.length > 0
    ? targetEntries.map(([ticker, allocation]) => `${ticker} ${money(state.dca.monthly * allocation)}`).join(" / ")
    : "No target allocation configured";
  const profileLabel = state.profile.age > 0
    ? `${state.profile.age}-year-old ${state.profile.riskTolerance.toLowerCase()}-risk investor`
    : `${state.profile.riskTolerance.toLowerCase()}-risk investor`;
  const messages: AdvisorMessage[] = [];

  messages.push({
    title: emergency < 1 ? "Safety still needs funding" : "Safety bucket complete ✅",
    body:
      emergency < 1
        ? `Emergency Fund is ${percent(emergency)} complete. Keep MYR ${state.emergency.monthlyTopUp}/month; estimated completion in ${months} months.`
        : `Emergency Fund reached ${money(state.emergency.target)}! You're safe. Consider redirecting savings to Happy Fun and Wishlist.`,
    severity: emergency < 1 ? "watch" : "positive",
  });

  messages.push({
    title: "Keep DCA mechanical",
    body: `Monthly DCA remains ${money(state.dca.monthly)}: ${allocationLabel}.`,
    severity: "positive",
  });

  messages.push({
    title: portfolio.maxAbsoluteDrift > 0.08 ? "Allocation drift is visible" : "Allocation drift is controlled",
    body:
      portfolio.maxAbsoluteDrift > 0.08
        ? `Largest drift is ${percent(portfolio.maxAbsoluteDrift)}. Direct future buys toward the underweight ETF before changing strategy.`
        : `Your configured allocation remains within a practical tolerance band for a ${profileLabel}.`,
    severity: portfolio.maxAbsoluteDrift > 0.08 ? "action" : "positive",
  });

  messages.push({
    title: "Opportunity Reserve remains separate",
    body: `${money(state.opportunity.total - state.opportunity.used)} is reserved for -10%, -15%, and -20% deployment rules. Do not mix it with daily spending.`,
    severity: "watch",
  });

  messages.push({
    title: "Cashflow discipline",
    body: `Monthly assignable surplus is ${money(surplus)} after basic spending. ${surplus >= state.dca.monthly ? "This currently covers the configured DCA plan." : `This is ${money(state.dca.monthly - surplus)} below the configured DCA plan.`}`,
    severity: surplus >= state.dca.monthly ? "positive" : "action",
  });

  return messages;
}

export function nextActions(state: WealthState): string[] {
  const actions = [
    `DCA ${money(state.dca.monthly)} this month unless cashflow breaks.`,
    state.emergency.monthlyTopUp > 0
      ? `Top up Safety by ${money(state.emergency.monthlyTopUp)} until Emergency Fund reaches ${money(state.emergency.target)}.`
      : `Emergency Fund is complete! Consider redirecting ${money(state.emergency.monthlyTopUp || 40)} to Happy Fun and Wishlist buckets.`,
    "Review spending at month end and record whether DCA was executed.",
  ];

  if (portfolioSummary(state).maxAbsoluteDrift > 0.08) {
    actions.push("Use the next buy to reduce allocation drift toward your configured targets.");
  }

  return actions;
}
