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
import type { Market, Ticker, WealthState } from "./models";
import { calculatePositionCostBasis, portfolioSummary, type PositionCostBasis } from "./rules";
import { tradesWithExchangeCost } from "./currencyExchange";
import { getPrice, isUsableRate, type PriceMap, type UsdToMyr } from "./marketPrices";
import { MARKETS, marketOfTicker, normalizeTradeMarket } from "./tradeCurrency";

export interface PortfolioHolding {
  ticker: Ticker;
  /** Where the listing trades. */
  market: Market;
  /**
   * The currency the holding was bought and is priced in. Every *Local field is
   * in this currency; the *Usd fields carry the same figures only for a dollar
   * holding and are 0 or null for any other, so they never mix currencies.
   */
  currency: string;
  investedLocal: number;
  averageCostLocal: number;
  realizedPnlLocal: number;
  /** Live price in `currency`, or null when unknown or quoted in another currency. */
  priceLocal: number | null;
  /** units x priceLocal. Null when the price is unknown. */
  marketValueLocal: number | null;
  /** marketValueLocal - investedLocal. Null when the price is unknown. */
  unrealizedPnlLocal: number | null;
  /** unrealizedPnlLocal / investedLocal. Null when unknown or nothing was invested. */
  unrealizedPnlPercentLocal: number | null;
  /** MYR per unit of `currency` used for marketValueMyr, or null when none was known. */
  rateToMyr: number | null;
  /** Units currently held. Sells reduce this; it never goes negative. */
  units: number;
  investedMyr: number;
  investedUsd: number;
  averageCostUsd: number;
  /**
   * Share of the portfolio this holding represents.
   *
   * Measured on market value whenever every holding is priced, because
   * allocation describes the risk you carry NOW — you are exposed to what the
   * shares are worth today, not to what they cost. Falls back to share of
   * invested cost when the portfolio cannot be fully valued; allocationBasis
   * says which was used, so nothing has to guess.
   */
  actualAllocation: number;
  /** Configured DCA target weight, 0 when this ticker has no target. */
  targetAllocation: number;
  /** actualAllocation - targetAllocation. Signed: negative means underweight. */
  drift: number;
  realizedPnlUsd: number;
  realizedPnlMyr: number;
  /** Every fee ever paid on this ticker, sold units included. */
  feesMyr: number;
  /** The part of investedMyr that is fee rather than shares. */
  feesInCostBasisMyr: number;

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
   * unrealizedPnlMyr / investedMyr — the RINGGIT return. It differs from the
   * USD return because the two sides are converted at different rates: market
   * value at today's rate, invested MYR at whatever rate each trade carries.
   * Never pair a MYR amount with the USD percentage.
   *
   * KNOWN CAVEAT — this is weaker than a true ringgit return. Trades imported
   * from a Moomoo CSV carry no real per-trade rate: recordsFromCsv() stamps
   * every row with the live rate at IMPORT time (see csvImport.ts), because
   * the broker's order export has no FX column. For those trades the gap
   * between this figure and unrealizedPnlPercent is an artefact of when the
   * user pressed Import, not a currency move they actually lived through.
   * Prefer the USD figure when the two are shown side by side.
   */
  unrealizedPnlPercentMyr: number | null;
}

/** Whether a portfolio could be valued, and how completely. */
export type ValuationStatus = "complete" | "partial" | "unavailable";

/**
 * The holdings in one currency, added up in that currency and in ringgit.
 * Like the portfolio totals, values cover the priced holdings only.
 */
