/**
 * Money Leaks page — the deterministic-detector list and its evidence panel.
 *
 * Findings come from detectMoneyLeaks and say only WHAT happened. The advisory
 * copy beside each — why it matters, what to do — is read from
 * AdvisorSnapshot.leakRecommendations; this file never writes advice of its own
 * or re-derives one from a finding. Marking an action done records execution
 * state only: the finding stays listed until the next scan no longer sees it.
 */

import type { AdvisorRecommendation, WealthState } from "../models";
import { detectMoneyLeaks, getAdvisorSnapshot, type MoneyLeak } from "../advisor";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import { isRecommendationCompleted, markRecommendationDone } from "../actionRecords";
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

/** Badge tone for a severity: high reads as a problem, low as neutral. */
function severityBadge(severity: MoneyLeak["severity"]): string {
  const tone = severity === "high" ? "negative" : severity === "medium" ? "warning" : "neutral";
  return `<span class="wu-badge wu-badge--${tone}">${severity} priority</span>`;
}

/**
 * The finding whose evidence panel is open, kept across a re-render.
 *
 * A "Review finding" button anywhere in the app writes this before navigating
 * here, so the setter is exported; the page itself keeps it in sync with what
 * is actually selected.
 */
let selectedMoneyLeakId = "";

export function setSelectedMoneyLeakId(id: string): void {
  selectedMoneyLeakId = id;
}

function leakImpactLabel(leak: MoneyLeak): string {
  return leak.impactBasis === "one-time" ? "observed once" : "per month";
}

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
 */
function leakActionBlock(state: WealthState, recommendation: AdvisorRecommendation | undefined): string {
  if (!recommendation) return "";
  const done = isRecommendationCompleted(state, recommendation.id);
  if (done) {
    return `<div class="wu-stack wu-stack--sm">
      <span class="wu-badge wu-badge--positive">&#10003; Action completed</span>
      <span class="t-caption t-faint">Recorded on your side. The finding stays listed until the next scan no longer detects it.</span>
    </div>`;
  }
  return `<div class="wu-row"><button class="wu-btn wu-btn--primary wu-btn--sm leak-mark-done"
    data-recommendation-id="${escapeHtml(recommendation.id)}"
    data-action-label="${escapeHtml(recommendation.action)}">Mark as done</button></div>`;
}

/**
 * The evidence panel for one finding. Shared by the first paint and by
 * bindMoneyLeaks' renderDetail(), so the two can never drift apart.
 */
export function leakDetailContent(state: WealthState, leak: MoneyLeak, advice: AdvisorRecommendation | undefined): string {
  return `<div class="leak-detail-content wu-stack" data-leak-detail="${escapeHtml(leak.id)}">
    <div class="wu-row wu-row--between">
      <div class="wu-stack wu-stack--sm">
        <span class="wu-label">${leakCategoryLabels[leak.category]}</span>
        <h2 class="t-heading">${escapeHtml(leak.title)}</h2>
      </div>
      ${severityBadge(leak.severity)}
    </div>
    <div class="wu-metric">
      <span class="wu-metric__value t-num">${money(leak.annualImpact)}</span>
      <span class="wu-metric__note t-caption">${leak.impactBasis === "one-time" ? "observed one-time impact" : "estimated annual impact"}</span>
    </div>
    <div class="wu-stack wu-stack--sm">
      <span class="wu-label">What was observed</span>
      <p class="t-body-sm t-muted">${escapeHtml(leak.summary)}</p>
    </div>
    <ul class="wu-list">${leak.evidence.map((item) => `<li class="wu-list__row"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></li>`).join("")}</ul>
    ${advice ? `<div class="wu-stack wu-stack--sm">
      <span class="wu-label">Why it matters</span>
      <p class="t-body-sm t-muted">${escapeHtml(advice.impact)}</p>
    </div>
    <div class="wu-stack wu-stack--sm">
      <span class="wu-label">Recommended next move</span>
      <p class="t-body-sm">${escapeHtml(advice.action)}</p>
    </div>`
    : `<div class="wu-stack wu-stack--sm">
      <span class="wu-label">Recommended next move</span>
      <p class="wu-empty">No recommendation applies to this finding yet. The observation above is the full picture.</p>
    </div>`}
    ${leakActionBlock(state, advice)}
    <div class="wu-row">
      <button class="wu-btn wu-btn--primary wu-btn--sm leak-primary-action" data-action="${leak.primaryAction}">${escapeHtml(leak.actionLabel)}</button>
      <button class="wu-btn wu-btn--secondary wu-btn--sm leak-advisor-action" type="button">Ask Advisor</button>
    </div>
  </div>`;
}

