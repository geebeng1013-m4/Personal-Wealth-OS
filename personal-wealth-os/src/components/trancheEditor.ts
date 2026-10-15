import type { WealthState } from "../models";
import { escapeHtml, amt } from "../html";
import { money } from "../rules";
import { updateOpportunityTranches } from "../opportunityTranches";
import { openBottomSheet } from "./bottomSheet";

/** Shared by Advisor and Me, so both entry points use the same validation. */
export function openTrancheEditor(state: WealthState, save: (next: WealthState) => void): void {
  openBottomSheet({
    title: "Edit dip-buy ladder",
    destination: "Opportunity reserve",
    intro: `Reserve: ${amt(money(state.opportunity.total))}. Amounts are for each whole step. Deployed steps stay locked.`,
    body: state.opportunity.tranches.length ? `<div class="wu-stack">${state.opportunity.tranches.map((tranche, index) => `<fieldset class="wu-fieldset wu-tranche-editor">
      <legend>Step ${index + 1}${tranche.deployed ? " · Deployed — locked" : ""}</legend>
      <div class="wu-grid wu-grid--2">
        <label class="wu-field-row"><span class="wu-field-row__label">Trigger drawdown (%)</span><input class="wu-field" name="drawdown:${index}" type="text" inputmode="decimal" value="${escapeHtml(String(tranche.drawdown))}"${tranche.deployed ? " readonly" : ""} required></label>
        <label class="wu-field-row"><span class="wu-field-row__label">Amount (MYR)</span><input class="wu-field" name="amount:${index}" type="text" inputmode="decimal" value="${escapeHtml(String(tranche.amount))}"${tranche.deployed ? " readonly" : ""} required></label>
      </div>
    </fieldset>`).join("")}</div>` : `<p class="wu-empty">No dip-buy steps are configured to edit.</p>`,
    onSave: (form) => {
      const data = new FormData(form);
      const result = updateOpportunityTranches(state, state.opportunity.tranches.map((_tranche, index) => ({
        drawdown: String(data.get(`drawdown:${index}`) ?? ""),
        amount: String(data.get(`amount:${index}`) ?? ""),
      })));
      if (!result.ok) return result.error;
      // Keep the editor open when local persistence fails, as with entry sheets.
      let localFailed = false;
      const onError = (event: Event): void => {
        if ((event as CustomEvent<{ kind?: string }>).detail?.kind === "local-write") localFailed = true;
      };
      window.addEventListener("pwo-save-error", onError);
      try { save(result.state); } finally { window.removeEventListener("pwo-save-error", onError); }
      return localFailed ? "This device could not save the changes. Your inputs are still here; try again." : null;
    },
  });
}
