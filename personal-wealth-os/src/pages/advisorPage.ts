/**
 * Advisor page — rules-based guidance and the dip-buy deployment ladder.
 *
 * The guidance cards are read straight from AdvisorSnapshot: same
 * recommendations, same canonical order, each carrying its own execution
 * state. The UI ranks nothing and re-words nothing.
 *
 * The dip-buy ladder is a record, not a calculator: it lists the reserve's
 * drawdown tranches and marks each against how far VOO and QQQM are below
 * their all-time highs (fetched from the same source Market → Context uses;
 * a tranche is "reached" when either half is down by its step). The user
 * records a tranche as deployed, which moves its amount into the reserve's
 * Used total. Everything persists in state.opportunity. The check is passive
 * — the Dashboard surfaces a reached, undeployed tranche the next time it
 * loads; nothing runs while the app is closed.
 */

import type { WealthState, OpportunityTranche } from "../models";
import type { AdvisorRecommendation } from "../models";
import { createId } from "../state";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { getAdvisorSnapshot } from "../advisor";
import { isRecommendationCompleted, markRecommendationDone } from "../actionRecords";
import { assetDrawdownBelow } from "../drawdowns";
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

function dipTrancheCard(tranche: OpportunityTranche, index: number): string {
  const half = tranche.amount / 2;
  return `<div class="wu-card wu-card--inset wu-card--pad-sm${tranche.deployed ? " wu-card--positive" : ""}">
    <div class="wu-row wu-row--between" style="align-items:flex-start">
      <div class="wu-stack wu-stack--sm">
        <strong class="t-subheading">−${tranche.drawdown}% · deploy ${money(tranche.amount)}</strong>
        <span class="t-caption t-faint">VOO ${money(half)} / QQQM ${money(half)}</span>
      </div>
      <div class="wu-stack wu-stack--sm" style="align-items:flex-end;flex:none">
        <span class="t-caption dip-status${tranche.deployed ? " wu-metric__value--positive" : ""}" data-tranche="${index}">${tranche.deployed ? "✓ Deployed" : "—"}</span>
        ${tranche.deployed
          ? `<button class="wu-btn wu-btn--ghost wu-btn--sm dip-undo" data-tranche="${index}" type="button">Undo</button>`
          : `<button class="wu-btn wu-btn--secondary wu-btn--sm dip-deploy" data-tranche="${index}" type="button">Mark deployed</button>`}
      </div>
    </div>
  </div>`;
}

export function advisorPageTemplate(state: WealthState): string {
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
          <div class="wu-stack wu-stack--sm"><span class="wu-label">Bear Market Plan</span><h3 class="wu-card__title t-heading">Dip-Buy Ladder</h3></div>
          <span class="wu-badge wu-badge--neutral">${state.opportunity.tranches.filter((t) => t.deployed).length}/${state.opportunity.tranches.length} deployed</span>
        </div>
        <div class="wu-stack wu-stack--lg">
          <div class="wu-grid wu-grid--3">
            <div class="wu-card wu-card--inset wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">🎯 Reserve remaining</span><span class="wu-metric__value t-num wu-metric__value--positive">${money(state.opportunity.total - state.opportunity.used)}</span><span class="wu-metric__note t-caption">of ${money(state.opportunity.total)} · ${money(state.opportunity.used)} deployed</span></div></div>
            <div class="wu-card wu-card--inset wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">📊 VOO allocation</span><span class="wu-metric__value t-num">${money(state.opportunity.allocation.VOO)}</span></div></div>
            <div class="wu-card wu-card--inset wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">📊 QQQM allocation</span><span class="wu-metric__value t-num">${money(state.opportunity.allocation.QQQM)}</span></div></div>
          </div>
          <div id="dipDrawdown" class="wu-card wu-card--inset wu-card--pad-sm t-body-sm t-muted">Checking VOO and QQQM against their all-time highs…</div>
          <div class="wu-stack wu-stack--sm">
            ${state.opportunity.tranches.map((tranche, index) => dipTrancheCard(tranche, index)).join("")}
          </div>
          <p class="t-caption t-faint">Marking a tranche deployed moves its amount into the reserve's Used total. The status against VOO's live level is a prompt, not a rule — you decide when you actually buy.</p>
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

  // --- Dip-buy ladder: record a tranche as deployed (or undo it). The amount
  // moves into opportunity.used; the tranche keeps its own deployed flag. Both
  // already persist in WealthState — nothing else read here changes shape.
  const setTrancheDeployed = (index: number, deployed: boolean): void => {
    const tranche = state.opportunity.tranches[index];
    if (!tranche || tranche.deployed === deployed) return;
    const delta = deployed ? tranche.amount : -tranche.amount;
    const next: WealthState = {
      ...state,
      opportunity: {
        ...state.opportunity,
        used: Math.max(0, Math.min(state.opportunity.total, state.opportunity.used + delta)),
        tranches: state.opportunity.tranches.map((item, i) => i === index ? { ...item, deployed } : item),
      },
    };
    setState(next, deployed ? "Marked dip-buy tranche deployed" : "Undid dip-buy tranche");
    rerender(root, next, setState, "advisor", navigate);
  };
  root.querySelectorAll<HTMLButtonElement>(".dip-deploy").forEach((button) =>
    button.addEventListener("click", () => setTrancheDeployed(Number(button.dataset.tranche), true)));
  root.querySelectorAll<HTMLButtonElement>(".dip-undo").forEach((button) =>
    button.addEventListener("click", () => setTrancheDeployed(Number(button.dataset.tranche), false)));

  // Live distance below all-time high for both halves of the reserve, from the
  // same series Market → Context reads. A tranche is "reached" when EITHER VOO
  // or QQQM is down by its step — the reserve buys both, so a genuine drop in
  // the growth half counts. It is a prompt beside each row, never an automatic
  // trigger; a failed fetch just leaves the rows at "—".
  const drawdownBox = root.querySelector<HTMLElement>("#dipDrawdown");
  void Promise.all([assetDrawdownBelow("VOO"), assetDrawdownBelow("QQQM")]).then(([voo, qqqm]) => {
    if (voo === null && qqqm === null) {
      if (drawdownBox) drawdownBox.textContent = "Price history unavailable — mark tranches by hand.";
      return;
    }
    const worst = Math.max(voo ?? 0, qqqm ?? 0);
    const part = (label: string, value: number | null): string =>
      value === null ? `${label} —` : `${label} <strong>−${value.toFixed(1)}%</strong>`;
    if (drawdownBox) {
      drawdownBox.innerHTML = worst < 0.1
        ? "VOO and QQQM are <strong>at or near their all-time highs</strong> — no tranche is in range."
        : `${part("VOO", voo)} · ${part("QQQM", qqqm)} below their highs.`;
    }
    root.querySelectorAll<HTMLElement>(".dip-status").forEach((cell) => {
      const tranche = state.opportunity.tranches[Number(cell.dataset.tranche)];
      if (!tranche || tranche.deployed) return;
      if (worst >= tranche.drawdown) {
        cell.textContent = "Reached — deploy now";
        cell.classList.add("wu-metric__value--negative");
      } else {
        cell.textContent = `${(tranche.drawdown - worst).toFixed(1)}pp to go`;
      }
    });
  }).catch(() => {
    if (drawdownBox) drawdownBox.textContent = "Could not load price history — mark tranches by hand.";
  });
}
