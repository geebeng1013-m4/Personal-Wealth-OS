/**
 * Money Leaks page — the deterministic-detector list and its evidence panel.
 *
 * Findings come from detectMoneyLeaks and say only WHAT happened. The advisory
 * copy beside each — why it matters, what to do — is read from
 * AdvisorSnapshot.leakRecommendations; this file never writes advice of its own
 * or re-derives one from a finding. Marking an action done records execution
 * state only: the finding stays listed until the next scan no longer sees it.
 *
 * T-5a layout: desktop is four figures, then the list beside the selected
 * finding. A phone gets one summary card and a list whose rows open their
 * evidence underneath.
 */

import type { AdvisorRecommendation, WealthState } from "../models";
import { detectMoneyLeaks, getAdvisorSnapshot, type MoneyLeak } from "../advisor";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import { isRecommendationCompleted, markRecommendationDone, undoRecommendationDone } from "../actionRecords";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

const leakCategoryLabels: Record<MoneyLeak["category"], string> = {
  subscription: "Subscription",
  fee: "Fee",
  duplicate: "Duplicate",
  increase: "Spending increase",
  unusual: "Unusual spending",
  budget: "Budget drift",
  goal: "Goal drift",
  debt: "Debt cost",
};

/** Severity as a word, coloured the way the rest of the tidy pages colour status. */
function severityText(severity: MoneyLeak["severity"]): { label: string; tone: string; chip: string } {
  if (severity === "high") return { label: "High", tone: "t-negative", chip: "wu-chip wu-chip--negative" };
  if (severity === "medium") return { label: "Medium", tone: "wu-leak-medium", chip: "wu-chip wu-chip--warning" };
  return { label: "Low", tone: "t-faint", chip: "wu-chip wu-chip--muted" };
}

/** A figure without its currency prefix, for the tidy money layout. */
function amountOf(value: number): string {
  return money(value, "").trim();
}

/**
 * The finding whose evidence is showing, kept across a re-render.
 *
 * A "Review finding" button anywhere in the app writes this before navigating
 * here, so the setter is exported; the page itself keeps it in sync with what
 * is actually selected. On a desktop the selected finding always fills the
 * detail card beside the list; on a phone it opens under its row. The page
 * opens with the top finding already open, so the list reads as something to
 * tap; tapping the open row closes it.
 */
let selectedMoneyLeakId = "";
let leakDetailOpen = true;

export function setSelectedMoneyLeakId(id: string): void {
  selectedMoneyLeakId = id;
  leakDetailOpen = true;
}

/** Rows the list shows before "See all". */
const LEAK_LIMIT = 5;
let leakListExpanded = false;

/**
 * The canonical Advisor recommendation for one Money Leak finding.
 *
 * Findings say WHAT happened; the Advisor owns WHY it matters and WHAT to do.
 * Both are read from AdvisorSnapshot.leakRecommendations — the UI never writes
 * advisory copy of its own, and never re-derives one from the finding.
 */
function leakAdvice(
  recommendations: AdvisorRecommendation[],
  leakId: string,
): AdvisorRecommendation | undefined {
  return recommendations.find((recommendation) => recommendation.id === `advisor:leak:${leakId}`);
}

/**
 * Execution state for one leak recommendation.
 *
 * Completing an action records only that the user did what was suggested. The
 * finding itself is untouched: the leak may well still be there, so this must
 * never be presented as the problem being solved.
 *
 * Completing is one press with no confirmation, so the completed state keeps
 * the same slot in the action row and offers Undo there. Undo drops the record
 * only — the finding never changed, so nothing else has to be put back.
 */
function leakDoneButton(state: WealthState, recommendation: AdvisorRecommendation | undefined): string {
  if (!recommendation) return "";
  if (isRecommendationCompleted(state, recommendation.id)) {
    return `<button class="wu-btn wu-btn--ghost wu-btn--sm leak-undo-done"
    data-recommendation-id="${escapeHtml(recommendation.id)}"
    aria-label="Undo marking this done" type="button">Undo</button>`;
  }
  return `<button class="wu-btn wu-btn--ghost wu-btn--sm leak-mark-done"
    data-recommendation-id="${escapeHtml(recommendation.id)}"
    data-action-label="${escapeHtml(recommendation.action)}" type="button">Mark as done</button>`;
}

function leakDoneNote(state: WealthState, recommendation: AdvisorRecommendation | undefined): string {
  if (!recommendation || !isRecommendationCompleted(state, recommendation.id)) return "";
  return `<p class="wu-dash__note"><span class="wu-chip">Action completed</span> Recorded on your side. The finding stays listed until the next scan no longer detects it.</p>`;
}

