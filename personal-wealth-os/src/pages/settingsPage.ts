/**
 * Settings page — the investor profile and every planning parameter.
 *
 * Seven forms: profile, recurring cash flow, liabilities, privacy, cash flow &
 * DCA, emergency fund, and DCA targets. Each is a plain overwrite of its slice
 * of the state; percentages are stored as fractions and shown as whole numbers,
 * so the templates multiply and the handlers divide by 100.
 *
 * Export / import, snapshots and version history are NOT here — they live in
 * the sidebar drawer.
 */

import type { WealthState } from "../models";
import { createId } from "../state";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

/** A labelled control in a settings form's 2-col grid. */
function field(label: string, control: string, wide = false): string {
  return `<label class="wu-field-row${wide ? " wu-field-row--wide" : ""}"><span class="wu-field-row__label">${label}</span>${control}</label>`;
}

/** A number field pre-filled from state. */
function num(name: string, label: string, value: string, step: string, wide = false): string {
  return field(label, `<input class="wu-field" name="${name}" type="number" step="${step}" value="${value}">`, wide);
}

function settingsCard(title: string, formId: string, saveLabel: string, body: string): string {
  return `<div class="wu-card">
    <div class="wu-card__header"><h3 class="wu-card__title t-heading">${title}</h3></div>
    <form id="${formId}" class="wu-grid wu-grid--2">
      ${body}
      <div class="wu-row wu-field-row--wide"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">${saveLabel}</button></div>
    </form>
  </div>`;
}

