/**
 * "This month" — the income the Ledger recorded, routed through the plan.
 *
 * The Budget page has always shown what each bucket is *meant* to get. This
 * shows where the money that actually arrived went, layer by layer, so a thin
 * month reads as a thin month instead of as an unchanged plan.
 *
 * Presentation only. Every figure comes from the canonical budget snapshot; no
 * arithmetic happens here beyond turning a ratio into a bar width.
 */

import type { BudgetSnapshot } from "../budgetSummary";
import type { AllocationRow, PlanWarning } from "../allocation";
import { money } from "../rules";
import { escapeHtml } from "../html";

/** "2026-08" → "August 2026", falling back to the raw key. */
function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" });
}

function ruleText(row: AllocationRow): string {
  if (row.stepKind === "fill") return `Fill to ${money(row.want)}`;
  if (row.stepKind === "gross") return `${row.value}% of everything that comes in`;
  return `${row.value}% of what is left`;
}

/** The plan's own problems, in the user's words rather than the model's codes. */
function warningText(warning: PlanWarning): string {
  switch (warning.code) {
    case "percent-total-not-100":
      return `Your percentages add up to ${warning.value}%, not 100%.`;
    case "essential-is-percent":
      return "Your first layer is a percentage, so living costs shrink in a bad month. A fixed amount keeps them steady.";
    case "no-overflow-step":
      return "Nothing is set to catch money left over at the end, so a good month leaves it unassigned.";
    case "duplicate-step-id":
      return "Two layers share the same id.";
    case "negative-value":
      return "A layer has an amount below zero.";
    case "no-steps":
      return "";
    default:
      return "";
  }
}

function layerRow(row: AllocationRow): string {
  const filled = row.want > 0 && row.got >= row.want - 0.005;
  const empty = row.got < 0.005;
  const width = row.want > 0 ? Math.min(100, (row.got / row.want) * 100) : 0;

  // A layer set to zero asked for nothing and got nothing. Saying "not
  // reached" would blame the month for a choice the user made.
  const unset = row.want < 0.005 && row.overflow < 0.005;

  const badge = row.overflow > 0.005
    ? `<span class="wu-badge wu-badge--positive">+${money(row.overflow)} left over</span>`
    : unset
      ? `<span class="wu-badge wu-badge--neutral">Nothing set</span>`
      : empty
        ? `<span class="wu-badge wu-badge--neutral">Not reached</span>`
        : filled
          ? `<span class="wu-badge wu-badge--positive">Filled</span>`
          : `<span class="wu-badge wu-badge--warning">Part way</span>`;

  return `<div class="wu-list__row">
    <div class="wu-stack wu-stack--sm" style="flex:1;min-width:0">
      <div class="wu-row wu-row--between">
        <span class="wu-row wu-row--tight" style="min-width:0">
          <strong class="t-body">${escapeHtml(row.name)}</strong>
          ${badge}
        </span>
        <span class="wu-metric__value t-num">${money(row.got)}</span>
      </div>
      <div class="wu-bar"><span class="wu-bar__fill${empty ? " wu-bar__fill--faint" : ""}" style="width:${width}%"></span></div>
      <span class="wu-label--plain t-caption">${escapeHtml(ruleText(row))}${row.note ? ` &middot; ${escapeHtml(row.note)}` : ""}</span>
    </div>
  </div>`;
}

export function allocationPanel(budget: BudgetSnapshot): string {
  const { allocation } = budget;
  const month = monthLabel(budget.monthKey);

  if (allocation.actual.rows.length === 0) {
    return `<article class="wu-card">
      <div class="wu-stack wu-stack--sm">
        <span class="wu-label">This month &middot; ${escapeHtml(month)}</span>
        <p class="wu-empty">Add a bucket below and it becomes the first layer your income flows into.</p>
      </div>
    </article>`;
  }

  const rows = allocation.actual.rows.map(layerRow).join("");

  const nothingIn = allocation.actual.income < 0.005;
  const lede = nothingIn
    ? `No income recorded yet this month. Record one in the Ledger and it will flow through these layers.`
    : `Recorded in the Ledger, routed top to bottom. A layer only gets what the layers above it left.`;

  const shortfall = allocation.actual.shortfall > 0.005 && !nothingIn
    ? `<aside class="wu-card wu-card--warning wu-card--pad-sm">
        <div class="wu-stack wu-stack--sm">
          <strong class="t-subheading">${escapeHtml(allocation.actual.rows[0].name)} is ${money(allocation.actual.shortfall)} short</strong>
          <p class="t-caption t-muted">Cash on hand is ${money(allocation.cashOnHand)}, about ${allocation.cashMonths.toFixed(1)} months of living costs. Nothing below this layer is funded this month.</p>
        </div>
      </aside>`
    : "";

  const leftOver = allocation.actual.unassigned > 0.005
    ? `<p class="wu-note t-caption">${money(allocation.actual.unassigned)} reached the end with no layer set to catch it.</p>`
    : "";

  const warnings = allocation.warnings
    .map(warningText)
    .filter((text) => text.length > 0)
    .map((text) => `<p class="wu-note t-caption">${escapeHtml(text)}</p>`)
    .join("");

  return `<article class="wu-card">
    <div class="wu-stack">
      <div class="wu-row wu-row--between">
        <span class="wu-label">This month &middot; ${escapeHtml(month)}</span>
        <span class="wu-chip wu-chip--muted">Plan: ${money(allocation.planned.income)} a month</span>
      </div>
      <div class="wu-stack wu-stack--sm">
        <span class="wu-metric__value wu-metric--hero t-num">${money(allocation.actual.income)}</span>
        <span class="wu-label--plain t-caption">${escapeHtml(lede)}</span>
      </div>
      ${shortfall}
      <div class="wu-list">${rows}</div>
      ${leftOver}
      ${warnings}
    </div>
  </article>`;
}
