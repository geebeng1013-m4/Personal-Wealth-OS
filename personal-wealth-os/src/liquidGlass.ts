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
 */

const PRESSABLE = ".wu-glass--press, .wu-btn--primary, .wu-btn--secondary, .wu-btn--danger";

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

/** Wire the press behaviour once, at boot. Delegated, so re-renders need nothing. */
export function initLiquidGlass(): void {
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