export function settingsTemplate(state: WealthState): string {
  const opt = (v: string, sel: boolean) => `<option${sel ? " selected" : ""}>${v}</option>`;

  const profile = settingsCard("Investor Profile", "profileForm", "Save Profile",
    field("Name", `<input class="wu-field" name="name" type="text" value="${escapeHtml(state.profile.name)}">`) +
    field("Age", `<input class="wu-field" name="age" type="number" min="16" max="100" step="1" value="${state.profile.age}">`) +
    field("Risk Tolerance", `<select class="wu-field" name="riskTolerance">${opt("High", state.profile.riskTolerance === "High")}${opt("Medium", state.profile.riskTolerance === "Medium")}${opt("Low", state.profile.riskTolerance === "Low")}</select>`) +
    field("Stage", `<select class="wu-field" name="stage">${opt("Student", state.profile.stage === "Student")}${opt("Early Career", state.profile.stage === "Early Career")}${opt("Mid Career", state.profile.stage === "Mid Career")}${opt("Pre-Retirement", state.profile.stage === "Pre-Retirement")}</select>`) +
    num("investmentHorizonYears", "Investment Horizon (years)", String(state.profile.investmentHorizonYears), "1") +
    field("Base Currency", `<select class="wu-field" name="baseCurrency">${opt("MYR", state.profile.baseCurrency === "MYR")}${opt("USD", state.profile.baseCurrency === "USD")}</select>`));

  const recurringRows = state.recurringTransactions.map((item) =>
    `<li class="wu-list__row"><span>${escapeHtml(item.label)} &middot; ${item.type} &middot; day ${item.dayOfMonth}${item.dayOfMonth >= 29 ? " &middot; short-month fallback" : ""}</span><strong class="t-num">${money(item.amount)}</strong><button class="wu-btn wu-btn--ghost wu-btn--icon delete-recurring" data-id="${escapeHtml(item.id)}" type="button" aria-label="Delete recurring item">&times;</button></li>`).join("");
  const recurring = `<div class="wu-card">
    <div class="wu-card__header"><h3 class="wu-card__title t-heading">Recurring Cash Flow</h3></div>
    <form id="recurringForm" class="wu-grid wu-grid--2">
      ${field("Label", `<input class="wu-field" name="label" maxlength="60" required>`)}
      ${num("amount", "Amount MYR", "", "0.01")}
      ${field("Type", `<select class="wu-field" name="type"><option value="expense">Expense</option><option value="income">Income</option></select>`)}
      ${field("Day of month", `<input class="wu-field" name="dayOfMonth" type="number" min="1" max="31" value="1" required>`)}
      <p class="wu-field-row--wide t-caption t-faint">If a month is shorter, it runs on the last day.</p>
      <div class="wu-row wu-field-row--wide"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Add recurring item</button></div>
    </form>
    <ul class="wu-list">${recurringRows}</ul>
    ${state.recurringTransactions.length === 0 ? `<p class="wu-empty">No recurring items.</p>` : ""}
  </div>`;

  const liabilityRows = state.liabilities.map((item) =>
    `<li class="wu-list__row"><span>${escapeHtml(item.name)} &middot; ${item.annualRate.toFixed(2)}%</span><strong class="t-num">${money(item.balance)}</strong><button class="wu-btn wu-btn--ghost wu-btn--icon delete-liability" data-id="${escapeHtml(item.id)}" type="button" aria-label="Delete liability">&times;</button></li>`).join("");
  const liabilities = `<div class="wu-card">
    <div class="wu-card__header"><h3 class="wu-card__title t-heading">Liabilities</h3></div>
    <form id="liabilityForm" class="wu-grid wu-grid--2">
      ${field("Name", `<input class="wu-field" name="name" maxlength="60" required>`)}
      ${num("balance", "Balance MYR", "", "0.01")}
      ${num("annualRate", "Annual rate %", "0", "0.01")}
      ${num("minimumPayment", "Minimum payment MYR", "0", "0.01")}
      <div class="wu-row wu-field-row--wide"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Add liability</button></div>
    </form>
    <ul class="wu-list">${liabilityRows}</ul>
    ${state.liabilities.length === 0 ? `<p class="wu-empty">No liabilities recorded.</p>` : ""}
  </div>`;

  const sw = (name: string, checked: boolean, label: string) =>
    `<label class="wu-switch"><input name="${name}" type="checkbox"${checked ? " checked" : ""}><span class="wu-switch__track"></span><span class="wu-switch__label">${label}</span></label>`;
  const privacy = `<div class="wu-card">
    <div class="wu-card__header"><h3 class="wu-card__title t-heading">Privacy</h3></div>
    <form id="privacyForm" class="wu-stack">
      ${sw("maskAmounts", state.privacy.maskAmounts, "Mask financial amounts on screen")}
      ${sw("requireExportConfirmation", state.privacy.requireExportConfirmation, "Confirm before exporting financial data")}
      <div class="wu-row"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save privacy</button></div>
    </form>
  </div>`;

  const cashflow = settingsCard("Cashflow &amp; DCA", "cashflowForm", "Save Cashflow",
    num("allowance", "Monthly Allowance MYR", String(state.cashflow.allowance), "1") +
    num("transport", "Transport MYR", String(state.cashflow.transport), "1") +
    num("food", "Food MYR", String(state.cashflow.food), "1") +
    num("otherFixed", "Other Fixed MYR", String(state.cashflow.otherFixed), "1") +
    num("irregularIncome", "Irregular Income MYR", String(state.cashflow.irregularIncome), "1") +
    num("dcaMonthly", "DCA Monthly MYR", String(state.dca.monthly), "1"));

  const emergency = settingsCard("Emergency Fund", "emergencyForm", "Save Emergency",
    num("current", "Current Emergency MYR", String(state.emergency.current), "1") +
    num("target", "Target Emergency MYR", String(state.emergency.target), "1") +
    num("monthlyTopUp", "Monthly Top-Up MYR", String(state.emergency.monthlyTopUp), "1") +
    num("annualYield", "Annual Yield %", String(Math.round(state.emergency.annualYield * 10000) / 100), "0.01"));

  const targets = settingsCard("DCA Targets", "targetsForm", "Save Targets",
    num("vooTarget", "VOO Target %", String(Math.round(state.dca.targets.VOO * 100)), "1") +
    num("qqqmTarget", "QQQM Target %", String(Math.round(state.dca.targets.QQQM * 100)), "1") +
    num("opportunityTotal", "Opportunity Reserve MYR", String(state.opportunity.total), "1") +
    num("vooAlloc", "Opportunity VOO MYR", String(state.opportunity.allocation.VOO), "1") +
    num("qqqmAlloc", "Opportunity QQQM MYR", String(state.opportunity.allocation.QQQM), "1"));

  return `
    <div class="wu">
      ${pageHeader({
        eyebrow: "Configuration",
        title: "Profile and Parameters",
        sub: "Adjust your investor profile, cash flow, and investment parameters.",
      })}
      <div class="wu-grid wu-grid--wide">
        ${profile}
        ${recurring}
        ${liabilities}
        ${privacy}
        ${cashflow}
        ${emergency}
        ${targets}
      </div>
    </div>
  `;
}

