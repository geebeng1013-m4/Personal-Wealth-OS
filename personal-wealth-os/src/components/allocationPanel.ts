/**
 * The Budget page's content — this month's income routed through the plan, the
 * editor for the rules that route it, the months the user actually had, and the
 * money set aside outside the layers.
 *
 * The Budget page has always shown what each bucket is *meant* to get. This
 * shows where the money that actually arrived went, layer by layer, so a thin
 * month reads as a thin month instead of as an unchanged plan. Each layer row
 * is also where its rule is edited: one list, one set of figures, nothing to
 * reconcile.
 *
 * T-6a layout (see the Budget preview): desktop is four figures, the layers as
 * one table, then the months beside the plan's other rules. A phone reads this
 * month's card, the layers as a grouped list, the months, and what is set
 * aside. Rows open their editor in place.
 *
 * Presentation only. Every figure comes from the canonical budget snapshot; no
 * arithmetic happens here beyond turning ratios into bar widths and adding up
 * figures the snapshot already holds.
 */

import type { BudgetBucketSnapshot, BudgetSnapshot, OutlookMonth } from "../budgetSummary";
import type { AllocationRow, PlanWarning } from "../allocation";
import type { AllocationPlan } from "../models";
import { money } from "../rules";
import { amt, escapeHtml } from "../html";

/** Which row is open, carried by the page across re-renders. */
export interface BudgetView {
  openLayer: number | null;
  openBucket: number | null;
  overflowOpen: boolean;
}

/** One colour per layer, in plan order, shared by the split bar and the rows. */
const LAYER_COLORS = ["var(--accent)", "var(--slate, #6f86a6)", "var(--highlight)", "var(--plum, #a38cc4)", "var(--negative)"];
const layerColor = (index: number): string => LAYER_COLORS[index % LAYER_COLORS.length];

/** A figure without its currency prefix. */
function amountOf(value: number): string {
  return money(value, "").trim();
}

/**
 * The same figure, marked as money so privacy mode blurs it.
 *
 * The sentence builders below return markup for this reason, and escape the
 * layer names they quote themselves — a layer is named by the user.
 */
function figure(value: number): string {
  return amt(amountOf(value));
}

/** "2026-08" → "August 2026", falling back to the raw key. */
function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" });
}

/** "2026-08" → "Aug 2026". */
function shortMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-MY", { month: "short", year: "numeric" });
}

function ruleText(row: AllocationRow): string {
  if (row.stepKind === "fill") return `Fill to ${figure(row.value)}`;
  if (row.stepKind === "gross") return `${row.value}% of all income`;
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
    ? ` This assumes your ${amt(money(emergencyHeldBack))} emergency fund sits in your bank; link the Emergency Fund goal to its account to make it exact.`
    : "";
}

/** The cash a shortfall could draw on, never counting the emergency fund. */
function cashSentence(budget: BudgetSnapshot): string {
  const { spendableCash, cashMonths, emergencyBasis } = budget.allocation;
  const base = emergencyBasis === "none"
    ? `Cash on hand is ${amt(money(spendableCash))}`
    : `Cash outside your emergency fund is ${amt(money(spendableCash))}`;
  return `${base}, about ${cashMonths.toFixed(1)} months of living costs.${assumptionNote(budget)}`;
}

/** What the plan did with one recorded month, in a sentence. */
function outcomeText(month: OutlookMonth): string {
  const { result } = month;
  if (result.shortfall > 0.005) {
    return `${escapeHtml(result.rows[0]?.name ?? "The first layer")} short ${figure(result.shortfall)} — nothing below it funded`;
  }
  const caught = result.rows.find((row) => row.overflow > 0.005);
  if (caught) return `Every layer filled · ${amt(`+${amountOf(caught.overflow)}`)} to ${escapeHtml(caught.name)}`;
  if (result.unassigned > 0.005) return `Every layer filled · ${figure(result.unassigned)} left unassigned`;
  return "Every layer filled";
}

/** A layer's state as a word or two, and its tone. */
function layerStatus(row: AllocationRow): { text: string; tone: string } {
  if (row.overflow > 0.005) return { text: `${amt(`+${amountOf(row.overflow)}`)} extra`, tone: "t-positive" };
  // A layer set to zero asked for nothing and got nothing. Saying "not
  // reached" would blame the month for a choice the user made.
  if (row.want < 0.005) return { text: "Not set", tone: "t-faint" };
  if (row.got < 0.005) return { text: "Not reached", tone: "t-faint" };
  if (row.got >= row.want - 0.005) return { text: "Filled", tone: "t-positive" };
  return { text: `${figure(row.got)} of ${figure(row.want)}`, tone: "wu-budget-part" };
}

