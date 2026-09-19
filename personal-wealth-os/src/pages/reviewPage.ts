/**
 * Review page — the monthly close and its history.
 *
 * The form is seeded from the canonical snapshot (income, spending and what
 * was actually invested this month) so the user confirms figures rather than
 * recalling them, and the discipline score arrives pre-computed from the same
 * facts.
 *
 * T-5c layout: desktop is four figures (this month's income, spending, DCA and
 * the average score with its recent months as bars), then the history as one
 * table. A phone gets this month's card, the score bars and a short history.
 * The form opens behind "Complete review"; each history row opens its note.
 * Scores read out of 10 (see reviewScore.ts).
 */

import type { WealthState } from "../models";
import { createId } from "../state";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import { getFinancialSnapshot, monthlyClose } from "../financialHealth";
import { ledgerMonthTotals } from "../ledgerSummary";
import { formatScore, scoreOutOfTen, upsertReview } from "../reviewScore";
import type { Navigate, RenderApp, Setter } from "./pageTypes";
import { answerPayPrompt, buildCheckins, confirmWeeklyCheck, isoDate, type Checkin, type CheckinBoard } from "../checkins";
import { applyLedgerDraft } from "./ledgerPage";

/** Open/closed state that survives a re-render. */
let reviewFormOpen = false;
let reviewHistoryExpanded = false;
let openReviewId: string | null = null;

/** History rows shown before "See all", and months in the score bars. */
const HISTORY_LIMIT = 5;
const SCORE_MONTHS = 9;

/** A figure without its currency prefix. */
function amountOf(value: number): string {
  return money(value, "").trim();
}

/** "2026-07" → "Jul 2026"; `long` gives "July 2026". */
function monthName(monthKey: string, long = false): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-MY", { month: long ? "long" : "short", year: "numeric" });
}

/*
 * Check-ins (P-6a): payday, the weekly look and the month-end review, at the
 * top of this page. Each due item has one button that does the thing; later
 * items say when they open. The sidebar and the Overview only point here.
 */
function checkinButton(item: Checkin): string {
  if (item.status !== "due") return "";
  if (item.kind === "pay") return `<button class="wu-btn wu-btn--primary wu-btn--sm" type="button" data-checkin-pay="${escapeHtml(item.recurring?.id ?? "")}">Record ${escapeHtml(money(item.recurring?.amount ?? 0))}</button>`;
  if (item.kind === "weekly") return `<button class="wu-btn wu-btn--primary wu-btn--sm" type="button" data-checkin-weekly>Looks right</button><button class="wu-btn wu-btn--ghost wu-btn--sm" type="button" data-checkin-spend>Add missing spending</button>`;
  return `<button class="wu-btn wu-btn--primary wu-btn--sm" type="button" data-checkin-review="${escapeHtml(item.month ?? "")}">Start review</button>`;
}

function checkinsCard(board: CheckinBoard): string {
  if (board.hidden) return "";
  const prompt = board.payPrompt;
  return `<section class="wu-card wu-dash__full wu-checkins" aria-labelledby="checkinsLabel">
      <div class="wu-tc__top"><span class="wu-label" id="checkinsLabel">Check-ins</span><span class="wu-chip${board.dueCount ? " wu-chip--warning" : ""}">${board.dueCount ? `${board.dueCount} due` : "All clear"}</span></div>
      ${prompt ? `<div class="wu-checkins__prompt">
        <p>You recorded ${escapeHtml(money(prompt.amount))} on ${escapeHtml(new Date(prompt.date + "T00:00").toLocaleDateString("en-MY", { day: "numeric", month: "short" }))}. Is ${escapeHtml(prompt.label.toLowerCase())} paid around the ${prompt.dayOfMonth}${prompt.dayOfMonth % 10 === 1 && prompt.dayOfMonth !== 11 ? "st" : prompt.dayOfMonth % 10 === 2 && prompt.dayOfMonth !== 12 ? "nd" : prompt.dayOfMonth % 10 === 3 && prompt.dayOfMonth !== 13 ? "rd" : "th"} every month?</p>
        <div class="wu-row wu-row--tight"><button class="wu-btn wu-btn--primary wu-btn--sm" type="button" data-pay-prompt="yes">Yes, save as monthly income</button><button class="wu-btn wu-btn--ghost wu-btn--sm" type="button" data-pay-prompt="no">It changes</button></div>
      </div>` : ""}
      <ul class="wu-checkins__list">
        ${board.items.map((item) => `<li class="wu-checkin is-${item.status}">
          <span class="wu-checkin__mark" aria-hidden="true">${item.status === "done" ? "✓" : ""}</span>
          <span class="wu-checkin__text"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span>
          <span class="visually-hidden">${item.status === "due" ? "Due now" : item.status === "done" ? "Done" : "Not open yet"}</span>
          <span class="wu-checkin__actions">${checkinButton(item)}</span>
        </li>`).join("")}
      </ul>
    </section>`;
}