/**
 * The evidence for one finding: impact, what was observed, the evidence rows,
 * the Advisor's reason and next move, and the actions. The desktop detail card
 * and the open row on a phone both render it from here, so they never drift.
 *
 * `compact` is the phone's open row: the amount, one sentence and the two
 * actions that matter, with the evidence, the reasoning and Ask Advisor one
 * tap further in under "More detail".
 */
export function leakDetailContent(state: WealthState, leak: MoneyLeak, advice: AdvisorRecommendation | undefined, compact = false): string {
  const severity = severityText(leak.severity);
  const evidence = leak.evidence.length ? `<ul class="wu-facts wu-facts--plain wu-leak-evidence">${leak.evidence.map((item) => `<li><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.value)}</span></li>`).join("")}</ul>` : "";
  const reasoning = advice
    ? `<p class="wu-leak-advice"><span class="wu-label">Why it matters</span>${escapeHtml(advice.impact)}</p>
    <p class="wu-leak-advice"><span class="wu-label">Next move</span>${escapeHtml(advice.action)}</p>`
    : `<p class="wu-leak-advice"><span class="wu-label">Next move</span>No recommendation applies to this finding yet. The observation above is the full picture.</p>`;
  const primary = `<button class="wu-btn wu-btn--primary wu-btn--sm leak-primary-action" data-action="${leak.primaryAction}" type="button">${escapeHtml(leak.actionLabel)}</button>`;
  const askAdvisor = `<button class="wu-btn wu-btn--secondary wu-btn--sm leak-advisor-action" type="button">Ask Advisor</button>`;
  const head = `<p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(leak.annualImpact)}</span><span class="wu-money__of">${leak.impactBasis === "one-time" ? "observed once" : "a year"}</span></p>
    <p class="wu-dash__note">${escapeHtml(leak.summary)}</p>`;

  if (compact) {
    return `<div class="leak-detail-content wu-stack wu-stack--sm" data-leak-detail="${escapeHtml(leak.id)}">
    ${head}
    ${leakDoneNote(state, advice)}
    <div class="wu-row wu-row--tight wu-leak-actions">${primary}${leakDoneButton(state, advice)}</div>
    <details class="wu-leak-more">
      <summary>More detail</summary>
      <div class="wu-stack wu-stack--sm">${evidence}${reasoning}<div class="wu-row wu-row--tight">${askAdvisor}</div></div>
    </details>
    <span class="visually-hidden">${severity.label} priority · ${leakCategoryLabels[leak.category]} · ${Math.round(leak.confidence * 100)}% confidence</span>
  </div>`;
  }

  return `<div class="leak-detail-content wu-stack wu-stack--sm" data-leak-detail="${escapeHtml(leak.id)}">
    ${head}
    ${evidence}
    ${reasoning}
    ${leakDoneNote(state, advice)}
    <div class="wu-row wu-row--tight wu-leak-actions">
      ${primary}
      ${askAdvisor}
      ${leakDoneButton(state, advice)}
    </div>
    <span class="visually-hidden">${severity.label} priority · ${leakCategoryLabels[leak.category]} · ${Math.round(leak.confidence * 100)}% confidence</span>
  </div>`;
}