/** The rule editor under an open layer row. */
function layerEditor(row: AllocationRow, index: number, total: number): string {
  const kindButton = (kind: string, label: string) =>
    `<button type="button" class="wu-segmented__option layer-kind${row.stepKind === kind ? " is-active" : ""}" data-kind="${kind}" aria-pressed="${row.stepKind === kind}">${label}</button>`;
  return `<form class="wu-stack wu-stack--sm layerForm wu-budget-editor" data-index="${index}">
      <input type="hidden" name="kind" value="${row.stepKind}">
      <div class="wu-segmented wu-budget-kinds" role="group" aria-label="Rule">
        ${kindButton("fill", "Fixed amount")}${kindButton("pct", "% of what's left")}${kindButton("gross", "% of all income")}
      </div>
      <div class="wu-grid wu-grid--2">
        <label class="wu-field-row"><span class="wu-field-row__label">Name</span><input class="wu-field" name="name" type="text" value="${escapeHtml(row.name)}"></label>
        <label class="wu-field-row"><span class="wu-field-row__label js-value-label">${row.stepKind === "fill" ? "Amount MYR" : "Share %"}</span><input class="wu-field" name="value" type="number" min="0" step="${row.stepKind === "fill" ? "1" : "0.1"}" value="${row.value}"></label>
        <label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">What it is for</span><input class="wu-field" name="note" type="text" value="${escapeHtml(row.note ?? "")}" placeholder="What this money is allowed to do"></label>
      </div>
      <div class="wu-row wu-row--tight wu-budget-editor__actions">
        <button class="wu-btn wu-btn--ghost wu-btn--icon move-layer" data-index="${index}" data-dir="up" type="button" aria-label="Move up"${index === 0 ? " disabled" : ""}>↑</button>
        <button class="wu-btn wu-btn--ghost wu-btn--icon move-layer" data-index="${index}" data-dir="down" type="button" aria-label="Move down"${index === total - 1 ? " disabled" : ""}>↓</button>
        <button class="wu-btn wu-btn--ghost wu-btn--sm wu-budget-danger delete-layer" data-index="${index}" type="button">Delete</button>
        <span class="wu-budget-editor__grow"></span>
        <button class="wu-btn wu-btn--ghost wu-btn--sm budget-close" type="button">Cancel</button>
        <button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save</button>
      </div>
    </form>`;
}

function layerRow(row: AllocationRow, index: number, total: number, view: BudgetView): string {
  const open = view.openLayer === index;
  const status = layerStatus(row);
  const filled = row.want > 0 ? Math.min(100, (Math.min(row.got, row.want) / row.want) * 100) : 0;
  return `<li class="wu-budget-layer${open ? " is-open" : ""}">
      <button class="wu-budget-row layer-row" type="button" data-index="${index}" aria-expanded="${open}">
        <i class="wu-budget-row__dot" style="background:${layerColor(index)}" aria-hidden="true"></i>
        <span class="wu-budget-row__title">${escapeHtml(row.name)}<small>${ruleText(row)}</small></span>
        <span class="wu-budget-row__fill" aria-hidden="true"><span class="wu-bar"><span class="wu-bar__fill${status.tone === "wu-budget-part" ? " is-part" : ""}" style="width:${filled}%"></span></span><small>${row.want > 0 ? `${Math.round(filled)}% filled` : "No amount set"}${row.note ? ` · ${escapeHtml(row.note)}` : ""}</small></span>
        <span class="wu-budget-row__got">${figure(row.got)}<small class="${status.tone}">${status.text}</small></span>
        <span class="wu-budget-row__status ${status.tone}">${status.text}</span>
        <span class="wu-budget-row__chev" aria-hidden="true">›</span>
      </button>
      ${open ? layerEditor(row, index, total) : ""}
    </li>`;
}

