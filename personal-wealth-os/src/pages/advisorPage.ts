/**
 * Advisor page — rules-based guidance and the dip-buy scenario check.
 *
 * Every card is read straight from AdvisorSnapshot: the same recommendations,
 * in the same canonical order, each carrying its own execution state. The UI
 * ranks nothing and re-words nothing. Marking one done writes an ActionRecord
 * and leaves the recommendation exactly where it was.
 */

import type { AdvisorRecommendation, WealthState } from "../models";
import { createId } from "../state";
import { money, percent, trancheStatus } from "../rules";
import { escapeHtml } from "../html";
import { getAdvisorSnapshot } from "../advisor";
import { isRecommendationCompleted, markRecommendationDone } from "../actionRecords";
import { leakInsightStrip } from "../components/leakInsightStrip";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

function advisorPriorityActionControl(state: WealthState): string {
  const priority = getAdvisorSnapshot(state).priority;
  if (!priority) return "";
  const done = isRecommendationCompleted(state, priority.id);
  return `
    <div class="advisor-action-record${done ? " advisor-action-record--done" : ""}">
      <div class="advisor-action-record__copy">
        <span class="eyebrow">Priority action</span>
        <strong>${escapeHtml(priority.action)}</strong>
      </div>
      ${done
        ? '<span class="advisor-action-record__done"><span aria-hidden="true">✓</span> Completed</span>'
        : `<button class="primary-button advisor-mark-done" type="button" data-recommendation-id="${escapeHtml(priority.id)}" data-action-label="${escapeHtml(priority.action)}">Mark as done</button>`}
    </div>`;
}

function advisorRecommendationCard(state: WealthState, recommendation: AdvisorRecommendation): string {
  const done = isRecommendationCompleted(state, recommendation.id);
  // Same body composition advisorMessages() has always produced.
  const body = `${recommendation.fact} ${recommendation.action}`.trim();
  return `<div class="advice ${recommendation.severity}${done ? " advice--done" : ""}" data-recommendation-id="${escapeHtml(recommendation.id)}">
      <strong>${escapeHtml(recommendation.title)}</strong>
      <span>${escapeHtml(body)}</span>
      <div class="advice-action">${done
        ? '<span class="advice-action__done"><span aria-hidden="true">✓</span> Action completed</span>'
        : `<button class="v2-btn v2-btn--ghost v2-btn--sm advisor-mark-done" type="button" data-recommendation-id="${escapeHtml(recommendation.id)}" data-action-label="${escapeHtml(recommendation.action)}">Mark as done</button>`}
        ${recommendation.destination
          // The recommendation already names where the work happens. Surfacing
          // it means the card tells the user what to do AND how to get there.
          ? `<button class="v2-btn v2-btn--ghost v2-btn--sm dashboard-nav" type="button" data-page="${escapeHtml(recommendation.destination)}">Go to ${escapeHtml(recommendation.destination.replace(/-/g, " "))} →</button>`
          : ""}</div>
    </div>`;
}

export function advisorPageTemplate(state: WealthState): string {
  const trancheRows = state.opportunity.tranches.map((tranche) => {
    return '<tr>' +
      '<td>-' + tranche.drawdown + '%</td>' +
      '<td>' + percent(tranche.percent) + '</td>' +
      '<td>' + money(tranche.amount) + '</td>' +
      '<td>' + money(tranche.amount / 2) + ' / ' + money(tranche.amount / 2) + '</td>' +
      '<td class="tranche-status">—</td>' +
      '</tr>';
  }).join("");

  return `
    ${leakInsightStrip(state, ["debt", "goal", "budget", "fee", "subscription", "duplicate"], "Priority guidance")}
    <div class="terminal-grid">
      <article class="card panel advisor-panel">
        <div class="panel-head"><div><span class="eyebrow">Advisor Engine</span><h3>Financial Planning Guidance</h3></div><span style="color:var(--muted);font-size:12px;">Rules-based</span></div>
        ${advisorPriorityActionControl(state)}
        <!-- Rendered straight from AdvisorSnapshot.recommendations: the same
             cards as before, in the same canonical order, now each carrying its
             own execution state. The UI does not rank or re-word anything. -->
        <div class="advice-list">${getAdvisorSnapshot(state).recommendations
          .map((recommendation) => advisorRecommendationCard(state, recommendation)).join("")}</div>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Scenario Check</span><h3>Dip-Buy Trigger</h3></div><span style="color:var(--muted);font-size:12px;">Bear Market Plan</span></div>
        <div class="scenario-summary-grid">
          <div class="scenario-summary-cell">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">🎯 Opportunity Reserve</div>
            <div style="font-size:16px;font-weight:700;color:var(--green);">${money(state.opportunity.total)}</div>
            <div style="font-size:11px;color:var(--ink-3);">Used: ${money(state.opportunity.used)} · Remaining: ${money(state.opportunity.total - state.opportunity.used)}</div>
          </div>
          <div class="scenario-summary-cell">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📊 VOO Allocation</div>
            <div style="font-size:16px;font-weight:700;">${money(state.opportunity.allocation.VOO)}</div>
          </div>
          <div class="scenario-summary-cell">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📊 QQQM Allocation</div>
            <div style="font-size:16px;font-weight:700;">${money(state.opportunity.allocation.QQQM)}</div>
          </div>
        </div>
        <form id="drawdownForm" class="scenario-form">
          <label>Market Drawdown %<input id="drawdownInput" type="number" min="0" max="80" step="1" value="0"></label>
          <button class="primary-button" type="submit">Check Rule</button>
        </form>
        <div id="drawdownResult" class="scenario-result">Enter the market drawdown from its peak to check whether reserve deployment is triggered.</div>
        <div class="table-wrap compact-table financial-table">
          <table><thead><tr><th>Trigger</th><th>Reserve %</th><th>Amount</th><th>VOO / QQQM</th><th>Status</th></tr></thead><tbody>${trancheRows}</tbody></table>
        </div>
      </article>
    </div>
  `;
}

