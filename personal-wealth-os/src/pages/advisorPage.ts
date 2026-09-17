/**
 * Advisor page — rules-based guidance and the dip-buy deployment ladder.
 *
 * The guidance is read straight from AdvisorSnapshot: same recommendations,
 * same canonical order, each carrying its own execution state. The UI ranks
 * nothing and re-words nothing. The first recommendation is the priority and
 * leads the page; the rest are one list whose rows open their full wording.
 *
 * The dip-buy ladder is a record, not a calculator: it lists the reserve's
 * drawdown tranches and marks each against how far VOO and QQQM are below
 * their all-time highs (fetched from the same source Market → Context uses;
 * a tranche is "reached" when either half is down by its step). The user
 * records a tranche as deployed, which moves its amount into the reserve's
 * Used total. Everything persists in state.opportunity. The check is passive
 * — the Dashboard surfaces a reached, undeployed tranche the next time it
 * loads; nothing runs while the app is closed.
 *
 * T-5b layout: desktop is Priority beside the ladder, then the guidance list
 * across the page. A phone reads Priority, guidance, ladder. The disclaimer
 * keeps its wording and sits at the foot.
 */

import type { WealthState, OpportunityTranche } from "../models";
import type { AdvisorRecommendation } from "../models";
import { createId } from "../state";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { getAdvisorSnapshot } from "../advisor";
import { isRecommendationCompleted, markRecommendationDone } from "../actionRecords";
import { assetDrawdownBelow } from "../drawdowns";
import { pageHeader } from "../components/pageHeader";
import { DISCLAIMER_TEXT } from "../components/disclaimer";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

/** The guidance row whose full wording is open, and the ladder step whose controls are. */
let openAdviceId: string | null = null;
let openTranche: number | null = null;

/** A figure without its currency prefix. */
function amountOf(value: number): string {
  return money(value, "").trim();
}

function severityDot(severity: AdvisorRecommendation["severity"]): string {
  return severity === "action" ? "is-alert" : severity === "watch" ? "is-watch" : "";
}

function destinationButton(recommendation: AdvisorRecommendation, primary: boolean): string {
  if (!recommendation.destination) return "";
  // Advice that points at this page (the opportunity reserve) would send the
  // reader nowhere; here it takes them to the part of the page it means.
  if (recommendation.destination === "advisor") {
    return `<button class="wu-btn ${primary ? "wu-btn--primary" : "wu-btn--secondary"} wu-btn--sm advisor-see-ladder" type="button">See the ladder <span class="wu-advisor-arrow" aria-hidden="true"></span></button>`;
  }
  // The recommendation already names where the work happens. Surfacing it
  // means the page tells the user what to do AND how to get there.
  return `<button class="wu-btn ${primary ? "wu-btn--primary" : "wu-btn--secondary"} wu-btn--sm dashboard-nav" type="button" data-page="${escapeHtml(recommendation.destination)}">Go to ${escapeHtml(recommendation.destination.replace(/-/g, " "))}</button>`;
}

function markDoneControl(state: WealthState, recommendation: AdvisorRecommendation): string {
  return isRecommendationCompleted(state, recommendation.id)
    ? `<span class="wu-chip">Completed</span>`
    : `<button class="wu-btn wu-btn--ghost wu-btn--sm advisor-mark-done" type="button" data-recommendation-id="${escapeHtml(recommendation.id)}" data-action-label="${escapeHtml(recommendation.action)}">Mark as done</button>`;
}

function priorityCard(state: WealthState, priority: AdvisorRecommendation | null): string {
  if (!priority) {
    return `<section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-advisor-priority" aria-labelledby="advPriorityLabel">
      <div class="wu-tc__top"><span class="wu-label" id="advPriorityLabel">Priority</span><span class="wu-chip">All clear</span></div>
      <p class="wu-dash__note">Nothing needs action right now. Keep recording so the guidance stays current.</p>
    </section>`;
  }
  const done = isRecommendationCompleted(state, priority.id);
  const chip = done
    ? `<span class="wu-chip">Completed</span>`
    : priority.severity === "action"
      ? `<span class="wu-chip wu-chip--warning">Needs action</span>`
      : priority.severity === "watch"
        ? `<span class="wu-chip wu-chip--warning">Watch</span>`
        : `<span class="wu-chip">On track</span>`;
  return `<section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-advisor-priority" aria-labelledby="advPriorityLabel">
      <div class="wu-tc__top"><span class="wu-label" id="advPriorityLabel">Priority</span>${chip}</div>
      <h3 class="wu-advisor-heading">${escapeHtml(priority.action)}</h3>
      <p class="wu-dash__note">${escapeHtml(priority.fact)}</p>
      <div class="wu-row wu-row--tight wu-dash__actions">${destinationButton(priority, true)}${done ? "" : markDoneControl(state, priority)}</div>
    </section>`;
}

