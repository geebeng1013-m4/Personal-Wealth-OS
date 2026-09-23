/**
 * The debt form: Me's "Add liability" and the Overview's "Write down what
 * you owe" sheet (L-2, made into choices in L-6).
 *
 * Like the Q&A: pick what the debt is first, then only that kind's questions
 * appear, each a row of choices with "type your own" last. The typical figures
 * come from DEBT_KINDS and the choices below; the minimum payment is worked
 * out (a card's 5% or RM50, a loan's instalment) instead of asked. A line at
 * the bottom says what the answers mean, in the user's numbers.
 *
 * Every kind's questions are in the markup; the ones not in use are hidden and
 * disabled, so FormData only carries the chosen kind's answers. Names are
 * prefixed with the kind ("car-loan:rate") so one kind's radio group never
 * unticks another's. The checks live in buildLiability.
 */

import { escapeHtml } from "../html";
import type { DebtKind, Liability } from "../models";
import {
  addMonths,
  buildLiability,
  cardMinimumPayment,
  DEBT_KIND_IDS,
  DEBT_KINDS,
  debtTier,
  isDebtKind,
  monthlyInstalment,
  monthlyInterest,
  monthsUntil,
  type LiabilityResult,
} from "../debtPriority";

interface RateChoice {
  percent: number;
  label: string;
}

interface KindQuestions {
  amounts: number[];
  rates: RateChoice[];
  /** The rate picked before the user picks one. */
  defaultRate: number;
  /** Offer "Not sure" as a rate. */
  rateUnknown: boolean;
  /** Ask flat or effective; the default is DEBT_KINDS' `quotedFlat`. */
  askBasis: boolean;
  /** Months-left choices; null for a debt without a term. */
  terms: number[] | null;
  defaultTerm: number | null;
  /** "Each month I [pay it all off] [pay only part of it]": for a card and BNPL. */
  paid: { full: string; part: string } | null;
}

/** Choices a Malaysian user is likely to recognise. Estimates, labelled as such in the form. */
const QUESTIONS: Record<DebtKind, KindQuestions> = {
  "credit-card": {
    amounts: [1000, 3000, 5000, 10000],
    // Bank Negara's tiers, by the last 12 months' payments.
    rates: [
      { percent: 15, label: "15% · paid on time all 12 months" },
      { percent: 17, label: "17% · on time 10 of 12 months" },
      { percent: 18, label: "18% · otherwise" },
    ],
    defaultRate: 18, rateUnknown: false, askBasis: false, terms: null, defaultTerm: null,
    paid: { full: "pay it all off", part: "pay only part of it" },
  },
  "personal-loan": {
    amounts: [5000, 10000, 30000, 50000],
    rates: [4, 6, 8, 10].map((percent) => ({ percent, label: `${percent}%` })),
    defaultRate: 6, rateUnknown: false, askBasis: true, terms: [12, 24, 36, 60, 84, 120], defaultTerm: 60, paid: null,
  },
  "car-loan": {
    amounts: [10000, 30000, 50000, 80000],
    rates: [2.5, 3, 3.5, 4].map((percent) => ({ percent, label: `${percent}%` })),
    defaultRate: 3, rateUnknown: false, askBasis: true, terms: [12, 24, 36, 60, 84, 108], defaultTerm: 84, paid: null,
  },
  ptptn: {
    amounts: [5000, 10000, 20000, 40000],
    rates: [{ percent: 1, label: "1%" }, { percent: 3, label: "3% · loans before 2008" }],
    defaultRate: 1, rateUnknown: false, askBasis: false, terms: [36, 60, 120, 180, 240], defaultTerm: 120, paid: null,
  },
  "housing-loan": {
    amounts: [100000, 300000, 500000, 800000],
    rates: [3.5, 4, 4.5].map((percent) => ({ percent, label: `${percent}%` })),
    defaultRate: 4, rateUnknown: false, askBasis: false, terms: [60, 120, 180, 240, 300, 360, 420], defaultTerm: 300, paid: null,
  },
  bnpl: {
    amounts: [300, 1000, 3000, 5000],
    rates: [{ percent: 18, label: "18%" }],
    defaultRate: 18, rateUnknown: false, askBasis: false, terms: null, defaultTerm: null,
    paid: { full: "pay every instalment on time", part: "sometimes pay late" },
  },
  other: {
    amounts: [1000, 5000, 10000, 30000],
    rates: [3, 5, 8, 12, 18].map((percent) => ({ percent, label: `${percent}%` })),
    defaultRate: 0, rateUnknown: true, askBasis: false, terms: [12, 24, 36, 60, 120], defaultTerm: null, paid: null,
  },
};

