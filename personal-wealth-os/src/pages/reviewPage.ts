/**
 * Review page — the monthly close and its history.
 *
 * The form is seeded from the canonical snapshot (income, spending and what
 * was actually invested this month) so the user confirms figures rather than
 * recalling them, and the discipline score arrives pre-computed from the same
 * facts.
 */

import type { WealthState } from "../models";
import { createId } from "../state";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { leakInsightStrip } from "../components/leakInsightStrip";
import { pageHeader } from "../components/pageHeader";
import { getFinancialSnapshot, monthlyClose } from "../financialHealth";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

export function reviewTemplate(state: WealthState): string {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const close = monthlyClose(state, month);
  const snapshot = getFinancialSnapshot(state, now);
  const reviewRows = state.reviews.map((review) => {
    return `<div class="wu-card wu-card--inset wu-card--pad-sm">
      <div class="wu-stack wu-stack--sm">
        <div class="wu-row wu-row--between">
          <strong class="t-subheading">${escapeHtml(review.month)}</strong>
          <button class="wu-btn wu-btn--ghost wu-btn--icon delete-review" data-id="${review.id}" type="button" aria-label="Delete review for ${escapeHtml(review.month)}" title="Delete review">&times;</button>
        </div>
        <span class="t-body-sm t-num">Income ${money(review.income)} &middot; Spending ${money(review.spending)} &middot; Score ${review.disciplineScore}/100</span>
        <p class="t-body-sm t-muted">${escapeHtml(review.notes || "No notes")}</p>
      </div>
    </div>`;
  }).join("");

  return `
    <div class="wu">
      ${pageHeader({
        eyebrow: "Monthly Close",
        title: "Monthly Review",
        sub: "Confirm this month's figures, then note what to change.",
      })}
      ${leakInsightStrip(state, ["fee", "duplicate", "subscription", "budget", "goal", "debt"], "Monthly review signal")}
      <div class="wu-grid wu-grid--2">
        <div class="wu-card">
          <div class="wu-card__header">
            <h3 class="wu-card__title t-heading">This month</h3>
            <span class="wu-badge wu-badge--neutral">Discipline</span>
          </div>
          <form id="reviewForm" class="wu-grid wu-grid--2">
            <label class="wu-field-row"><span class="wu-field-row__label">Month</span><input class="wu-field" name="month" type="month" required value="${month}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">DCA Done?</span><select class="wu-field" name="dcaDone"><option value="true"${close.dcaDone ? " selected" : ""}>Yes</option><option value="false"${!close.dcaDone ? " selected" : ""}>No</option></select></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Income MYR</span><input class="wu-field" name="income" type="number" min="0" step="1" value="${snapshot.currentMonthIncome}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Spending MYR</span><input class="wu-field" name="spending" type="number" min="0" step="1" value="${snapshot.currentMonthExpenses}"></label>
            <label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">Discipline Score</span><input class="wu-field" name="disciplineScore" type="number" min="0" step="1" value="${close.disciplineScore}"></label>
            <p class="wu-field-row--wide t-caption t-faint">Calculated from ${money(snapshot.currentMonthIncome)} income, ${money(snapshot.currentMonthExpenses)} spending and ${money(close.dcaInvested)} invested this month.</p>
            <label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">Notes</span><textarea class="wu-field" name="notes" rows="4" placeholder="This month's cash flow, investment discipline, and next month's actions"></textarea></label>
            <div class="wu-row wu-field-row--wide"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save Review</button></div>
          </form>
        </div>
        <div class="wu-card">
          <div class="wu-card__header">
            <h3 class="wu-card__title t-heading">History</h3>
            <span class="wu-badge wu-badge--neutral">${state.reviews.length} months</span>
          </div>
          <div class="wu-stack">${reviewRows || `<p class="wu-empty">No monthly reviews yet.</p>`}</div>
        </div>
      </div>
    </div>
  `;
}

export function bindReview(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  root.querySelector<HTMLFormElement>("#reviewForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next = {
      ...state,
      reviews: [
        {
          id: createId("review"),
          month: String(data.get("month") ?? ""),
          income: Number(data.get("income")) || 0,
          spending: Number(data.get("spending")) || 0,
          dcaDone: String(data.get("dcaDone")) === "true",
          disciplineScore: Number(data.get("disciplineScore")) || 0,
          notes: String(data.get("notes") ?? ""),
        },
        ...state.reviews,
      ],
    };
    setState(next);
    rerender(root, next, setState, "review", navigate);
  });

  // Delete review
  root.querySelectorAll<HTMLButtonElement>(".delete-review").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id || !confirm("Delete this review?")) return;
      const next = { ...state, reviews: state.reviews.filter((r) => r.id !== id) };
      setState(next);
      rerender(root, next, setState, "review", navigate);
    });
  });
}
