/**
 * The one-line Money Leaks banner that six pages carry.
 *
 * Ledger, Budget, Goals, Advisor, Rules and Review each surface the single most
 * relevant leak for their own categories, linking through to the Money Leaks
 * page for the detail. It lives here rather than in any one of them because it
 * belongs to none of them.
 *
 * Detection only — the strip states what was found and links onward. It never
 * carries advice, which keeps it on the right side of the split the
 * architecture tests enforce: Money Leaks detect WHAT happened, the Advisor
 * says what to do about it.
 */

import type { WealthState } from "../models";
import type { MoneyLeakCategory } from "../moneyLeaks";
import { detectMoneyLeaks } from "../advisor";
import { money } from "../rules";
import { escapeHtml } from "../html";

export function leakInsightStrip(state: WealthState, categories: MoneyLeakCategory[], label: string): string {
  const leak = detectMoneyLeaks(state).leaks.find((item) => categories.includes(item.category));
  if (!leak) return "";
  const tone = leak.severity === "high" ? "wu-card--negative" : leak.severity === "medium" ? "wu-card--warning" : "wu-card--accent";
  return `<aside class="wu wu-card wu-card--pad-sm ${tone}" style="margin:var(--space-3) 0">
    <div class="wu-row wu-row--between" style="align-items:flex-start;gap:var(--space-4)">
      <div class="wu-stack wu-stack--sm">
        <span class="wu-label">${escapeHtml(label)}</span>
        <strong class="t-subheading">${escapeHtml(leak.title)}</strong>
        <p class="t-caption t-muted">${escapeHtml(leak.summary)}</p>
      </div>
      <div class="wu-stack wu-stack--sm" style="align-items:flex-end;flex:none">
        <span class="wu-metric wu-metric--end"><span class="wu-metric__label wu-label">Potential impact</span><span class="t-num t-subheading">${money(leak.monthlyImpact)}${leak.impactBasis === "one-time" ? " observed" : "/mo"}</span></span>
        <button class="wu-btn wu-btn--secondary wu-btn--sm dashboard-nav" data-page="money-leaks" data-leak-id="${escapeHtml(leak.id)}" type="button">Review finding</button>
      </div>
    </div>
  </aside>`;
}
