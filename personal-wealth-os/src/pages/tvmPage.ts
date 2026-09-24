/**
 * TVM Calculator page — the classic five-variable solver, plus two small tools.
 *
 * Fill any four of PV / PMT / FV / Rate / Periods and solve for the fifth; an
 * inflation adjustment; and "what if I spend this", a hypothetical spend
 * against the user's real Emergency Fund and current goal.
 *
 * T-6c layout: the three tools sit behind one segmented control, one showing at
 * a time. Each is its inputs beside its result on a desktop, the result on top
 * on a phone. The five TVM values are typed straight into their rows, and each
 * row keeps its own solve button (PV, PMT, FV, Rate, Periods).
 *
 * Inputs are session-only, held in module state and deliberately not persisted
 * to WealthState, localStorage or Firebase. The calculator explores
 * hypotheticals; none of it is a recorded financial fact, and writing it into
 * the state would make it look like one. Refreshing resets it, which is the
 * correct behaviour for a scratchpad.
 *
 * The arithmetic all lives in ./tvm and ./whatIf — this module only renders it
 * and wires up the events.
 */

import type { WealthState } from "../models";
import { money, percent } from "../rules";
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import {
  calculateInflationAdjustedValue,
  solveTvm,
  COMPOUNDING_LABELS,
  type CompoundingFrequency,
  type PaymentTiming,
  type RateKind,
  type TvmSolveInput,
  type TvmVariable,
} from "../tvm";
import { getSpendingImpact, type SpendingImpact, type SpendMode } from "../whatIf";

type TvmFieldName = "presentValue" | "payment" | "futureValue" | "annualRatePercent" | "periods";
type TvmTab = "tvm" | "inflation" | "whatif";

const TVM_DEFAULTS: Record<TvmFieldName, string> = {
  presentValue: "-1000",
  payment: "-300",
  futureValue: "",
  annualRatePercent: "8",
  periods: "120",
};

let tvmTab: TvmTab = "tvm";
let tvmValues: Record<TvmFieldName, string> = { ...TVM_DEFAULTS };
let tvmFrequency: CompoundingFrequency = "monthly";
let tvmTiming: PaymentTiming = "end";
let tvmRateKind: RateKind = "nominal";
/** The most recent solve, so the result panel survives re-renders. */
let tvmSolved: { variable: TvmVariable; result: ReturnType<typeof solveTvm> } | null = null;

/** Inflation is a separate small tool, not one of the five variables. */
const tvmInflation = { futureAmount: "100000", inflationRatePercent: "3", years: "10" };

/** What-if is a third separate tool: a hypothetical spend against real state. */
let tvmWhatIfAmount = "";
let tvmWhatIfMode: SpendMode = "once";

const TVM_ROWS: Array<{ name: TvmFieldName; label: string; button: string; unit: string; step: string }> = [
  { name: "presentValue", label: "Present value", button: "PV", unit: "MYR", step: "100" },
  { name: "payment", label: "Payment", button: "PMT", unit: "MYR", step: "50" },
  { name: "futureValue", label: "Future value", button: "FV", unit: "MYR", step: "1000" },
  { name: "annualRatePercent", label: "Annual rate", button: "Rate", unit: "%", step: "0.1" },
  { name: "periods", label: "Periods", button: "Periods", unit: "n", step: "1" },
];

const TABS: Array<{ id: TvmTab; label: string }> = [
  { id: "tvm", label: "TVM" },
  { id: "inflation", label: "Inflation" },
  { id: "whatif", label: "What if I spend this?" },
];

/** A figure without its currency prefix. */
function amountOf(value: number): string {
  return money(value, "").trim();
}

/** Parse a field. Empty means "not filled in", never silently 0. */
function tvmNumber(name: TvmFieldName): number {
  const raw = tvmValues[name].trim();
  if (raw === "") return Number.NaN;
  return Number(raw);
}