export function moneyLeaksTemplate(state: WealthState): string {
  const summary = detectMoneyLeaks(state);
  // Canonical advice for every finding, already ranked by the Advisor.
  const leakRecommendations = getAdvisorSnapshot(state).leakRecommendations;
  const selected = summary.leaks.find((leak) => leak.id === selectedMoneyLeakId) ?? summary.topLeak;
  if (selected) selectedMoneyLeakId = selected.id;
  // A selected finding past the fold keeps the whole list showing, so it stays visible.
  const selectedIndex = selected ? summary.leaks.indexOf(selected) : -1;
  const showAll = leakListExpanded || selectedIndex >= LEAK_LIMIT;
  const shown = showAll ? summary.leaks : summary.leaks.slice(0, LEAK_LIMIT);
  const oneTime = summary.leaks.some((leak) => leak.impactBasis === "one-time");

  const leakRows = shown.map((leak) => {
    const isSelected = leak.id === selected?.id;
    const open = isSelected && leakDetailOpen;
    const severity = severityText(leak.severity);
    const basis = leak.impactBasis === "one-time" ? "observed once" : `${amountOf(leak.monthlyImpact)} / mo`;
    return `<li class="wu-leak${isSelected ? " is-selected" : ""}${open ? " is-open" : ""}">
        <button class="wu-leak__row leak-row" type="button" data-leak-id="${escapeHtml(leak.id)}" aria-pressed="${isSelected}" aria-expanded="${open}">
          <span class="wu-leak__title">${escapeHtml(leak.title)}<small>${leakCategoryLabels[leak.category]} · ${basis}</small></span>
          <span class="wu-leak__value">${amountOf(leak.annualImpact)}<small class="${severity.tone}">${severity.label}</small></span>
          <span class="wu-leak__chev" aria-hidden="true">›</span>
        </button>
        ${open ? `<div class="wu-leak__inline">${leakDetailContent(state, leak, leakAdvice(leakRecommendations, leak.id), true)}</div>` : ""}
      </li>`;
  }).join("");

  const highChip = summary.highCount > 0
    ? `<span class="wu-chip wu-chip--negative">${summary.highCount} high</span>`
    : `<span class="wu-chip wu-chip--muted">None high</span>`;
  const findingsText = `${summary.leaks.length} ${summary.leaks.length === 1 ? "finding" : "findings"}`;
  const selectedSeverity = selected ? severityText(selected.severity) : null;

  return `
    <div class="wu money-leaks-page">
      ${pageHeader({
        eyebrow: "Cash Flow",
        title: "Money Leaks",
        sub: "Where small recurring costs are quietly draining your cash flow.",
        actions: `<button class="wu-btn wu-btn--secondary wu-btn--sm dashboard-nav" data-page="ledger" type="button">Open transactions</button><button class="wu-btn wu-btn--primary wu-btn--sm dashboard-nav" data-page="buckets" type="button">Review budget</button>`,
      })}
      <div class="wu-dash">
        <!-- ROW 1 (desktop) — four figures, all the same size -->
        <div class="wu-dash__full wu-dash__tiles wu-leak-tiles">
          <section class="wu-card wu-dash__tile" aria-labelledby="leakMonthLabel">
            <div class="wu-tc__top"><span class="wu-label" id="leakMonthLabel">Each month</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(summary.monthlyImpact)}</span></p>
            <p class="wu-dash__note">Potential monthly drag</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="leakYearLabel">
            <div class="wu-tc__top"><span class="wu-label" id="leakYearLabel">Each year</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(summary.annualImpact)}</span></p>
            <p class="wu-dash__note">${oneTime ? "Includes one-time findings" : "If nothing changes"}</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="leakFindingsLabel">
            <div class="wu-tc__top"><span class="wu-label" id="leakFindingsLabel">Findings</span></div>
            <p class="wu-money wu-money--md"><span>${summary.leaks.length}</span></p>
            <p class="wu-dash__note">Across ${summary.categoryCount} ${summary.categoryCount === 1 ? "category" : "categories"}</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="leakHighLabel">
            <div class="wu-tc__top"><span class="wu-label" id="leakHighLabel">High priority</span>${summary.highCount > 0 ? `<span class="wu-chip wu-chip--negative">High</span>` : ""}</div>
            <p class="wu-money wu-money--md${summary.highCount > 0 ? " t-negative" : ""}"><span>${summary.highCount}</span></p>
            <p class="wu-dash__note">${summary.highCount > 0 ? "Look at these first" : "Nothing urgent"}</p>
          </section>
        </div>

        <!-- phone — one summary card carries the same figures -->
        <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-leak-summary" aria-labelledby="leakSummaryLabel">
          <div class="wu-tc__top"><span class="wu-label" id="leakSummaryLabel">Leaking each month</span>${highChip}</div>
          <p class="wu-money"><span class="wu-money__cur">MYR</span><span>${amountOf(summary.monthlyImpact)}</span><span class="wu-money__of">/ mo</span></p>
          <p class="wu-dash__note">About ${money(summary.annualImpact)} a year across ${findingsText}.</p>
          <div class="wu-row wu-row--tight">
            <button class="wu-btn wu-btn--secondary wu-btn--sm dashboard-nav" data-page="buckets" type="button">Review budget</button>
            <button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-nav" data-page="ledger" type="button">Open transactions</button>
          </div>
        </section>

        <!-- ROW 2 — the findings | the selected one -->
        <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-leak-list-card" aria-labelledby="leakListLabel">
          <div class="wu-tc__top"><span class="wu-label" id="leakListLabel">By yearly impact<span class="wu-leak-hint wu-leak-hint--phone"> · tap to open</span><span class="wu-leak-hint wu-leak-hint--desk"> · click to open</span></span></div>
          ${summary.leaks.length > 0
            ? `<ul class="wu-leak-list">${leakRows}</ul>`
            : `<p class="wu-empty">No material leaks detected. Keep recurring payments and transaction details current so the scan can stay useful.</p>`}
          ${/* With one or two findings the card beside the detail is mostly empty;
               say why, so the space reads as "nothing else" rather than as missing rows. */
            summary.leaks.length > 0 && summary.leaks.length < 3
              ? `<p class="wu-dash__note wu-leak-few">Only ${summary.leaks.length} ${summary.leaks.length === 1 ? "finding" : "findings"} right now — nothing else detected.</p>`
              : ""}
          ${summary.leaks.length > LEAK_LIMIT && selectedIndex < LEAK_LIMIT
            ? `<button class="wu-btn wu-btn--ghost wu-btn--sm wu-self-end wu-leak-see-all" id="leakSeeAll" type="button">${leakListExpanded ? "Show less" : `See all ${summary.leaks.length}`}</button>`
            : ""}
        </section>
        <aside class="wu-card wu-dash__half wu-stack wu-stack--sm leak-detail-panel" aria-live="polite" aria-labelledby="leakDetailLabel">
          ${selected && selectedSeverity
            ? `<div class="wu-tc__top"><span class="wu-label" id="leakDetailLabel">${escapeHtml(leakCategoryLabels[selected.category])}</span><span class="${selectedSeverity.chip}">${selectedSeverity.label}</span></div>
          <h3 class="wu-leak__heading">${escapeHtml(selected.title)}</h3>
          ${leakDetailContent(state, selected, leakAdvice(leakRecommendations, selected.id))}`
            : `<div class="wu-tc__top"><span class="wu-label" id="leakDetailLabel">Details</span></div><p class="wu-empty">No money leaks detected. Your recent spending is within the current leak-detection rules.</p>`}
        </aside>
      </div>
      <p class="wu-dash__note wu-leak-foot">Estimates are planning aids based on your records. Confirm merchant charges, account statements and goal assumptions before changing or disputing payments.</p>
    </div>`;
}

