/**
 * The grouped-list building blocks shared by the Me and Settings pages (T-4):
 * one row per setting showing its current value, tapping a row opens that one
 * editor underneath it, with a single Save.
 *
 * Only one editor is open at a time across both pages, so the open row lives
 * here rather than in either page module. Row keys are unique across the two
 * pages ("profile:age", "targets", …).
 */

import type { WealthState } from "../models";
import { money } from "../rules";
import type { Navigate, RenderApp, SessionUser, Setter } from "./pageTypes";

let openEditor: string | null = null;

/** A figure without its currency prefix. */
export function amountOf(value: number): string {
  return money(value, "").trim();
}

/** A stored fraction as the whole-number percent the boxes take. */
export function pct(fraction: number): string {
  return String(Math.round(fraction * 10000) / 100);
}

/** A labelled control inside an editor. */
export function field(label: string, control: string, wide = false): string {
  return `<label class="wu-field-row${wide ? " wu-field-row--wide" : ""}"><span class="wu-field-row__label">${label}</span>${control}</label>`;
}

/** A number field pre-filled from state. */
export function num(name: string, label: string, value: string, step: string, extra = ""): string {
  return field(label, `<input class="wu-field" name="${name}" type="number" step="${step}" value="${value}"${extra}>`);
}

/** An editor form with one Save. `key` routes the submit in the page's bind function. */
export function editorForm(key: string, body: string, saveLabel = "Save", layout = "wu-grid wu-grid--2"): string {
  return `<form class="wu-set__form" data-form="${key}">
      <div class="${layout}">${body}</div>
      <div class="wu-set__actions"><button class="wu-btn wu-btn--ghost wu-btn--sm" type="button" data-close-editor>Cancel</button><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">${saveLabel}</button></div>
    </form>`;
}

/**
 * One row: title (with an optional quiet second line) on the left, the current
 * value and a chevron on the right. The editor renders only while open.
 * `only` limits the row to the phone or the desktop layout, where the previews
 * group a setting differently.
 */
export function row(key: string, title: string, value: string, sub: string, editor: () => string, only: "" | "phone" | "desk" = ""): string {
  const open = openEditor === key;
  return `<li class="wu-set__item${only ? ` wu-set__item--${only}` : ""}${open ? " is-open" : ""}">
      <button class="wu-set__row" type="button" data-edit="${key}" aria-expanded="${open}">
        <span class="wu-set__title">${title}${sub ? `<small>${sub}</small>` : ""}</span>
        <span class="wu-set__value">${value}<span class="wu-set__chev" aria-hidden="true">›</span></span>
      </button>
      ${open ? `<div class="wu-set__editor">${editor()}</div>` : ""}
    </li>`;
}

/**
 * A row that shows a value and does nothing else. It carries a hidden chevron
 * so its value sits on the same edge as the rows above it that open an editor —
 * without it the column jogs right on the one row that cannot be tapped.
 */
export function staticRow(title: string, value: string, only: "" | "phone" | "desk" = ""): string {
  return `<li class="wu-set__item${only ? ` wu-set__item--${only}` : ""}"><div class="wu-set__row wu-set__row--static"><span class="wu-set__title">${title}</span><span class="wu-set__value">${value}<span class="wu-set__chev wu-set__chev--ghost" aria-hidden="true">›</span></span></div></li>`;
}

/** A group: its name above the list on a phone, inside the card's top-left on a desktop. */
export function group(id: string, label: string, rows: string, extraClass = ""): string {
  return `<section class="wu-card wu-dash__half wu-set${extraClass ? ` ${extraClass}` : ""}" aria-labelledby="${id}">
      <div class="wu-tc__top wu-set__head"><span class="wu-label" id="${id}">${label}</span></div>
      <ul class="wu-set__list">${rows}</ul>
    </section>`;
}

export interface RowPage {
  /** Re-render in place, keeping the reader where they were. */
  repaint: (next: WealthState, persist?: boolean, label?: string) => void;
  /** Save and close the editor. */
  save: (next: WealthState, label?: string) => void;
  /** Save and keep the editor open (adding to or deleting from a list). */
  saveOpen: (next: WealthState, label: string) => void;
  /** Route a `data-form` editor's submit to its handler. */
  onSubmit: (key: string, handler: (data: FormData, form: HTMLFormElement) => void) => void;
}

/**
 * Wires a page's row toggles and Cancel buttons, and hands back its save
 * helpers. The signed-in user and sign-out are handed on to every re-render,
 * so the account card on the Me page survives a save.
 */
export function bindRowPage(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp, page: string, user?: SessionUser, onLogout?: () => void): RowPage {
  // A change label makes saveState snapshot the previous copy into Version
  // History, so labels stay exactly where the old forms had them (recurring
  // items, liabilities, privacy); the other saves pass none, as before.
  const repaint = (next: WealthState, persist = false, label?: string): void => {
    const scrollPosition = { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 };
    if (persist) setState(next, label);
    rerender(root, next, setState, page, navigate, user, onLogout);
    const restore = () => {
      window.scrollTo(scrollPosition.x, scrollPosition.y);
      document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
    };
    restore();
    requestAnimationFrame(restore);
  };
  const save = (next: WealthState, label?: string): void => {
    openEditor = null;
    repaint(next, true, label);
  };
  const saveOpen = (next: WealthState, label: string): void => repaint(next, true, label);

  root.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.edit ?? null;
    openEditor = openEditor === key ? null : key;
    repaint(state);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-close-editor]").forEach((button) => button.addEventListener("click", () => {
    openEditor = null;
    repaint(state);
  }));

  const onSubmit = (key: string, handler: (data: FormData, form: HTMLFormElement) => void): void => {
    root.querySelectorAll<HTMLFormElement>(`form[data-form="${key}"]`).forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      handler(new FormData(form), form);
    }));
  };

  return { repaint, save, saveOpen, onSubmit };
}