function tvmSolveInput(): TvmSolveInput {
  return {
    presentValue: tvmNumber("presentValue"),
    payment: tvmNumber("payment"),
    futureValue: tvmNumber("futureValue"),
    annualRatePercent: tvmNumber("annualRatePercent"),
    periods: tvmNumber("periods"),
    frequency: tvmFrequency,
    timing: tvmTiming,
    rateKind: tvmRateKind,
  };
}

function tvmFormat(variable: TvmVariable, value: number): string {
  if (variable === "annualRatePercent") return `${(Math.round(value * 1000) / 1000).toLocaleString("en-MY")}%`;
  if (variable === "periods") return `${Math.round(value * 100) / 100}`;
  return money(value);
}

const TVM_LABELS: Record<TvmVariable, string> = {
  presentValue: "Present value",
  payment: "Payment",
  futureValue: "Future value",
  annualRatePercent: "Annual rate",
  periods: "Periods",
};

/** A small two- or three-way choice built from buttons. */
function choice(name: string, options: Array<{ value: string; label: string }>, current: string, label: string): string {
  return `<div class="wu-segmented wu-tvm-choice" role="group" aria-label="${escapeHtml(label)}">${options.map((option) =>
    `<button type="button" class="wu-segmented__option${option.value === current ? " is-active" : ""}" data-tvm-choice="${name}" data-value="${option.value}" aria-pressed="${option.value === current}">${escapeHtml(option.label)}</button>`).join("")}</div>`;
}

function errorList(errors: Array<{ message: string }>): string {
  return `<ul class="wu-tvm-errors" role="alert">${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join("")}</ul>`;
}

// --- TVM ------------------------------------------------------------------

function tvmResultTemplate(): string {
  if (!tvmSolved) {
    return `<div class="wu-tc__top"><span class="wu-label">Result</span></div>
      <p class="wu-dash__note">Fill in any four values, then press the button beside the one you want to solve (PV, PMT, FV, Rate or Periods).</p>`;
  }

  const { variable, result } = tvmSolved;
  if (!result.ok) {
    return `<div class="wu-tc__top"><span class="wu-label">${escapeHtml(TVM_LABELS[variable])}</span><span class="wu-chip wu-chip--negative">Can't solve</span></div>
      <p class="wu-money"><span>—</span></p>
      ${errorList(result.errors)}`;
  }

  const v = result.value;
  // Money paid in carries a minus sign under the cash-flow convention; the bar
  // compares what went in with what it grew by, so both read as positive.
  const putIn = Math.max(0, -v.presentValue) + Math.max(0, -v.totalPayments);
  const showSplit = putIn > 0.005 && v.totalInterest > 0.005 && v.futureValue > 0;
  const periodsLabel = `${Math.round(v.periods * 100) / 100} ${COMPOUNDING_LABELS[tvmFrequency].toLowerCase()} periods`;
  const value = tvmFormat(variable, v.value);
  const currency = variable !== "annualRatePercent" && variable !== "periods";
  return `<div class="wu-tc__top"><span class="wu-label">Solved for ${escapeHtml(TVM_LABELS[variable])}</span>${v.totalInterest > 0.005 ? `<span class="wu-chip">+${amountOf(v.totalInterest)} interest</span>` : ""}</div>
      <p class="wu-money">${currency ? `<span class="wu-money__cur">MYR</span><span>${escapeHtml(value.replace(/^MYR\s*/, ""))}</span>` : `<span>${escapeHtml(value)}</span>`}</p>
      ${showSplit ? `<div class="wu-split wu-tvm-split" aria-hidden="true"><span style="flex:${putIn};background:var(--text-faint)"></span><span style="flex:${v.totalInterest};background:var(--accent)"></span></div>
      <div class="wu-legend"><span><i style="background:var(--text-faint)"></i>You put in <b>${amountOf(putIn)}</b></span><span><i style="background:var(--accent)"></i>Interest <b>${amountOf(v.totalInterest)}</b></span></div>` : ""}
      <ul class="wu-facts wu-facts--plain">
        <li><span>Present value</span><span>${money(v.presentValue)}</span></li>
        <li><span>Payment</span><span>${money(v.payment)}</span></li>
        <li><span>Future value</span><span>${money(v.futureValue)}</span></li>
        <li><span>Annual rate</span><span>${Math.round(v.annualRatePercent * 1000) / 1000}% ${escapeHtml(tvmRateKind)}</span></li>
        <li><span>Periods</span><span>${escapeHtml(periodsLabel)}</span></li>
        <li><span>Total payments</span><span>${money(v.totalPayments)}</span></li>
      </ul>
      <p class="wu-dash__note wu-dash__actions">Based on your own assumptions: ${escapeHtml(COMPOUNDING_LABELS[tvmFrequency].toLowerCase())} compounding, payments at the ${tvmTiming === "end" ? "end" : "beginning"} of each period, ${escapeHtml(tvmRateKind)} rate. Projections only — not guaranteed returns or investment advice.</p>`;
}