/** "Leftover goes to" — a row that opens a picker of the layers. */
function overflowRow(budget: BudgetSnapshot, plan: AllocationPlan, view: BudgetView, extraClass = ""): string {
  const rows = budget.allocation.actual.rows;
  const target = rows.find((row) => row.stepId === plan.overflowStepId);
  const options = rows
    .map((row) => `<option value="${escapeHtml(row.stepId)}"${plan.overflowStepId === row.stepId ? " selected" : ""}>${escapeHtml(row.name)}</option>`)
    .join("");
  return `<li class="wu-budget-layer${extraClass ? ` ${extraClass}` : ""}${view.overflowOpen ? " is-open" : ""}">
      <button class="wu-budget-row wu-budget-row--plain overflow-row" type="button" aria-expanded="${view.overflowOpen}">
        <span class="wu-budget-row__title">Leftover goes to<small>Money left after every layer fills</small></span>
        <span class="wu-budget-row__got wu-budget-row__muted">${escapeHtml(target?.name ?? "Nothing")}</span>
        <span class="wu-budget-row__chev" aria-hidden="true">›</span>
      </button>
      ${view.overflowOpen ? `<div class="wu-budget-editor"><label class="wu-field-row"><span class="wu-field-row__label">Money left at the end goes to</span><select class="wu-field overflow-select">${options}</select></label></div>` : ""}
    </li>`;
}

/** A one-time bucket (the Opportunity reserve): outside the layers, its own editor. */
function bucketRow(bucket: BudgetBucketSnapshot, view: BudgetView): string {
  const open = view.openBucket === bucket.index;
  return `<li class="wu-budget-layer${open ? " is-open" : ""}">
      <button class="wu-budget-row wu-budget-row--plain bucket-row" type="button" data-index="${bucket.index}" aria-expanded="${open}">
        <span class="wu-budget-row__title">${escapeHtml(bucket.label || bucket.name)}<small>${escapeHtml(bucket.note || "Used only when the market falls")}</small></span>
        <span class="wu-budget-row__got">${figure(bucket.amount)}</span>
        <span class="wu-budget-row__chev" aria-hidden="true">›</span>
      </button>
      ${open ? `<form class="wu-stack wu-stack--sm bucketForm wu-budget-editor" data-index="${bucket.index}">
        <div class="wu-grid wu-grid--2">
          <label class="wu-field-row"><span class="wu-field-row__label">Name</span><input class="wu-field" name="name" type="text" value="${escapeHtml(bucket.name)}"></label>
          <label class="wu-field-row"><span class="wu-field-row__label">Label</span><input class="wu-field" name="label" type="text" value="${escapeHtml(bucket.label)}"></label>
          <label class="wu-field-row"><span class="wu-field-row__label">Amount MYR</span><input class="wu-field" name="amount" type="number" min="0" step="1" value="${bucket.amount}"></label>
          <label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">Note</span><textarea class="wu-field" name="note" rows="2">${escapeHtml(bucket.note)}</textarea></label>
        </div>
        <div class="wu-row wu-row--tight wu-budget-editor__actions">
          <button class="wu-btn wu-btn--ghost wu-btn--sm wu-budget-danger delete-bucket" data-index="${bucket.index}" type="button">Delete</button>
          <span class="wu-budget-editor__grow"></span>
          <button class="wu-btn wu-btn--ghost wu-btn--sm budget-close" type="button">Cancel</button>
          <button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save</button>
        </div>
      </form>` : ""}
    </li>`;
}

function monthRow(label: string, month: OutlookMonth, bad: boolean): string {
  return `<li class="wu-budget-layer"><div class="wu-budget-row wu-budget-row--plain wu-budget-row--static">
      <span class="wu-budget-row__title">${label} · ${escapeHtml(shortMonth(month.monthKey))}<small>${outcomeText(month)}</small></span>
      <span class="wu-budget-row__got${bad ? " t-negative" : ""}">${figure(month.income)}</span>
    </div></li>`;
}

/**
 * The plan measured against months the user actually had.
 *
 * An average month is the least useful thing to show someone whose income
 * swings — it is the month they never have. The worst one decides whether the
 * plan holds.
 */
function monthsCard(budget: BudgetSnapshot): string {
  const { outlook, spendableCash } = budget.allocation;
  if (!outlook) {
    return `<section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-budget-months" aria-labelledby="budMonthsLabel">
      <div class="wu-tc__top"><span class="wu-label" id="budMonthsLabel">Your months</span></div>
      <p class="wu-dash__note">Record income for two or more months and this will show what your leanest month does to the plan — the month that decides whether it holds.</p>
    </section>`;
  }
  const short = outlook.worst.result.shortfall > 0.005;
  const cover = short
    ? `${amt(money(spendableCash))} outside your emergency fund covers ${outlook.worstMonthsCovered} ${outlook.worstMonthsCovered === 1 ? "month" : "months"} that lean.${assumptionNote(budget)}`
    : "Even your leanest month covered living costs.";
  // With only two months on record the middle one IS the leanest or the best,
  // and printing it again says the same thing twice.
  const typical = outlook.median.monthKey !== outlook.worst.monthKey && outlook.median.monthKey !== outlook.best.monthKey;
  return `<section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-budget-months" aria-labelledby="budMonthsLabel">
      <div class="wu-tc__top"><span class="wu-label" id="budMonthsLabel">Your months</span><span class="wu-chip wu-chip--muted">${Math.round(outlook.spread * 100)}% swing</span></div>
      <ul class="wu-budget-list">
        ${monthRow("Leanest", outlook.worst, short)}
        ${typical ? monthRow("Typical", outlook.median, false) : ""}
        ${outlook.best.monthKey !== outlook.worst.monthKey ? monthRow("Best", outlook.best, false) : ""}
      </ul>
      <p class="wu-dash__note wu-dash__actions">${outlook.history.length} months recorded. ${cover}</p>
    </section>`;
}

