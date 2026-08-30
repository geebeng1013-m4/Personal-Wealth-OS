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
import { escapeHtml, numberInput } from "../html";
import { leakInsightStrip } from "../components/leakInsightStrip";
import { getFinancialSnapshot, monthlyClose } from "../financialHealth";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

export function reviewTemplate(state: WealthState): string {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const close = monthlyClose(state, month);
  const snapshot = getFinancialSnapshot(state, now);
  const reviewRows = state.reviews.map((review) => {
    return '<article class="review-item"><div style="display:flex;justify-content:space-between;align-items:flex-start;"><strong>' + escapeHtml(review.month) + '</strong><button class="icon-button danger delete-review" data-id="' + review.id + '" type="button" aria-label="Delete review for ' + escapeHtml(review.month) + '" title="Delete review">🗑️</button></div><span>Income ' +
      money(review.income) + ' · Spending ' + money(review.spending) + ' · Score ' +
      review.disciplineScore + '/100</span><p>' + escapeHtml(review.notes || "No notes") + '</p></article>';
  }).join("");

  return `
    ${leakInsightStrip(state, ["fee", "duplicate", "subscription", "budget", "goal", "debt"], "Monthly review signal")}
    <div class="terminal-grid">
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Monthly Close</span><h3>Monthly Review</h3></div><span style="color:var(--muted);font-size:12px;">Discipline</span></div>
        <form id="reviewForm" class="form-grid">
          <label>Month<input name="month" type="month" required value="${month}"></label>
          ${numberInput("income", "Income MYR", String(snapshot.currentMonthIncome), "1")}
          ${numberInput("spending", "Spending MYR", String(snapshot.currentMonthExpenses), "1")}
          <label>DCA Done?<select name="dcaDone"><option value="true"${close.dcaDone ? " selected" : ""}>Yes</option><option value="false"${!close.dcaDone ? " selected" : ""}>No</option></select></label>
          ${numberInput("disciplineScore", "Discipline Score", String(close.disciplineScore), "1")}
          <p class="wide-field panel-note">Calculated from ${money(snapshot.currentMonthIncome)} income, ${money(snapshot.currentMonthExpenses)} spending and ${money(close.dcaInvested)} invested this month.</p>
          <label class="wide-field">Notes<textarea name="notes" rows="4" placeholder="This month's cash flow, investment discipline, and next month's actions"></textarea></label>
          <button class="primary-button" type="submit">Save Review</button>
        </form>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Review Log</span><h3>Review History</h3></div><span style="color:var(--muted);font-size:12px;">${state.reviews.length} months</span></div>
        <div class="review-list">${reviewRows || '<p class="empty-state">No monthly reviews yet.</p>'}</div>
      </article>
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