function tvmToolTemplate(): string {
  return `
    <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-tvm-inputs" aria-labelledby="tvmInputsLabel">
      <div class="wu-tc__top"><span class="wu-label" id="tvmInputsLabel">Inputs</span></div>
      <ul class="wu-tvm-rows">
        ${TVM_ROWS.map((row) => `
          <li class="wu-tvm-row">
            <label class="wu-tvm-row__label" for="tvm-${row.name}">${escapeHtml(row.label)}</label>
            <span class="wu-tvm-row__input">
              <input class="wu-field" id="tvm-${row.name}" type="number" inputmode="decimal"
                     step="${row.step}" value="${escapeHtml(tvmValues[row.name])}"
                     data-tvm-input="${row.name}" aria-describedby="tvmSignNote">
              <span class="wu-tvm-row__unit" aria-hidden="true">${escapeHtml(row.unit)}</span>
            </span>
            <button class="wu-btn wu-btn--secondary wu-btn--sm wu-tvm-solve${tvmSolved?.variable === row.name ? " is-solved" : ""}" type="button"
                    data-tvm-solve="${row.name}" aria-label="Solve for ${escapeHtml(row.label)}">${escapeHtml(row.button)}</button>
          </li>`).join("")}
        <li class="wu-tvm-row wu-tvm-row--option">
          <label class="wu-tvm-row__label" for="tvmFrequency">Compounding</label>
          <select class="wu-field" id="tvmFrequency" data-tvm-frequency>
            ${(Object.keys(COMPOUNDING_LABELS) as CompoundingFrequency[]).map((key) => `
              <option value="${key}"${key === tvmFrequency ? " selected" : ""}>${escapeHtml(COMPOUNDING_LABELS[key])}</option>`).join("")}
          </select>
        </li>
        <li class="wu-tvm-row wu-tvm-row--option">
          <span class="wu-tvm-row__label">Rate is</span>
          ${choice("ratekind", [{ value: "nominal", label: "Nominal" }, { value: "effective", label: "Effective" }], tvmRateKind, "Rate kind")}
        </li>
        <li class="wu-tvm-row wu-tvm-row--option">
          <span class="wu-tvm-row__label">Payments at</span>
          ${choice("timing", [{ value: "end", label: "End" }, { value: "beginning", label: "Beginning" }], tvmTiming, "Payment timing")}
        </li>
      </ul>
      <p class="wu-dash__note wu-dash__actions" id="tvmSignNote">Money you pay in is negative; money you get back is positive. Press the button beside the value you want to solve — it is filled in for you.</p>
    </section>
    <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-tvm-result" id="tvmOutput" aria-live="polite">
      ${tvmResultTemplate()}
    </section>`;
}

// --- Inflation ------------------------------------------------------------

