import type { AdvisorMessage, PortfolioPosition, PortfolioSummary, Ticker, Trade, WealthState } from "./models";

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

export function tradeUnits(trade: Trade): number {
  if (trade.priceUsd <= 0 || trade.amountUsd <= 0) return 0;
  return trade.amountUsd / trade.priceUsd;
}

export function portfolioSummary(state: WealthState): PortfolioSummary {
  // Collect all unique tickers from trades
  const tickerSet = new Set<string>();
  state.trades.forEach((t) => tickerSet.add(t.ticker));
  const tickers = Array.from(tickerSet);
  if (tickers.length === 0) tickers.push("VOO", "QQQM"); // fallback

  const totals: Record<string, { investedMyr: number; investedUsd: number; units: number }> = {};
  tickers.forEach((ticker) => {
    totals[ticker] = { investedMyr: 0, investedUsd: 0, units: 0 };
  });

  state.trades.forEach((trade) => {
    if (!totals[trade.ticker]) totals[trade.ticker] = { investedMyr: 0, investedUsd: 0, units: 0 };
    const direction = trade.type === "Sell" ? -1 : 1;
    totals[trade.ticker].investedMyr += direction * (trade.amountMyr + trade.feeMyr);
    totals[trade.ticker].investedUsd += direction * trade.amountUsd;
    totals[trade.ticker].units += direction * tradeUnits(trade);
  });

  const totalInvestedMyr = tickers.reduce((sum, ticker) => sum + totals[ticker].investedMyr, 0);
  const totalInvestedUsd = tickers.reduce((sum, ticker) => sum + totals[ticker].investedUsd, 0);
  const positions: PortfolioPosition[] = tickers.map((ticker) => {
    const actualAllocation = totalInvestedMyr > 0 ? totals[ticker].investedMyr / totalInvestedMyr : 0;
    const targetAllocation = state.dca.targets[ticker] ?? 0;
    const averageCostUsd = totals[ticker].units > 0 ? totals[ticker].investedUsd / totals[ticker].units : 0;
    return {
      ticker,
      investedMyr: totals[ticker].investedMyr,
      investedUsd: totals[ticker].investedUsd,
      units: totals[ticker].units,
      averageCostUsd,
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
      status: tranche.deployed ? "已部署" : triggered ? "已触发" : "未触发",
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
  const messages: AdvisorMessage[] = [];

  messages.push({
    title: emergency < 1 ? "Safety still needs funding" : "Safety bucket complete ✅",
    body:
      emergency < 1
        ? `Emergency Fund is ${percent(emergency)} complete. Keep MYR ${state.emergency.monthlyTopUp}/month; estimated completion in ${months} months.`
        : `Emergency Fund reached ${money(state.emergency.target)}! You're safe. Consider redirecting savings to Growth or Travel.`,
    severity: emergency < 1 ? "watch" : "positive",
  });

  messages.push({
    title: "Keep DCA mechanical",
    body: `Monthly DCA remains ${money(state.dca.monthly)}: VOO ${money(state.dca.monthly * state.dca.targets.VOO)} / QQQM ${money(state.dca.monthly * state.dca.targets.QQQM)}.`,
    severity: "positive",
  });

  messages.push({
    title: portfolio.maxAbsoluteDrift > 0.08 ? "Allocation drift is visible" : "Allocation drift is controlled",
    body:
      portfolio.maxAbsoluteDrift > 0.08
        ? `Largest drift is ${percent(portfolio.maxAbsoluteDrift)}. Direct future buys toward the underweight ETF before changing strategy.`
        : `VOO / QQQM remains within a practical tolerance band for a 19-year-old growth investor.`,
    severity: portfolio.maxAbsoluteDrift > 0.08 ? "action" : "positive",
  });

  messages.push({
    title: "Opportunity Reserve remains separate",
    body: `${money(state.opportunity.total - state.opportunity.used)} is reserved for -10%, -15%, and -20% deployment rules. Do not mix it with daily spending.`,
    severity: "watch",
  });

  messages.push({
    title: "Cashflow discipline",
    body: `Monthly assignable surplus is ${money(surplus)} after basic spending. This is enough for DCA, Safety, Freedom, and Learning if the plan is followed.`,
    severity: surplus >= state.dca.monthly ? "positive" : "action",
  });

  return messages;
}

export function nextActions(state: WealthState): string[] {
  const actions = [
    `DCA ${money(state.dca.monthly)} this month unless cashflow breaks.`,
    state.emergency.monthlyTopUp > 0
      ? `Top up Safety by ${money(state.emergency.monthlyTopUp)} until Emergency Fund reaches ${money(state.emergency.target)}.`
      : `Emergency Fund is complete! Consider redirecting ${money(state.emergency.monthlyTopUp || 40)} to Growth or Travel bucket.`,
    "Review spending at month end and record whether DCA was executed.",
  ];

  if (portfolioSummary(state).maxAbsoluteDrift > 0.08) {
    actions.push("Use the next buy to reduce VOO / QQQM allocation drift.");
  }

  return actions;
}
