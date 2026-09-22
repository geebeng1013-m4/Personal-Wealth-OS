/**
 * Me page — everything about the user and their money, moved out of Settings
 * so Settings keeps only how the app behaves: the investor profile, money in
 * and out, and the plan (DCA, emergency fund, opportunity reserve).
 *
 * Same grouped-list rows as Settings (settingsRows). Each save is a plain
 * overwrite of its slice of the state; percentages are stored as fractions and
 * shown as whole numbers, so the templates multiply and the handlers divide by
 * 100.
 */

import type { WealthState } from "../models";
import { bindLiabilityForm, liabilityFields, readLiabilityForm } from "../components/liabilityForm";
import { createId } from "../state";
import { syncPlanningRules } from "../financialRules";
import { DEFAULT_EMERGENCY_MONTHS, money, suggestedEmergencyTarget } from "../rules";
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import { planTickers, tradedTickers, withPlannedCustomTickers } from "../planTickers";
import { amountOf, bindRowPage, editorForm, field, group, num, pct, row, staticRow } from "./settingsRows";
import type { Navigate, RenderApp, SessionUser, Setter } from "./pageTypes";

const STAGES = ["Student", "Early Career", "Mid Career", "Pre-Retirement"];

/**
 * Inside the Emergency fund editor: a suggested target from the essential
 * spending already entered, with a button that fills the target field. It never
 * saves — the user presses Save — because the target is their decision.
 */
function emergencySuggestion(state: WealthState): string {
  const suggestion = suggestedEmergencyTarget(state);
  if (!suggestion) {
    return `<p class="wu-field-row--wide t-caption t-faint">Enter your transport, food and other fixed costs under Monthly cash flow to get a suggested target.</p>`;
  }
  const already = state.emergency.target === suggestion.target;
  return `<div class="wu-field-row--wide settings-suggest">
    <p class="t-caption t-muted">Suggested target: <strong>${money(suggestion.target)}</strong> &mdash; ${suggestion.months} months of your essential spending (${money(suggestion.monthlyEssential)}/month). WealthUp's standard is 3&ndash;6 months.</p>
    ${already
      ? `<span class="t-caption t-faint">Your target already matches.</span>`
      : `<button class="wu-btn wu-btn--secondary wu-btn--sm" type="button" data-suggest-emergency="${suggestion.target}">Use ${DEFAULT_EMERGENCY_MONTHS} months</button>`}
  </div>`;
}

/** One ticker line in the DCA targets editor. Traded tickers can go to 0% but not be removed. */
function targetLine(ticker: string, value: string, removable: boolean): string {
  return `<li class="wu-set__ticker" data-ticker="${escapeHtml(ticker)}">
      <span class="wu-set__ticker-name">${escapeHtml(ticker)}</span>
      <span class="wu-set__ticker-input"><input class="wu-field" name="target:${escapeHtml(ticker)}" type="number" min="0" max="100" step="0.1" value="${value}" aria-label="${escapeHtml(ticker)} target percent"><span class="wu-set__unit">%</span></span>
      ${removable
        ? `<button class="wu-btn wu-btn--ghost wu-btn--icon" type="button" data-remove-ticker aria-label="Remove ${escapeHtml(ticker)}">&times;</button>`
        : `<span class="wu-set__keep" title="Has trades — set it to 0% instead">&nbsp;</span>`}
    </li>`;
}

function targetsEditor(state: WealthState): string {
  const traded = tradedTickers(state);
  const tickers = planTickers(state);
  const total = tickers.reduce((sum, ticker) => sum + (state.dca.targets[ticker] ?? 0), 0);
  return `<form class="wu-set__form" data-form="targets">
      <ul class="wu-set__tickers">${tickers.map((ticker) => targetLine(ticker, pct(state.dca.targets[ticker] ?? 0), !traded.has(ticker))).join("")}</ul>
      <div class="wu-set__add">
        <input class="wu-field" type="text" maxlength="20" placeholder="Add ETF, e.g. SCHD" data-new-ticker aria-label="New ticker">
        <button class="wu-btn wu-btn--secondary wu-btn--sm" type="button" data-add-ticker>+ Add ETF</button>
      </div>
      <p class="wu-set__total t-caption" data-target-total>${targetTotalText(total * 100)}</p>
      <p class="wu-field-row__error" role="alert" data-ticker-error></p>
      <div class="wu-set__actions"><button class="wu-btn wu-btn--ghost wu-btn--sm" type="button" data-close-editor>Cancel</button><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save</button></div>
    </form>`;
}