export function budgetContent(budget: BudgetSnapshot, plan: AllocationPlan, view: BudgetView): string {
  const { allocation } = budget;
  const month = monthLabel(budget.monthKey);
  const rows = allocation.actual.rows;
  const oneTime = budget.buckets.filter((bucket) => bucket.cadence === "one-time");
  const setAside = oneTime.reduce((sum, bucket) => sum + bucket.amount, 0);
  const nothingIn = allocation.actual.income < 0.005;
  const short = allocation.actual.shortfall > 0.005 && !nothingIn;

  const statusChip = nothingIn
    ? `<span class="wu-chip wu-chip--muted">No income yet</span>`
    : short
      ? `<span class="wu-chip wu-chip--negative">Short ${figure(allocation.actual.shortfall)}</span>`
      : `<span class="wu-chip">On plan</span>`;
  const split = rows.some((row) => row.got > 0.005)
    ? `<div class="wu-split" aria-hidden="true">${rows.map((row, index) => row.got > 0.005 ? `<span style="flex:${row.got};background:${layerColor(index)}"></span>` : "").join("")}${allocation.planned.income > allocation.actual.income ? `<span style="flex:${allocation.planned.income - allocation.actual.income};background:transparent"></span>` : ""}</div>`
    : `<div class="wu-split" aria-hidden="true"></div>`;
  const planLine = nothingIn
    ? "No income recorded yet this month. Record one in the Ledger and it will flow through these layers."
    : `Plan ${figure(allocation.planned.income)} a month · routed top to bottom`;

  const caught = rows.find((row) => row.overflow > 0.005);
  const outlook = allocation.outlook;

  const shortfallBlock = short
    ? `<div class="wu-budget-alert" role="status"><b>${escapeHtml(rows[0].name)} is ${figure(allocation.actual.shortfall)} short</b><span>${cashSentence(budget)} Nothing below this layer is funded this month.</span></div>`
    : "";
  const notes = [
    allocation.actual.unassigned > 0.005 ? `${amt(money(allocation.actual.unassigned))} reached the end with no layer set to catch it.` : "",
    ...allocation.warnings.map(warningText),
  ].filter(Boolean);
  const needsNormalizing = allocation.warnings.some((warning) => warning.code === "percent-total-not-100");
  const percentWarning = allocation.warnings.find((warning) => warning.code === "percent-total-not-100");
  const hasPercent = rows.some((row) => row.stepKind !== "fill");

  const layers = rows.length === 0
    ? `<p class="wu-empty">No layers yet. Add one and it becomes the first place your income flows into.</p>`
    : `<div class="wu-budget-row wu-budget-row--head" aria-hidden="true"><span></span><span>Layer</span><span>Filled</span><span>Got</span><span>Status</span><span></span></div>
      <ul class="wu-budget-list">
        ${rows.map((row, index) => layerRow(row, index, rows.length, view)).join("")}
        ${overflowRow(budget, plan, view, "wu-budget-phone-only")}
      </ul>`;

  return `
    <!-- ROW 1 (desktop) — four figures -->
    <div class="wu-dash__full wu-dash__tiles wu-budget-tiles">
      <section class="wu-card wu-dash__tile" aria-labelledby="budMonthLabel">
        <div class="wu-tc__top"><span class="wu-label" id="budMonthLabel">This month</span>${statusChip}</div>
        <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span class="t-amt">${amountOf(allocation.actual.income)}</span></p>
        <p class="wu-dash__note">Plan ${figure(allocation.planned.income)} a month</p>
        ${split}
      </section>
      <section class="wu-card wu-dash__tile" aria-labelledby="budExtraLabel">
        <div class="wu-tc__top"><span class="wu-label" id="budExtraLabel">Extra caught</span></div>
        <p class="wu-money wu-money--md${caught ? " t-positive" : ""}"><span class="wu-money__cur">MYR</span><span class="t-amt">${caught ? `+${amountOf(caught.overflow)}` : "0"}</span></p>
        <p class="wu-dash__note">${caught ? `Went to ${escapeHtml(caught.name)} after every layer filled` : "Nothing left over after the layers"}</p>
      </section>
      <section class="wu-card wu-dash__tile" aria-labelledby="budSwingLabel">
        <div class="wu-tc__top"><span class="wu-label" id="budSwingLabel">Swing</span>${outlook ? `<span class="wu-chip wu-chip--muted">${outlook.history.length} months</span>` : ""}</div>
        <p class="wu-money wu-money--md"><span>${outlook ? `${Math.round(outlook.spread * 100)}%` : "--"}</span></p>
        <p class="wu-dash__note">${outlook ? `Leanest ${figure(outlook.worst.income)} · best ${figure(outlook.best.income)}` : "Needs two recorded months"}</p>
      </section>
      <section class="wu-card wu-dash__tile" aria-labelledby="budAsideLabel">
        <div class="wu-tc__top"><span class="wu-label" id="budAsideLabel">Set aside</span></div>
        <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span class="t-amt">${amountOf(setAside)}</span></p>
        <p class="wu-dash__note">${oneTime.length ? `${escapeHtml(oneTime.map((bucket) => bucket.label || bucket.name).join(", "))}, outside the layers` : "Nothing set aside"}</p>
      </section>
    </div>

    <!-- phone — this month in one card -->
    <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-budget-month" aria-labelledby="budPhoneMonthLabel">
      <div class="wu-tc__top"><span class="wu-label" id="budPhoneMonthLabel">This month · ${escapeHtml(month)}</span>${statusChip}</div>
      <p class="wu-money"><span class="wu-money__cur">MYR</span><span class="t-amt">${amountOf(allocation.actual.income)}</span></p>
      ${split}
      <p class="wu-dash__note">${planLine}</p>
    </section>

    <!-- LAYERS — a table on a desktop, a grouped list on a phone -->
    <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-budget-layers" aria-labelledby="budLayersLabel">
      <div class="wu-tc__top"><span class="wu-label" id="budLayersLabel">Layers · filled top to bottom</span>${nothingIn ? "" : short ? `<span class="wu-chip wu-chip--negative">${escapeHtml(rows[0]?.name ?? "")} ${figure(allocation.actual.shortfall)} short</span>` : `<span class="wu-chip">All filled</span>`}</div>
      ${shortfallBlock}
      ${layers}
      ${notes.map((note) => `<p class="wu-dash__note wu-budget-note">${note}</p>`).join("")}
      ${needsNormalizing ? `<div><button class="wu-btn wu-btn--secondary wu-btn--sm" id="normalizeLayersBtn" type="button">Make them add to 100%</button></div>` : ""}
      <button class="wu-budget-add add-layer" type="button">+ Add a layer</button>
    </section>

    <!-- ROW 3 — the months you had | the plan's other rules -->
    ${monthsCard(budget)}
    <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-budget-rules" aria-labelledby="budRulesLabel">
      <div class="wu-tc__top"><span class="wu-label" id="budRulesLabel">Plan rules</span></div>
      <ul class="wu-budget-list">
        ${rows.length ? overflowRow(budget, plan, view) : ""}
        <li class="wu-budget-layer"><div class="wu-budget-row wu-budget-row--plain wu-budget-row--static">
          <span class="wu-budget-row__title">Percent layers add up to<small>${hasPercent ? "Shares of what is left and of all income" : "Every layer is a fixed amount"}</small></span>
          <span class="wu-budget-row__got wu-budget-row__muted${percentWarning ? " wu-budget-part" : ""}">${hasPercent ? (percentWarning ? `${percentWarning.value}%` : "100%") : "No % layers"}</span>
        </div></li>
        ${oneTime.map((bucket) => bucketRow(bucket, view)).join("")}
      </ul>
    </section>

    <!-- phone — money set aside outside the layers -->
    ${oneTime.length ? `<section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-budget-aside" aria-labelledby="budPhoneAsideLabel">
      <div class="wu-tc__top"><span class="wu-label" id="budPhoneAsideLabel">Set aside</span></div>
      <ul class="wu-budget-list">${oneTime.map((bucket) => bucketRow(bucket, view)).join("")}</ul>
    </section>` : ""}`;
}
