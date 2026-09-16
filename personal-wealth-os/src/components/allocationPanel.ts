/**
 * "This month" — the income the Ledger recorded, routed through the plan, and
 * the editor for the rules that route it.
 *
 * The Budget page has always shown what each bucket is *meant* to get. This
 * shows where the money that actually arrived went, layer by layer, so a thin
 * month reads as a thin month instead of as an unchanged plan. Each row is also
 * where its rule is edited: one list, one set of figures, nothing to reconcile.
 *
 * Presentation only. Every figure comes from the canonical budget snapshot; no
 * arithmetic happens here beyond turning a ratio into a bar width.
 */

import type { BudgetSnapshot, OutlookMonth } from "../budgetSummary";
import type { AllocationRow, PlanWarning } from "../allocation";
import type { AllocationPlan } from "../models";
import { money } from "../rules";
import { escapeHtml } from "../html";

/** "2026-08" → "August 2026", falling back to the raw key. */
function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" });
}

function ruleText(row: AllocationRow): string {
  if (row.stepKind === "fill") return `Fill to ${money(row.value)}`;
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

/**
 * Where the spendable figure came from, said out loud when it rests on an
 * assumption. A number the page guessed at must not read like one it knows.
 */
function assumptionNote(budget: BudgetSnapshot): string {
  const { emergencyBasis, emergencyHeldBack } = budget.allocation;
  return emergencyBasis === "assumed-in-cash"
    ? ` This assumes your ${money(emergencyHeldBack)} emergency fund sits in your bank; link the Emergency Fund goal to its account to make it exact.`
    : "";
}

/** The cash a shortfall could draw on, never counting the emergency fund. */
function cashSentence(budget: BudgetSnapshot): string {
  const { spendableCash, cashMonths, emergencyBasis } = budget.allocation;
  const base = emergencyBasis === "none"
    ? `Cash on hand is ${money(spendableCash)}`
    : `Cash outside your emergency fund is ${money(spendableCash)}`;
  return `${base}, about ${cashMonths.toFixed(1)} months of living costs.${assumptionNote(budget)}`;
}

/** "2026-08" → "Aug 2026". */
function shortMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-MY", { month: "short", year: "numeric" });
}

/** What the plan did with one recorded month, in a sentence. */
function outcomeText(month: OutlookMonth): string {
  const { result } = month;
  if (result.shortfall > 0.005) {
    return `${result.rows[0]?.name ?? "The first layer"} short ${money(result.shortfall)} — nothing below it funded`;
  }
  const caught = result.rows.find((row) => row.overflow > 0.005);
  if (caught) return `every layer filled, ${money(caught.overflow)} extra into ${caught.name}`;
  if (result.unassigned > 0.005) return `every layer filled, ${money(result.unassigned)} left unassigned`;
  return "every layer filled";
}

function outlookRow(label: string, month: OutlookMonth, tone: "bad" | "plain"): string {
  return `<div class="wu-list__row">
    <div class="wu-stack wu-stack--sm" style="flex:1;min-width:0">
      <div class="wu-row wu-row--between">
        <span class="wu-row wu-row--tight" style="min-width:0">
          <strong class="t-body">${label}</strong>
          <span class="wu-label--plain t-caption">${shortMonth(month.monthKey)}</span>
        </span>
        <span class="wu-metric__value t-num${tone === "bad" ? " wu-metric__value--negative" : ""}">${money(month.income)}</span>
      </div>
      <span class="wu-label--plain t-caption">${escapeHtml(outcomeText(month))}</span>
    </div>
  </div>`;
}

/**
 * The plan measured against months the user actually had.
 *
 * An average month is the least useful thing to show someone whose income
 * swings — it is the month they never have. The worst one decides whether the
 * plan holds.
 */
function outlookCard(budget: BudgetSnapshot): string {
  const { outlook, spendableCash } = budget.allocation;

  if (!outlook) {
    return `<article class="wu-card wu-card--bare">
      <div class="wu-stack wu-stack--sm">
        <span class="wu-label">Your worst month</span>
        <p class="wu-label--plain t-caption">Record income for two or more months and this will show what your leanest month does to the plan — the month that decides whether it holds.</p>
      </div>
    </article>`;
  }

  const short = outlook.worst.result.shortfall > 0.005;
  const cover = short
    ? `${money(spendableCash)} outside your emergency fund covers ${outlook.worstMonthsCovered} ${outlook.worstMonthsCovered === 1 ? "month" : "months"} that lean.${assumptionNote(budget)}`
    : `Even your leanest month covered living costs.`;

  return `<article class="wu-card" style="margin-top:var(--space-4)">
    <div class="wu-stack">
      <div class="wu-row wu-row--between">
        <span class="wu-label">The months you actually had</span>
        <span class="wu-chip wu-chip--muted">${outlook.history.length} recorded &middot; ${Math.round(outlook.spread * 100)}% swing</span>
      </div>
      <div class="wu-list">
        ${outlookRow("Leanest", outlook.worst, short ? "bad" : "plain")}
        ${/* With only two months on record the middle one IS the leanest or the
             best, and printing it again says the same thing twice. */
          outlook.median.monthKey !== outlook.worst.monthKey && outlook.median.monthKey !== outlook.best.monthKey
            ? outlookRow("Typical", outlook.median, "plain")
            : ""}
        ${outlook.best.monthKey !== outlook.worst.monthKey ? outlookRow("Best", outlook.best, "plain") : ""}
      </div>
      <p class="wu-note t-caption">${escapeHtml(cover)}</p>
    </div>
  </article>`;
}

