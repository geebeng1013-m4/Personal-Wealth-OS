/**
 * One disclaimer, everywhere it needs to appear.
 *
 * WealthUp records what the user tells it and runs deterministic, rules-based
 * arithmetic over it — net worth, budgets, a DCA schedule, time-value
 * projections. It makes no market predictions, picks no securities, and its
 * "Advisor" output is procedural ("record this month's contribution"), never a
 * personalised buy/sell call or a return promise. Once the app is a paid
 * product that framing has to be stated to the user, not just true in the code.
 *
 * The wording is deliberately plain and lives in one place so a compliance
 * review changes it once. `disclaimerStrip` is the visible-on-the-page form;
 * `DISCLAIMER_SHORT` is the always-present sidebar line.
 */

export const DISCLAIMER_SHORT = "For guidance only — not financial advice.";

export const DISCLAIMER_TEXT =
  "WealthUp is a personal bookkeeping and planning tool. Its figures and guidance "
  + "are estimates from your own recorded data and stated assumptions, for education "
  + "and planning only. They are not financial, investment, or tax advice, not a "
  + "recommendation to buy or sell anything, and not a forecast of returns. "
  + "You are responsible for your own decisions.";

/**
 * A muted strip for the top of an advice-bearing page. Rendered as a static
 * literal — no user data, nothing to escape.
 */
export function disclaimerStrip(): string {
  return `<p class="wu-disclaimer" role="note">${DISCLAIMER_TEXT}</p>`;
}