function tvmInflationResult(): string {
  const result = calculateInflationAdjustedValue({
    futureAmount: Number(tvmInflation.futureAmount.trim() === "" ? Number.NaN : tvmInflation.futureAmount),
    inflationRatePercent: Number(tvmInflation.inflationRatePercent.trim() === "" ? Number.NaN : tvmInflation.inflationRatePercent),
    years: Number(tvmInflation.years.trim() === "" ? Number.NaN : tvmInflation.years),
  });
  if (!result.ok) {
    return `<div class="wu-tc__top"><span class="wu-label">Today's purchasing power</span><span class="wu-chip wu-chip--negative">Check inputs</span></div>
      <p class="wu-money"><span>—</span></p>
      ${errorList(result.errors)}`;
  }
  const kept = result.value.todaysPurchasingPower;
  const lost = result.value.purchasingPowerLoss;
  return `<div class="wu-tc__top"><span class="wu-label">Today's purchasing power</span><span class="wu-chip wu-chip--warning">−${percent(result.value.purchasingPowerLossPercent, 1)}</span></div>
      <p class="wu-money"><span class="wu-money__cur">MYR</span><span>${amountOf(kept)}</span></p>
      ${kept > 0 && lost > 0 ? `<div class="wu-split wu-tvm-split" aria-hidden="true"><span style="flex:${kept};background:var(--accent)"></span><span style="flex:${lost};background:var(--highlight)"></span></div>
      <div class="wu-legend"><span><i style="background:var(--accent)"></i>Still worth <b>${amountOf(kept)}</b></span><span><i style="background:var(--highlight)"></i>Lost to inflation <b>${amountOf(lost)}</b></span></div>` : ""}
      <p class="wu-dash__note wu-dash__actions">Assumes a constant ${escapeHtml(tvmInflation.inflationRatePercent || "0")}% inflation a year.</p>`;
}

function tvmInflationTemplate(): string {
  const fields: Array<{ name: keyof typeof tvmInflation; label: string; unit: string; step: string }> = [
    { name: "futureAmount", label: "Future amount", unit: "MYR", step: "1000" },
    { name: "inflationRatePercent", label: "Inflation rate", unit: "%", step: "0.1" },
    { name: "years", label: "Years", unit: "years", step: "1" },
  ];
  return `
    <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-tvm-inputs" aria-labelledby="tvmInfLabel">
      <div class="wu-tc__top"><span class="wu-label" id="tvmInfLabel">Inputs</span></div>
      <p class="wu-dash__note">What a future amount is worth in today's money.</p>
      <ul class="wu-tvm-rows">
        ${fields.map((field) => `
          <li class="wu-tvm-row wu-tvm-row--plain">
            <label class="wu-tvm-row__label" for="tvmInf-${field.name}">${escapeHtml(field.label)}</label>
            <span class="wu-tvm-row__input">
              <input class="wu-field" id="tvmInf-${field.name}" type="number" inputmode="decimal"
                     step="${field.step}" value="${escapeHtml(tvmInflation[field.name])}"
                     data-tvm-inflation="${field.name}">
              <span class="wu-tvm-row__unit" aria-hidden="true">${escapeHtml(field.unit)}</span>
            </span>
          </li>`).join("")}
      </ul>
    </section>
    <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-tvm-result" id="tvmInflationOutput" aria-live="polite">
      ${tvmInflationResult()}
    </section>`;
}

// --- What if I spend this -------------------------------------------------

/** Infinity means no monthly pace to estimate against — never printed as a raw number. */
function tvmMonthsLabel(months: number): string {
  if (!Number.isFinite(months)) return "no monthly rate set";
  if (months <= 0) return "already there";
  return `${months} mo`;
}

/**
 * What if this money were invested instead, using the exact rate/periods/
 * frequency/timing already set in the TVM tool — so this always reflects "your
 * own assumptions", not a second invented rate. "once" invests it as a lump sum
 * today; "monthly" invests it as a recurring contribution, matching how the
 * spend itself behaves.
 */