export function moneyLeaksTemplate(state: WealthState): string {
  const summary = detectMoneyLeaks(state);
  // Canonical advice for every finding, already ranked by the Advisor.
  const leakRecommendations = getAdvisorSnapshot(state).leakRecommendations;
  const selected = summary.leaks.find((leak) => leak.id === selectedMoneyLeakId) ?? summary.topLeak;
  if (selected) selectedMoneyLeakId = selected.id;
  const leakRows = summary.leaks.length > 0
    ? summary.leaks.map((leak) => `
      <button class="wu-pick leak-row${leak.id === selected?.id ? " is-selected" : ""}" data-leak-id="${escapeHtml(leak.id)}" aria-pressed="${leak.id === selected?.id ? "true" : "false"}">
        <div class="wu-row wu-row--between">
          <strong class="t-subheading">${escapeHtml(leak.title)}</strong>
          <span class="t-num t-muted">${money(leak.monthlyImpact)}<span class="t-caption t-faint"> ${leakImpactLabel(leak)}</span></span>
        </div>
        <p class="t-body-sm t-muted">${escapeHtml(leak.summary)}</p>
        <div class="wu-row wu-row--tight">
          ${severityBadge(leak.severity)}
          <span class="t-caption t-faint">${leakCategoryLabels[leak.category]} &middot; ${Math.round(leak.confidence * 100)}% confidence &middot; ${leak.impactBasis === "one-time" ? "Not annualised" : `${money(leak.annualImpact)} annual`}</span>
        </div>
      </button>`).join("")
    : `<p class="wu-empty">No material leaks detected. Keep recurring payments and transaction details current so the scan can stay useful.</p>`;
  const selectedAdvice = selected ? leakAdvice(leakRecommendations, selected.id) : undefined;
  const detail = selected
    ? leakDetailContent(state, selected, selectedAdvice)
    : `<p class="wu-empty">No money leaks detected. Your recent spending is within the current leak-detection rules.</p>`;
  return `
    <div class="wu money-leaks-page">
      ${pageHeader({
        eyebrow: "Cash Flow",
        title: "Money Leaks",
        sub: "Deterministic checks across recurring payments, transactions, budgets, goals, and debt.",
        actions: `<button class="wu-btn wu-btn--secondary wu-btn--sm dashboard-nav" data-page="ledger" type="button">Open transactions</button><button class="wu-btn wu-btn--primary wu-btn--sm dashboard-nav" data-page="buckets" type="button">Review budget</button>`,
      })}
      <div class="wu-grid wu-grid--wide">
        <div class="wu-card"><div class="wu-metric"><span class="wu-metric__label wu-label">Potential monthly drag</span><span class="wu-metric__value t-num">${money(summary.monthlyImpact)}</span></div></div>
        <div class="wu-card"><div class="wu-metric"><span class="wu-metric__label wu-label">Potential annual impact</span><span class="wu-metric__value t-num">${money(summary.annualImpact)}</span></div></div>
        <div class="wu-card"><div class="wu-metric"><span class="wu-metric__label wu-label">Findings</span><span class="wu-metric__value t-num">${summary.leaks.length}</span></div></div>
        <div class="wu-card"><div class="wu-metric"><span class="wu-metric__label wu-label">High priority</span><span class="wu-metric__value t-num">${summary.highCount}</span></div></div>
      </div>
      <div class="money-leaks-workspace wu-grid wu-grid--2">
        <section class="wu-card" aria-label="Detected money leaks">
          <div class="wu-card__header"><h3 class="wu-card__title t-heading">Detected issues</h3><span class="wu-badge wu-badge--neutral">by annual impact</span></div>
          <div class="wu-stack">${leakRows}</div>
        </section>
        <aside class="wu-card leak-detail-panel" aria-live="polite">${detail}</aside>
      </div>
      <p class="t-caption t-faint">Estimates are planning aids based on available records. Confirm merchant charges, account statements, and goal assumptions before changing or disputing payments.</p>
    </div>`;
}

export function bindMoneyLeaks(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const summary = detectMoneyLeaks(state);
  // One canonical recommendation list for the whole page, in Advisor order.
  const leakRecommendations = getAdvisorSnapshot(state).leakRecommendations;
  const initialLeak = summary.leaks.find((leak) => leak.id === selectedMoneyLeakId) ?? summary.topLeak;
  const renderDetail = (leak: MoneyLeak): void => {
    const panel = root.querySelector<HTMLElement>(".leak-detail-panel");
    if (!panel) return;
    panel.innerHTML = leakDetailContent(state, leak, leakAdvice(leakRecommendations, leak.id));
    bindDetailActions(panel, leak);
    bindMarkDone(panel);
  };

  /**
   * Record that the user carried out a recommendation. This writes execution
   * state only — the finding, its impact and its severity are untouched, and
   * the leak stays on the list.
   */
  const bindMarkDone = (scope: ParentNode): void => {
    scope.querySelector<HTMLButtonElement>(".leak-mark-done")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
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
    });
  };
  const bindDetailActions = (scope: ParentNode, leak: MoneyLeak): void => {
    scope.querySelector<HTMLButtonElement>(".leak-primary-action")?.addEventListener("click", () => {
      const pageByAction: Record<MoneyLeak["primaryAction"], string> = {
        "review-recurring": "settings",
        "review-ledger": "ledger",
        "review-budget": "buckets",
        "review-goal": "goals",
        "review-debt": "settings",
      };
      navigate?.(pageByAction[leak.primaryAction]);
    });
    scope.querySelector<HTMLButtonElement>(".leak-advisor-action")?.addEventListener("click", () => navigate?.("advisor"));
  };
  root.querySelectorAll<HTMLButtonElement>(".leak-row").forEach((row) => row.addEventListener("click", () => {
    const leak = summary.leaks.find((item) => item.id === row.dataset.leakId);
    if (!leak) return;
    // Remember the pick so a later re-render (e.g. after marking an action
    // done) keeps this finding open rather than snapping back to the top leak.
    selectedMoneyLeakId = leak.id;
    root.querySelectorAll<HTMLButtonElement>(".leak-row").forEach((item) => {
      const selected = item === row;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    renderDetail(leak);
  }));
  // The first detail panel comes from the template rather than renderDetail(),
  // so its controls need binding here too.
  if (initialLeak) bindDetailActions(root, initialLeak);
  bindMarkDone(root);
}