export function reviewTemplate(state: WealthState): string {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const close = monthlyClose(state, month);
  const snapshot = getFinancialSnapshot(state, now);
  const reviewed = state.reviews.some((review) => review.month === month);
  // Newest first for reading, whatever order they were saved in.
  const history = [...state.reviews].sort((a, b) => b.month.localeCompare(a.month));
  const recent = history.slice(0, SCORE_MONTHS).reverse();
  const average = recent.length ? recent.reduce((sum, review) => sum + scoreOutOfTen(review.disciplineScore), 0) / recent.length : null;
  const openIndex = history.findIndex((review) => review.id === openReviewId);
  const shown = reviewHistoryExpanded || openIndex >= HISTORY_LIMIT ? history : history.slice(0, HISTORY_LIMIT);

  const statusChip = reviewed
    ? `<span class="wu-chip">Reviewed</span>`
    : `<span class="wu-chip wu-chip--warning">Not reviewed</span>`;
  const dcaText = close.dcaDone ? "Done" : "Not yet";
  const toggleLabel = reviewFormOpen ? "Close" : reviewed ? "Review again" : "Complete review";
  const toggle = (extra: string) => `<button class="wu-btn wu-btn--primary wu-btn--sm review-toggle${extra}" type="button" aria-expanded="${reviewFormOpen}" aria-controls="reviewFormPanel">${toggleLabel}</button>`;

  const bars = recent.length
    ? `<div class="wu-review-bars" role="img" aria-label="Discipline score, last ${recent.length} months">${recent.map((review) => {
      const score = scoreOutOfTen(review.disciplineScore);
      return `<span class="wu-review-bars__month"><i class="${score < 9 ? "is-low" : ""}" style="height:${Math.max(4, score * 10)}%" title="${escapeHtml(monthName(review.month))}: ${formatScore(review.disciplineScore)}/10"></i><small>${escapeHtml(monthName(review.month).slice(0, 3))}</small></span>`;
    }).join("")}</div>`
    : `<p class="wu-dash__note">Complete a review to start the score history.</p>`;

  const historyRows = shown.map((review) => {
    const open = review.id === openReviewId;
    const note = review.notes || "No notes";
    return `<li class="wu-review${open ? " is-open" : ""}">
        <button class="wu-review__row review-row" type="button" data-review-id="${escapeHtml(review.id)}" aria-expanded="${open}">
          <span class="wu-review__month">${escapeHtml(monthName(review.month))}<small>Spent ${amountOf(review.spending)} · ${escapeHtml(note)}</small></span>
          <span class="wu-review__num wu-review__col">${amountOf(review.income)}</span>
          <span class="wu-review__num wu-review__col">${amountOf(review.spending)}</span>
          <span class="wu-review__col ${review.dcaDone ? "t-positive" : "t-faint"}">${review.dcaDone ? "Done" : "Missed"}</span>
          <span class="wu-review__score">${formatScore(review.disciplineScore)}<small>/10</small></span>
          <span class="wu-review__note wu-review__col">${escapeHtml(note)}</span>
          <span class="wu-review__chev" aria-hidden="true">›</span>
        </button>
        ${open ? `<div class="wu-review__detail wu-stack wu-stack--sm">
          <p class="wu-dash__note">${escapeHtml(note)}</p>
          <p class="wu-dash__note">Income ${money(review.income)} · spent ${money(review.spending)} · DCA ${review.dcaDone ? "done" : "missed"} · score ${formatScore(review.disciplineScore)}/10</p>
          <div class="wu-row wu-row--tight"><button class="wu-btn wu-btn--ghost wu-btn--sm delete-review" data-id="${escapeHtml(review.id)}" type="button">Delete review</button></div>
        </div>` : ""}
      </li>`;
  }).join("");

  return `
    <div class="wu wu-review-page">
      ${pageHeader({
        eyebrow: "Monthly Close",
        title: "Monthly Review",
        sub: "Confirm this month's figures, then note what to change.",
        actions: toggle(""),
      })}
      <div class="wu-dash">
        ${checkinsCard(buildCheckins(state))}
        <!-- ROW 1 (desktop) — this month's figures and the score -->
        <div class="wu-dash__full wu-dash__tiles wu-review-tiles">
          <section class="wu-card wu-dash__tile" aria-labelledby="revIncomeLabel">
            <div class="wu-tc__top"><span class="wu-label" id="revIncomeLabel">${escapeHtml(monthName(month, true).split(" ")[0])} income</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(snapshot.currentMonthIncome)}</span></p>
            <p class="wu-dash__note">Recorded so far · ${reviewed ? "reviewed" : "not reviewed yet"}</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="revSpentLabel">
            <div class="wu-tc__top"><span class="wu-label" id="revSpentLabel">${escapeHtml(monthName(month, true).split(" ")[0])} spent</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(snapshot.currentMonthExpenses)}</span></p>
            <p class="wu-dash__note">Recorded so far</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="revDcaLabel">
            <div class="wu-tc__top"><span class="wu-label" id="revDcaLabel">DCA</span>${close.dcaDone ? `<span class="wu-chip">Done</span>` : `<span class="wu-chip wu-chip--warning">Pending</span>`}</div>
            <p class="wu-money wu-money--md"><span>${dcaText}</span></p>
            <p class="wu-dash__note">${amountOf(close.dcaInvested)} of ${amountOf(state.dca.monthly)} invested</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="revScoreLabel">
            <div class="wu-tc__top"><span class="wu-label" id="revScoreLabel">Average score</span></div>
            <p class="wu-money wu-money--md"><span>${average === null ? "--" : formatScore(average)}</span><span class="wu-money__of">/ 10</span></p>
            <p class="wu-dash__note">${recent.length ? `Last ${recent.length} ${recent.length === 1 ? "month" : "months"}` : "No reviews yet"}</p>
            ${recent.length ? bars.replace("wu-review-bars", "wu-review-bars wu-review-bars--mini") : ""}
          </section>
        </div>

        <!-- phone — this month in one card -->
        <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-review-month" aria-labelledby="revMonthLabel">
          <div class="wu-tc__top"><span class="wu-label" id="revMonthLabel">${escapeHtml(monthName(month, true))}</span>${statusChip}</div>
          <div class="wu-three">
            <div><span>Income</span><b>${amountOf(snapshot.currentMonthIncome)}</b></div>
            <div><span>Spent</span><b>${amountOf(snapshot.currentMonthExpenses)}</b></div>
            <div><span>DCA</span><b class="${close.dcaDone ? "t-positive" : ""}">${dcaText}</b></div>
          </div>
          ${toggle(" wu-btn--block")}
        </section>

        <!-- THE FORM — collapsed until asked for -->
        <section class="wu-card wu-dash__full wu-stack wu-review-form" id="reviewFormPanel" aria-labelledby="revFormLabel"${reviewFormOpen ? "" : " hidden"}>
          <div class="wu-tc__top"><span class="wu-label" id="revFormLabel">Complete review</span><button class="wu-btn wu-btn--ghost wu-btn--sm review-close" type="button">Cancel</button></div>
          <form id="reviewForm" class="wu-grid wu-grid--2">
            <label class="wu-field-row"><span class="wu-field-row__label">Month</span><input class="wu-field" name="month" type="month" required value="${month}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">DCA done?</span><select class="wu-field" name="dcaDone"><option value="true"${close.dcaDone ? " selected" : ""}>Yes</option><option value="false"${!close.dcaDone ? " selected" : ""}>No</option></select></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Income MYR</span><input class="wu-field" name="income" type="number" min="0" step="1" value="${snapshot.currentMonthIncome}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Spending MYR</span><input class="wu-field" name="spending" type="number" min="0" step="1" value="${snapshot.currentMonthExpenses}"></label>
            <label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">Discipline score (out of 10)</span><input class="wu-field" name="disciplineScore" type="number" min="0" max="10" step="0.1" value="${scoreOutOfTen(close.disciplineScore)}"></label>
            <p class="wu-field-row--wide t-caption t-faint" id="reviewCalcNote">Calculated from ${money(snapshot.currentMonthIncome)} income, ${money(snapshot.currentMonthExpenses)} spending and ${money(close.dcaInvested)} invested that month.</p>
            <label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">Notes</span><textarea class="wu-field" name="notes" rows="4" placeholder="This month's cash flow, investment discipline, and next month's actions"></textarea></label>
            <div class="wu-row wu-field-row--wide"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save review</button></div>
          </form>
        </section>

        <!-- phone — the score over recent months -->
        <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-review-score" aria-labelledby="revBarsLabel">
          <div class="wu-tc__top"><span class="wu-label" id="revBarsLabel">Discipline score</span>${average === null ? "" : `<span class="wu-chip">Average ${formatScore(average)}</span>`}</div>
          ${bars}
        </section>

        <!-- HISTORY — one table on a desktop, short rows on a phone -->
        <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-review-history" aria-labelledby="revHistoryLabel">
          <div class="wu-tc__top"><span class="wu-label" id="revHistoryLabel">History</span>${history.length ? `<span class="wu-chip wu-chip--muted">${history.length} ${history.length === 1 ? "month" : "months"}</span>` : ""}</div>
          ${history.length
            ? `<div class="wu-review__row wu-review__head" aria-hidden="true"><span>Month</span><span class="wu-review__num">Income</span><span class="wu-review__num">Spent</span><span>DCA</span><span class="wu-review__score">Score</span><span>Note</span><span></span></div>
          <ul class="wu-review-list">${historyRows}</ul>`
            : `<p class="wu-empty">No monthly reviews yet.</p>`}
          ${history.length > HISTORY_LIMIT && openIndex < HISTORY_LIMIT
            ? `<button class="wu-btn wu-btn--ghost wu-btn--sm wu-self-end" id="reviewSeeAll" type="button">${reviewHistoryExpanded ? "Show less" : `See all ${history.length}`}</button>`
            : ""}
        </section>
      </div>
    </div>
  `;
}

