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
import { pageHeader } from "../components/pageHeader";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

function advisorPriorityActionControl(state: WealthState): string {
  const priority = getAdvisorSnapshot(state).priority;
  if (!priority) return "";
  const done = isRecommendationCompleted(state, priority.id);
  return `
    <div class="wu-card wu-card--inset wu-card--pad-sm${done ? " wu-card--positive" : ""} advisor-action-record">
      <div class="wu-row wu-row--between">
        <div class="wu-stack wu-stack--sm">
          <span class="wu-label">Priority action</span>
          <strong class="t-subheading">${escapeHtml(priority.action)}</strong>
        </div>
        ${done
          ? '<span class="wu-badge wu-badge--positive"><span aria-hidden="true">✓</span> Completed</span>'
          : `<button class="wu-btn wu-btn--primary wu-btn--sm advisor-mark-done" type="button" data-recommendation-id="${escapeHtml(priority.id)}" data-action-label="${escapeHtml(priority.action)}">Mark as done</button>`}
      </div>
    </div>`;
}

function advisorRecommendationCard(state: WealthState, recommendation: AdvisorRecommendation): string {
  const done = isRecommendationCompleted(state, recommendation.id);
  const tone = recommendation.severity === "action" ? " wu-card--negative" : recommendation.severity === "watch" ? " wu-card--warning" : " wu-card--positive";
  // Same body composition advisorMessages() has always produced.
  const body = `${recommendation.fact} ${recommendation.action}`.trim();
  return `<div class="wu-card wu-card--pad-sm${tone}${done ? " is-done" : ""} advice" data-recommendation-id="${escapeHtml(recommendation.id)}">
      <div class="wu-stack wu-stack--sm">
        <strong class="t-subheading">${escapeHtml(recommendation.title)}</strong>
        <span class="t-body-sm t-muted">${escapeHtml(body)}</span>
        <div class="wu-row wu-row--tight advice-action">${done
          ? '<span class="wu-badge wu-badge--positive"><span aria-hidden="true">✓</span> Action completed</span>'
          : `<button class="wu-btn wu-btn--ghost wu-btn--sm advisor-mark-done" type="button" data-recommendation-id="${escapeHtml(recommendation.id)}" data-action-label="${escapeHtml(recommendation.action)}">Mark as done</button>`}
          ${recommendation.destination
            // The recommendation already names where the work happens. Surfacing
            // it means the card tells the user what to do AND how to get there.
            ? `<button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-nav" type="button" data-page="${escapeHtml(recommendation.destination)}">Go to ${escapeHtml(recommendation.destination.replace(/-/g, " "))} →</button>`
            : ""}</div>
      </div>
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

  return `<div class="wu">
    ${pageHeader({
      eyebrow: "Guidance & Scenarios",
      title: "Advisor",
      sub: "Rules-based guidance in canonical order, plus the dip-buy scenario check.",
    })}
    ${leakInsightStrip(state, ["debt", "goal", "budget", "fee", "subscription", "duplicate"], "Priority guidance")}
    <div class="wu-grid wu-grid--2">
      <article class="wu-card advisor-panel">
        <div class="wu-card__header">
          <div class="wu-stack wu-stack--sm"><span class="wu-label">Advisor Engine</span><h3 class="wu-card__title t-heading">Financial Planning Guidance</h3></div>
          <span class="wu-badge wu-badge--neutral">Rules-based</span>
        </div>
        <div class="wu-stack">
          ${advisorPriorityActionControl(state)}
          <!-- Rendered straight from AdvisorSnapshot.recommendations: the same
               cards as before, in the same canonical order, now each carrying its
               own execution state. The UI does not rank or re-word anything. -->
          <div class="wu-stack wu-stack--sm advice-list">${getAdvisorSnapshot(state).recommendations
            .map((recommendation) => advisorRecommendationCard(state, recommendation)).join("")}</div>
        </div>
      </article>
      <article class="wu-card">
        <div class="wu-card__header">
          <div class="wu-stack wu-stack--sm"><span class="wu-label">Scenario Check</span><h3 class="wu-card__title t-heading">Dip-Buy Trigger</h3></div>
          <span class="wu-badge wu-badge--neutral">Bear Market Plan</span>
        </div>
        <div class="wu-stack wu-stack--lg">
          <div class="wu-grid wu-grid--3">
            <div class="wu-metric"><span class="wu-metric__label wu-label">🎯 Opportunity Reserve</span><span class="wu-metric__value t-num wu-metric__value--positive">${money(state.opportunity.total)}</span><span class="wu-metric__note t-caption">Used ${money(state.opportunity.used)} · Remaining ${money(state.opportunity.total - state.opportunity.used)}</span></div>
            <div class="wu-metric"><span class="wu-metric__label wu-label">📊 VOO Allocation</span><span class="wu-metric__value t-num">${money(state.opportunity.allocation.VOO)}</span></div>
            <div class="wu-metric"><span class="wu-metric__label wu-label">📊 QQQM Allocation</span><span class="wu-metric__value t-num">${money(state.opportunity.allocation.QQQM)}</span></div>
          </div>
          <form id="drawdownForm" class="wu-row">
            <label class="wu-field-row"><span class="wu-field-row__label">Market Drawdown %</span><input class="wu-field" id="drawdownInput" type="number" min="0" max="80" step="1" value="0"></label>
            <button class="wu-btn wu-btn--primary wu-btn--sm wu-self-end" type="submit">Check Rule</button>
          </form>
          <div id="drawdownResult" class="wu-card wu-card--inset wu-card--pad-sm t-body-sm t-muted">Enter the market drawdown from its peak to check whether reserve deployment is triggered.</div>
          <div class="wu-table-wrap">
            <table class="wu-table"><thead><tr><th>Trigger</th><th>Reserve %</th><th>Amount</th><th>VOO / QQQM</th><th>Status</th></tr></thead><tbody>${trancheRows}</tbody></table>
          </div>
        </div>
      </article>
    </div>
  </div>`;
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
        const statusColor = tranche.deployed ? "var(--text-faint)" : drawdown >= tranche.drawdown ? "var(--positive)" : "var(--text-faint)";
        statusCells[i].textContent = tranche.status;
        statusCells[i].style.color = statusColor;
      }
    });

    if (!result) return;
    if (triggered.length === 0) {
      const remaining = state.opportunity.total - state.opportunity.used;
      result.innerHTML = '<div style="margin-bottom:8px;">No tranche triggered at -' + drawdown + '%.</div>' +
        '<div style="font-size:12px;color:var(--text-faint);">Continue DCA and preserve the Opportunity Reserve of ' + money(remaining) + '.</div>';
      return;
    }
    const totalDeploy = triggered.reduce((sum, t) => sum + t.amount, 0);
    const totalVoo = triggered.reduce((sum, t) => sum + t.suggestedVoo, 0);
    const totalQqqm = triggered.reduce((sum, t) => sum + t.suggestedQqqm, 0);
    result.innerHTML = '<div style="font-size:14px;font-weight:700;color:var(--warning);margin-bottom:8px;">🐻 -' + drawdown + '% Drawdown: Deploy ' + money(totalDeploy) + '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<div style="flex:1;background:var(--surface-raised);border-radius:6px;padding:8px;text-align:center;">' +
          '<div style="font-size:11px;color:var(--text-faint);">VOO</div>' +
          '<div style="font-size:14px;font-weight:700;color:var(--accent);">' + money(totalVoo) + '</div>' +
        '</div>' +
        '<div style="flex:1;background:var(--surface-raised);border-radius:6px;padding:8px;text-align:center;">' +
          '<div style="font-size:11px;color:var(--text-faint);">QQQM</div>' +
          '<div style="font-size:14px;font-weight:700;color:var(--highlight);">' + money(totalQqqm) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12px;">' +
        '<div style="font-weight:600;margin-bottom:4px;">Deployment Rules:</div>' +
        allTranches.map((t) => {
          const isTriggered = drawdown >= t.drawdown;
          const icon = t.deployed ? '✅' : isTriggered ? '🟢' : '⬜';
          const color = t.deployed ? 'var(--text-faint)' : isTriggered ? 'var(--positive)' : 'var(--text-faint)';
          return '<div style="display:flex;justify-content:space-between;padding:4px 0;color:' + color + ';">' +
            '<span>' + icon + ' -' + t.drawdown + '% → ' + money(t.amount) + ' (VOO ' + money(t.suggestedVoo) + ' / QQQM ' + money(t.suggestedQqqm) + ')</span>' +
            '<span>' + t.status + '</span></div>';
        }).join('') +
      '</div>';
  });
}