/** "Total 90%" and, when it is not 100, what that means — a warning, never a block. */
export function targetTotalText(totalPercent: number): string {
  const rounded = Math.round(totalPercent * 10) / 10;
  if (Math.abs(rounded - 100) < 0.05) return "Total 100%";
  return `Total ${rounded}% — ${rounded < 100 ? "the rest of each contribution is not assigned to any ETF" : "targets add up to more than 100%"}`;
}

function opportunityEditor(state: WealthState): string {
  const tickers = planTickers(state);
  return editorForm("opportunity",
    num("opportunityTotal", "Opportunity reserve MYR", String(state.opportunity.total), "1") +
    tickers.map((ticker) => num(`alloc:${escapeHtml(ticker)}`, `${escapeHtml(ticker)} allocation MYR`, String(state.opportunity.allocation[ticker] ?? 0), "1")).join(""));
}

function recurringEditor(state: WealthState): string {
  const rows = state.recurringTransactions.map((item) =>
    `<li class="wu-list__row"><span>${escapeHtml(item.label)} &middot; ${item.type} &middot; day ${item.dayOfMonth}${item.dayOfMonth >= 29 ? " &middot; short-month fallback" : ""}</span><strong class="t-num">${money(item.amount)}</strong><button class="wu-btn wu-btn--ghost wu-btn--icon delete-recurring" data-id="${escapeHtml(item.id)}" type="button" aria-label="Delete recurring item">&times;</button></li>`).join("");
  return `${state.recurringTransactions.length ? `<ul class="wu-list">${rows}</ul>` : `<p class="wu-empty">No recurring items.</p>`}
    ${editorForm("recurring-add",
      field("Label", `<input class="wu-field" name="label" maxlength="60" required>`) +
      num("amount", "Amount MYR", "", "0.01") +
      field("Type", `<select class="wu-field" name="type"><option value="expense">Expense</option><option value="income">Income</option></select>`) +
      field("Day of month", `<input class="wu-field" name="dayOfMonth" type="number" min="1" max="31" value="1" required>`) +
      `<p class="wu-field-row--wide t-caption t-faint">If a month is shorter, it runs on the last day.</p>`,
      "Add recurring item")}`;
}

function liabilitiesEditor(state: WealthState): string {
  const rows = state.liabilities.map((item) => {
    const rate = item.paidInFull ? "paid in full" : item.annualRate > 0 ? `${pct(item.annualRate)}% a year` : "rate not set";
    const until = item.endMonth ? ` &middot; until ${escapeHtml(item.endMonth)}` : "";
    return `<li class="wu-list__row"><span>${escapeHtml(item.name)} &middot; ${rate}${until}</span><strong class="t-num">${money(item.balance)}</strong><button class="wu-btn wu-btn--ghost wu-btn--icon delete-liability" data-id="${escapeHtml(item.id)}" type="button" aria-label="Delete ${escapeHtml(item.name)}">&times;</button></li>`;
  }).join("");
  return `${state.liabilities.length ? `<ul class="wu-list">${rows}</ul>` : `<p class="wu-empty">No liabilities recorded.</p>`}
    ${editorForm("liability-add", `${liabilityFields()}<p class="wu-field-row__error wu-field-row--wide" role="alert" data-liability-error></p>`, "Add liability")}`;
}

