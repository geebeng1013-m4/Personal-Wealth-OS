/*
 * Liquid glass behaviour — the two bits CSS can't do alone (PLAN.md G-1).
 *
 * 1. Press: a `.wu-glass--press` element, or an L2 button (primary /
 *    secondary / danger, G-2), bulges and glows under the finger.
 *    CSS owns the look (.is-pressed in components.css); this only tracks where
 *    the finger is so the glow sits under it.
 * 2. Tab lens: every navigation re-renders the whole shell, so the tab bar's
 *    lens can't transition on its own. We remember which tab was active and
 *    slide the fresh lens over from there.
 * 3. Segmented lens (DG-4): the same idea for every segmented control
 *    (.wu-segmented, the Ask/Record tabs). Pages and the assistant re-render
 *    them on each click, so one MutationObserver finds them wherever they
 *    appear, adds the lens, and slides it from the option that was active
 *    last time — no template changes.
 */

const PRESSABLE = ".wu-glass--press, .wu-btn--primary, .wu-btn--secondary, .wu-btn--danger, .wu-segmented.has-lens, .assistant-tabs.has-lens";

let pressed: HTMLElement | null = null;
let lastTabIndex: number | null = null;

function placeGlow(el: HTMLElement, event: PointerEvent): void {
  const box = el.getBoundingClientRect();
  if (!box.width || !box.height) return;
  el.style.setProperty("--glass-x", `${((event.clientX - box.left) / box.width) * 100}%`);
  el.style.setProperty("--glass-y", `${((event.clientY - box.top) / box.height) * 100}%`);
}

function release(): void {
  pressed?.classList.remove("is-pressed");
  pressed = null;
}

const SEGMENTED = ".wu-segmented, .assistant-tabs";

interface LensPlacement { index: number; x: number; y: number; w: number; h: number }
const placedLens = new WeakMap<HTMLElement, LensPlacement>();
const lastActiveByControl = new Map<string, number>();

function segmentOptions(control: HTMLElement): HTMLElement[] {
  return Array.from(control.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains("wu-seg-lens"),
  );
}

/* A control is re-created on every render, so remember it by what it is:
   its label plus the data-* keys its options carry (data-ledger-type,
   data-preset, data-category, data-assistant-mode). */
function controlKey(control: HTMLElement, options: HTMLElement[]): string {
  const dataKeys = options[0] ? Object.keys(options[0].dataset).join(",") : "";
  return `${control.getAttribute("aria-label") ?? ""}|${dataKeys}|${options.length}`;
}

function placeLens(lens: HTMLElement, option: HTMLElement, animate: boolean): LensPlacement {
  const placement = { index: -1, x: option.offsetLeft, y: option.offsetTop, w: option.offsetWidth, h: option.offsetHeight };
  lens.classList.toggle("is-instant", !animate);
  lens.style.width = `${placement.w}px`;
  lens.style.height = `${placement.h}px`;
  lens.style.setProperty("--lens-x", `${placement.x}px`);
  lens.style.setProperty("--lens-y", `${placement.y}px`);
  return placement;
}

function settleSegmented(control: HTMLElement): void {
  const options = segmentOptions(control);
  const active = options.findIndex((option) => option.classList.contains("is-active"));
  let lens = control.querySelector<HTMLElement>(":scope > .wu-seg-lens");
  if (!lens) {
    lens = document.createElement("span");
    lens.className = "wu-seg-lens";
    lens.setAttribute("aria-hidden", "true");
    control.prepend(lens);
    control.classList.add("has-lens");
  }
  lens.hidden = active < 0;
  if (active < 0) return;

  const target = options[active];
  const previous = placedLens.get(control);
  if (previous && previous.index === active && previous.x === target.offsetLeft && previous.w === target.offsetWidth) return;

  const key = controlKey(control, options);
  if (previous) {
    placedLens.set(control, { ...placeLens(lens, target, true), index: active });
  } else {
    // A freshly rendered control: start where the last one left off.
    const from = lastActiveByControl.get(key);
    if (from !== undefined && from !== active && options[from]) {
      placeLens(lens, options[from], false);
      void lens.getBoundingClientRect();
    }
    placedLens.set(control, { ...placeLens(lens, target, from !== undefined && from !== active), index: active });
  }
  lastActiveByControl.set(key, active);
}

function watchSegmentedControls(): void {
  let frame: number | null = null;
  const scan = () => {
    frame = null;
    document.querySelectorAll<HTMLElement>(SEGMENTED).forEach(settleSegmented);
  };
  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(scan);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", schedule, { passive: true });
  schedule();
}

/** Wire the press behaviour once, at boot. Delegated, so re-renders need nothing. */
export function initLiquidGlass(): void {
  watchSegmentedControls();
  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(PRESSABLE) : null;
    if (!target || target.matches(":disabled")) return;
    pressed = target;
    placeGlow(target, event);
    target.classList.add("is-pressed");
  });
  document.addEventListener("pointermove", (event) => {
    if (pressed) placeGlow(pressed, event);
  });
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
}

/** Call after the shell is rendered: slides the tab lens from the last active tab. */
export function settleTabbarLens(root: ParentNode): void {
  const bar = root.querySelector<HTMLElement>(".tabbar");
  const lens = bar?.querySelector<HTMLElement>(".tabbar__lens");
  if (!bar || !lens) return;
  const tabs = Array.from(bar.querySelectorAll(".tabbar__btn"));
  const active = tabs.findIndex((tab) => tab.classList.contains("is-active"));
  if (active < 0) return;
  const from = lastTabIndex ?? active;
  lastTabIndex = active;
  lens.style.setProperty("--lens-i", String(from));
  if (from === active) return;
  // Commit the starting position before moving, or there is nothing to animate.
  void lens.getBoundingClientRect();
  lens.style.setProperty("--lens-i", String(active));
}
