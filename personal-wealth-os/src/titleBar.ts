/*
 * Desktop glass title bar (PLAN.md DG-2).
 *
 * The big shell topbar used to repeat each page's own wu-page-header. It is
 * gone; instead, once the page header scrolls up behind the top edge, a slim
 * liquid-glass bar with the page name fades in, and it fades out again when
 * the header comes back — the iOS large-title collapse.
 *
 * Why a scroll listener and not an IntersectionObserver on the header: pages
 * re-render their content in place, which swaps the header element out from
 * under an observer. Looking the header up again on each (rAF-throttled)
 * scroll costs one querySelector + one rect read per frame.
 */

// Bottom edge of the bar: 48px tall, floating 12px from the top on desktop (DG-5).
const BAR_HEIGHT_PX = 60;
const FALLBACK_SCROLL_PX = 120;

export function mountTitleBar(root: ParentNode): () => void {
  const bar = root.querySelector<HTMLElement>(".titlebar");
  const main = root.querySelector<HTMLElement>("#main-content");
  if (!bar || !main) return () => {};

  let frame: number | null = null;

  const shouldShow = (): boolean => {
    const header = main.querySelector<HTMLElement>(".wu-page-header");
    if (!header) return window.scrollY > FALLBACK_SCROLL_PX;
    return header.getBoundingClientRect().bottom < BAR_HEIGHT_PX;
  };

  const update = (): void => {
    frame = null;
    bar.classList.toggle("is-on", shouldShow());
  };

  const onScroll = (): void => {
    if (frame === null) frame = requestAnimationFrame(update);
  };

  // Re-renders happen while scrolled (saving a form, live prices): set the
  // right state at once, without the fade, so the bar doesn't blink.
  bar.classList.add("is-instant");
  update();
  const settle = requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove("is-instant")));

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    if (frame !== null) cancelAnimationFrame(frame);
    cancelAnimationFrame(settle);
  };
}