export interface CurrencySubtotal {
  currency: string;
  /** Held tickers in this currency. */
  tickers: Ticker[];
  investedLocal: number;
  investedMyr: number;
  /** Null when no holding in this currency could be priced. */
  marketValueLocal: number | null;
  /** Null when unpriced, or when no rate to ringgit was known. */
  marketValueMyr: number | null;
  /** Null whenever marketValueMyr is. Measured against the priced holdings' cost. */
  unrealizedPnlMyr: number | null;
  rateToMyr: number | null;
  valuationStatus: ValuationStatus;
}

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
  /**
   * Which measure the allocation and drift figures above rest on.
   *
   * "market" once every held holding has a usable price; "cost" otherwise. A
   * partial valuation deliberately stays on cost rather than mixing the two —
   * weighing some holdings at today's value and others at what they cost would
   * produce percentages that describe no portfolio that exists.
   */
  allocationBasis: "market" | "cost";
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
  /**
   * The same ratio in ringgit. Differs from the USD figure by the FX gap
   * between the trades' recorded rates and today's — which, for CSV-imported
   * trades, is partly an import-time artefact. See PortfolioHolding's
   * unrealizedPnlPercentMyr for the full caveat.
   */
  unrealizedPnlPercentMyr: number | null;

  /**
   * Trading costs sitting inside the cost basis of the PRICED holdings.
   *
   * Kept as its own fact because it answers a question the headline return
   * cannot: brokers charge a per-order minimum, so at small order sizes the
   * commission is a larger drag than any market move, and a return quoted only
   * net of it gives no clue that this is where the money went.
   */
  feesInCostBasisMyr: number;
  /**
   * The ringgit return the holdings would have produced with no trading costs.
   *
   * Not a better number than unrealizedPnlMyr — a different one. The headline
   * figure answers "what did every ringgit I handed over become", which is the
   * honest measure of the account; this one answers "how did the investment
   * itself do", which is what a broker app shows and what makes commission
   * visible as the gap between the two. Both are true; neither replaces the
   * other. Null whenever the priced valuation is unknown.
   */
  unrealizedPnlMyrExFees: number | null;
  /** The same return as a ratio of the fee-free cost. Null when unknown. */
  unrealizedPnlPercentMyrExFees: number | null;

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
  /** Held holdings grouped by currency, largest ringgit cost first. */
  byCurrency: CurrencySubtotal[];
}

/** Live market inputs. Everything is optional; anything missing means unknown. */
export interface ValuationInputs {
  /** Validated live prices. Absent ticker = unknown price for that holding. */
  prices?: PriceMap;
  /** USD→MYR rate. Null/absent means MYR valuation stays unknown. */
  usdToMyr?: UsdToMyr;
  /**
   * MYR per unit for every other currency a holding or quote is in, MYR itself
   * as 1. Absent currency = unknown rate. The dollar is read from usdToMyr.
   */
  ratesToMyr?: ReadonlyMap<string, number>;
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
  // portfolioSummary() restates ringgit costs from the recorded conversions;
  // the fallback below must read the same trades or one holding could be priced
  // against a cost basis the rest of the snapshot disagrees with.
  const trades = tradesWithExchangeCost(state.trades, state.currencyExchanges ?? []);

  // FX is only applied when a real rate was supplied. No rate means the MYR
  // valuation stays unknown rather than being converted at an invented number.
  const usdToMyr = isUsableRate(market.usdToMyr) ? market.usdToMyr : null;
  const rateToMyr = (currency: string): number | null => {
    if (currency === "MYR") return 1;
    if (currency === "USD") return usdToMyr;
    const rate = market.ratesToMyr?.get(currency);
    return isUsableRate(rate) ? rate : null;
  };

  // Where each ticker trades, from its newest trade; a ticker with no trades
  // yet (a DCA target only) is placed by its suffix.
  const marketByTicker = new Map<string, Market>();
  for (const trade of state.trades) marketByTicker.set(trade.ticker, normalizeTradeMarket(trade).market ?? "US");