function tvmWhatIfOpportunityCost(amount: number, mode: SpendMode): ReturnType<typeof solveTvm> | null {
  if (amount <= 0) return null;
  const input = tvmSolveInput();
  if (!Number.isFinite(input.annualRatePercent) || !Number.isFinite(input.periods)) return null;
  const hypothetical: TvmSolveInput = mode === "once"
    ? { ...input, presentValue: -amount, payment: 0, futureValue: Number.NaN }
    : { ...input, presentValue: 0, payment: -amount, futureValue: Number.NaN };
  return solveTvm("futureValue", hypothetical);
}

/** null when there is nothing to say (no delay in either direction). */
function tvmWhatIfDelayPhrase(now: number, after: number, label: string): string | null {
  if (after <= now) return null;
  if (!Number.isFinite(after)) return `stall ${label} entirely`;
  const delay = after - now;
  return `push ${label} back ${delay} month${delay === 1 ? "" : "s"}`;
}

/** One synthesized sentence combining the Emergency Fund, the goal, and the opportunity cost. */
function tvmWhatIfSummary(impact: SpendingImpact, opportunity: ReturnType<typeof solveTvm> | null): string {
  if (impact.amount <= 0) return "";
  const costLabel = impact.mode === "monthly" ? `${money(impact.amount)}/month` : money(impact.amount);
  const phrases = [
    tvmWhatIfDelayPhrase(impact.emergency.monthsToTargetNow, impact.emergency.monthsToTargetAfter, "your Emergency Fund"),
    impact.goal ? tvmWhatIfDelayPhrase(impact.goal.monthsToTargetNow, impact.goal.monthsToTargetAfter, impact.goal.name) : null,
  ].filter((phrase): phrase is string => phrase !== null);

  let sentence = phrases.length > 0
    ? `Spending ${costLabel} would ${phrases.join(" and ")}.`
    : `Spending ${costLabel} would not meaningfully delay your Emergency Fund or current goal.`;

  if (opportunity?.ok) {
    sentence += ` Invested instead at the rate set in TVM, it would grow to ${money(opportunity.value.value)}.`;
  }
  return sentence;
}

function tvmWhatIfResultTemplate(impact: SpendingImpact, opportunity: ReturnType<typeof solveTvm> | null): string {
  if (impact.amount <= 0) {
    return `<div class="wu-tc__top"><span class="wu-label">Result</span></div>
      <p class="wu-dash__note">Enter an amount to see the impact.</p>`;
  }
  return `<div class="wu-tc__top"><span class="wu-label">Impact</span></div>
      <p class="wu-tvm-lead">${escapeHtml(tvmWhatIfSummary(impact, opportunity))}</p>
      <ul class="wu-facts wu-facts--plain">
        <li><span>Emergency Fund</span><span>${tvmMonthsLabel(impact.emergency.monthsToTargetNow)} → ${tvmMonthsLabel(impact.emergency.monthsToTargetAfter)}</span></li>
        ${impact.goal ? `<li><span>${escapeHtml(impact.goal.name)}</span><span>${tvmMonthsLabel(impact.goal.monthsToTargetNow)} → ${tvmMonthsLabel(impact.goal.monthsToTargetAfter)}</span></li>` : ""}
        ${opportunity?.ok ? `<li><span>Invested instead</span><span>${money(opportunity.value.value)}</span></li>` : ""}
      </ul>
      ${impact.goal ? "" : `<p class="wu-dash__note">No goal is currently being actively funded, so only the Emergency Fund is shown.</p>`}
      ${!opportunity ? `<p class="wu-dash__note">Set Annual rate and Periods in TVM to see the opportunity cost.</p>` : ""}
      <p class="wu-dash__note wu-dash__actions">Assumes this money would otherwise have gone toward these at their current monthly pace. Projections only — not financial advice.</p>`;
}

function tvmWhatIfOutput(state: WealthState): string {
  const amount = Number(tvmWhatIfAmount.trim() === "" ? Number.NaN : tvmWhatIfAmount);
  const impact = getSpendingImpact(state, amount, tvmWhatIfMode);
  return tvmWhatIfResultTemplate(impact, tvmWhatIfOpportunityCost(impact.amount, tvmWhatIfMode));
}

