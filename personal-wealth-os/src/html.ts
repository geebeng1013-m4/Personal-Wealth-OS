/**
 * Shared HTML helpers for the page modules.
 *
 * escapeHtml lived in ui.ts while every template did. As pages move out into
 * their own modules they each still need it, and the alternatives are worse:
 * importing it back out of ui.ts makes every page circular with the shell, and
 * a second copy per page is one copy that can be forgotten at the one call site
 * rendering user text.
 */

/**
 * Render `value` as text, not markup.
 *
 * Goes through the DOM's own escaping rather than a hand-written replace chain,
 * so it cannot fall behind on a case the browser already handles. Every
 * interpolation of user-supplied text into a template must pass through here.
 */
export function escapeHtml(value: string): string {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

/**
 * A labelled number field, as used by the forms on nearly every page.
 *
 * Moved here unchanged, including the fact that it interpolates `label` and
 * `value` without escaping them. That is safe only because all 31 call sites
 * pass a literal label and a String(number) value; it would not survive a
 * caller passing user text, and should gain escaping before one does.
 */
export function numberInput(name: string, label: string, value = "", step = "0.01"): string {
  return `<label>${label}<input name="${name}" type="number" min="0" step="${step}" value="${value}"></label>`;
}

/**
 * The active theme, as the root element's data-theme (default "light").
 *
 * A one-line DOM read, shared because the shell's theme toggle and the Market
 * page's chart both branch on it and neither owns it.
 */
export function getTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? "light";
}

/**
 * Mark a formatted figure as money, so privacy mode can blur it.
 *
 * Privacy mode (Settings → "Mask amounts on screen") blurs `.t-amt` and
 * nothing else in new markup, which is why this wraps the figure rather than
 * the sentence around it: "Assets 12,000 · liabilities 3,000" keeps its words
 * readable and hides only the two numbers.
 *
 * Takes the already-formatted string — `money()`, `percent()` and the pages'
 * own prefix-less variants all stay the single formatters — and escapes it,
 * because a figure that ever carries a symbol from remote data must not become
 * markup. Only for text positions: an attribute needs the bare string.
 */
export function amt(figure: string): string {
  return `<span class="t-amt">${escapeHtml(figure)}</span>`;
}

/** Currency-prefixed figures: "MYR 1,234.56", "RM20,000", "USD 0.31". */
const CURRENCY_FIGURE = /(?:MYR|RM|USD|HKD|SGD|GBP|EUR|JPY)\s?-?[\d,]+(?:\.\d+)?/g;

/**
 * Escape a sentence, then mark the money inside it.
 *
 * For text a domain module wrote — a stage reason, an advisor line — where the
 * figures are baked into the sentence and the module has no business returning
 * markup. Only currency-prefixed figures match, so dates, counts and
 * percentages in the same sentence stay as they are.
 */
export function amtIn(text: string): string {
  return escapeHtml(text).replace(CURRENCY_FIGURE, (figure) => `<span class="t-amt">${figure}</span>`);
}
