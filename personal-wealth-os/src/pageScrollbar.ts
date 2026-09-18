/*
 * iOS-style page scrollbar (PLAN.md F-9) — the page-level twin of
 * sidebarScrollbar.ts.
 *
 * On mouse devices the document's native scrollbar is hidden (shell.css): on
 * Windows it is a wide grey bar with arrow buttons that reads as a stray line
 * down the right edge of the dark theme. Scrolling itself stays native. This
 * only draws an overlay thumb, fixed to the right edge: invisible at rest,
 * shown while the user scrolls or points at the right edge, faded out ~1s
 * later, draggable while shown.
 *
 * Unlike the sidebar's, it is mounted once at boot, not per render — the
 * document outlives every renderApp. Two consequences:
 * - "Did the user cause this scroll?" can't be a flag set once and kept, or
 *   the scroll a navigation causes would show the thumb for the rest of the
 *   session. A scroll counts as the user's only shortly after a wheel or a
 *   scrolling key.
 * - It flashes once, the first time the page is taller than the window, so a
 *   mouse user sees there is more below.
 *
 * Touch devices keep their own native overlay scrollbar: the CSS and this
 * thumb both apply only under MOUSE_QUERY.
 */

const MOUSE_QUERY = "(hover: hover) and (pointer: fine)";
const HIDE_AFTER_MS = 1000;
const USER_INPUT_WINDOW_MS = 1000;
const EDGE_HOVER_PX = 16;
const MIN_THUMB_PX = 36;
const TRACK_INSET_PX = 6;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

export function mountPageScrollbar(): void {
  const mouse = window.matchMedia(MOUSE_QUERY);
  const scroller = document.scrollingElement ?? document.documentElement;
  const thumb = document.createElement("div");
  thumb.className = "page-scrollbar";
  thumb.setAttribute("aria-hidden", "true");
  thumb.hidden = true;
  document.body.append(thumb);

  let hideTimer: number | undefined;
  let lastUserInput = -Infinity;
  let dragging = false;
  let dragStartY = 0;
  let dragStartTop = 0;
  let flashed = false;

  const geometry = () => {
    const viewport = window.innerHeight;
    const content = scroller.scrollHeight;
    const track = viewport - TRACK_INSET_PX * 2;
    const size = Math.max(MIN_THUMB_PX, (track * viewport) / content);
    return { viewport, content, track, size, overflow: content - viewport > 1 };
  };

  const update = () => {
    const g = geometry();
    thumb.hidden = !mouse.matches || !g.overflow;
    if (thumb.hidden) return;
    const progress = scroller.scrollTop / (g.content - g.viewport);
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

  const layoutChanged = () => {
    update();
    if (!flashed && !thumb.hidden) {
      flashed = true;
      window.setTimeout(show, 400);
    }
  };

  window.addEventListener("wheel", () => {
    lastUserInput = performance.now();
  }, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (SCROLL_KEYS.has(event.key)) lastUserInput = performance.now();
  }, { passive: true });
  window.addEventListener("scroll", () => {
    if (performance.now() - lastUserInput < USER_INPUT_WINDOW_MS) show();
    else update();
  }, { passive: true });
  // Pointing at the right edge shows the thumb, so a mouse user can find and
  // drag it without having to scroll first.
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" && event.clientX >= window.innerWidth - EDGE_HOVER_PX) show();
  }, { passive: true });

  thumb.addEventListener("pointerleave", () => {
    if (!dragging && thumb.classList.contains("is-visible")) scheduleHide();
  });
  thumb.addEventListener("pointerdown", (event) => {
    dragging = true;
    dragStartY = event.clientY;
    dragStartTop = scroller.scrollTop;
    thumb.classList.add("is-dragging");
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  thumb.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const g = geometry();
    const travel = g.track - g.size;
    if (travel <= 0) return;
    scroller.scrollTop = dragStartTop + ((event.clientY - dragStartY) / travel) * (g.content - g.viewport);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove("is-dragging");
    scheduleHide();
  };
  thumb.addEventListener("pointerup", endDrag);
  thumb.addEventListener("pointercancel", endDrag);

  // The body grows and shrinks with every page render; the window with resizes.
  new ResizeObserver(layoutChanged).observe(document.body);
  window.addEventListener("resize", layoutChanged, { passive: true });
  mouse.addEventListener("change", update);
  layoutChanged();
}
