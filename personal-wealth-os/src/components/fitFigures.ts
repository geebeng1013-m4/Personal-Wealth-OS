/**
 * Keeps every big figure (`.wu-money`) inside its card. A figure that is
 * wider than its box has its font size stepped down until it fits; one that
 * fits keeps the size the stylesheet gives it.
 *
 * CSS alone can't do this: the width a figure needs depends on how many
 * digits it has, and container units only know the box's width. So the app
 * re-measures whenever the DOM changes (a page render, a live price patching a
 * figure in place) or the window resizes, batched to one pass per frame.
 */

const FIGURE_SELECTOR = ".wu-money";
// Below this a figure stops reading as the card's headline; the card still
// clips rather than spilling into the next one.
const MIN_FONT_PX = 14;

let scheduled = false;

function fitAll(): void {
  scheduled = false;
  const figures = Array.from(document.querySelectorAll<HTMLElement>(FIGURE_SELECTOR));
  // Reset every figure first, then measure, then write — interleaving reads
  // and writes per figure would force a layout for each one.
  for (const figure of figures) figure.style.fontSize = "";
  const overflowing = figures.filter((figure) => figure.clientWidth > 0 && figure.scrollWidth > figure.clientWidth + 1);
  for (const figure of overflowing) {
    let size = parseFloat(getComputedStyle(figure).fontSize);
    // The currency label keeps its own size, so shrinking the font doesn't
    // shrink the figure proportionally; a few passes converge.
    for (let pass = 0; pass < 6 && figure.scrollWidth > figure.clientWidth + 1 && size > MIN_FONT_PX; pass += 1) {
      const ratio = figure.clientWidth / figure.scrollWidth;
      size = Math.max(MIN_FONT_PX, Math.floor(size * Math.min(ratio, 0.97)));
      figure.style.fontSize = `${size}px`;
    }
  }
}

function scheduleFit(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(fitAll);
}

export function startFigureFitting(): void {
  // Only content changes are watched: the fitter's own inline font-size is an
  // attribute change, so it can't retrigger itself.
  new MutationObserver(scheduleFit).observe(document.body, { childList: true, characterData: true, subtree: true });
  window.addEventListener("resize", scheduleFit);
  // Web fonts load after first paint and change every figure's width.
  void document.fonts?.ready.then(scheduleFit);
  scheduleFit();
}
