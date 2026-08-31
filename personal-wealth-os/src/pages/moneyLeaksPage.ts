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
    return `<div class="leak-action-state"><span class="leak-action-done">✓ Action completed</span>
      <span class="leak-action-note">Recorded on your side. The finding stays listed until the next scan no longer detects it.</span></div>`;
  }
  return `<div class="leak-action-state"><button class="v2-btn v2-btn--primary v2-btn--sm leak-mark-done"
    data-recommendation-id="${escapeHtml(recommendation.id)}"
    data-action-label="${escapeHtml(recommendation.action)}">Mark as done</button></div>`;
}

export function moneyLeaksTemplate(state: WealthState): string {
  const summary = detectMoneyLeaks(state);
  // Canonical advice for every finding, already ranked by the Advisor.
  const leakRecommendations = getAdvisorSnapshot(state).leakRecommendations;
  const selected = summary.leaks.find((leak) => leak.id === selectedMoneyLeakId) ?? summary.topLeak;
  if (selected) selectedMoneyLeakId = selected.id;
  const leakRows = summary.leaks.length > 0
    ? summary.leaks.map((leak) => `
      <button class="leak-row ${leak.id === selected?.id ? "is-selected" : ""}" data-leak-id="${escapeHtml(leak.id)}" aria-pressed="${leak.id === selected?.id ? "true" : "false"}">
        <span class="leak-row-main">
          <span class="leak-row-heading"><strong>${escapeHtml(leak.title)}</strong><span class="leak-severity leak-${leak.severity}">${leak.severity} priority</span></span>
          <span>${escapeHtml(leak.summary)}</span>
          <span class="leak-row-meta">${leakCategoryLabels[leak.category]} · ${Math.round(leak.confidence * 100)}% confidence</span>
        </span>
        <span class="leak-row-impact"><strong>${money(leak.monthlyImpact)}</strong><span>${leakImpactLabel(leak)}</span><span>${leak.impactBasis === "one-time" ? "Not annualised" : `${money(leak.annualImpact)} annual`}</span></span>
      </button>`).join("")
    : `<div class="empty-state"><strong>No material leaks detected</strong><span>Keep recurring payments and transaction details current so the scan can stay useful.</span></div>`;
  const selectedAdvice = selected ? leakAdvice(leakRecommendations, selected.id) : undefined;
  const detail = selected ? `
    <div class="leak-detail-content" data-leak-detail="${escapeHtml(selected.id)}">
      <div class="leak-detail-head">
        <div><span class="eyebrow">${leakCategoryLabels[selected.category]}</span><h2>${escapeHtml(selected.title)}</h2></div>
        <span class="leak-severity leak-${selected.severity}">${selected.severity} priority</span>
      </div>
      <div class="leak-detail-impact"><strong>${money(selected.annualImpact)}</strong><span>${selected.impactBasis === "one-time" ? "observed one-time impact" : "estimated annual impact"}</span></div>
      <section><h3>What was observed</h3><p>${escapeHtml(selected.summary)}</p></section>
      <dl class="leak-evidence">${selected.evidence.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}</dl>
      ${selectedAdvice ? `<section><h3>Why it matters</h3><p>${escapeHtml(selectedAdvice.impact)}</p></section>
      <section class="leak-recommendation"><h3>Recommended next move</h3><p>${escapeHtml(selectedAdvice.action)}</p></section>`
      : `<section class="leak-recommendation"><h3>Recommended next move</h3><p class="empty-state">No recommendation applies to this finding yet. The observation above is the full picture.</p></section>`}
      ${leakActionBlock(state, selectedAdvice)}
      <div class="leak-detail-actions"><button class="primary-button leak-primary-action" data-action="${selected.primaryAction}" data-leak-id="${escapeHtml(selected.id)}">${escapeHtml(selected.actionLabel)}</button><button class="secondary-button dashboard-nav" data-page="advisor" data-advisor-prompt="How should I address ${escapeHtml(selected.title)}?">Ask Advisor</button></div>
    </div>` : `<div class="empty-state"><strong>No money leaks detected</strong><span>Your recent spending is within the current leak-detection rules.</span></div>`;
  return `
    <section class="page-shell money-leaks-page">
      <header class="page-header compact-page-header">
        <div><span class="eyebrow">Cash Flow</span><h1>Money Leaks</h1><p>Deterministic checks across recurring payments, transactions, budgets, goals, and debt.</p></div>
        <div class="page-header-actions"><button class="secondary-button dashboard-nav" data-page="ledger">Open transactions</button><button class="primary-button dashboard-nav" data-page="buckets">Review budget</button></div>
      </header>
      <section class="leak-summary-strip" aria-label="Money leak summary">
        <div><span>Potential monthly drag</span><strong>${money(summary.monthlyImpact)}</strong></div>
        <div><span>Potential annual impact</span><strong>${money(summary.annualImpact)}</strong></div>
        <div><span>Findings</span><strong>${summary.leaks.length}</strong></div>
        <div><span>High priority</span><strong>${summary.highCount}</strong></div>
      </section>
      <div class="money-leaks-workspace">
        <section class="card leak-list-panel" aria-label="Detected money leaks">
          <div class="section-head"><div><span class="eyebrow">Detected issues</span><h2 class="card-title">Prioritised by annual impact</h2></div><span class="card-sub">Select a row for evidence and actions</span></div>
          <div class="leak-list">${leakRows}</div>
        </section>
        <aside class="card leak-detail-panel" aria-live="polite">${detail}</aside>
      </div>
      <p class="money-leaks-disclaimer">Estimates are planning aids based on available records. Confirm merchant charges, account statements, and goal assumptions before changing or disputing payments.</p>
    </section>`;
}