/** Up to two initials for the avatar when there is no photo, or it fails to load. */
function initialsOf(name: string): string {
  const letters = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/**
 * The top of the page: who is signed in, with Sign Out (moved here from the
 * sidebar and the phone More page), and the investor mandate the sidebar card
 * shows, as words — the Advisor and Rules read these.
 */
function accountCard(state: WealthState, user?: SessionUser): string {
  const profile = state.profile;
  const name = profile.name.trim() || user?.displayName?.trim() || "You";
  const email = user?.email ?? "";
  const photo = user?.photoURL ?? "";
  const facts = [
    profile.age > 0 ? `Age ${profile.age}` : "",
    `${profile.riskTolerance} risk`,
    `${profile.investmentHorizonYears}-year horizon`,
    profile.stage,
    `${profile.baseCurrency} base`,
  ].filter(Boolean);
  return `<section class="wu-card wu-me-card" aria-label="Your account">
      <div class="wu-me-card__id">
        <span class="wu-me-card__avatar" aria-hidden="true">
          <span class="wu-me-card__initials">${escapeHtml(initialsOf(name))}</span>
          ${photo ? `<img src="${escapeHtml(photo)}" alt="" referrerpolicy="no-referrer" data-me-photo>` : ""}
        </span>
        <div class="wu-me-card__who">
          <h2 class="wu-me-card__name t-heading">${escapeHtml(name)}</h2>
          ${email ? `<p class="wu-me-card__email t-caption t-muted">${escapeHtml(email)}</p>` : ""}
        </div>
        ${user ? `<button class="wu-btn wu-btn--secondary wu-btn--sm logout-btn wu-me-card__signout" type="button">Sign Out</button>` : ""}
      </div>
      <ul class="wu-me-card__facts" aria-label="Investor profile">${facts.map((fact) => `<li class="wu-badge wu-badge--neutral">${escapeHtml(fact)}</li>`).join("")}</ul>
      <p class="wu-me-card__note t-caption t-faint">Your age, stage and risk tolerance shape what the Advisor and Rules suggest.</p>
    </section>`;
}

export function meTemplate(state: WealthState, user?: SessionUser): string {
  const opt = (v: string, sel: boolean) => `<option${sel ? " selected" : ""}>${escapeHtml(v)}</option>`;
  const profile = state.profile;
  // A stage saved outside the four presets (the demo's "18-22 / University
  // Year 3") is offered as its own option, so saving never swaps it for Student.
  const stages = STAGES.includes(profile.stage) ? STAGES : [profile.stage, ...STAGES];

  const profileRows = [
    row("profile:name", "Name", escapeHtml(profile.name), "", () => editorForm("profile:name", field("Name", `<input class="wu-field" name="name" type="text" value="${escapeHtml(profile.name)}">`, true))),
    row("profile:age", "Age", String(profile.age), "", () => editorForm("profile:age", num("age", "Age", String(profile.age), "1", ' min="16" max="100"'))),
    row("profile:riskTolerance", "Risk tolerance", escapeHtml(profile.riskTolerance), "", () => editorForm("profile:riskTolerance", field("Risk tolerance", `<select class="wu-field" name="riskTolerance">${["High", "Medium", "Low"].map((v) => opt(v, profile.riskTolerance === v)).join("")}</select>`))),
    row("profile:stage", "Stage", escapeHtml(profile.stage), "", () => editorForm("profile:stage", field("Stage", `<select class="wu-field" name="stage">${stages.map((v) => opt(v, profile.stage === v)).join("")}</select>`, true))),
    row("profile:investmentHorizonYears", "Investment horizon", `${profile.investmentHorizonYears} years`, "", () => editorForm("profile:investmentHorizonYears", num("investmentHorizonYears", "Investment horizon (years)", String(profile.investmentHorizonYears), "1"))),
    row("profile:baseCurrency", "Base currency", escapeHtml(profile.baseCurrency), "", () => editorForm("profile:baseCurrency", field("Base currency", `<select class="wu-field" name="baseCurrency">${["MYR", "USD"].map((v) => opt(v, profile.baseCurrency === v)).join("")}</select>`))),
  ].join("");

  const activeRecurring = state.recurringTransactions.filter((item) => item.active !== false);
  const recurringIn = activeRecurring.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const recurringOut = activeRecurring.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  const liabilityTotal = state.liabilities.reduce((sum, item) => sum + item.balance, 0);
  const tickers = planTickers(state);
  const tranches = state.opportunity.tranches ?? [];

  const cashflowRow = (only: "phone" | "desk") => row("cashflow", "Monthly cash flow", amountOf(state.cashflow.allowance), "Allowance, fixed costs, irregular income", () => editorForm("cashflow",
    num("allowance", "Monthly allowance MYR", String(state.cashflow.allowance), "1") +
    num("transport", "Transport MYR", String(state.cashflow.transport), "1") +
    num("food", "Food MYR", String(state.cashflow.food), "1") +
    num("otherFixed", "Other fixed MYR", String(state.cashflow.otherFixed), "1") +
    num("irregularIncome", "Irregular income MYR", String(state.cashflow.irregularIncome), "1")), only);

  const moneyRows = [
    row("recurring", "Recurring items", String(state.recurringTransactions.length), activeRecurring.length ? `+${amountOf(recurringIn)} in · −${amountOf(recurringOut)} out` : "None yet", () => recurringEditor(state)),
    row("liabilities", "Liabilities", amountOf(liabilityTotal), state.liabilities.length ? escapeHtml(state.liabilities.map((item) => item.name).join(", ")) : "None recorded", () => liabilitiesEditor(state)),
    cashflowRow("phone"),
  ].join("");

  const planRows = [
    row("dca", "Monthly DCA", amountOf(state.dca.monthly), "", () => editorForm("dca", num("dcaMonthly", "DCA monthly MYR", String(state.dca.monthly), "1"))),
    row("targets", "DCA targets", tickers.map((ticker) => pct(state.dca.targets[ticker] ?? 0)).join(" / "), escapeHtml(tickers.join(" · ")), () => targetsEditor(state)),
    row("emergency", "Emergency fund", `${amountOf(state.emergency.current)} / ${amountOf(state.emergency.target)}`, "", () => editorForm("emergency",
      num("current", "Current emergency MYR", String(state.emergency.current), "1") +
      num("target", "Target emergency MYR", String(state.emergency.target), "1") +
      num("monthlyTopUp", "Monthly top-up MYR", String(state.emergency.monthlyTopUp), "1") +
      num("annualYield", "Annual yield %", pct(state.emergency.annualYield), "0.01") +
      emergencySuggestion(state))),
    row("opportunity", "Opportunity reserve", amountOf(state.opportunity.total), "", () => opportunityEditor(state)),
    staticRow("Dip-buy tranches", tranches.length ? `${tranches.map((tranche) => `−${tranche.drawdown}`).join(" / ")}%` : "Not set", "desk"),
    cashflowRow("desk"),
  ].join("");

  return `
    <div class="wu wu-settings-page">
      ${pageHeader({
        eyebrow: "You",
        title: "Me",
        sub: "Who you are, your money in and out, and your plan.",
      })}
      ${accountCard(state, user)}
      <div class="wu-me-cols">
        <div class="wu-me-col">
          ${group("meProfileLabel", "Profile", profileRows)}
          ${group("meMoneyLabel", "Money in &amp; out", moneyRows)}
        </div>
        <div class="wu-me-col">
          ${group("mePlanLabel", "Plan", planRows)}
        </div>
      </div>
    </div>
  `;
}

export function bindMe(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp, user?: SessionUser, onLogout?: () => void): void {
  const { save, saveOpen, onSubmit } = bindRowPage(root, state, setState, navigate, rerender, "me", user, onLogout);

  // A photo that will not load leaves the initials underneath showing.
  root.querySelector<HTMLImageElement>("[data-me-photo]")?.addEventListener("error", (event) => (event.currentTarget as HTMLImageElement).remove());

  // Profile: each row edits one field.
  onSubmit("profile:name", (data) => save({ ...state, profile: { ...state.profile, name: String(data.get("name") ?? state.profile.name) } }));
  onSubmit("profile:age", (data) => save({ ...state, profile: { ...state.profile, age: Number(data.get("age")) || 19 } }));
  onSubmit("profile:riskTolerance", (data) => save({ ...state, profile: { ...state.profile, riskTolerance: String(data.get("riskTolerance")) as WealthState["profile"]["riskTolerance"] } }));
  onSubmit("profile:stage", (data) => save({ ...state, profile: { ...state.profile, stage: String(data.get("stage") ?? state.profile.stage) } }));
  onSubmit("profile:investmentHorizonYears", (data) => save({ ...state, profile: { ...state.profile, investmentHorizonYears: Number(data.get("investmentHorizonYears")) || 10 } }));
  onSubmit("profile:baseCurrency", (data) => save({ ...state, profile: { ...state.profile, baseCurrency: String(data.get("baseCurrency")) as WealthState["profile"]["baseCurrency"] } }));

  onSubmit("recurring-add", (data) => {
    const amount = Number(data.get("amount"));
    const dayOfMonth = Number(data.get("dayOfMonth"));
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return;
    saveOpen({ ...state, recurringTransactions: [...state.recurringTransactions, { id: createId("recurring"), label: String(data.get("label") ?? "").trim().slice(0, 60), amount, type: String(data.get("type")) as "income" | "expense", dayOfMonth, active: true }] }, "Add recurring transaction");
  });
  root.querySelectorAll<HTMLButtonElement>(".delete-recurring").forEach((button) => button.addEventListener("click", () => saveOpen({ ...state, recurringTransactions: state.recurringTransactions.filter((item) => item.id !== button.dataset.id) }, "Delete recurring transaction")));

  onSubmit("liability-add", (data, form) => {
    const result = readLiabilityForm(data, createId("liability"), new Date().toLocaleDateString("en-CA"));
    const error = form.querySelector<HTMLElement>("[data-liability-error]");
    if (error) error.textContent = result.ok ? "" : result.error;
    if (!result.ok) return;
    saveOpen({ ...state, liabilities: [...state.liabilities, result.liability] }, "Add liability");
  });
  root.querySelectorAll<HTMLFormElement>('form[data-form="liability-add"]').forEach(bindLiabilityForm);
  root.querySelectorAll<HTMLButtonElement>(".delete-liability").forEach((button) => button.addEventListener("click", () => saveOpen({ ...state, liabilities: state.liabilities.filter((item) => item.id !== button.dataset.id) }, "Delete liability")));

  onSubmit("cashflow", (data) => {
    const next: WealthState = {
      ...state,
      cashflow: {
        allowance: Number(data.get("allowance")) || 0,
        transport: Number(data.get("transport")) || 0,
        food: Number(data.get("food")) || 0,
        otherFixed: Number(data.get("otherFixed")) || 0,
        irregularIncome: Number(data.get("irregularIncome")) || 0,
      },
    };
    // The spending limit is the policy the Advisor reads; keep it in step with
    // what was just saved (see syncPlanningRules).
    next.financialRules = syncPlanningRules(next, ["monthly-spending-limit"]);
    save(next);
  });

  onSubmit("dca", (data) => {
    const next: WealthState = { ...state, dca: { ...state.dca, monthly: Number(data.get("dcaMonthly")) || 0 } };
    next.financialRules = syncPlanningRules(next, ["dca-monthly-amount"]);
    save(next);
  });

  // "Use 6 months" fills the target field only; Save is still the save.
  root.querySelectorAll<HTMLButtonElement>("[data-suggest-emergency]").forEach((button) => button.addEventListener("click", () => {
    const target = button.closest("form")?.querySelector<HTMLInputElement>('input[name="target"]');
    if (!target) return;
    target.value = button.dataset.suggestEmergency ?? target.value;
    target.focus();
  }));

  onSubmit("emergency", (data) => {
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
    next.financialRules = syncPlanningRules(next, ["emergency-fund-minimum"]);
    save(next);
  });

  // DCA targets: one box per ticker, added or removed in the form before Save.
  root.querySelectorAll<HTMLFormElement>('form[data-form="targets"]').forEach((form) => {
    const list = form.querySelector<HTMLUListElement>(".wu-set__tickers");
    const totalLine = form.querySelector<HTMLElement>("[data-target-total]");
    const error = form.querySelector<HTMLElement>("[data-ticker-error]");
    const updateTotal = (): void => {
      const total = [...form.querySelectorAll<HTMLInputElement>('input[name^="target:"]')].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
      if (totalLine) totalLine.textContent = targetTotalText(total);
    };
    const bindRemove = (scope: ParentNode): void => {
      scope.querySelectorAll<HTMLButtonElement>("[data-remove-ticker]").forEach((button) => button.addEventListener("click", () => {
        button.closest("li")?.remove();
        updateTotal();
      }));
    };
    form.addEventListener("input", updateTotal);
    bindRemove(form);
    const addInput = form.querySelector<HTMLInputElement>("[data-new-ticker]");
    const addTicker = (): void => {
      if (!addInput || !list || !error) return;
      const ticker = addInput.value.trim().toUpperCase();
      if (!/^[A-Z0-9._^:-]{1,20}$/.test(ticker)) {
        error.textContent = "Enter a ticker such as SCHD — letters, numbers, dots or dashes.";
        return;
      }
      if (list.querySelector(`[data-ticker="${CSS.escape(ticker)}"]`)) {
        error.textContent = `${ticker} is already in the list.`;
        return;
      }
      error.textContent = "";
      list.insertAdjacentHTML("beforeend", targetLine(ticker, "0", true));
      const added = list.lastElementChild as HTMLElement;
      bindRemove(added);
      added.querySelector<HTMLInputElement>("input")?.focus();
      addInput.value = "";
      updateTotal();
    };
    form.querySelector<HTMLButtonElement>("[data-add-ticker]")?.addEventListener("click", addTicker);
    addInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTicker();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const targets: Record<string, number> = {};
      form.querySelectorAll<HTMLInputElement>('input[name^="target:"]').forEach((input) => {
        const ticker = input.name.slice("target:".length);
        const value = Number(input.value);
        targets[ticker] = Number.isFinite(value) && value > 0 ? value / 100 : 0;
      });
      if (Object.keys(targets).length === 0) {
        if (error) error.textContent = "Keep at least one ETF in the plan.";
        return;
      }
      const planned = Object.keys(targets);
      const next: WealthState = {
        ...state,
        dca: { ...state.dca, targets },
        customTickers: withPlannedCustomTickers(state.customTickers, planned),
      };
      next.financialRules = syncPlanningRules(next, ["target-allocation"]);
      save(next);
    });
  });

  onSubmit("opportunity", (data) => {
    const allocation: Record<string, number> = { ...state.opportunity.allocation };
    for (const [name, value] of data.entries()) {
      if (!name.startsWith("alloc:")) continue;
      allocation[name.slice("alloc:".length)] = Number(value) || 0;
    }
    save({ ...state, opportunity: { ...state.opportunity, total: Number(data.get("opportunityTotal")) || 0, allocation } });
  });
}
