/**
 * Walks a new user from a "Get started" step to the exact field it asks for
 * (PLAN.md F-7).
 *
 * The Dashboard queues a step, then navigates. Navigating rebuilds the page,
 * so the step waits here in module state and the shell hands it the freshly
 * rendered page (runQueuedGuide, called at the end of renderApp) — the same
 * pattern the assistant uses to pre-fill a form on another page.
 *
 * On arrival the guide opens whatever hides the field (a collapsed panel, an
 * editor row), scrolls to it, rings it and says in one line what to do. It
 * never fills anything in or clicks a button that saves: a step is only ticked
 * when the user has entered the value themselves.
 */

import type { OnboardingStepId } from "./onboarding";

interface GuideSpec {
  page: string;
  /** Opened first when the target is not on screen: a <details>, or a button that only reveals. */
  reveal?: string;
  target: string;
  tip: string;
  /** The tip goes after the target's closest match — for a button sitting in a row. */
  tipAfter?: string;
}

const GUIDES: Record<OnboardingStepId, GuideSpec> = {
  balances: {
    page: "ledger",
    reveal: "#ledgerAccountsPanel",
    target: "#ledgerAccountsPanel .edit-account",
    tip: "Tap Edit on each account and enter what it holds today.",
    tipAfter: ".wu-card--inset",
  },
  "first-entry": {
    page: "ledger",
    reveal: "#ledgerAddToggle",
    target: "#ledgerAmount",
    tip: "Enter the amount, pick income or expense, then save.",
  },
  goal: {
    page: "goals",
    target: ".add-goal",
    tip: "Tap + Add goal, then give it a name and a target.",
    tipAfter: ".wu-page-header",
  },
  "safety-buffer": {
    page: "settings",
    reveal: '[data-edit="emergency"]',
    target: 'form[data-form="emergency"] input[name="target"]',
    tip: "Enter how much you want set aside for emergencies, then save.",
  },
  investment: {
    page: "portfolio",
    reveal: ".pf-add-toggle",
    target: '#tradeForm input[name="date"]',
    tip: "Fill in a trade you have made, then save.",
  },
};

let queued: OnboardingStepId | null = null;

/** Remember the step; the next render of its page shows the way. */
export function queueGuide(step: OnboardingStepId): string {
  queued = step;
  return GUIDES[step].page;
}

/** Called after every render. Runs a queued guide once, on its own page only. */
export function runQueuedGuide(root: HTMLElement, activePage: string): void {
  const step = queued;
  if (!step) return;
  // Taken now, so the re-render a reveal click causes cannot run it twice.
  queued = null;
  const spec = GUIDES[step];
  if (spec.page !== activePage) return;

  requestAnimationFrame(() => {
    const reveal = spec.reveal ? root.querySelector<HTMLElement>(spec.reveal) : null;
    // A closed <details> still lays out its content in current Chromium, so
    // "is the target shown" cannot tell it is folded away: just open it. A
    // reveal button toggles, so it is pressed only while the target is absent.
    if (reveal instanceof HTMLDetailsElement) reveal.open = true;
    else if (reveal && !isShown(root.querySelector<HTMLElement>(spec.target))) reveal.click();
    // A reveal may re-render the page and restore its scroll on the next frame;
    // wait that out so the scroll below is the last one.
    window.setTimeout(() => {
      const target = [...root.querySelectorAll<HTMLElement>(spec.target)].find(isShown);
      if (target) pointAt(target, spec);
    }, 120);
  });
}

function isShown(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element && element.getClientRects().length > 0);
}

function pointAt(target: HTMLElement, { tip, tipAfter }: GuideSpec): void {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  target.classList.add("wu-guide-target");

  const note = document.createElement("p");
  note.className = "wu-guide-tip";
  note.setAttribute("role", "status");
  note.textContent = tip;
  // Under a field's whole row, or under the row a button sits in.
  const anchor = (tipAfter ? target.closest<HTMLElement>(tipAfter) : null)
    ?? target.closest<HTMLElement>(".wu-field-row")
    ?? target;
  anchor.insertAdjacentElement("afterend", note);

  if (target instanceof HTMLInputElement) target.focus({ preventScroll: true });

  const clear = (): void => {
    target.classList.remove("wu-guide-target");
    note.remove();
  };
  target.addEventListener("input", clear, { once: true });
  target.addEventListener("click", clear, { once: true });
}
