/**
 * The one place the app talks to the user out-of-band.
 *
 * Two things use it:
 *   - `pwo-save-error` CustomEvents from state.ts — a write it cannot retry has
 *     failed (localStorage over quota or blocked, a Firestore sync rejected, a
 *     snapshot not stored). Silent until this listener existed.
 *   - showSyncNotice() from main.ts — another device changed the data and this
 *     device is clean, so there is a newer version to pick up.
 *
 * Deliberately small: a stacked, self-dismissing strip at the bottom-right, no
 * dependency, no framework. It never blocks and never steals focus.
 */

const ERROR_EVENT = "pwo-save-error";
const ERROR_DISMISS_MS = 6500;
const NOTICE_DISMISS_MS = 20000;
const MAX_VISIBLE = 3;

let stack: HTMLElement | null = null;
let started = false;

function ensureStack(): HTMLElement {
  if (stack && stack.isConnected) return stack;
  stack = document.createElement("div");
  stack.className = "wu-toast-stack";
  stack.setAttribute("aria-live", "polite");
  document.body.appendChild(stack);
  return stack;
}

function dismiss(toast: HTMLElement): void {
  if (!toast.isConnected) return;
  toast.classList.remove("is-in");
  toast.classList.add("is-out");
  const done = (): void => toast.remove();
  toast.addEventListener("transitionend", done, { once: true });
  setTimeout(done, 400);
}

interface ToastOptions {
  tone?: "error" | "notice";
  dismissAfterMs?: number;
  action?: { label: string; onClick: () => void };
}

function show(message: string, opts: ToastOptions = {}): void {
  const host = ensureStack();

  while (host.childElementCount >= MAX_VISIBLE && host.firstElementChild) {
    host.firstElementChild.remove();
  }

  const toast = document.createElement("div");
  toast.className = opts.tone === "notice" ? "wu-toast wu-toast--notice" : "wu-toast";
  toast.setAttribute("role", opts.tone === "notice" ? "status" : "alert");

  const text = document.createElement("span");
  text.className = "wu-toast__text";
  text.textContent = message;
  toast.append(text);

  if (opts.action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wu-toast__action";
    btn.textContent = opts.action.label;
    btn.addEventListener("click", () => { opts.action!.onClick(); dismiss(toast); });
    toast.append(btn);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "wu-toast__close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => dismiss(toast));
  toast.append(close);

  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-in"));
  setTimeout(() => dismiss(toast), opts.dismissAfterMs ?? ERROR_DISMISS_MS);
}

/**
 * Start listening for save-error events. Safe to call more than once; only the
 * first call binds. Call it once during app boot.
 */
export function initSaveErrorToasts(): void {
  if (started) return;
  started = true;
  window.addEventListener(ERROR_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<{ message?: unknown }>).detail;
    const message = typeof detail?.message === "string" && detail.message.trim().length > 0
      ? detail.message.trim()
      : "Something could not be saved.";
    show(message, { tone: "error" });
  });
}

/**
 * Tell the user another device changed their data and offer to reload. Neutral
 * tone, longer on screen, does not auto-swap what is under the user's hands.
 */
export function showSyncNotice(onReload: () => void): void {
  show("Your data was updated on another device.", {
    tone: "notice",
    dismissAfterMs: NOTICE_DISMISS_MS,
    action: { label: "Reload", onClick: onReload },
  });
}