function guidanceRow(state: WealthState, recommendation: AdvisorRecommendation): string {
  const done = isRecommendationCompleted(state, recommendation.id);
  const open = openAdviceId === recommendation.id;
  const value = recommendation.evidence[0]?.value ?? "";
  return `<li class="wu-advice${open ? " is-open" : ""}${done ? " is-done" : ""}" data-recommendation-id="${escapeHtml(recommendation.id)}">
      <button class="wu-advice__row advice-row" type="button" data-advice-id="${escapeHtml(recommendation.id)}" aria-expanded="${open}">
        <i class="wu-advice__dot ${severityDot(recommendation.severity)}" aria-hidden="true"></i>
        <span class="wu-advice__title">${escapeHtml(recommendation.title)}<small>${escapeHtml(recommendation.fact)}</small></span>
        <span class="wu-advice__value">${escapeHtml(value)}${done ? `<small class="t-positive">Done</small>` : ""}</span>
        <span class="wu-advice__chev" aria-hidden="true">›</span>
      </button>
      ${open ? `<div class="wu-advice__detail wu-stack wu-stack--sm">
        <p class="wu-advice__text"><span class="wu-label">What we see</span>${escapeHtml(recommendation.fact)}</p>
        <p class="wu-advice__text"><span class="wu-label">Next step</span>${escapeHtml(recommendation.action)}</p>
        <div class="wu-row wu-row--tight">${destinationButton(recommendation, false)}${markDoneControl(state, recommendation)}</div>
      </div>` : ""}
    </li>`;
}

function trancheRow(tranche: OpportunityTranche, index: number): string {
  const open = openTranche === index;
  const half = tranche.amount / 2;
  return `<li class="wu-step${open ? " is-open" : ""}${tranche.deployed ? " is-deployed" : ""}">
      <button class="wu-step__row dip-row" type="button" data-tranche="${index}" aria-expanded="${open}">
        <b class="wu-step__drop">−${tranche.drawdown}%</b>
        <span class="wu-step__bar" aria-hidden="true"><i class="dip-bar" data-tranche="${index}" style="width:${tranche.deployed ? 100 : 0}%"></i></span>
        <span class="wu-step__amount">${amountOf(tranche.amount)}<small class="dip-status${tranche.deployed ? " t-positive" : ""}" data-tranche="${index}">${tranche.deployed ? "Deployed" : "—"}</small></span>
        <span class="wu-step__chev" aria-hidden="true">›</span>
      </button>
      ${open ? `<div class="wu-step__detail wu-stack wu-stack--sm">
        <p class="wu-dash__note">Deploy ${money(tranche.amount)} when VOO or QQQM is ${tranche.drawdown}% below its high · VOO ${money(half)} / QQQM ${money(half)}. Marking it deployed moves the amount into the reserve's Used total — you decide when you actually buy.</p>
        <div class="wu-row wu-row--tight">${tranche.deployed
          ? `<button class="wu-btn wu-btn--ghost wu-btn--sm dip-undo" data-tranche="${index}" type="button">Undo</button>`
          : `<button class="wu-btn wu-btn--secondary wu-btn--sm dip-deploy" data-tranche="${index}" type="button">Mark deployed</button>`}</div>
      </div>` : ""}
    </li>`;
}

function ladderCard(state: WealthState): string {
  const { opportunity } = state;
  const deployed = opportunity.tranches.filter((tranche) => tranche.deployed).length;
  const split = Object.entries(opportunity.allocation)
    .filter(([, amount]) => amount > 0)
    .map(([ticker, amount]) => `${escapeHtml(ticker)} ${amountOf(amount)}`)
    .join(" · ");
  return `<section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-advisor-ladder" aria-labelledby="advLadderLabel">
      <div class="wu-tc__top"><span class="wu-label" id="advLadderLabel">Dip-buy ladder</span><span class="wu-chip wu-chip--muted">${deployed} / ${opportunity.tranches.length} deployed</span></div>
      <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(opportunity.total - opportunity.used)}</span><span class="wu-money__of">left of ${amountOf(opportunity.total)}</span></p>
      ${opportunity.tranches.length
        ? `<ul class="wu-steps">${opportunity.tranches.map((tranche, index) => trancheRow(tranche, index)).join("")}</ul>`
        : `<p class="wu-empty">No drawdown steps set.</p>`}
      <p class="wu-dash__note wu-dash__actions" id="dipDrawdown">Checking VOO and QQQM against their all-time highs…</p>
      ${split ? `<p class="wu-dash__note">Reserve split: ${split}</p>` : ""}
    </section>`;
}