export function bindReview(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  /** Re-render in place, keeping the reader where they were. */
  const repaint = (next: WealthState = state, focusId?: string): void => {
    const scrollPosition = { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 };
    rerender(root, next, setState, "review", navigate);
    const restore = () => {
      window.scrollTo(scrollPosition.x, scrollPosition.y);
      document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
    };
    restore();
    requestAnimationFrame(() => {
      restore();
      if (focusId) root.querySelector<HTMLElement>("#" + focusId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  // Check-ins (P-6a).
  const openLedger = (type: "income" | "expense", amount: number, accountId?: string) => {
    const category = type === "income"
      ? state.ledgerCategories.find((item) => item.id === "income-salary") ?? state.ledgerCategories.find((item) => item.type === "income")
      : undefined;
    applyLedgerDraft({
      kind: "ledger", type, amount,
      categoryId: category?.id,
      accountId: accountId ?? state.ledgerAccounts.find((item) => item.id === "account-bank")?.id,
      date: isoDate(new Date()), note: "", unresolved: [], dropped: [],
    });
    if (navigate) navigate("ledger");
    else rerender(root, state, setState, "ledger", navigate);
  };
  root.querySelectorAll<HTMLButtonElement>("[data-checkin-pay]").forEach((button) => button.addEventListener("click", () => {
    const recurring = state.recurringTransactions.find((item) => item.id === button.dataset.checkinPay);
    if (recurring) openLedger("income", recurring.amount, recurring.accountId);
  }));
  root.querySelector<HTMLButtonElement>("[data-checkin-spend]")?.addEventListener("click", () => openLedger("expense", 0));
  root.querySelector<HTMLButtonElement>("[data-checkin-weekly]")?.addEventListener("click", () => {
    const next = confirmWeeklyCheck(state);
    setState(next, "Weekly check");
    repaint(next);
  });
  root.querySelector<HTMLButtonElement>("[data-checkin-review]")?.addEventListener("click", (event) => {
    const month = (event.currentTarget as HTMLButtonElement).dataset.checkinReview ?? "";
    reviewFormOpen = true;
    repaint(state, "reviewFormPanel");
    // Early in a month the review is for the one that just ended: point the
    // form at it, and let its change handler bring in that month's figures.
    const input = root.querySelector<HTMLInputElement>('#reviewForm input[name="month"]');
    if (input && month && input.value !== month) {
      input.value = month;
      input.dispatchEvent(new Event("change"));
    }
  });
  root.querySelectorAll<HTMLButtonElement>("[data-pay-prompt]").forEach((button) => button.addEventListener("click", () => {
    const prompt = buildCheckins(state).payPrompt;
    if (!prompt) return;
    const save = button.dataset.payPrompt === "yes";
    const next = answerPayPrompt(state, prompt, save, createId("recurring"));
    setState(next, save ? "Saved monthly income" : "Payday question answered");
    repaint(next);
  }));

  root.querySelectorAll<HTMLButtonElement>(".review-toggle").forEach((button) => button.addEventListener("click", () => {
    reviewFormOpen = !reviewFormOpen;
    repaint(state, reviewFormOpen ? "reviewFormPanel" : undefined);
  }));
  root.querySelector<HTMLButtonElement>(".review-close")?.addEventListener("click", () => {
    reviewFormOpen = false;
    repaint();
  });
  root.querySelectorAll<HTMLButtonElement>(".review-row").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.reviewId ?? null;
    openReviewId = openReviewId === id ? null : id;
    repaint();
  }));
  root.querySelector<HTMLButtonElement>("#reviewSeeAll")?.addEventListener("click", () => {
    reviewHistoryExpanded = !reviewHistoryExpanded;
    repaint();
  });

  const form = root.querySelector<HTMLFormElement>("#reviewForm");

  // Re-seed Income / Spending / Discipline / DCA from the ledger for whatever
  // month is now selected, so switching months shows that month's recorded
  // figures instead of leaving the current month's on screen.
  form?.querySelector<HTMLInputElement>('input[name="month"]')?.addEventListener("change", (event) => {
    const month = (event.currentTarget as HTMLInputElement).value;
    if (!/^\d{4}-\d{2}$/.test(month) || !form) return;
    const totals = ledgerMonthTotals(state.ledgerTransactions, month);
    const close = monthlyClose(state, month);
    const setNum = (name: string, value: number): void => {
      const field = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (field) field.value = String(value);
    };
    setNum("income", Math.round(totals.income));
    setNum("spending", Math.round(totals.expenses));
    setNum("disciplineScore", scoreOutOfTen(close.disciplineScore));
    const dcaSelect = form.querySelector<HTMLSelectElement>('select[name="dcaDone"]');
    if (dcaSelect) dcaSelect.value = close.dcaDone ? "true" : "false";
    const note = root.querySelector<HTMLElement>("#reviewCalcNote");
    if (note) note.textContent = `Calculated from ${money(totals.income)} income, ${money(totals.expenses)} spending and ${money(close.dcaInvested)} invested that month.`;
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const month = String(data.get("month") ?? "");
    // A month already on record is replaced, after asking, rather than listed twice.
    if (state.reviews.some((review) => review.month === month) && !confirm(`Replace the ${monthName(month, true)} review?`)) return;
    const { reviews } = upsertReview(state.reviews, {
      id: createId("review"),
      month,
      income: Number(data.get("income")) || 0,
      spending: Number(data.get("spending")) || 0,
      dcaDone: String(data.get("dcaDone")) === "true",
      disciplineScore: scoreOutOfTen(Number(data.get("disciplineScore")) || 0),
      notes: String(data.get("notes") ?? ""),
    });
    const next = { ...state, reviews };
    reviewFormOpen = false;
    setState(next);
    repaint(next);
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-review").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id || !confirm("Delete this review?")) return;
      const next = { ...state, reviews: state.reviews.filter((r) => r.id !== id) };
      openReviewId = null;
      setState(next);
      repaint(next);
    });
  });
}
