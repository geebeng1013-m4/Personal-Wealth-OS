/**
 * TVM Calculator page — the classic five-variable solver.
 *
 * Fill any four of PV / PMT / FV / Rate / Periods and solve for the fifth,
 * plus a small separate inflation-adjustment tool.
 *
 * Inputs are session-only, held in module state and deliberately not persisted
 * to WealthState, localStorage or Firebase. The calculator explores
 * hypotheticals; none of it is a recorded financial fact, and writing it into
 * the state would make it look like one. Refreshing resets it, which is the
 * correct behaviour for a scratchpad.
 *
 * The arithmetic all lives in ./tvm — this module only renders it and wires up
 * the events.
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

const TVM_DEFAULTS: Record<TvmFieldName, string> = {
  presentValue: "-1000",
  payment: "-300",
  futureValue: "",
  annualRatePercent: "8",
  periods: "120",
};

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
  { name: "presentValue", label: "Present Value", button: "PV", unit: "MYR", step: "100" },
  { name: "payment", label: "Payments", button: "PMT", unit: "MYR", step: "50" },
  { name: "futureValue", label: "Future Value", button: "FV", unit: "MYR", step: "1000" },
  { name: "annualRatePercent", label: "Annual Rate (%)", button: "Rate", unit: "%", step: "0.1" },
  { name: "periods", label: "Periods", button: "Periods", unit: "n", step: "1" },
];

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
  presentValue: "Present Value",
  payment: "Payment",
  futureValue: "Future Value",
  annualRatePercent: "Annual Rate",
  periods: "Periods",
};

function tvmResultTemplate(): string {
  if (!tvmSolved) {
    return `
      <div class="wu-card wu-card--inset wu-card--pad-sm tvm-result" role="status">
        <div class="wu-metric"><span class="wu-metric__label wu-label">Result</span><span class="t-body-sm t-muted">Fill in any four values, then press the button beside the one you want to solve.</span></div>
      </div>`;
  }

  const { variable, result } = tvmSolved;
  if (!result.ok) {
    return `
      <div class="wu-card wu-card--inset wu-card--pad-sm wu-card--negative tvm-result" role="status">
        <div class="wu-metric"><span class="wu-metric__label wu-label">${escapeHtml(TVM_LABELS[variable])}</span><span class="wu-metric__value t-num">—</span></div>
        <ul class="wu-list" role="alert" style="margin-top:var(--space-2)">
          ${result.errors.map((error) => `<li class="wu-list__row"><span class="wu-field-row__error"><span aria-hidden="true">⚠</span> ${escapeHtml(error.message)}</span></li>`).join("")}
        </ul>
      </div>`;
  }

  const v = result.value;
  const periodsLabel = `${Math.round(v.periods * 100) / 100} ${COMPOUNDING_LABELS[tvmFrequency].toLowerCase()} periods`;
  return `
    <div class="wu-card wu-card--inset wu-card--pad-sm wu-card--positive tvm-result" role="status">
      <div class="wu-metric wu-metric--hero"><span class="wu-metric__label wu-label">Solved for ${escapeHtml(TVM_LABELS[variable])}</span><span class="wu-metric__value t-num">${escapeHtml(tvmFormat(variable, v.value))}</span></div>
      <dl class="wu-list" style="margin-top:var(--space-3)">
        <div class="wu-list__row"><dt>Present value</dt><dd>${money(v.presentValue)}</dd></div>
        <div class="wu-list__row"><dt>Payment</dt><dd>${money(v.payment)}</dd></div>
        <div class="wu-list__row"><dt>Future value</dt><dd>${money(v.futureValue)}</dd></div>
        <div class="wu-list__row"><dt>Annual rate</dt><dd>${Math.round(v.annualRatePercent * 1000) / 1000}% ${escapeHtml(tvmRateKind)}</dd></div>
        <div class="wu-list__row"><dt>Periods</dt><dd>${escapeHtml(periodsLabel)}</dd></div>
        <div class="wu-list__row"><dt>Total payments</dt><dd>${money(v.totalPayments)}</dd></div>
        <div class="wu-list__row"><dt>Total interest</dt><dd>${money(v.totalInterest)}</dd></div>
      </dl>
      <p class="t-caption t-faint" style="margin-top:var(--space-3)">Based on your own assumptions: ${escapeHtml(COMPOUNDING_LABELS[tvmFrequency].toLowerCase())} compounding, payments at the ${tvmTiming === "end" ? "end" : "beginning"} of each period, ${escapeHtml(tvmRateKind)} rate. Projections only — not guaranteed returns or investment advice.</p>
    </div>`;
}

function tvmInflationTemplate(): string {
  const result = calculateInflationAdjustedValue({
    futureAmount: Number(tvmInflation.futureAmount.trim() === "" ? Number.NaN : tvmInflation.futureAmount),
    inflationRatePercent: Number(tvmInflation.inflationRatePercent.trim() === "" ? Number.NaN : tvmInflation.inflationRatePercent),
    years: Number(tvmInflation.years.trim() === "" ? Number.NaN : tvmInflation.years),
  });

  const fields: Array<{ name: keyof typeof tvmInflation; label: string; unit: string; step: string }> = [
    { name: "futureAmount", label: "Future amount", unit: "MYR", step: "1000" },
    { name: "inflationRatePercent", label: "Inflation rate", unit: "%", step: "0.1" },
    { name: "years", label: "Years", unit: "years", step: "1" },
  ];

  return `
    <section class="wu-card tvm-card" aria-labelledby="tvmInflationTitle">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm">
          <span class="wu-label">Planning Tool</span>
          <h3 class="wu-card__title t-heading" id="tvmInflationTitle">Inflation Adjustment</h3>
          <p class="t-body-sm t-muted">What a future amount is worth in today's money.</p>
        </div>
      </div>
      <div class="wu-grid wu-grid--2 wu-grid--top">
        <div class="wu-stack">
          ${fields.map((field) => `
            <label class="wu-field-row" for="tvmInf-${field.name}">
              <span class="wu-field-row__label">${escapeHtml(field.label)}</span>
              <span class="wu-affix">
                <span aria-hidden="true">${escapeHtml(field.unit)}</span>
                <input class="wu-field" id="tvmInf-${field.name}" type="number" inputmode="decimal"
                       step="${field.step}" value="${escapeHtml(tvmInflation[field.name])}"
                       data-tvm-inflation="${field.name}">
              </span>
            </label>`).join("")}
        </div>
        <div class="tvm-output" aria-live="polite">
          ${result.ok ? `
            <div class="wu-card wu-card--inset wu-card--pad-sm wu-card--positive tvm-result" role="status">
              <div class="wu-metric wu-metric--hero"><span class="wu-metric__label wu-label">Today's purchasing power</span><span class="wu-metric__value t-num">${money(result.value.todaysPurchasingPower)}</span></div>
              <dl class="wu-list" style="margin-top:var(--space-3)">
                <div class="wu-list__row"><dt>Purchasing-power loss</dt><dd>${money(result.value.purchasingPowerLoss)}</dd></div>
                <div class="wu-list__row"><dt>Loss</dt><dd>${percent(result.value.purchasingPowerLossPercent, 1)}</dd></div>
              </dl>
              <p class="t-caption t-faint" style="margin-top:var(--space-3)">Assumption: constant ${escapeHtml(tvmInflation.inflationRatePercent || "0")}% inflation.</p>
            </div>` : `
            <div class="wu-card wu-card--inset wu-card--pad-sm wu-card--negative tvm-result" role="status">
              <div class="wu-metric"><span class="wu-metric__label wu-label">Today's purchasing power</span><span class="wu-metric__value t-num">—</span></div>
              <ul class="wu-list" role="alert" style="margin-top:var(--space-2)">
                ${result.errors.map((e) => `<li class="wu-list__row"><span class="wu-field-row__error"><span aria-hidden="true">⚠</span> ${escapeHtml(e.message)}</span></li>`).join("")}
              </ul>
            </div>`}
        </div>
      </div>
    </section>`;
}

/** Infinity means no monthly pace to estimate against — never printed as a raw number. */
function tvmMonthsLabel(months: number): string {
  if (!Number.isFinite(months)) return "no monthly rate set";
  if (months <= 0) return "already there";
  return `${months} mo`;
}

