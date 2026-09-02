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

import { money, percent } from "../rules";
import { escapeHtml } from "../html";
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

export function tvmCalculatorTemplate(): string {
  // Wrapper so Reset can re-render just the calculator, not the page shell.
  return `<div id="tvmRoot" class="wu wu-stack wu-stack--lg">${tvmCardsTemplate()}</div>`;
}

function tvmCardsTemplate(): string {
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
    ${tvmInflationTemplate()}`;
}

export function bindTvmCalculator(root: HTMLElement): void {
  const rerenderAll = () => {
    const host = root.querySelector<HTMLElement>("#tvmRoot");
    if (!host) return;
    host.innerHTML = tvmCardsTemplate();
    bindTvmCalculator(root);
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
}
