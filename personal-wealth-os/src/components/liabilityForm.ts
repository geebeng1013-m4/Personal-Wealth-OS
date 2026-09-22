/**
 * The debt form (L-2): Settings' "Add liability" and the Overview's "Write
 * down what you owe" sheet show the same fields and read them the same way.
 * The rate is typed as a percent and stored as a fraction; a flat rate is
 * converted to the real yearly rate. The checks live in buildLiability.
 */

import { escapeHtml } from "../html";
import { buildLiability, DEBT_KIND_IDS, DEBT_KINDS, isDebtKind, type LiabilityResult } from "../debtPriority";

function field(label: string, control: string, wide = false): string {
  return `<label class="wu-field-row${wide ? " wu-field-row--wide" : ""}"><span class="wu-field-row__label">${label}</span>${control}</label>`;
}

export function liabilityFields(defaults: { name?: string; balance?: number | "" } = {}): string {
  const kinds = DEBT_KIND_IDS.map((id) => `<option value="${id}">${escapeHtml(DEBT_KINDS[id].label)}</option>`).join("");
  return field("What it is", `<input class="wu-field" name="name" maxlength="60" autocomplete="off" placeholder="Credit card" value="${escapeHtml(defaults.name ?? "")}" required>`) +
    field("Kind (optional)", `<select class="wu-field" name="kind"><option value="">Choose</option>${kinds}</select>`) +
    field("Still owed", `<span class="wu-affix"><span>MYR</span><input class="wu-field" name="balance" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeHtml(String(defaults.balance ?? ""))}" required></span>`) +
    field("Interest a year (%, optional)", `<input class="wu-field" name="annualRate" inputmode="decimal" autocomplete="off" placeholder="18">`) +
    field("The rate is", `<select class="wu-field" name="rateBasis"><option value="effective">Effective (EIR)</option><option value="flat">Flat (car, personal loans)</option></select>`) +
    field("Last payment (optional)", `<input class="wu-field" name="endMonth" type="month">`) +
    field("Minimum payment (optional)", `<span class="wu-affix"><span>MYR</span><input class="wu-field" name="minimumPayment" inputmode="decimal" autocomplete="off" placeholder="0"></span>`) +
    `<label class="wu-switch wu-field-row--wide"><input type="checkbox" name="paidInFull"><span class="wu-switch__track"></span><span class="wu-switch__label">A card I pay in full every month (no interest)</span></label>` +
    `<p class="wu-field-row--wide t-caption t-faint">A flat rate is turned into the real yearly rate using the last payment month (5 years if blank). An estimate, not financial advice.</p>`;
}

export function readLiabilityForm(data: FormData, id: string, today: string): LiabilityResult {
  const text = (key: string) => String(data.get(key) ?? "").trim();
  const number = (key: string, blank: number) => {
    const raw = text(key).replace(/[\s,%]/g, "").replace(/^(MYR|RM)/i, "");
    return raw === "" ? blank : Number(raw);
  };
  const kind = text("kind");
  return buildLiability(id, {
    name: text("name"),
    balance: number("balance", Number.NaN),
    ratePercent: number("annualRate", 0),
    rateFlat: text("rateBasis") === "flat",
    minimumPayment: number("minimumPayment", 0),
    kind: isDebtKind(kind) ? kind : null,
    endMonth: text("endMonth"),
    paidInFull: data.get("paidInFull") === "on",
  }, today);
}
