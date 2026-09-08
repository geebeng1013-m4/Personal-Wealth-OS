/**
 * The one place the app tells the user a save went wrong.
 *
 * state.ts dispatches a `pwo-save-error` CustomEvent whenever a write it cannot
 * retry has failed — localStorage over quota or blocked, a Firestore sync
 * rejected, a snapshot not stored. Each carries a plain-language `detail.message`
 * that is safe to show as-is. Until now nothing listened, so those failures were
 * completely silent: the user believed their data was saved when it was not.
 *
 * Deliberately small: a stacked, self-dismissing strip at the bottom-right, no
 * dependency, no state. It never blocks and never steals focus — a failed save
 * is worth telling the user about, not worth interrupting them over.
 */

const EVENT = "pwo-save-error";
const DISMISS_AFTER_MS = 6500;
const MAX_VISIBLE = 3;

let stack: HTMLElement | null = null;
let started = false;

function ensureStack(): HTMLElement {
  if (stack && stack.isConnected) return stack;
  stack = document.createElement("div");
  stack.className = "wu-toast-stack";
  // aria-live on the container so each appended child is announced once,
  // politely — these are not errors the user must act on this instant.
  stack.setAttribute("aria-live", "polite");
  document.body.appendChild(stack);
  return stack;
}

function dismiss(toast: HTMLElement): void {
  if (!toast.isConnected) return;
  toast.classList.remove("is-in");
  toast.classList.add("is-out");
  // Matches the CSS transition; falls back to a straight remove if the
  // transition never fires (reduced motion zeroes the duration).
  const done = (): void => toast.remove();
  toast.addEventListener("transitionend", done, { once: true });
  setTimeout(done, 400);
}

function show(message: string): void {
  const host = ensureStack();

  while (host.childElementCount >= MAX_VISIBLE && host.firstElementChild) {
    host.firstElementChild.remove();
  }

  const toast = document.createElement("div");
  toast.className = "wu-toast";
  toast.setAttribute("role", "alert");

  const text = document.createElement("span");
  text.className = "wu-toast__text";
  text.textContent = message;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "wu-toast__close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => dismiss(toast));

  toast.append(text, close);
  host.appendChild(toast);

  // Next frame, so the entrance transition has a starting state to move from.
  requestAnimationFrame(() => toast.classList.add("is-in"));
  setTimeout(() => dismiss(toast), DISMISS_AFTER_MS);
}

/**
 * Start listening for save-error events. Safe to call more than once; only the
 * first call binds. Call it once during app boot.
 */
export function initSaveErrorToasts(): void {
  if (started) return;
  started = true;
  window.addEventListener(EVENT, (event: Event) => {
    const detail = (event as CustomEvent<{ message?: unknown }>).detail;
    const message = typeof detail?.message === "string" && detail.message.trim().length > 0
      ? detail.message.trim()
      : "Something could not be saved.";
    show(message);
  });
}
