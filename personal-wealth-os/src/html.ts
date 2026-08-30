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
