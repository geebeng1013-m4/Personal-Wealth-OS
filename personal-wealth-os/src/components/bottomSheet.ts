/**
 * A form that slides up from the bottom of the screen (PLAN.md Q-1).
 *
 * The Overview's next step opens one so a beginner can record their pay or set
 * a target without leaving the page. It is only a frame: the caller supplies
 * the fields and a save function that goes through the same validation as the
 * page the data belongs to. Nothing is saved until Save; Cancel, Esc and a tap
 * on the dimmed page all close it without saving.
 *
 * On a desktop the same sheet sits in the middle of the screen as a dialog.
 */

import { escapeHtml } from "../html";

export interface BottomSheetOptions {
  title: string;
  /** Where the data lands, shown as "Saves to Ledger". */
  destination: string;
  /**
   * One line under the title, e.g. where a prefilled number came from.
   *
   * Trusted markup, like `body`: the caller escapes what it interpolates, and
   * marks a figure with `amt()` so privacy mode blurs it. The fields below stay
   * readable either way — a number you are being asked to check or change has
   * to be legible.
   */
  intro?: string;
  /** The fields. Trusted markup: the caller escapes every value it interpolates. */
  body: string;
  saveLabel?: string;
  /**
   * Validate and save. Return a message to keep the sheet open and show it,
   * or null once the data is saved — the sheet then closes.
   */
  onSave: (form: HTMLFormElement) => string | null;
  /** Bind anything extra inside the body (a preset button, say). */
  onOpen?: (sheet: HTMLElement) => void;
}

let open: { host: HTMLElement; returnFocus: HTMLElement | null; cleanup: () => void } | null = null;

export function closeBottomSheet(): void {
  if (!open) return;
  const { host, returnFocus, cleanup } = open;
  open = null;
  cleanup();
  host.remove();
  document.documentElement.classList.remove("has-sheet");
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

export function openBottomSheet(options: BottomSheetOptions): void {
  closeBottomSheet();
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = document.createElement("div");
  host.className = "wu-sheet-host";
  host.innerHTML = `
    <div class="wu-sheet__scrim" data-sheet-close></div>
    <form class="wu-sheet wu-glass wu-glass--sheet" role="dialog" aria-modal="true" aria-labelledby="wuSheetTitle" novalidate>
      <span class="wu-sheet__handle" aria-hidden="true"></span>
      <header class="wu-sheet__head">
        <h2 class="wu-sheet__title" id="wuSheetTitle">${escapeHtml(options.title)}</h2>
        <p class="wu-sheet__dest">Saves to <strong>${escapeHtml(options.destination)}</strong></p>
      </header>
      ${options.intro ? `<p class="wu-sheet__intro">${options.intro}</p>` : ""}
      <div class="wu-sheet__body">${options.body}</div>
      <p class="wu-sheet__error" role="alert" hidden></p>
      <div class="wu-sheet__actions">
        <button class="wu-btn wu-btn--ghost" type="button" data-sheet-close>Cancel</button>
        <button class="wu-btn wu-btn--primary" type="submit">${escapeHtml(options.saveLabel ?? "Save")}</button>
      </div>
    </form>`;
  document.body.appendChild(host);
  document.documentElement.classList.add("has-sheet");

  const form = host.querySelector<HTMLFormElement>("form")!;
  const error = host.querySelector<HTMLElement>(".wu-sheet__error")!;
  const save = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  const focusables = (): HTMLElement[] => [...form.querySelectorAll<HTMLElement>("button, input, select, textarea")]
    .filter((element) => !element.hasAttribute("disabled") && !element.closest("[hidden]"));
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeBottomSheet();
      return;
    }
    if (event.key !== "Tab") return;
    // Keep focus inside the sheet while it is open.
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  // A phone keyboard covers the bottom of the screen without resizing the
  // layout viewport; lift the sheet by the covered part so Save stays visible.
  const viewport = window.visualViewport;
  const onViewport = (): void => {
    if (!viewport) return;
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    host.style.setProperty("--sheet-keyboard", `${Math.round(covered)}px`);
  };
  document.addEventListener("keydown", onKey);
  viewport?.addEventListener("resize", onViewport);
  open = {
    host,
    returnFocus,
    cleanup: () => {
      document.removeEventListener("keydown", onKey);
      viewport?.removeEventListener("resize", onViewport);
    },
  };

  host.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-sheet-close]")) closeBottomSheet();
  });
  // Typing again clears the last error, so it never outlives the value it was about.
  form.addEventListener("input", () => { error.hidden = true; });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    save.setAttribute("aria-busy", "true");
    let message: string | null;
    try {
      message = options.onSave(form);
    } catch (err) {
      console.error("[bottomSheet] save failed:", err);
      message = "Something went wrong, and nothing was saved. Please try again.";
    }
    save.disabled = false;
    save.removeAttribute("aria-busy");
    if (message === null) {
      closeBottomSheet();
      return;
    }
    error.textContent = message;
    error.hidden = false;
  });

  options.onOpen?.(form);
  (form.querySelector<HTMLElement>("input, select") ?? save).focus({ preventScroll: true });
}
