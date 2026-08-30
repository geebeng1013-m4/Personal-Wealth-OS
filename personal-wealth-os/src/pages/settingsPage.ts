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
import { escapeHtml, numberInput } from "../html";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

export function settingsTemplate(state: WealthState): string {
  return `
    <div class="section-title"><span class="eyebrow">Configuration</span><h3>Profile and Parameters</h3><p>Adjust your investor profile, cash flow, and investment parameters.</p></div>
    <div class="settings-grid">
      <article class="card settings-section">
        <h3>👤 Investor Profile</h3>
        <form id="profileForm" class="form-grid">
          <label>Name<input name="name" type="text" value="${escapeHtml(state.profile.name)}"></label>
          <label>Age<input name="age" type="number" min="16" max="100" step="1" value="${state.profile.age}"></label>
          <label>Risk Tolerance<select name="riskTolerance"><option${state.profile.riskTolerance === "High" ? " selected" : ""}>High</option><option${state.profile.riskTolerance === "Medium" ? " selected" : ""}>Medium</option><option${state.profile.riskTolerance === "Low" ? " selected" : ""}>Low</option></select></label>
          <label>Stage<select name="stage"><option${state.profile.stage === "Student" ? " selected" : ""}>Student</option><option${state.profile.stage === "Early Career" ? " selected" : ""}>Early Career</option><option${state.profile.stage === "Mid Career" ? " selected" : ""}>Mid Career</option><option${state.profile.stage === "Pre-Retirement" ? " selected" : ""}>Pre-Retirement</option></select></label>
          ${numberInput("investmentHorizonYears", "Investment Horizon (years)", String(state.profile.investmentHorizonYears), "1")}
          <label>Base Currency<select name="baseCurrency"><option${state.profile.baseCurrency === "MYR" ? " selected" : ""}>MYR</option><option${state.profile.baseCurrency === "USD" ? " selected" : ""}>USD</option></select></label>
          <button class="primary-button" type="submit">Save Profile</button>
        </form>
      </article>
      <article class="card settings-section">
        <h3>Recurring Cash Flow</h3>
        <form id="recurringForm" class="form-grid"><label>Label<input name="label" maxlength="60" required></label>${numberInput("amount", "Amount MYR", "", "0.01")}<label>Type<select name="type"><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Day of month<input name="dayOfMonth" type="number" min="1" max="31" value="1" required><small class="field-hint">If a month is shorter, it runs on the last day.</small></label><button class="primary-button" type="submit">Add recurring item</button></form>
        <div class="settings-list">${state.recurringTransactions.map((item) => `<div><span>${escapeHtml(item.label)} · ${item.type} · day ${item.dayOfMonth}${item.dayOfMonth >= 29 ? " · short-month fallback" : ""}</span><strong>${money(item.amount)}</strong><button class="icon-button danger delete-recurring" data-id="${escapeHtml(item.id)}" aria-label="Delete recurring item">✕</button></div>`).join("") || '<p class="empty-state">No recurring items.</p>'}</div>
      </article>
      <article class="card settings-section">
        <h3>Liabilities</h3>
        <form id="liabilityForm" class="form-grid"><label>Name<input name="name" maxlength="60" required></label>${numberInput("balance", "Balance MYR", "", "0.01")}${numberInput("annualRate", "Annual rate %", "0", "0.01")}${numberInput("minimumPayment", "Minimum payment MYR", "0", "0.01")}<button class="primary-button" type="submit">Add liability</button></form>
        <div class="settings-list">${state.liabilities.map((item) => `<div><span>${escapeHtml(item.name)} · ${item.annualRate.toFixed(2)}%</span><strong>${money(item.balance)}</strong><button class="icon-button danger delete-liability" data-id="${escapeHtml(item.id)}" aria-label="Delete liability">✕</button></div>`).join("") || '<p class="empty-state">No liabilities recorded.</p>'}</div>
      </article>
      <article class="card settings-section">
        <h3>Privacy</h3><form id="privacyForm"><label class="setting-check"><input name="maskAmounts" type="checkbox"${state.privacy.maskAmounts ? " checked" : ""}>Mask financial amounts on screen</label><label class="setting-check"><input name="requireExportConfirmation" type="checkbox"${state.privacy.requireExportConfirmation ? " checked" : ""}>Confirm before exporting financial data</label><button class="primary-button" type="submit">Save privacy</button></form>
      </article>
      <article class="card settings-section">
        <h3>💰 Cashflow & DCA</h3>
        <form id="cashflowForm" class="form-grid">
          ${numberInput("allowance", "Monthly Allowance MYR", String(state.cashflow.allowance), "1")}
          ${numberInput("transport", "Transport MYR", String(state.cashflow.transport), "1")}
          ${numberInput("food", "Food MYR", String(state.cashflow.food), "1")}
          ${numberInput("otherFixed", "Other Fixed MYR", String(state.cashflow.otherFixed), "1")}
          ${numberInput("irregularIncome", "Irregular Income MYR", String(state.cashflow.irregularIncome), "1")}
          ${numberInput("dcaMonthly", "DCA Monthly MYR", String(state.dca.monthly), "1")}
          <button class="primary-button" type="submit">Save Cashflow</button>
        </form>
      </article>
      <article class="card settings-section">
        <h3>🛡️ Emergency Fund</h3>
        <form id="emergencyForm" class="form-grid">
          ${numberInput("current", "Current Emergency MYR", String(state.emergency.current), "1")}
          ${numberInput("target", "Target Emergency MYR", String(state.emergency.target), "1")}
          ${numberInput("monthlyTopUp", "Monthly Top-Up MYR", String(state.emergency.monthlyTopUp), "1")}
          ${numberInput("annualYield", "Annual Yield %", String(state.emergency.annualYield * 100), "0.01")}
          <button class="primary-button" type="submit">Save Emergency</button>
        </form>
      </article>
      <article class="card settings-section">
        <h3>🎯 DCA Targets</h3>
        <form id="targetsForm" class="form-grid">
          ${numberInput("vooTarget", "VOO Target %", String(Math.round(state.dca.targets.VOO * 100)), "1")}
          ${numberInput("qqqmTarget", "QQQM Target %", String(Math.round(state.dca.targets.QQQM * 100)), "1")}
          ${numberInput("opportunityTotal", "Opportunity Reserve MYR", String(state.opportunity.total), "1")}
          ${numberInput("vooAlloc", "Opportunity VOO MYR", String(state.opportunity.allocation.VOO), "1")}
          ${numberInput("qqqmAlloc", "Opportunity QQQM MYR", String(state.opportunity.allocation.QQQM), "1")}
          <button class="primary-button" type="submit">Save Targets</button>
        </form>
      </article>
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