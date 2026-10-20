import type { WealthState } from "./models";
import type { Setter } from "./pages/pageTypes";

let stateSource: (() => WealthState) | undefined;

export function setImportStateSource(source?: () => WealthState): void { stateSource = source; }
export function currentImportState(fallback: WealthState): WealthState { return stateSource?.() ?? fallback; }

/** File reading is asynchronous. Do not apply a preview to a different state
 * after a cloud update or another edit, even if its confirmation was open. */
export function commitImportedState(base: WealthState, next: WealthState, label: string, save: Setter): void {
  if (currentImportState(base) !== base) throw new Error("Your data changed while the import was open. Please select the file again.");
  if (save(next, label) === false) throw new Error("Import was not saved. Your original data is unchanged. Check browser storage and try again.");
}