function tvmWhatIfTemplate(state: WealthState): string {
  return `
    <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-tvm-inputs" aria-labelledby="tvmWhatIfLabel">
      <div class="wu-tc__top"><span class="wu-label" id="tvmWhatIfLabel">Inputs</span></div>
      <p class="wu-dash__note">How a hypothetical expense pushes back your real Emergency Fund and current goal — and what it would be worth invested instead.</p>
      <ul class="wu-tvm-rows">
        <li class="wu-tvm-row wu-tvm-row--option">
          <span class="wu-tvm-row__label">Shape</span>
          ${choice("whatifmode", [{ value: "once", label: "One-time" }, { value: "monthly", label: "Monthly" }], tvmWhatIfMode, "Spend shape")}
        </li>
        <li class="wu-tvm-row wu-tvm-row--plain">
          <label class="wu-tvm-row__label" for="tvmWhatIf-amount">${tvmWhatIfMode === "once" ? "One-time spend" : "New monthly cost"}</label>
          <span class="wu-tvm-row__input">
            <input class="wu-field" id="tvmWhatIf-amount" type="number" inputmode="decimal"
                   min="0" step="50" value="${escapeHtml(tvmWhatIfAmount)}"
                   data-tvm-whatif-amount>
            <span class="wu-tvm-row__unit" aria-hidden="true">MYR</span>
          </span>
        </li>
      </ul>
    </section>
    <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-tvm-result" id="tvmWhatIfOutput" aria-live="polite">
      ${tvmWhatIfOutput(state)}
    </section>`;
}

// --- Page -----------------------------------------------------------------

export function tvmCalculatorTemplate(state: WealthState): string {
  // The header sits outside #tvmRoot so a tab switch or Reset (rerenderAll in
  // bindTvmCalculator) can re-render just the tool without dropping it — and so
  // the phone "back to More" arrow has a page title to sit beside.
  return `<div class="wu wu-tvm-page">
    ${pageHeader({
      title: "TVM Calculator",
      sub: "Time value of money",
      actions: `<button class="wu-btn wu-btn--secondary wu-btn--sm" type="button" id="tvmReset">Reset</button>`,
    })}
    <div id="tvmRoot">${tvmCardsTemplate(state)}</div>
  </div>`;
}

function tvmCardsTemplate(state: WealthState): string {
  const tool = tvmTab === "inflation" ? tvmInflationTemplate() : tvmTab === "whatif" ? tvmWhatIfTemplate(state) : tvmToolTemplate();
  return `<div class="wu-stack wu-stack--lg">
    <div class="wu-segmented wu-tvm-tabs" role="tablist" aria-label="Calculator">
      ${TABS.map((tab) => `<button type="button" class="wu-segmented__option${tvmTab === tab.id ? " is-active" : ""}" role="tab" aria-selected="${tvmTab === tab.id}" data-tvm-tab="${tab.id}">${escapeHtml(tab.label)}</button>`).join("")}
    </div>
    <div class="wu-dash">${tool}</div>
  </div>`;
}