export function bindAdvisor(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  // Mark any recommendation as done — the priority callout and every card in
  // the list. Persists an ActionRecord only: the recommendation itself is
  // untouched, keeps its ranking, and stays on the page.
  const recommendations = getAdvisorSnapshot(state).recommendations;
  root.querySelectorAll<HTMLButtonElement>(".advisor-mark-done").forEach((button) => {
    button.addEventListener("click", (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const recommendationId = target.dataset.recommendationId;
      if (!recommendationId) return;
      // The id must belong to a live recommendation, so a stale button can
      // never write a record for advice that no longer exists.
      const recommendation = recommendations.find((item) => item.id === recommendationId);
      if (!recommendation) return;
      const next: WealthState = {
        ...state,
        actionRecords: markRecommendationDone(state.actionRecords, {
          id: createId("action"),
          recommendationId,
          action: recommendation.action,
        }),
      };
      setState(next, "Mark advisor action done");
      rerender(root, next, setState, "advisor", navigate);
    });
  });

  root.querySelector<HTMLFormElement>("#drawdownForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const drawdown = Number(root.querySelector<HTMLInputElement>("#drawdownInput")?.value) || 0;
    const allTranches = trancheStatus(state, drawdown);
    const triggered = allTranches.filter((tranche) => drawdown >= tranche.drawdown);
    const result = root.querySelector<HTMLElement>("#drawdownResult");

    // Update tranche status column in the table
    const statusCells = root.querySelectorAll<HTMLElement>(".tranche-status");
    allTranches.forEach((tranche, i) => {
      if (statusCells[i]) {
        const statusColor = tranche.deployed ? "var(--ink-3)" : drawdown >= tranche.drawdown ? "var(--green)" : "var(--ink-3)";
        statusCells[i].textContent = tranche.status;
        statusCells[i].style.color = statusColor;
      }
    });

    if (!result) return;
    if (triggered.length === 0) {
      const remaining = state.opportunity.total - state.opportunity.used;
      result.innerHTML = '<div style="margin-bottom:8px;">No tranche triggered at -' + drawdown + '%.</div>' +
        '<div style="font-size:12px;color:var(--ink-3);">Continue DCA and preserve the Opportunity Reserve of ' + money(remaining) + '.</div>';
      return;
    }
    const totalDeploy = triggered.reduce((sum, t) => sum + t.amount, 0);
    const totalVoo = triggered.reduce((sum, t) => sum + t.suggestedVoo, 0);
    const totalQqqm = triggered.reduce((sum, t) => sum + t.suggestedQqqm, 0);
    result.innerHTML = '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:8px;">🐻 -' + drawdown + '% Drawdown: Deploy ' + money(totalDeploy) + '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<div style="flex:1;background:var(--surface);border-radius:6px;padding:8px;text-align:center;">' +
          '<div style="font-size:11px;color:var(--ink-3);">VOO</div>' +
          '<div style="font-size:14px;font-weight:700;color:var(--blue);">' + money(totalVoo) + '</div>' +
        '</div>' +
        '<div style="flex:1;background:var(--surface);border-radius:6px;padding:8px;text-align:center;">' +
          '<div style="font-size:11px;color:var(--ink-3);">QQQM</div>' +
          '<div style="font-size:14px;font-weight:700;color:var(--purple);">' + money(totalQqqm) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12px;">' +
        '<div style="font-weight:600;margin-bottom:4px;">Deployment Rules:</div>' +
        allTranches.map((t) => {
          const isTriggered = drawdown >= t.drawdown;
          const icon = t.deployed ? '✅' : isTriggered ? '🟢' : '⬜';
          const color = t.deployed ? 'var(--ink-3)' : isTriggered ? 'var(--green)' : 'var(--ink-3)';
          return '<div style="display:flex;justify-content:space-between;padding:4px 0;color:' + color + ';">' +
            '<span>' + icon + ' -' + t.drawdown + '% → ' + money(t.amount) + ' (VOO ' + money(t.suggestedVoo) + ' / QQQM ' + money(t.suggestedQqqm) + ')</span>' +
            '<span>' + t.status + '</span></div>';
        }).join('') +
      '</div>';
  });
}
