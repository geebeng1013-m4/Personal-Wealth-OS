/**
 * One page header for every page.
 *
 * Replaces the four patterns the app grew: `.section-title` (Goals / Budget /
 * Ledger / Settings), `.ov-header` (Dashboard), the inert `page-shell` /
 * `page-header` on Money Leaks, and the header-less `.panel-head` + inline
 * pseudo-badge on Advisor / Review.
 *
 * `title` is the only required field. `actions` and `badge` take raw HTML so a
 * caller can drop in `wu-btn`s or a `wu-badge`. Everything is pre-escaped by the
 * caller where it's user data; the fixed strings here are literals.
 */

import { escapeHtml } from "../html";

export interface PageHeaderParts {
  /** Uppercase micro label above the title. */
  eyebrow?: string;
  /** The page name. Required. */
  title: string;
  /** One plain sentence under the title. */
  sub?: string;
  /** Raw HTML shown at the right of the title row — a badge or short status. */
  badge?: string;
  /** Raw HTML of action buttons, shown below the sub. */
  actions?: string;
}

export function pageHeader({ eyebrow, title, sub, badge, actions }: PageHeaderParts): string {
  return `<header class="wu-page-header">
    ${eyebrow ? `<p class="wu-page-header__eyebrow t-overline">${escapeHtml(eyebrow)}</p>` : ""}
    <div class="wu-page-header__bar">
      <h1 class="wu-page-header__title t-title">${escapeHtml(title)}</h1>
      ${badge ? `<span class="wu-page-header__badge">${badge}</span>` : ""}
    </div>
    ${sub ? `<p class="wu-page-header__sub t-body-sm">${escapeHtml(sub)}</p>` : ""}
    ${actions ? `<div class="wu-page-header__actions">${actions}</div>` : ""}
  </header>`;
}