/**
 * What if this money were invested instead, using the exact rate/periods/
 * frequency/timing already set in the main solver above — so this always
 * reflects "your own assumptions", not a second invented rate. "once" invests
 * it as a lump sum today; "monthly" invests it as a recurring contribution,
 * matching how the spend itself behaves.
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
    sentence += ` Invested instead at the rate you set above, it would grow to ${money(opportunity.value.value)}.`;
  }
  return sentence;
}

function tvmWhatIfResultTemplate(impact: SpendingImpact, opportunity: ReturnType<typeof solveTvm> | null): string {
  if (impact.amount <= 0) {
    return `
      <div class="wu-card wu-card--inset wu-card--pad-sm tvm-result" role="status">
        <div class="wu-metric"><span class="wu-metric__label wu-label">Result</span><span class="t-body-sm t-muted">Enter an amount to see the impact.</span></div>
      </div>`;
  }

  return `
    <div class="wu-card wu-card--inset wu-card--pad-sm wu-card--positive tvm-result" role="status">
      <dl class="wu-list">
        <div class="wu-list__row"><dt>Emergency Fund</dt><dd>${tvmMonthsLabel(impact.emergency.monthsToTargetNow)} → ${tvmMonthsLabel(impact.emergency.monthsToTargetAfter)}</dd></div>
        ${impact.goal ? `<div class="wu-list__row"><dt>${escapeHtml(impact.goal.name)}</dt><dd>${tvmMonthsLabel(impact.goal.monthsToTargetNow)} → ${tvmMonthsLabel(impact.goal.monthsToTargetAfter)}</dd></div>` : ""}
        ${opportunity?.ok ? `<div class="wu-list__row"><dt>Invested instead</dt><dd>${money(opportunity.value.value)}</dd></div>` : ""}
      </dl>
      ${impact.goal ? "" : `<p class="t-caption t-faint" style="margin-top:var(--space-3)">No goal is currently being actively funded, so only the Emergency Fund is shown.</p>`}
      ${!opportunity ? `<p class="t-caption t-faint" style="margin-top:var(--space-3)">Set Annual Rate and Periods in the calculator above to see the opportunity cost.</p>` : ""}
      <p class="t-body-sm" style="margin-top:var(--space-3)">${escapeHtml(tvmWhatIfSummary(impact, opportunity))}</p>
      <p class="t-caption t-faint" style="margin-top:var(--space-3)">Assumes this money would otherwise have gone toward these at their current monthly pace. Projections only — not financial advice.</p>
    </div>`;
}

function tvmWhatIfTemplate(state: WealthState): string {
  const amount = Number(tvmWhatIfAmount.trim() === "" ? Number.NaN : tvmWhatIfAmount);
  const impact = getSpendingImpact(state, amount, tvmWhatIfMode);
  const opportunity = tvmWhatIfOpportunityCost(impact.amount, tvmWhatIfMode);

  return `
    <section class="wu-card tvm-card" aria-labelledby="tvmWhatIfTitle">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm">
          <span class="wu-label">Planning Tool</span>
          <h3 class="wu-card__title t-heading" id="tvmWhatIfTitle">What If I Spend This?</h3>
          <p class="t-body-sm t-muted">See how a hypothetical expense pushes back your real Emergency Fund and current goal — and what it would be worth invested instead.</p>
        </div>
      </div>
      <div class="wu-grid wu-grid--2 wu-grid--top">
        <div class="wu-stack">
          <fieldset class="wu-fieldset">
            <legend class="wu-field-row__label">Shape</legend>
            <div class="wu-row wu-row--tight">
              ${(["once", "monthly"] as SpendMode[]).map((mode) => `
                <label class="wu-chip">
                  <input type="radio" name="tvmWhatIfMode" value="${mode}" data-tvm-whatif-mode="${mode}"${tvmWhatIfMode === mode ? " checked" : ""}>
                  <span>${mode === "once" ? "One-time" : "Monthly"}</span>
                </label>`).join("")}
            </div>
          </fieldset>
          <label class="wu-field-row" for="tvmWhatIf-amount">
            <span class="wu-field-row__label">${tvmWhatIfMode === "once" ? "One-time spend" : "New monthly cost"}</span>
            <span class="wu-affix">
              <span aria-hidden="true">MYR</span>
              <input class="wu-field" id="tvmWhatIf-amount" type="number" inputmode="decimal"
                     min="0" step="50" value="${escapeHtml(tvmWhatIfAmount)}"
                     data-tvm-whatif-amount>
            </span>
          </label>
        </div>
        <div class="tvm-output" aria-live="polite">
          ${tvmWhatIfResultTemplate(impact, opportunity)}
        </div>
      </div>
    </section>`;
}

export function tvmCalculatorTemplate(state: WealthState): string {
  // The header sits outside #tvmRoot so Reset (rerenderAll in
  // bindTvmCalculator) can re-render just the cards without dropping it — and
  // so the phone "back to More" arrow has a page title to sit beside.
  return `<div class="wu wu-stack wu-stack--lg">
    ${pageHeader({ title: "TVM Calculator", sub: "Time value of money" })}
    <div id="tvmRoot" class="wu-stack wu-stack--lg">${tvmCardsTemplate(state)}</div>
  </div>`;
}

function tvmCardsTemplate(state: WealthState): string {
  return `
    <section class="wu-card tvm-card" aria-labelledby="tvmTitle">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm">
          <span class="wu-label">Planning Tool</span>
          <h3 class="wu-card__title t-heading" id="tvmTitle">TVM Calculator</h3>
          <p class="t-body-sm t-muted">Fill in any four values, then solve for the fifth.</p>
        </div>
        <button class="wu-btn wu-btn--secondary wu-btn--sm" type="button" id="tvmReset">Reset</button>
      </div>

      <div class="wu-row" style="gap:var(--space-6);margin-bottom:var(--space-4)">
        <fieldset class="wu-fieldset">
          <legend class="wu-field-row__label">Annual Rate</legend>
          <div class="wu-row wu-row--tight">
            ${(["nominal", "effective"] as RateKind[]).map((kind) => `
              <label class="wu-chip">
                <input type="radio" name="tvmRateKind" value="${kind}" data-tvm-ratekind="${kind}"${tvmRateKind === kind ? " checked" : ""}>
                <span>${kind === "nominal" ? "Nominal" : "Effective"}</span>
              </label>`).join("")}
          </div>
        </fieldset>
        <fieldset class="wu-fieldset">
          <legend class="wu-field-row__label">Mode</legend>
          <div class="wu-row wu-row--tight">
            ${(["end", "beginning"] as PaymentTiming[]).map((timing) => `
              <label class="wu-chip">
                <input type="radio" name="tvmTiming" value="${timing}" data-tvm-timing="${timing}"${tvmTiming === timing ? " checked" : ""}>
                <span>${timing === "end" ? "End" : "Beginning"}</span>
              </label>`).join("")}
          </div>
        </fieldset>
      </div>

      <div class="wu-stack wu-stack--sm">
        ${TVM_ROWS.map((row) => `
          <div class="tvm-row">
            <label class="wu-field-row__label tvm-row__label" for="tvm-${row.name}">${escapeHtml(row.label)}</label>
            <span class="wu-affix">
              <span aria-hidden="true">${escapeHtml(row.unit)}</span>
              <input class="wu-field" id="tvm-${row.name}" type="number" inputmode="decimal"
                     step="${row.step}" value="${escapeHtml(tvmValues[row.name])}"
                     data-tvm-input="${row.name}" aria-describedby="tvmSignNote">
            </span>
            <button class="wu-btn wu-btn--secondary wu-btn--sm tvm-solve" type="button"
                    data-tvm-solve="${row.name}"
                    aria-label="Solve for ${escapeHtml(row.label)}">${escapeHtml(row.button)}</button>
          </div>`).join("")}

        <div class="tvm-row">
          <label class="wu-field-row__label tvm-row__label" for="tvmFrequency">Compounding</label>
          <select class="wu-field tvm-select" id="tvmFrequency" data-tvm-frequency>
            ${(Object.keys(COMPOUNDING_LABELS) as CompoundingFrequency[]).map((key) => `
              <option value="${key}"${key === tvmFrequency ? " selected" : ""}>${escapeHtml(COMPOUNDING_LABELS[key])}</option>`).join("")}
          </select>
        </div>
      </div>

      <p class="t-caption t-faint" id="tvmSignNote" style="margin-top:var(--space-3)">Cash-flow signs matter: money you pay in is negative, money you receive is positive. Leave the value you want to solve for blank, or just press its button to overwrite it.</p>

      <div class="tvm-output" id="tvmOutput" aria-live="polite" style="margin-top:var(--space-4)">
        ${tvmResultTemplate()}
      </div>
    </section>
    ${tvmInflationTemplate()}
    ${tvmWhatIfTemplate(state)}`;
}

export function bindTvmCalculator(root: HTMLElement, state: WealthState): void {
  const rerenderAll = () => {
    const host = root.querySelector<HTMLElement>("#tvmRoot");
    if (!host) return;
    host.innerHTML = tvmCardsTemplate(state);
    bindTvmCalculator(root, state);
  };
  const rerenderResult = () => {
    const output = root.querySelector<HTMLElement>("#tvmOutput");
    if (output) output.innerHTML = tvmResultTemplate();
  };

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
    });
  });

  root.querySelectorAll<HTMLInputElement>("[data-tvm-ratekind]").forEach((input) => {
    input.addEventListener("change", () => {
      tvmRateKind = input.dataset.tvmRatekind as RateKind;
      rerenderResult();
    });
  });

  root.querySelectorAll<HTMLInputElement>("[data-tvm-timing]").forEach((input) => {
    input.addEventListener("change", () => {
      tvmTiming = input.dataset.tvmTiming as PaymentTiming;
      rerenderResult();
    });
  });

  root.querySelector<HTMLSelectElement>("[data-tvm-frequency]")?.addEventListener("change", (event) => {
    tvmFrequency = (event.currentTarget as HTMLSelectElement).value as CompoundingFrequency;
    rerenderResult();
  });

  root.querySelector<HTMLButtonElement>("#tvmReset")?.addEventListener("click", () => {
    tvmValues = { ...TVM_DEFAULTS };
    tvmFrequency = "monthly";
    tvmTiming = "end";
    tvmRateKind = "nominal";
    tvmSolved = null;
    rerenderAll();
    root.querySelector<HTMLInputElement>('[data-tvm-input="presentValue"]')?.focus();
  });

  root.querySelectorAll<HTMLInputElement>("[data-tvm-inflation]").forEach((input) => {
    input.addEventListener("input", () => {
      const name = input.dataset.tvmInflation as keyof typeof tvmInflation | undefined;
      if (!name) return;
      tvmInflation[name] = input.value;
      const card = input.closest(".tvm-card");
      const output = card?.querySelector<HTMLElement>(".tvm-output");
      if (!output) return;
      // Re-render only the inflation card's output, preserving focus.
      const wrapper = document.createElement("div");
      wrapper.innerHTML = tvmInflationTemplate();
      const fresh = wrapper.querySelector(".tvm-output");
      if (fresh) output.innerHTML = fresh.innerHTML;
    });
  });

  root.querySelectorAll<HTMLInputElement>("[data-tvm-whatif-amount]").forEach((input) => {
    input.addEventListener("input", () => {
      tvmWhatIfAmount = input.value;
      const card = input.closest(".tvm-card");
      const output = card?.querySelector<HTMLElement>(".tvm-output");
      if (!output) return;
      // Re-render only this card's output, preserving focus, same as inflation.
      const amount = Number(tvmWhatIfAmount.trim() === "" ? Number.NaN : tvmWhatIfAmount);
      const impact = getSpendingImpact(state, amount, tvmWhatIfMode);
      output.innerHTML = tvmWhatIfResultTemplate(impact, tvmWhatIfOpportunityCost(impact.amount, tvmWhatIfMode));
    });
  });

  root.querySelectorAll<HTMLInputElement>("[data-tvm-whatif-mode]").forEach((input) => {
    input.addEventListener("change", () => {
      // Changes the field label too ("One-time spend" vs "New monthly cost"),
      // so this re-renders the whole card set rather than just the output —
      // a radio click has no typing focus to preserve, unlike the amount field.
      tvmWhatIfMode = input.dataset.tvmWhatifMode as SpendMode;
      rerenderAll();
    });
  });
}
