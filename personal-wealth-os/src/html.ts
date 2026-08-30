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
 * The active theme, as the root element's data-theme (default "dark").
 *
 * A one-line DOM read, shared because the shell's theme toggle and the Market
 * page's chart both branch on it and neither owns it.
 */
export function getTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? "dark";
}