const CUSTOM = "custom";
const UNKNOWN = "unknown";
const rm = (value: number) => `RM${Math.round(value).toLocaleString("en-MY")}`;
const pct = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

function termLabel(months: number): string {
  if (months < 12) return `${months} months`;
  const years = months / 12;
  return years === 1 ? "1 year" : `${Number.isInteger(years) ? years : years.toFixed(1)} years`;
}

/** One question: a row of radio choices, "type your own" last, its text box shown only when picked. */
function choices(name: string, legend: string, options: Array<[value: string, label: string]>, picked: string, custom?: { label: string; placeholder: string; unit: string; value: string }): string {
  const radios = options.map(([value, label]) =>
    `<label class="wu-choice__opt"><input type="radio" name="${name}" value="${escapeHtml(value)}"${value === picked ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("");
  const own = custom
    ? `<label class="wu-choice__opt"><input type="radio" name="${name}" value="${CUSTOM}"${picked === CUSTOM ? " checked" : ""}><span>${escapeHtml(custom.label)}</span></label>`
    : "";
  const box = custom
    ? `<span class="wu-affix wu-choice__custom" data-custom-for="${name}"${picked === CUSTOM ? "" : " hidden"}>${custom.unit === "RM" ? "<span>MYR</span>" : ""}<input class="wu-field" name="${name}:custom" inputmode="decimal" autocomplete="off" placeholder="${escapeHtml(custom.placeholder)}" aria-label="${escapeHtml(legend)}, typed" value="${escapeHtml(custom.value)}">${custom.unit !== "RM" ? `<span>${escapeHtml(custom.unit)}</span>` : ""}</span>`
    : "";
  return `<fieldset class="wu-choice wu-choice--glass wu-field-row--wide"><legend class="wu-field-row__label">${escapeHtml(legend)}</legend>
      <div class="wu-choice__opts">${radios}${own}</div>${box}</fieldset>`;
}

function kindSection(kind: DebtKind, defaults: LiabilityFormDefaults): string {
  const q = QUESTIONS[kind];
  const info = DEBT_KINDS[kind];
  const p = (field: string) => `${kind}:${field}`;
  const mine = defaults.kind === kind;
  const balance = mine && defaults.balance ? defaults.balance : undefined;
  const amountPicked = balance === undefined ? "" : q.amounts.includes(balance) ? String(balance) : CUSTOM;
  const parts: string[] = [];
  if (kind === "other") {
    parts.push(`<label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">What it is</span>
      <input class="wu-field" name="${p("name")}" maxlength="60" autocomplete="off" placeholder="A loan from family" value="${escapeHtml(mine ? defaults.name ?? "" : "")}"></label>`);
  }
  parts.push(choices(p("amount"), "Still owed", q.amounts.map((amount) => [String(amount), rm(amount)]), amountPicked,
    { label: "Type an amount", placeholder: "0.00", unit: "RM", value: amountPicked === CUSTOM ? String(balance) : "" }));
  if (q.paid) {
    const paid = mine && defaults.paidInFull !== undefined ? (defaults.paidInFull ? "full" : "part") : "";
    parts.push(choices(p("paid"), "Each month I", [["full", q.paid.full], ["part", q.paid.part]], paid));
  }
  const rateOptions: Array<[string, string]> = [
    ...(q.rateUnknown ? [[UNKNOWN, "Not sure"] as [string, string]] : []),
    ...q.rates.map((rate): [string, string] => [String(rate.percent), rate.label]),
  ];
  const rate = choices(p("rate"), "Interest a year", rateOptions, q.rateUnknown ? UNKNOWN : String(q.defaultRate),
    { label: "Type a rate", placeholder: "e.g. 13.5", unit: "%", value: "" });
  // A card or BNPL only asks the rate when it is not cleared on time.
  parts.push(q.paid ? `<div class="wu-choice__group wu-field-row--wide" data-when-part hidden>${rate}</div>` : rate);
  if (q.askBasis) {
    parts.push(choices(p("basis"), "The rate is", [["flat", "Flat (what the loan papers usually say)"], ["effective", "Effective (EIR)"]], info.quotedFlat ? "flat" : "effective"));
  }
  if (q.terms) {
    parts.push(choices(p("term"), "Time left to pay", [...q.terms.map((months): [string, string] => [String(months), termLabel(months)]), [UNKNOWN, "Not sure"]],
      q.defaultTerm ? String(q.defaultTerm) : UNKNOWN, { label: "Type years", placeholder: "e.g. 6", unit: "years", value: "" }));
  }
  return `<div class="wu-debt-form__kind wu-grid wu-grid--2 wu-field-row--wide" data-debt-kind="${kind}" hidden>${parts.join("")}</div>`;
}

export interface LiabilityFormDefaults {
  kind?: DebtKind;
  name?: string;
  balance?: number;
  /** A card or BNPL: what the Q&A said. */
  paidInFull?: boolean;
}

/** The whole form body. Call bindLiabilityForm on the form once it is on the page. */
export function liabilityFields(defaults: LiabilityFormDefaults = {}): string {
  const kinds = DEBT_KIND_IDS.map((id) =>
    `<label class="wu-choice__opt"><input type="radio" name="kind" value="${id}"${defaults.kind === id ? " checked" : ""}><span>${escapeHtml(id === "other" ? "Something else" : DEBT_KINDS[id].label)}</span></label>`).join("");
  return `<fieldset class="wu-choice wu-choice--glass wu-field-row--wide"><legend class="wu-field-row__label">What kind of debt?</legend>
      <div class="wu-choice__opts">${kinds}</div></fieldset>
    ${DEBT_KIND_IDS.map((id) => kindSection(id, defaults)).join("")}
    <p class="wu-debt-form__summary wu-field-row--wide" data-debt-summary aria-live="polite" hidden></p>
    <p class="wu-field-row--wide t-caption t-faint" data-debt-note hidden>The choices are typical figures, so check your statement. Estimates only, not financial advice.</p>`;
}

// --- reading it back ---------------------------------------------------------------

function selectedKind(data: FormData): DebtKind | null {
  const kind = data.get("kind");
  return isDebtKind(kind) ? kind : null;
}

/** A choice's number: the picked option, or what was typed when "type your own" was picked. NaN when blank. */
function picked(data: FormData, name: string): number | "unknown" | null {
  const value = data.get(name);
  if (value === null) return null;
  if (value === UNKNOWN) return UNKNOWN;
  const raw = value === CUSTOM ? String(data.get(`${name}:custom`) ?? "") : String(value);
  const cleaned = raw.replace(/[\s,%]/g, "").replace(/^(MYR|RM)/i, "");
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

/**
 * What the form says, as a liability; the monthly payment is worked out from
 * it. `result.ok` false carries a sentence for the user.
 */
export function readLiabilityForm(data: FormData, id: string, today: string): LiabilityResult {
  const kind = selectedKind(data);
  if (!kind) return { ok: false, error: "Choose what kind of debt it is." };
  const q = QUESTIONS[kind];
  const p = (field: string) => `${kind}:${field}`;
  const balance = picked(data, p("amount"));
  if (balance === null) return { ok: false, error: "Choose how much is still owed." };
  const paidInFull = q.paid ? data.get(p("paid")) === "full" : false;
  if (q.paid && data.get(p("paid")) === null) return { ok: false, error: `Choose how you pay it each month.` };
  // Cleared on time: no interest to ask about; the kind's typical rate is kept for reference.
  const rate = q.paid && paidInFull ? q.defaultRate : picked(data, p("rate"));
  if (rate === null) return { ok: false, error: "Choose the interest rate, or type it." };
  let months: number | null = null;
  if (q.terms) {
    const term = data.get(p("term"));
    if (term === CUSTOM) {
      const years = picked(data, p("term"));
      if (typeof years !== "number" || !Number.isFinite(years) || years <= 0 || years > 50) return { ok: false, error: "Type the years left, like 6." };
      months = Math.max(1, Math.round(years * 12));
    } else if (term !== null && term !== UNKNOWN) {
      months = Number(term);
    }
  }
  const name = kind === "other" ? String(data.get(p("name")) ?? "").trim() || DEBT_KINDS.other.label : DEBT_KINDS[kind].label;
  const result = buildLiability(id, {
    name,
    balance: typeof balance === "number" ? balance : Number.NaN,
    ratePercent: typeof rate === "number" ? rate : 0,
    rateFlat: q.askBasis && data.get(p("basis")) === "flat",
    minimumPayment: 0,
    kind,
    endMonth: months ? addMonths(today, months) : "",
    paidInFull,
  }, today);
  if (!result.ok) return result;
  const liability = result.liability;
  return { ok: true, liability: { ...liability, minimumPayment: Math.round(minimumFor(liability, months) * 100) / 100 } };
}

/** What has to go out each month anyway: a card's minimum, a loan's instalment; 0 when unknown. */
function minimumFor(liability: Liability, months: number | null): number {
  if (liability.kind === "credit-card") return cardMinimumPayment(liability.balance);
  return months ? monthlyInstalment(liability.balance, liability.annualRate, months) : 0;
}

/** The line under the form: what these answers mean. */
export function debtSummary(liability: Liability, today: string): string {
  if (liability.paidInFull) return "No interest while you clear it on time. It won't hold up your safety buffer.";
  const rate = liability.annualRate;
  const tier = debtTier(rate);
  if (tier === "unknown") return "Without a rate, WealthUp can't tell whether it should come first.";
  const end = liability.endMonth && monthsUntil(liability.endMonth, today) > 0
    ? `, cleared around ${new Date(Number(liability.endMonth.slice(0, 4)), Number(liability.endMonth.slice(5, 7)) - 1, 1).toLocaleDateString("en-MY", { month: "long", year: "numeric" })}`
    : "";
  const payment = liability.minimumPayment > 0 ? ` About ${rm(liability.minimumPayment)} a month${end}.` : "";
  if (tier === "high") return `${pct(rate)} a year is about ${rm(monthlyInterest(liability.balance, rate))} of interest a month, so WealthUp puts this first.${payment}`;
  return `${pct(rate)} a year: pay it on schedule, your safety buffer comes first.${payment}`;
}

/**
 * Show the chosen kind's questions (and nothing else), open a "type your own"
 * box when it is picked, and keep the summary line current.
 */
export function bindLiabilityForm(form: HTMLFormElement): void {
  const today = () => new Date().toLocaleDateString("en-CA");
  const sync = () => {
    const data = new FormData(form);
    const kind = selectedKind(data);
    form.querySelectorAll<HTMLElement>("[data-debt-kind]").forEach((section) => {
      const on = section.dataset.debtKind === kind;
      section.hidden = !on;
      section.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.disabled = !on; });
    });
    if (kind) {
      const section = form.querySelector<HTMLElement>(`[data-debt-kind="${kind}"]`);
      const partBlock = section?.querySelector<HTMLElement>("[data-when-part]");
      if (partBlock) {
        const part = section?.querySelector<HTMLInputElement>(`input[name="${kind}:paid"][value="part"]`)?.checked ?? false;
        partBlock.hidden = !part;
        partBlock.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.disabled = !part; });
      }
      section?.querySelectorAll<HTMLElement>("[data-custom-for]").forEach((box) => {
        const name = box.dataset.customFor ?? "";
        const open = section.querySelector<HTMLInputElement>(`input[name="${CSS.escape(name)}"][value="${CUSTOM}"]`)?.checked ?? false;
        box.hidden = !open;
        box.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.disabled = !open || input.closest("[hidden]") !== null; });
      });
    }
    const summary = form.querySelector<HTMLElement>("[data-debt-summary]");
    const note = form.querySelector<HTMLElement>("[data-debt-note]");
    const result = readLiabilityForm(new FormData(form), "preview", today());
    if (summary) {
      summary.hidden = !result.ok;
      summary.textContent = result.ok ? debtSummary(result.liability, today()) : "";
    }
    if (note) note.hidden = !kind;
  };
  // A save's complaint is about the answers as they were; once one changes it no longer applies.
  const clearError = () => form.querySelectorAll<HTMLElement>("[data-liability-error]").forEach((line) => { line.textContent = ""; });
  form.addEventListener("change", () => { clearError(); sync(); });
  form.addEventListener("input", () => { clearError(); sync(); });
  sync();
}
