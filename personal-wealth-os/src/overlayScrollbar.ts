/*
 * iOS-style overlay scrollbars (PLAN.md S-1 sidebar, F-9 page; merged in P-2).
 *
 * The native scrollbar is hidden (shell.css); scrolling itself stays native —
 * wheel, trackpad, keyboard, touch. What is drawn here is only a thumb:
 * invisible at rest, shown while the user scrolls, faded out ~1s after they
 * stop, draggable while shown.
 *
 * overlayThumb() is that shared thumb. The two mounts differ in what counts as
 * "the user scrolled" and when the thumb flashes to say "this scrolls":
 *
 * - Sidebar: remounted on every renderApp. ui.ts restores the saved scrollTop
 *   right after rendering, which fires a scroll event that must not show the
 *   thumb, so scroll events only count once the user has touched the sidebar.
 *   It flashes once per app session, and drives the edge-fade classes.
 * - Page: mounted once at boot; the document outlives every render. A scroll
 *   counts as the user's only shortly after a wheel or a scrolling key, so the
 *   scroll a navigation causes never shows it. Mouse devices only (touch keeps
 *   its own overlay scrollbar); pointing at the right edge shows it too; it
 *   flashes once, the first time the page is taller than the window.
 */

const HIDE_AFTER_MS = 1000;
const TRACK_INSET_PX = 6;

interface Geometry {
  viewport: number;
  content: number;
  track: number;
  size: number;
  overflow: boolean;
}

interface ThumbOptions {
  thumb: HTMLElement;
  getScrollTop: () => number;
  setScrollTop: (top: number) => void;
  /** Visible height and full content height of the scroller. */
  measure: () => { viewport: number; content: number };
  minThumbPx: number;
  /** False keeps the thumb hidden whatever the overflow (page: not a mouse device). */
  canShow?: () => boolean;
  /** Runs on every update, e.g. to toggle edge-fade classes. */
  afterUpdate?: (geometry: Geometry) => void;
  onDragStart?: () => void;
}

interface OverlayThumb {
  update: () => void;
  show: () => void;
  dispose: () => void;
}

