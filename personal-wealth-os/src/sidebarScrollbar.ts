/*
 * iOS-style sidebar scrollbar (PLAN.md S-1).
 *
 * The native scrollbar is hidden (shell.css); scrolling itself stays native —
 * wheel, trackpad, keyboard, touch. This module only draws an overlay thumb:
 * invisible at rest, shown while the user scrolls, faded out ~1s after they
 * stop, draggable while shown. It also toggles the classes that drive the top
 * and bottom edge fades.
 *
 * Two traps, both from renderApp re-rendering the whole shell on every
 * navigation:
 * - ui.ts restores the saved scrollTop right after rendering, which fires a
 *   scroll event. That must not show the thumb, so scroll events only count
 *   once the user has touched the sidebar (wheel / touch / key / pointer).
 * - The "flash once so you know it scrolls" happens on the first render of the
 *   app only, not on every navigation.
 */

const HIDE_AFTER_MS = 1000;
const MIN_THUMB_PX = 28;
const TRACK_INSET_PX = 6;

let flashedThisSession = false;

export function mountSidebarScrollbar(root: ParentNode): () => void {
  const area = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  const thumb = root.querySelector<HTMLElement>(".sidebar-scrollbar");
  if (!area || !thumb) return () => {};

  let hideTimer: number | undefined;
  let userScrolling = false;
  let dragging = false;
  let dragStartY = 0;
  let dragStartTop = 0;

  const geometry = () => {
    const viewport = area.clientHeight;
    const content = area.scrollHeight;
    const track = viewport - TRACK_INSET_PX * 2;
    const size = Math.max(MIN_THUMB_PX, (track * viewport) / content);
    return { viewport, content, track, size, overflow: content - viewport > 1 };
  };

  const update = () => {
    const g = geometry();
    area.classList.toggle("has-overflow", g.overflow);
    area.classList.toggle("is-scrolled", area.scrollTop > 2);
    area.classList.toggle("is-at-end", area.scrollTop + g.viewport >= g.content - 2);
    thumb.hidden = !g.overflow;
    if (!g.overflow) return;
    const progress = area.scrollTop / (g.content - g.viewport);
    thumb.style.height = `${g.size}px`;
    thumb.style.transform = `translateY(${TRACK_INSET_PX + progress * (g.track - g.size)}px)`;
  };

  const scheduleHide = () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!dragging && !thumb.matches(":hover")) thumb.classList.remove("is-visible");
    }, HIDE_AFTER_MS);
  };

  const show = () => {
    update();
    if (thumb.hidden) return;
    thumb.classList.add("is-visible");
    scheduleHide();
  };

  const markUserScrolling = () => {
    userScrolling = true;
  };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    area.addEventListener(type, markUserScrolling, { passive: true });
  }

  area.addEventListener("scroll", () => {
    if (userScrolling) show();
    else update();
  }, { passive: true });

  thumb.addEventListener("pointerleave", () => {
    if (!dragging && thumb.classList.contains("is-visible")) scheduleHide();
  });
  thumb.addEventListener("pointerdown", (event) => {
    userScrolling = true;
    dragging = true;
    dragStartY = event.clientY;
    dragStartTop = area.scrollTop;
    thumb.classList.add("is-dragging");
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  thumb.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const g = geometry();
    const travel = g.track - g.size;
    if (travel <= 0) return;
    area.scrollTop = dragStartTop + ((event.clientY - dragStartY) / travel) * (g.content - g.viewport);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove("is-dragging");
    scheduleHide();
  };
  thumb.addEventListener("pointerup", endDrag);
  thumb.addEventListener("pointercancel", endDrag);

  const resize = new ResizeObserver(update);
  resize.observe(area);
  update();

  // Marked only once it has actually shown: boot renders the shell more than
  // once in quick succession, and cleanup cancels a flash that hasn't fired.
  let flashTimer: number | undefined;
  if (!flashedThisSession) {
    flashTimer = window.setTimeout(() => {
      flashedThisSession = true;
      show();
    }, 400);
  }

  return () => {
    resize.disconnect();
    window.clearTimeout(hideTimer);
    window.clearTimeout(flashTimer);
  };
}
