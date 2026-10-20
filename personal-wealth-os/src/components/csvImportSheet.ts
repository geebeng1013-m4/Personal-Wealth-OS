import type { Trade, WealthState } from "../models";
import type { Setter } from "../pages/pageTypes";
import { previewCsvTrades, type CsvImportPreview } from "../csvImport";
import { commitImportedState } from "../importFlow";
import { CSV_IMPORT_SNAPSHOT_LABEL } from "../state";
import { escapeHtml } from "../html";
import { openBottomSheet } from "./bottomSheet";

export function csvImportBody(preview: CsvImportPreview): string {
  return `<p>${preview.newTrades.length} new trades. ${preview.suspectedDuplicates.length} possible duplicates.</p>
    <p class="t-caption t-muted">Possible duplicates are excluded unless you select the checkbox below. Matching executions can be separate orders; check your broker statement.</p>
    ${preview.suspectedDuplicates.length ? `<label class="wu-field-row wu-field-row--wide"><span><input type="checkbox" name="includeDuplicates"> These are separate executions. Include possible duplicates.</span></label>` : ""}
    <ul class="wu-list">${[...preview.newTrades, ...preview.suspectedDuplicates].slice(0, 10).map((trade) =>
      `<li class="wu-list__row"><span>${escapeHtml(trade.date)} · ${escapeHtml(trade.ticker)}</span><span>${escapeHtml(trade.type)}</span></li>`).join("")}</ul>
    ${preview.newTrades.length + preview.suspectedDuplicates.length > 10 ? `<p class="t-caption t-muted">Showing the first 10 trades. The counts above include the entire file.</p>` : ""}`;
}

export function csvImportSelection(preview: CsvImportPreview, includeDuplicates: boolean): Trade[] {
  return includeDuplicates ? [...preview.newTrades, ...preview.suspectedDuplicates] : [...preview.newTrades];
}

export function openCsvImportSheet(base: WealthState, records: Trade[], save: Setter, onSaved: (next: WealthState) => void): void {
  const preview = previewCsvTrades(base.trades, records);
  openBottomSheet({
    title: "Review CSV import",
    destination: "Portfolio",
    intro: "Nothing changes until you import. A snapshot of your current data must be saved to Version History first.",
    body: csvImportBody(preview),
    saveLabel: "Import trades",
    onOpen: (form) => {
      const checkbox = form.querySelector<HTMLInputElement>('[name="includeDuplicates"]');
      const button = form.querySelector<HTMLButtonElement>('[type="submit"]');
      const update = (): void => { if (button) button.disabled = !preview.newTrades.length && !checkbox?.checked; };
      checkbox?.addEventListener("change", update);
      update();
    },
    onSave: (form) => {
      const includeDuplicates = form.querySelector<HTMLInputElement>('[name="includeDuplicates"]')?.checked === true;
      const additions = csvImportSelection(preview, includeDuplicates);
      if (!additions.length) return "All trades are already recorded. Nothing was imported.";
      const next = { ...base, trades: [...base.trades, ...additions] };
      try { commitImportedState(base, next, CSV_IMPORT_SNAPSHOT_LABEL, save); }
      catch (error: unknown) { return error instanceof Error ? error.message : "Import was not saved. Your original data is unchanged. Check browser storage and try again."; }
      onSaved(next);
      return null;
    },
  });
}
