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
  return `<aside class="leak-insight-strip leak-insight-strip--${leak.severity}"><div><span class="eyebrow">${escapeHtml(label)}</span><strong>${escapeHtml(leak.title)}</strong><p>${escapeHtml(leak.summary)}</p></div><div class="leak-insight-impact"><small>Potential impact</small><b>${money(leak.monthlyImpact)}${leak.impactBasis === "one-time" ? " observed" : "/mo"}</b><button class="secondary-button dashboard-nav" data-page="money-leaks" data-leak-id="${escapeHtml(leak.id)}" type="button">Review finding</button></div></aside>`;
}