export function bindSettings(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const refreshSettings = (next: WealthState, label: string): void => { setState(next, label); rerender(root, next, setState, "settings", navigate); };
  root.querySelector<HTMLFormElement>("#recurringForm")?.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const amount = Number(data.get("amount")); const dayOfMonth = Number(data.get("dayOfMonth")); if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return; refreshSettings({ ...state, recurringTransactions: [...state.recurringTransactions, { id: createId("recurring"), label: String(data.get("label") ?? "").trim().slice(0, 60), amount, type: String(data.get("type")) as "income" | "expense", dayOfMonth, active: true }] }, "Add recurring transaction"); });
  root.querySelectorAll<HTMLButtonElement>(".delete-recurring").forEach((button) => button.addEventListener("click", () => refreshSettings({ ...state, recurringTransactions: state.recurringTransactions.filter((item) => item.id !== button.dataset.id) }, "Delete recurring transaction")));
  root.querySelector<HTMLFormElement>("#liabilityForm")?.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const balance = Number(data.get("balance")); const annualRate = Number(data.get("annualRate")); const minimumPayment = Number(data.get("minimumPayment")); if (![balance, annualRate, minimumPayment].every((value) => Number.isFinite(value) && value >= 0)) return; refreshSettings({ ...state, liabilities: [...state.liabilities, { id: createId("liability"), name: String(data.get("name") ?? "").trim().slice(0, 60), balance, annualRate, minimumPayment }] }, "Add liability"); });
  root.querySelectorAll<HTMLButtonElement>(".delete-liability").forEach((button) => button.addEventListener("click", () => refreshSettings({ ...state, liabilities: state.liabilities.filter((item) => item.id !== button.dataset.id) }, "Delete liability")));
  root.querySelector<HTMLFormElement>("#privacyForm")?.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); refreshSettings({ ...state, privacy: { maskAmounts: data.get("maskAmounts") === "on", requireExportConfirmation: data.get("requireExportConfirmation") === "on" } }, "Update privacy settings"); });
  root.querySelector<HTMLFormElement>("#profileForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next: WealthState = {
      ...state,
      profile: {
        name: String(data.get("name") ?? state.profile.name),
        age: Number(data.get("age")) || 19,
        stage: String(data.get("stage") ?? state.profile.stage),
        riskTolerance: String(data.get("riskTolerance")) as WealthState["profile"]["riskTolerance"],
        investmentHorizonYears: Number(data.get("investmentHorizonYears")) || 10,
        baseCurrency: String(data.get("baseCurrency")) as WealthState["profile"]["baseCurrency"],
      },
    };
    setState(next);
    rerender(root, next, setState, "settings", navigate);
  });

  root.querySelector<HTMLFormElement>("#cashflowForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next: WealthState = {
      ...state,
      cashflow: {
        allowance: Number(data.get("allowance")) || 0,
        transport: Number(data.get("transport")) || 0,
        food: Number(data.get("food")) || 0,
        otherFixed: Number(data.get("otherFixed")) || 0,
        irregularIncome: Number(data.get("irregularIncome")) || 0,
      },
      dca: {
        ...state.dca,
        monthly: Number(data.get("dcaMonthly")) || 0,
      },
    };
    setState(next);
    rerender(root, next, setState, "settings", navigate);
  });

  root.querySelector<HTMLFormElement>("#emergencyForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next: WealthState = {
      ...state,
      emergency: {
        ...state.emergency,
        current: Number(data.get("current")) || 0,
        target: Number(data.get("target")) || 0,
        monthlyTopUp: Number(data.get("monthlyTopUp")) || 0,
        annualYield: (Number(data.get("annualYield")) || 3.5) / 100,
      },
    };
    setState(next);
    rerender(root, next, setState, "settings", navigate);
  });

  root.querySelector<HTMLFormElement>("#targetsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next: WealthState = {
      ...state,
      dca: {
        ...state.dca,
        targets: {
          VOO: (Number(data.get("vooTarget")) || 65) / 100,
          QQQM: (Number(data.get("qqqmTarget")) || 35) / 100,
        },
      },
      opportunity: {
        ...state.opportunity,
        total: Number(data.get("opportunityTotal")) || 0,
        allocation: {
          VOO: Number(data.get("vooAlloc")) || 0,
          QQQM: Number(data.get("qqqmAlloc")) || 0,
        },
      },
    };
    setState(next);
    rerender(root, next, setState, "settings", navigate);
  });
}