function overlayThumb(options: ThumbOptions): OverlayThumb {
  const { thumb, getScrollTop, setScrollTop, measure, minThumbPx, canShow, afterUpdate, onDragStart } = options;
  let hideTimer: number | undefined;
  let dragging = false;
  let dragStartY = 0;
  let dragStartTop = 0;

  const geometry = (): Geometry => {
    const { viewport, content } = measure();
    const track = viewport - TRACK_INSET_PX * 2;
    const size = Math.max(minThumbPx, (track * viewport) / content);
    return { viewport, content, track, size, overflow: content - viewport > 1 };
  };

  const update = () => {
    const g = geometry();
    afterUpdate?.(g);
    thumb.hidden = !g.overflow || canShow?.() === false;
    if (thumb.hidden) return;
    const progress = getScrollTop() / (g.content - g.viewport);
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

  thumb.addEventListener("pointerleave", () => {
    if (!dragging && thumb.classList.contains("is-visible")) scheduleHide();
  });
  thumb.addEventListener("pointerdown", (event) => {
    onDragStart?.();
    dragging = true;
    dragStartY = event.clientY;
    dragStartTop = getScrollTop();
    thumb.classList.add("is-dragging");
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  thumb.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const g = geometry();
    const travel = g.track - g.size;
    if (travel <= 0) return;
    setScrollTop(dragStartTop + ((event.clientY - dragStartY) / travel) * (g.content - g.viewport));
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    thumb.classList.remove("is-dragging");
    scheduleHide();
  };
  thumb.addEventListener("pointerup", endDrag);
  thumb.addEventListener("pointercancel", endDrag);

  return { update, show, dispose: () => window.clearTimeout(hideTimer) };
}

// --- Sidebar ------------------------------------------------------------------

let sidebarFlashedThisSession = false;

/** Mount on a freshly rendered shell; returns the cleanup for the next render. */
export function mountSidebarScrollbar(root: ParentNode): () => void {
  const area = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  const thumbEl = root.querySelector<HTMLElement>(".sidebar-scrollbar");
  if (!area || !thumbEl) return () => {};

  let userScrolling = false;
  const thumb = overlayThumb({
    thumb: thumbEl,
    getScrollTop: () => area.scrollTop,
    setScrollTop: (top) => { area.scrollTop = top; },
    measure: () => ({ viewport: area.clientHeight, content: area.scrollHeight }),
    minThumbPx: 28,
    afterUpdate: (g) => {
      area.classList.toggle("has-overflow", g.overflow);
      area.classList.toggle("is-scrolled", area.scrollTop > 2);
      area.classList.toggle("is-at-end", area.scrollTop + g.viewport >= g.content - 2);
    },
    onDragStart: () => { userScrolling = true; },
  });

  const markUserScrolling = () => {
    userScrolling = true;
  };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    area.addEventListener(type, markUserScrolling, { passive: true });
  }
  area.addEventListener("scroll", () => {
    if (userScrolling) thumb.show();
    else thumb.update();
  }, { passive: true });

  const resize = new ResizeObserver(thumb.update);
  resize.observe(area);
  thumb.update();

  // Marked only once it has actually shown: boot renders the shell more than
  // once in quick succession, and cleanup cancels a flash that hasn't fired.
  let flashTimer: number | undefined;
  if (!sidebarFlashedThisSession) {
    flashTimer = window.setTimeout(() => {
      sidebarFlashedThisSession = true;
      thumb.show();
    }, 400);
  }

  return () => {
    resize.disconnect();
    thumb.dispose();
    window.clearTimeout(flashTimer);
  };
}

// --- Page ---------------------------------------------------------------------

const MOUSE_QUERY = "(hover: hover) and (pointer: fine)";
const USER_INPUT_WINDOW_MS = 1000;
const EDGE_HOVER_PX = 16;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** Mount once at boot. */
export function mountPageScrollbar(): void {
  const mouse = window.matchMedia(MOUSE_QUERY);
  const scroller = document.scrollingElement ?? document.documentElement;
  const thumbEl = document.createElement("div");
  thumbEl.className = "page-scrollbar";
  thumbEl.setAttribute("aria-hidden", "true");
  thumbEl.hidden = true;
  document.body.append(thumbEl);

  const thumb = overlayThumb({
    thumb: thumbEl,
    getScrollTop: () => scroller.scrollTop,
    setScrollTop: (top) => { scroller.scrollTop = top; },
    measure: () => ({ viewport: window.innerHeight, content: scroller.scrollHeight }),
    minThumbPx: 36,
    canShow: () => mouse.matches,
  });

  let lastUserInput = -Infinity;
  let flashed = false;
  const layoutChanged = () => {
    thumb.update();
    if (!flashed && !thumbEl.hidden) {
      flashed = true;
      window.setTimeout(thumb.show, 400);
    }
  };

  window.addEventListener("wheel", () => {
    lastUserInput = performance.now();
  }, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (SCROLL_KEYS.has(event.key)) lastUserInput = performance.now();
  }, { passive: true });
  window.addEventListener("scroll", () => {
    if (performance.now() - lastUserInput < USER_INPUT_WINDOW_MS) thumb.show();
    else thumb.update();
  }, { passive: true });
  // Pointing at the right edge shows the thumb, so a mouse user can find and
  // drag it without having to scroll first.
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" && event.clientX >= window.innerWidth - EDGE_HOVER_PX) thumb.show();
  }, { passive: true });

  // The body grows and shrinks with every page render; the window with resizes.
  new ResizeObserver(layoutChanged).observe(document.body);
  window.addEventListener("resize", layoutChanged, { passive: true });
  mouse.addEventListener("change", thumb.update);
  layoutChanged();
}