/** The inline rule editor, hidden until its row's Edit button is pressed. */
function layerForm(row: AllocationRow, index: number, total: number): string {
  const kindOption = (value: string, label: string) =>
    `<option value="${value}"${row.stepKind === value ? " selected" : ""}>${label}</option>`;

  return `<div class="layer-edit-form is-hidden" id="layerEdit${index}">
    <form class="wu-stack layerForm" data-index="${index}">
      <label class="wu-field-row"><span class="wu-field-row__label">Name</span><input class="wu-field" name="name" type="text" value="${escapeHtml(row.name)}"></label>
      <label class="wu-field-row"><span class="wu-field-row__label">Rule</span><select class="wu-field" name="kind">
        ${kindOption("fill", "Fill to a fixed amount")}
        ${kindOption("pct", "A share of what is left")}
        ${kindOption("gross", "A share of everything that comes in")}
      </select></label>
      <label class="wu-field-row"><span class="wu-field-row__label js-value-label">${row.stepKind === "fill" ? "Amount MYR" : "Share %"}</span><input class="wu-field" name="value" type="number" min="0" step="${row.stepKind === "fill" ? "1" : "0.1"}" value="${row.value}"></label>
      <label class="wu-field-row"><span class="wu-field-row__label">What it is for</span><input class="wu-field" name="note" type="text" value="${escapeHtml(row.note ?? "")}" placeholder="What this money is allowed to do"></label>
      <div class="wu-row">
        <button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save</button>
        <button class="wu-btn wu-btn--secondary wu-btn--sm cancel-layer-edit" data-index="${index}" type="button">Cancel</button>
        <button class="wu-btn wu-btn--ghost wu-btn--sm move-layer" data-index="${index}" data-dir="up" type="button"${index === 0 ? " disabled" : ""}>Move up</button>
        <button class="wu-btn wu-btn--ghost wu-btn--sm move-layer" data-index="${index}" data-dir="down" type="button"${index === total - 1 ? " disabled" : ""}>Move down</button>
        <button class="wu-btn wu-btn--danger wu-btn--sm delete-layer" data-index="${index}" type="button">Delete</button>
      </div>
    </form>
  </div>`;
}

function layerRow(row: AllocationRow, index: number, total: number): string {
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
          <span class="wu-label--plain t-caption">${index + 1}</span>
          <strong class="t-body">${escapeHtml(row.name)}</strong>
          ${badge}
        </span>
        <span class="wu-row wu-row--tight">
          <span class="wu-metric__value t-num">${money(row.got)}</span>
          <button class="wu-btn wu-btn--ghost wu-btn--sm edit-layer" data-index="${index}" type="button">Edit</button>
        </span>
      </div>
      <div class="wu-bar"><span class="wu-bar__fill${empty ? " wu-bar__fill--faint" : ""}" style="width:${width}%"></span></div>
      <span class="wu-label--plain t-caption">${escapeHtml(ruleText(row))}${row.note ? ` &middot; ${escapeHtml(row.note)}` : ""}</span>
      ${layerForm(row, index, total)}
    </div>
  </div>`;
}

export function allocationPanel(budget: BudgetSnapshot, plan: AllocationPlan): string {
  const { allocation } = budget;
  const month = monthLabel(budget.monthKey);
  const rows = allocation.actual.rows;

  const addLayer = `<button class="wu-add" id="addLayerBtn" type="button">` +
    `<span class="wu-add__plus" aria-hidden="true">+</span><span>Add a layer</span></button>`;

  if (rows.length === 0) {
    return `<article class="wu-card">
      <div class="wu-stack">
        <span class="wu-label">This month &middot; ${escapeHtml(month)}</span>
        <p class="wu-empty">No layers yet. Add one and it becomes the first place your income flows into.</p>
        ${addLayer}
      </div>
    </article>`;
  }

  const nothingIn = allocation.actual.income < 0.005;
  const lede = nothingIn
    ? "No income recorded yet this month. Record one in the Ledger and it will flow through these layers."
    : "Recorded in the Ledger, routed top to bottom. A layer only gets what the layers above it left.";

  const shortfall = allocation.actual.shortfall > 0.005 && !nothingIn
    ? `<aside class="wu-card wu-card--warning wu-card--pad-sm">
        <div class="wu-stack wu-stack--sm">
          <strong class="t-subheading">${escapeHtml(rows[0].name)} is ${money(allocation.actual.shortfall)} short</strong>
          <p class="t-caption t-muted">${escapeHtml(cashSentence(budget))} Nothing below this layer is funded this month.</p>
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

  const needsNormalizing = allocation.warnings.some((warning) => warning.code === "percent-total-not-100");
  const normalize = needsNormalizing
    ? `<button class="wu-btn wu-btn--secondary wu-btn--sm" id="normalizeLayersBtn" type="button">Make them add to 100%</button>`
    : "";

  const overflowOptions = rows
    .map((row) => `<option value="${escapeHtml(row.stepId)}"${plan.overflowStepId === row.stepId ? " selected" : ""}>${escapeHtml(row.name)}</option>`)
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
      <div class="wu-list">${rows.map((row, index) => layerRow(row, index, rows.length)).join("")}</div>
      ${leftOver}
      ${warnings}
      <div class="wu-row wu-row--between" style="flex-wrap:wrap;gap:var(--space-3)">
        <label class="wu-field-row" style="flex:1;min-width:220px">
          <span class="wu-field-row__label">Money left at the end goes to</span>
          <select class="wu-field" id="overflowSelect">${overflowOptions}</select>
        </label>
        ${normalize}
      </div>
      ${addLayer}
    </div>
  </article>
  ${outlookCard(budget)}`;
}
