/**
 * The tickers the investment plan offers a box for.
 *
 * Settings used to hard-code VOO and QQQM, so saving the DCA targets or the
 * opportunity split silently dropped every other ticker (VXUS's 10% vanished on
 * the first save). The plan now lists every ticker the user is actually dealing
 * with: the ones that already have a target, the ones they have traded, and the
 * custom ones they added — in that order, each once.
 */

import type { WealthState } from "./models";

export function planTickers(state: Pick<WealthState, "dca" | "trades" | "customTickers">): string[] {
  const seen = new Set<string>();
  const add = (raw: string | undefined): void => {
    const ticker = raw?.trim().toUpperCase();
    if (ticker) seen.add(ticker);
  };
  Object.keys(state.dca.targets).forEach(add);
  state.trades.forEach((trade) => add(trade.ticker));
  state.customTickers.forEach(add);
  return [...seen];
}

/** Tickers with at least one trade — these can be set to 0% but not removed. */
export function tradedTickers(state: Pick<WealthState, "trades">): Set<string> {
  return new Set(state.trades.map((trade) => trade.ticker.trim().toUpperCase()).filter(Boolean));
}

/**
 * The custom-ticker list after a plan save: every planned ticker that is not a
 * built-in trade-form option is offered in Portfolio's ticker dropdown too, so
 * an ETF added in Settings can be bought without typing it again.
 */
export function withPlannedCustomTickers(customTickers: string[], planned: string[]): string[] {
  const builtIn = new Set(["VOO", "QQQM"]);
  const next = [...customTickers];
  for (const ticker of planned) {
    if (!builtIn.has(ticker) && !next.includes(ticker)) next.push(ticker);
  }
  return next;
}