export function advisorPageTemplate(state: WealthState): string {
  const snapshot = getAdvisorSnapshot(state);
  const priority = snapshot.priority;
  const others = snapshot.recommendations.filter((recommendation) => recommendation.id !== priority?.id);
  return `<div class="wu wu-advisor-page">
    ${pageHeader({
      eyebrow: "Guidance & Scenarios",
      title: "Advisor",
      sub: "What to do next — from the rules you set, not predictions.",
    })}
    <div class="wu-dash">
      ${priorityCard(state, priority)}
      ${ladderCard(state)}
      <!-- Rendered straight from AdvisorSnapshot.recommendations, in canonical
           order, after the priority that leads the page. -->
      <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-advisor-guidance" aria-labelledby="advGuidanceLabel">
        <div class="wu-tc__top"><span class="wu-label" id="advGuidanceLabel">Guidance</span><span class="wu-chip wu-chip--muted">Rules-based</span></div>
        ${others.length
          ? `<ul class="wu-advice-list">${others.map((recommendation) => guidanceRow(state, recommendation)).join("")}</ul>`
          : `<p class="wu-empty">No other guidance right now.</p>`}
      </section>
    </div>
    <p class="wu-dash__note wu-advisor-foot" role="note">${DISCLAIMER_TEXT}</p>
  </div>`;
}

export function bindAdvisor(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  /** Re-render in place, keeping the reader where they were. */
  const repaint = (next: WealthState = state): void => {
    const scrollPosition = { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 };
    rerender(root, next, setState, "advisor", navigate);
    const restore = () => {
      window.scrollTo(scrollPosition.x, scrollPosition.y);
      document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
    };
    restore();
    requestAnimationFrame(restore);
  };

  root.querySelectorAll<HTMLButtonElement>(".advice-row").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.adviceId ?? null;
    openAdviceId = openAdviceId === id ? null : id;
    repaint();
  }));
  root.querySelectorAll<HTMLButtonElement>(".advisor-see-ladder").forEach((button) => button.addEventListener("click", () => {
    const ladder = root.querySelector<HTMLElement>(".wu-advisor-ladder");
    if (!ladder) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ladder.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    ladder.classList.remove("is-flash");
    // Restart the highlight even on a second press.
    void ladder.offsetWidth;
    ladder.classList.add("is-flash");
    window.setTimeout(() => ladder.classList.remove("is-flash"), 1800);
  }));
  root.querySelectorAll<HTMLButtonElement>(".dip-row").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.tranche);
    openTranche = openTranche === index ? null : index;
    repaint();
  }));

  // Mark any recommendation as done — the priority and every row in the list.
  // Persists an ActionRecord only: the recommendation itself is untouched,
  // keeps its ranking, and stays on the page.
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
      repaint(next);
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
    repaint(next);
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
      if (drawdownBox) drawdownBox.textContent = "Price history unavailable — mark steps by hand.";
      return;
    }
    const worst = Math.max(voo ?? 0, qqqm ?? 0);
    const part = (label: string, value: number | null): string =>
      value === null ? `${label} —` : `${label} <strong>−${value.toFixed(1)}%</strong>`;
    if (drawdownBox) {
      drawdownBox.innerHTML = worst < 0.1
        ? "VOO and QQQM are <strong>at or near their all-time highs</strong> — no step is in range."
        : `${part("VOO", voo)} · ${part("QQQM", qqqm)} below their highs.`;
    }
    root.querySelectorAll<HTMLElement>(".dip-status").forEach((cell) => {
      const tranche = state.opportunity.tranches[Number(cell.dataset.tranche)];
      if (!tranche || tranche.deployed) return;
      if (worst >= tranche.drawdown) {
        cell.textContent = "Reached — deploy now";
        cell.classList.add("t-negative");
      } else {
        cell.textContent = `${(tranche.drawdown - worst).toFixed(1)}% away`;
      }
    });
    // How far the market has come toward each step, as a bar.
    root.querySelectorAll<HTMLElement>(".dip-bar").forEach((bar) => {
      const tranche = state.opportunity.tranches[Number(bar.dataset.tranche)];
      if (!tranche || tranche.deployed || tranche.drawdown <= 0) return;
      bar.style.width = `${Math.min(100, (worst / tranche.drawdown) * 100)}%`;
      if (worst >= tranche.drawdown) bar.classList.add("is-reached");
    });
  }).catch(() => {
    if (drawdownBox) drawdownBox.textContent = "Could not load price history — mark steps by hand.";
  });
}
