/**
 * The line under the Ledger's income form that says what the payment is for.
 *
 * "Whatever money comes in, WealthUp tells you what this money is allowed to
 * do" happens here, while the amount is being typed — not a page later on the
 * Budget screen. Presentation only: every figure comes from
 * previewIncomeRouting.
 */

import type { WealthState } from "../models";
import { previewIncomeRouting, type IncomeRoutingInput } from "../incomeRouting";
import { money } from "../rules";
import { amt, escapeHtml } from "../html";

/** "2026-09" → "September". */
function monthName(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-MY", { month: "long" });
}

export function incomeRoutingHint(state: WealthState, input: IncomeRoutingInput): string {
  const preview = previewIncomeRouting(state, input);
  if (!preview) return "";

  if (preview.sponsored) {
    return `<p class="wu-note t-caption">Sponsored money is kept out of your plan, so none of it is routed.</p>`;
  }

  // The context matters as much as the split: a payment that lands after the
  // month's living costs are already covered goes somewhere else entirely.
  // Markup, not text: the figure inside carries the .t-amt mark privacy mode
  // blurs, and everything in the sentence is generated, never user input.
  const context = preview.receivedBefore > 0.005
    ? `On top of ${amt(money(preview.receivedBefore))} already recorded in ${monthName(preview.monthKey)}, this `
    : "This ";

  const split = preview.parts.length > 0
    // Each layer and its amount stay on one line; a name stranded from its
    // figure on a narrow screen reads as two separate facts.
    ? preview.parts.map((part) => `<span style="white-space:nowrap"><strong>${escapeHtml(part.name)}</strong> ${amt(money(part.amount))}</span>`).join(" &middot; ")
    : "";

  const lines = [
    split
      ? `<p class="t-body-sm">${context}${amt(money(preview.amount))} goes to ${split}</p>`
      : `<p class="t-body-sm">${context}${amt(money(preview.amount))} is not claimed by any layer.</p>`,
  ];

  if (preview.stillShort > 0.005 && preview.essentialName) {
    lines.push(`<p class="t-caption t-muted">${escapeHtml(preview.essentialName)} still needs ${amt(money(preview.stillShort))} this month.</p>`);
  }
  if (split && preview.unclaimed > 0.005) {
    lines.push(`<p class="t-caption t-muted">${amt(money(preview.unclaimed))} is not claimed by any layer.</p>`);
  }

  return `<div class="wu-card wu-card--inset wu-card--pad-sm wu-stack wu-stack--sm">
    <span class="wu-label">Where this goes</span>
    ${lines.join("")}
  </div>`;
}