export function bindTvmCalculator(root: HTMLElement, state: WealthState): void {
  const rerenderAll = (): void => {
    const host = root.querySelector<HTMLElement>("#tvmRoot");
    if (!host) return;
    host.innerHTML = tvmCardsTemplate(state);
    bindTools();
  };
  const rerenderResult = (): void => {
    const output = root.querySelector<HTMLElement>("#tvmOutput");
    if (output) output.innerHTML = tvmResultTemplate();
    root.querySelectorAll<HTMLButtonElement>("[data-tvm-solve]").forEach((button) =>
      button.classList.toggle("is-solved", tvmSolved?.variable === button.dataset.tvmSolve));
  };

  // Reset lives in the header, outside #tvmRoot, so it is bound once here.
  root.querySelector<HTMLButtonElement>("#tvmReset")?.addEventListener("click", () => {
    tvmValues = { ...TVM_DEFAULTS };
    tvmFrequency = "monthly";
    tvmTiming = "end";
    tvmRateKind = "nominal";
    tvmSolved = null;
    tvmInflation.futureAmount = "100000";
    tvmInflation.inflationRatePercent = "3";
    tvmInflation.years = "10";
    tvmWhatIfAmount = "";
    tvmWhatIfMode = "once";
    rerenderAll();
    root.querySelector<HTMLInputElement>("[data-tvm-input], [data-tvm-inflation], [data-tvm-whatif-amount]")?.focus();
  });

  const bindTools = (): void => {
    root.querySelectorAll<HTMLButtonElement>("[data-tvm-tab]").forEach((button) => button.addEventListener("click", () => {
      const tab = button.dataset.tvmTab as TvmTab;
      if (tab === tvmTab) return;
      tvmTab = tab;
      rerenderAll();
    }));

    root.querySelectorAll<HTMLInputElement>("[data-tvm-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const name = input.dataset.tvmInput as TvmFieldName | undefined;
        if (name) tvmValues[name] = input.value;
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-tvm-solve]").forEach((button) => {
      button.addEventListener("click", () => {
        const variable = button.dataset.tvmSolve as TvmVariable | undefined;
        if (!variable) return;
        const result = solveTvm(variable, tvmSolveInput());
        tvmSolved = { variable, result };
        // Write the solved value back into its own field, as a solver does.
        if (result.ok) {
          const solved = result.value.value;
          tvmValues[variable as TvmFieldName] = String(
            variable === "annualRatePercent" || variable === "periods"
              ? Math.round(solved * 1e4) / 1e4
              : Math.round(solved * 100) / 100,
          );
          const field = root.querySelector<HTMLInputElement>(`[data-tvm-input="${variable}"]`);
          if (field) field.value = tvmValues[variable as TvmFieldName];
        }
        rerenderResult();
        // On a phone the result sits above the inputs; bring it into view.
        if (window.matchMedia("(max-width: 900px)").matches) {
          root.querySelector<HTMLElement>("#tvmOutput")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    });

    root.querySelector<HTMLSelectElement>("[data-tvm-frequency]")?.addEventListener("change", (event) => {
      tvmFrequency = (event.currentTarget as HTMLSelectElement).value as CompoundingFrequency;
      rerenderResult();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-tvm-choice]").forEach((button) => button.addEventListener("click", () => {
      const value = button.dataset.value ?? "";
      const group = button.dataset.tvmChoice;
      button.parentElement?.querySelectorAll<HTMLButtonElement>("[data-tvm-choice]").forEach((other) => {
        const active = other === button;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      if (group === "ratekind") {
        tvmRateKind = value as RateKind;
        rerenderResult();
      } else if (group === "timing") {
        tvmTiming = value as PaymentTiming;
        rerenderResult();
      } else if (group === "whatifmode") {
        // Changes the field label too ("One-time spend" vs "New monthly cost"),
        // so the whole tool re-renders; a click has no typing focus to keep.
        tvmWhatIfMode = value as SpendMode;
        rerenderAll();
      }
    }));

    root.querySelectorAll<HTMLInputElement>("[data-tvm-inflation]").forEach((input) => {
      input.addEventListener("input", () => {
        const name = input.dataset.tvmInflation as keyof typeof tvmInflation | undefined;
        if (!name) return;
        tvmInflation[name] = input.value;
        // Re-render only the result, preserving focus in the field being typed in.
        const output = root.querySelector<HTMLElement>("#tvmInflationOutput");
        if (output) output.innerHTML = tvmInflationResult();
      });
    });

    root.querySelectorAll<HTMLInputElement>("[data-tvm-whatif-amount]").forEach((input) => {
      input.addEventListener("input", () => {
        tvmWhatIfAmount = input.value;
        const output = root.querySelector<HTMLElement>("#tvmWhatIfOutput");
        if (output) output.innerHTML = tvmWhatIfOutput(state);
      });
    });
  };

  bindTools();
}
