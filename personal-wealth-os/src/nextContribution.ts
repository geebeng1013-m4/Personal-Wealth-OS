/**
 * The one sentence at the top of Portfolio's "Next contribution" card.
 *
 * Reads the split rebalanceContributions already decided and says it plainly —
 * which holding this month's money goes into, and whether that is because it
 * is the only one below target. No new arithmetic: the amounts are the plan's
 * own, and "below target" is the holding's own drift sign.
 */

export interface ContributionSplit {
  ticker: string;
  amount: number;
}

export type NextContributionLead =
  | { kind: "none" }
  | { kind: "one"; ticker: string; amount: number; onlyBelowTarget: boolean }
  | { kind: "split"; tickers: string[]; amount: number };

/** Anything under half a sen is rounding noise, not money going anywhere. */
const FUNDED = 0.005;
/** A weight within 0.05 points of target is on target, not under it. */
const BELOW_TARGET = 0.0005;

export function nextContributionLead(
  plan: ContributionSplit[],
  holdings: Array<{ ticker: string; drift: number }>,
): NextContributionLead {
  const funded = plan.filter((item) => item.amount > FUNDED);
  const amount = funded.reduce((sum, item) => sum + item.amount, 0);
  if (funded.length === 0) return { kind: "none" };
  if (funded.length === 1) {
    const ticker = funded[0].ticker;
    const below = holdings.filter((holding) => holding.drift < -BELOW_TARGET);
    return { kind: "one", ticker, amount, onlyBelowTarget: below.length === 1 && below[0].ticker === ticker };
  }
  return { kind: "split", tickers: funded.map((item) => item.ticker), amount };
}