  const holdings: PortfolioHolding[] = summary.positions.map((position) => {
    const costBasis = costBases.get(position.ticker)
      ?? calculatePositionCostBasis(trades, position.ticker);
    const holdingMarket = marketByTicker.get(position.ticker) ?? marketOfTicker(position.ticker);
    const currency = marketByTicker.has(position.ticker)
      ? costBasis.currency
      : MARKETS.find((info) => info.market === holdingMarket)?.defaultCurrency ?? "USD";
    const isUsd = currency === "USD";

    // A holding is valued only when a usable price exists AND units are held.
    // Zero units is not a valuation failure — it is genuinely worth nothing.
    // A quote in a different currency from the holding's is not a price for it:
    // Hong Kong units times a dollar figure values nothing that exists.
    const live = getPrice(market.prices, position.ticker);
    const priceLocal = live && live.currency === currency ? live.priceUsd : null;
    const rate = rateToMyr(currency);

    const marketValueLocal = priceLocal !== null ? position.units * priceLocal : null;
    const marketValueMyr = marketValueLocal !== null && rate !== null
      ? marketValueLocal * rate
      : null;
    const unrealizedPnlLocal = marketValueLocal !== null ? marketValueLocal - costBasis.costBasisLocal : null;
    const unrealizedPnlMyr = marketValueMyr !== null ? marketValueMyr - position.investedMyr : null;
    // Percentage return needs a cost to divide by; with none it is undefined,
    // not zero.
    const unrealizedPnlPercentLocal = unrealizedPnlLocal !== null && costBasis.costBasisLocal > 0
      ? unrealizedPnlLocal / costBasis.costBasisLocal
      : null;

    return {
      ticker: position.ticker,
      market: holdingMarket,
      currency,
      investedLocal: costBasis.costBasisLocal,
      averageCostLocal: costBasis.averageCostLocal,
      realizedPnlLocal: costBasis.realizedPnlLocal,
      priceLocal,
      marketValueLocal,
      unrealizedPnlLocal,
      unrealizedPnlPercentLocal,
      rateToMyr: rate,
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
      feesInCostBasisMyr: costBasis.feeBasisMyr,
      priceUsd: isUsd ? priceLocal : null,
      marketValueUsd: isUsd ? marketValueLocal : null,
      marketValueMyr,
      unrealizedPnlUsd: isUsd ? unrealizedPnlLocal : null,
      unrealizedPnlMyr,
      unrealizedPnlPercent: isUsd ? unrealizedPnlPercentLocal : null,
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
  const priced = heldHoldings.filter((holding) => holding.marketValueLocal !== null);
  const unpriced = heldHoldings.filter((holding) => holding.marketValueLocal === null);
  const pricedUsd = priced.filter((holding) => holding.currency === "USD");
  // A ringgit total needs every priced holding in ringgit. Adding up only the
  // ones with a known rate would quietly shrink the portfolio.
  const allInRinggit = priced.every((holding) => holding.marketValueMyr !== null);

  const valuationStatus: ValuationStatus = priced.length === 0
    ? "unavailable"
    : unpriced.length === 0 ? "complete" : "partial";

  const hasValuation = priced.length > 0;
  // The dollar totals cover the dollar holdings only. Adding a Hong Kong
  // holding's value into a dollar figure would be adding different units.
  const totalInvestmentValueUsd = pricedUsd.length > 0
    ? pricedUsd.reduce((sum, holding) => sum + (holding.marketValueUsd ?? 0), 0)
    : null;
  const totalInvestmentValueMyr = hasValuation && allInRinggit
    ? priced.reduce((sum, holding) => sum + (holding.marketValueMyr ?? 0), 0)
    : null;
  // Compared against the cost of the priced holdings only, so a partial
  // valuation is not measured against the whole portfolio's cost.
  const pricedInvestedUsd = pricedUsd.reduce((sum, holding) => sum + holding.investedUsd, 0);
  const pricedInvestedMyr = priced.reduce((sum, holding) => sum + holding.investedMyr, 0);
  const unrealizedPnlUsd = totalInvestmentValueUsd !== null
    ? totalInvestmentValueUsd - pricedInvestedUsd
    : null;
  const unrealizedPnlMyr = totalInvestmentValueMyr !== null
    ? totalInvestmentValueMyr - pricedInvestedMyr
    : null;
  // What the same holdings cost before the broker's cut, and what they would
  // have returned on that. Measured over the priced holdings only, exactly like
  // every other total here.
  const pricedFeesMyr = priced.reduce((sum, holding) => sum + holding.feesInCostBasisMyr, 0);
  const pricedInvestedExFeesMyr = pricedInvestedMyr - pricedFeesMyr;
  const unrealizedPnlMyrExFees = totalInvestmentValueMyr !== null
    ? totalInvestmentValueMyr - pricedInvestedExFeesMyr
    : null;
  const quoteTimes = priced
    .map((holding) => getPrice(market.prices, holding.ticker)?.quotedAt ?? 0)
    .filter((time) => time > 0);

  // --- Allocation ---
  // portfolioSummary() weighs positions by cost, which is what it can see. Once
  // every holding has a price, weigh them by what they are worth instead: two
  // ETFs bought at the same cost are not the same exposure after one of them
  // doubles, and the rebalancing advice downstream is only as good as this.
  // Ringgit market values are needed, not just prices: with a price but no FX
  // rate every marketValueMyr is null, and weighing by them would divide by
  // zero. That case stays on cost, and the label says so rather than claiming a
  // market basis it did not use.
  const marketTotalMyr = priced.reduce((sum, holding) => sum + (holding.marketValueMyr ?? 0), 0);
  const useMarket = valuationStatus === "complete" && allInRinggit && marketTotalMyr > 0;
  const allocationBasis: "market" | "cost" = useMarket ? "market" : "cost";

  const weighted: PortfolioHolding[] = useMarket
    ? holdings.map((holding) => {
      const actualAllocation = holding.units > 0
        ? (holding.marketValueMyr ?? 0) / marketTotalMyr
        : 0;
      return {
        ...holding,
        actualAllocation,
        // Drift is defined against the same weights, or the two disagree.
        drift: actualAllocation - holding.targetAllocation,
      };
    })
    : holdings;

  const maxAbsoluteDrift = useMarket
    ? weighted.reduce((max, holding) => Math.max(max, Math.abs(holding.drift)), 0)
    : summary.maxAbsoluteDrift;

  const allocation: Record<Ticker, number> = {};
  const targetAllocation: Record<Ticker, number> = {};
  for (const holding of weighted) {
    allocation[holding.ticker] = holding.actualAllocation;
    targetAllocation[holding.ticker] = holding.targetAllocation;
  }

  return {
    holdings: weighted,
    totalInvestedMyr: summary.totalInvestedMyr,
    totalInvestedUsd: summary.totalInvestedUsd,
    totalUnits: summary.totalUnits,
    realizedPnlMyr: weighted.reduce((sum, holding) => sum + holding.realizedPnlMyr, 0),
    realizedPnlUsd: weighted.reduce((sum, holding) => sum + holding.realizedPnlUsd, 0),
    totalFeesMyr: weighted.reduce((sum, holding) => sum + holding.feesMyr, 0),
    allocation,
    targetAllocation,
    maxAbsoluteDrift,
    allocationBasis,
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
    feesInCostBasisMyr: pricedFeesMyr,
    unrealizedPnlMyrExFees,
    unrealizedPnlPercentMyrExFees: unrealizedPnlMyrExFees !== null && pricedInvestedExFeesMyr > 0
      ? unrealizedPnlMyrExFees / pricedInvestedExFeesMyr
      : null,
    valuationStatus,
    pricedTickers: priced.map((holding) => holding.ticker),
    unpricedTickers: unpriced.map((holding) => holding.ticker),
    valuedAt: quoteTimes.length > 0 ? Math.max(...quoteTimes) : null,
    usdToMyrUsed: hasValuation ? usdToMyr : null,
    byCurrency: currencySubtotals(weighted),
  };
}

/** Group held holdings by currency. See CurrencySubtotal. */
function currencySubtotals(holdings: PortfolioHolding[]): CurrencySubtotal[] {
  const groups = new Map<string, PortfolioHolding[]>();
  for (const holding of holdings) {
    if (holding.units <= 0) continue;
    groups.set(holding.currency, [...(groups.get(holding.currency) ?? []), holding]);
  }
  return [...groups].map(([currency, group]): CurrencySubtotal => {
    const priced = group.filter((holding) => holding.marketValueLocal !== null);
    const rate = group[0].rateToMyr;
    const marketValueLocal = priced.length > 0
      ? priced.reduce((sum, holding) => sum + (holding.marketValueLocal ?? 0), 0)
      : null;
    const marketValueMyr = marketValueLocal !== null && rate !== null
      ? priced.reduce((sum, holding) => sum + (holding.marketValueMyr ?? 0), 0)
      : null;
    const pricedInvestedMyr = priced.reduce((sum, holding) => sum + holding.investedMyr, 0);
    return {
      currency,
      tickers: group.map((holding) => holding.ticker),
      investedLocal: group.reduce((sum, holding) => sum + holding.investedLocal, 0),
      investedMyr: group.reduce((sum, holding) => sum + holding.investedMyr, 0),
      marketValueLocal,
      marketValueMyr,
      unrealizedPnlMyr: marketValueMyr !== null ? marketValueMyr - pricedInvestedMyr : null,
      rateToMyr: rate,
      valuationStatus: priced.length === 0 ? "unavailable" : priced.length === group.length ? "complete" : "partial",
    };
  }).sort((a, b) => b.investedMyr - a.investedMyr);
}

/** One slice of the portfolio: a market or a currency, in ringgit and as a share. */
export interface ExposureSlice<K extends string> {
  key: K;
  tickers: Ticker[];
  myr: number;
  /** myr over the whole portfolio, 0..1. */
  share: number;
}

/** Where the money sits: by the market a listing trades on, and by the currency it is priced in. */
export interface PortfolioExposure {
  /**
   * The same basis the allocation uses: "market" once every held holding is
   * worth a known ringgit amount, "cost" otherwise. Mixing the two would give
   * shares of a portfolio that does not exist.
   */
  basis: "market" | "cost";
  totalMyr: number;
  /** Largest first. */
  markets: ExposureSlice<Market>[];
  /** Largest first. The ringgit slice is the part with no currency risk. */
  currencies: ExposureSlice<string>[];
}

/**
 * Split the held portfolio by market and by currency.
 *
 * They are different questions. A London ETF priced in dollars is London by
 * market and dollars by currency: the currency split is the one that says how
 * much a move in the ringgit changes the portfolio's value.
 */
export function getPortfolioExposure(snapshot: PortfolioSnapshot): PortfolioExposure {
  const held = snapshot.holdings.filter((holding) => holding.units > 0);
  const basis = snapshot.allocationBasis;
  const amount = (holding: PortfolioHolding): number =>
    basis === "market" ? holding.marketValueMyr ?? 0 : holding.investedMyr;
  const totalMyr = held.reduce((sum, holding) => sum + amount(holding), 0);

  const slices = <K extends string>(keyOf: (holding: PortfolioHolding) => K): ExposureSlice<K>[] => {
    const groups = new Map<K, ExposureSlice<K>>();
    for (const holding of held) {
      const key = keyOf(holding);
      const slice = groups.get(key) ?? { key, tickers: [], myr: 0, share: 0 };
      slice.tickers.push(holding.ticker);
      slice.myr += amount(holding);
      groups.set(key, slice);
    }
    return [...groups.values()]
      .map((slice) => ({ ...slice, share: totalMyr > 0 ? slice.myr / totalMyr : 0 }))
      .sort((a, b) => b.myr - a.myr);
  };

  return {
    basis,
    totalMyr,
    markets: slices((holding) => holding.market),
    currencies: slices((holding) => holding.currency),
  };
}

/** One holding by ticker, or undefined. */
export function getHolding(snapshot: PortfolioSnapshot, ticker: Ticker): PortfolioHolding | undefined {
  return snapshot.holdings.find((holding) => holding.ticker === ticker);
}