export function bindMoneyLeaks(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const summary = detectMoneyLeaks(state);

  /** Re-render in place, keeping the reader where they were. */
  const repaint = (): void => {
    const scrollPosition = { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 };
    rerender(root, state, setState, "money-leaks", navigate);
    const restore = () => {
      window.scrollTo(scrollPosition.x, scrollPosition.y);
      document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
    };
    restore();
    requestAnimationFrame(restore);
  };

  /**
   * Record that the user carried out a recommendation. This writes execution
   * state only — the finding, its impact and its severity are untouched, and
   * the leak stays on the list.
   */
  root.querySelectorAll<HTMLButtonElement>(".leak-mark-done").forEach((button) => button.addEventListener("click", () => {
    const recommendationId = button.dataset.recommendationId ?? "";
    const action = button.dataset.actionLabel ?? "";
    if (!recommendationId) return;
    const next: WealthState = {
      ...state,
      actionRecords: markRecommendationDone(state.actionRecords, {
        id: `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        recommendationId,
        action,
      }),
    };
    setState(next, "Marked a money-leak action as done");
    if (navigate) navigate("money-leaks");
    else rerender(root, next, setState, "money-leaks");
  }));

  /**
   * Undo a completion. Removes the execution record and nothing else: the
   * finding, its impact and its severity were never touched by completing it.
   */
  root.querySelectorAll<HTMLButtonElement>(".leak-undo-done").forEach((button) => button.addEventListener("click", () => {
    const recommendationId = button.dataset.recommendationId ?? "";
    if (!recommendationId) return;
    const next: WealthState = {
      ...state,
      actionRecords: undoRecommendationDone(state.actionRecords, recommendationId),
    };
    setState(next, "Undid a money-leak action");
    if (navigate) navigate("money-leaks");
    else rerender(root, next, setState, "money-leaks");
  }));

  const pageByAction: Record<MoneyLeak["primaryAction"], string> = {
    "review-recurring": "me",
    "review-ledger": "ledger",
    "review-budget": "buckets",
    "review-goal": "goals",
    "review-debt": "me",
  };
  root.querySelectorAll<HTMLButtonElement>(".leak-primary-action").forEach((button) => button.addEventListener("click", () => {
    const leakId = button.closest<HTMLElement>("[data-leak-detail]")?.dataset.leakDetail;
    const leak = summary.leaks.find((item) => item.id === leakId);
    if (leak) navigate?.(pageByAction[leak.primaryAction]);
  }));
  root.querySelectorAll<HTMLButtonElement>(".leak-advisor-action").forEach((button) => button.addEventListener("click", () => navigate?.("advisor")));

  // A tap picks the finding (the desktop card follows it) and opens or closes
  // its evidence under the row on a phone.
  root.querySelectorAll<HTMLButtonElement>(".leak-row").forEach((row) => row.addEventListener("click", () => {
    const leak = summary.leaks.find((item) => item.id === row.dataset.leakId);
    if (!leak) return;
    const wasOpen = selectedMoneyLeakId === leak.id && leakDetailOpen;
    selectedMoneyLeakId = leak.id;
    leakDetailOpen = !wasOpen;
    repaint();
  }));
  root.querySelector<HTMLButtonElement>("#leakSeeAll")?.addEventListener("click", () => {
    leakListExpanded = !leakListExpanded;
    repaint();
  });
}