export function bindMoneyLeaks(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const summary = detectMoneyLeaks(state);
  // One canonical recommendation list for the whole page, in Advisor order.
  const leakRecommendations = getAdvisorSnapshot(state).leakRecommendations;
  const initialLeak = summary.leaks.find((leak) => leak.id === selectedMoneyLeakId) ?? summary.topLeak;
  const renderDetail = (leak: MoneyLeak): void => {
    const panel = root.querySelector<HTMLElement>(".leak-detail-panel");
    if (!panel) return;
    const advice = leakAdvice(leakRecommendations, leak.id);
    panel.innerHTML = `
      <div class="leak-detail-content" data-leak-detail="${escapeHtml(leak.id)}">
        <div class="leak-detail-head"><div><span class="eyebrow">${leakCategoryLabels[leak.category]}</span><h2>${escapeHtml(leak.title)}</h2></div><span class="leak-severity leak-${leak.severity}">${leak.severity} priority</span></div>
        <div class="leak-detail-impact"><strong>${money(leak.annualImpact)}</strong><span>${leak.impactBasis === "one-time" ? "observed one-time impact" : "estimated annual impact"}</span></div>
        <section><h3>What was observed</h3><p>${escapeHtml(leak.summary)}</p></section>
        <dl class="leak-evidence">${leak.evidence.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}</dl>
        ${advice ? `<section><h3>Why it matters</h3><p>${escapeHtml(advice.impact)}</p></section>
        <section class="leak-recommendation"><h3>Recommended next move</h3><p>${escapeHtml(advice.action)}</p></section>`
        : `<section class="leak-recommendation"><h3>Recommended next move</h3><p class="empty-state">No recommendation applies to this finding yet. The observation above is the full picture.</p></section>`}
        ${leakActionBlock(state, advice)}
        <div class="leak-detail-actions"><button class="primary-button leak-primary-action" data-action="${leak.primaryAction}">${escapeHtml(leak.actionLabel)}</button><button class="secondary-button leak-advisor-action">Ask Advisor</button></div>
      </div>`;
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
