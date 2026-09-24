/**
 * Goals page — overall progress, one row per goal, and the editor under it.
 *
 * Every figure (current amount, progress, months to target, linked account,
 * totals) comes from getGoalsSnapshot, the canonical model, so a row cannot
 * disagree with the Dashboard's featured goal. A goal linked to a ledger
 * account shows that account's live balance; an unlinked one tracks a manual
 * number.
 *
 * T-6b layout: the financial goal sentence (tap to edit), then desktop's four
 * figures and goal table, or a phone's progress card and goal list. A goal's
 * row opens its editor, which is also where it is chosen for the Dashboard.
 */

import type { WealthState } from "../models";
import { MAX_FINANCIAL_GOAL_CHARS, createId, normalizeFinancialGoal } from "../state";
import { money, percent } from "../rules";
import { amt, escapeHtml } from "../html";
import { accountBalances } from "../ledger";
import { pageHeader } from "../components/pageHeader";
import { getGoalsSnapshot, type GoalSnapshot } from "../goalSummary";
import { syncGoalContributionRules } from "../financialRules";
import { isoDate } from "../checkins";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

/**
 * The open goal row (by state.goals index), whether that goal shows its form
 * instead of its details, and whether the goal sentence is being edited.
 */
let openGoalIndex: number | null = null;
let editingGoal = false;
let editingFinancialGoal = false;

/** A figure without its currency prefix. */
function amountOf(value: number): string {
  return money(value, "").trim();
}

/**
 * The one-sentence financial goal the Overview shows.
 *
 * Written here, beside the goals it gives a direction to, and shown on the
 * Overview — the Overview only displays it, keeping editing out of the page that
 * is meant to be read at a glance. Read as the sentence; tapped to edit.
 */
function financialGoalBlock(state: WealthState): string {
  if (!editingFinancialGoal) {
    return state.financialGoal
      ? `<button class="wu-goal-line wu-goals-goalline financial-goal-edit" type="button" aria-label="My financial goal: ${escapeHtml(state.financialGoal)}. Edit"><span class="wu-goal-line__label">My financial goal · Edit</span><span class="wu-goal-line__text">${escapeHtml(state.financialGoal)}</span></button>`
      : `<button class="wu-goal-line wu-goal-line--empty wu-goals-goalline financial-goal-edit" type="button"><span class="wu-goal-line__label">My financial goal</span><span class="wu-goal-line__text">Write the one sentence you want in front of you every time you open WealthUp.</span></button>`;
  }
  return `<section class="wu-card wu-card--pad-sm wu-financial-goal" aria-labelledby="financialGoalLabel">
    <form class="wu-stack wu-stack--sm" id="financialGoalForm">
      <label class="wu-label" id="financialGoalLabel" for="financialGoalInput">My financial goal</label>
      <p class="t-caption t-muted">One sentence you want in front of you every time you open WealthUp. It shows on the Overview.</p>
      <div class="wu-row wu-row--tight wu-financial-goal__row">
        <input class="wu-field" id="financialGoalInput" name="financialGoal" type="text" maxlength="${MAX_FINANCIAL_GOAL_CHARS}"
          placeholder="e.g. RM80,000 house deposit by 35" value="${escapeHtml(state.financialGoal)}">
        <button class="wu-btn wu-btn--ghost wu-btn--sm financial-goal-cancel" type="button">Cancel</button>
        <button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save</button>
      </div>
    </form>
  </section>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-22" → "22 Sep 2026". Spelled out so every browser shows the same. */
function spentDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1] ?? ""} ${year}`;
}

/** What the linked account puts in the Current slot, e.g. "28 · from MAE wallet". */
function linkedCurrentText(balance: number, accountName: string): string {
  return `${amt(amountOf(balance))} · from ${escapeHtml(accountName)}`;
}

function goalEditor(state: WealthState, snapshot: GoalSnapshot, featured: boolean): string {
  const goal = state.goals[snapshot.index];
  const index = snapshot.index;
  const balances = new Map(accountBalances(state.ledgerTransactions, state.ledgerAccounts).map((item) => [item.account.id, item.balance]));
  // A linked goal's progress is the account balance, so the typed Current
  // number would be ignored; it is only asked for on a manual goal. The input
  // stays in the form (hidden) so saving keeps the stored figure unchanged.
  const linked = Boolean(snapshot.linkedAccountName);
  const accountLine = snapshot.isAccountLinked && !snapshot.linkedAccountName
    ? `<p class="wu-dash__note">Linked account unavailable — progress uses the Current amount below.</p>`
    : "";
  return `<form class="wu-stack wu-stack--sm goalForm wu-goal-editor" data-index="${index}">
      ${accountLine}
      <div class="wu-grid wu-grid--2">
        <label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">Name</span><input class="wu-field" name="label" type="text" value="${escapeHtml(goal.label)}"></label>
        <label class="wu-field-row"><span class="wu-field-row__label">Progress comes from</span><select class="wu-field goal-account" name="accountId"><option value="">Manual — I type it in</option>${state.ledgerAccounts.map((account) => `<option value="${escapeHtml(account.id)}" data-balance="${balances.get(account.id) ?? 0}"${account.id === goal.accountId ? " selected" : ""}>${escapeHtml(account.name)}</option>`).join("")}</select></label>
        <label class="wu-field-row wu-goal-editor__current goal-current-manual"${linked ? " hidden" : ""}><span class="wu-field-row__label">Current MYR</span><input class="wu-field" name="current" type="number" min="0" step="1" value="${goal.current}"></label>
        <div class="wu-field-row wu-goal-editor__current goal-current-linked"${linked ? "" : " hidden"}><span class="wu-field-row__label">Current MYR</span><p class="wu-goal-editor__linked">${linked ? linkedCurrentText(snapshot.currentAmount, snapshot.linkedAccountName ?? "") : ""}</p></div>
        <label class="wu-field-row"><span class="wu-field-row__label">Target MYR</span><input class="wu-field" name="target" type="number" min="0" step="1" value="${goal.target}"></label>
        <label class="wu-field-row"><span class="wu-field-row__label">Monthly MYR</span><input class="wu-field" name="monthlyContribution" type="number" min="0" step="1" value="${goal.monthlyContribution}"></label>
        <label class="wu-field-row wu-field-row--wide"><span class="wu-field-row__label">Note</span><textarea class="wu-field" name="note" rows="2" placeholder="Why this goal matters, or anything to remember">${escapeHtml(goal.note)}</textarea></label>
      </div>
      <p class="wu-field-row__error goal-form-error" role="alert" hidden></p>
      <div class="wu-row wu-row--tight wu-goal-editor__actions">
        ${featured || snapshot.isSpent ? "" : `<button class="wu-btn wu-btn--secondary wu-btn--sm feature-goal" data-goal-id="${escapeHtml(goal.id)}" type="button">Show on Dashboard</button>`}
        <button class="wu-btn wu-btn--ghost wu-btn--sm wu-goal-danger delete-goal" data-index="${index}" type="button">Delete</button>
        <span class="wu-goal-editor__grow"></span>
        <button class="wu-btn wu-btn--ghost wu-btn--sm wu-goal-editor__cancel cancel-goal-edit" type="button">Cancel</button>
        <button class="wu-btn wu-btn--primary wu-btn--sm save-goal" type="button">Save</button>
      </div>
    </form>`;
}

/** How long until the goal is reached at its monthly amount, in words. */
function timeToGoal(snapshot: GoalSnapshot): string {
  if (snapshot.isComplete) return "Reached";
  if (snapshot.targetAmount <= 0) return "Set a target to see when";
  const months = snapshot.estimatedMonthsToTarget;
  if (months === null) return "Add a monthly amount to see when";
  if (months < 12) return `Reach it in <strong>${months} ${months === 1 ? "month" : "months"}</strong>`;
  return `Reach it in <strong>about ${snapshot.estimatedYearsToTarget} years</strong>`;
}

/**
 * The same figure as a table cell for the desktop row: "13 mo".
 *
 * A dash where there is no figure to give — a goal that is done, or one with
 * no target or nothing going in each month, where the Monthly column beside it
 * already shows the 0 that explains the dash.
 */
function timeLeftCell(snapshot: GoalSnapshot): string {
  const dash = `<span class="t-faint">&mdash;</span>`;
  if (snapshot.isSpent || snapshot.isComplete) return dash;
  const months = snapshot.estimatedMonthsToTarget;
  return months ? `${months} mo` : dash;
}

/**
 * What an open goal shows before any editing: its note, how long until it is
 * reached, and an Edit button. The row above already carries the figures, so
 * they are not repeated, and the form only appears behind Edit.
 */
function goalDetails(snapshot: GoalSnapshot): string {
  const note = snapshot.note.trim();
  // A reached goal can be marked done (its money used), so buying the thing it
  // was for does not send it back to 0% when the account empties.
  const status = snapshot.isSpent && snapshot.spentAt
    ? `<p class="wu-goal-detail__eta">Done <strong>${spentDate(snapshot.spentAt)}</strong></p>`
    : `<p class="wu-goal-detail__eta">${timeToGoal(snapshot)}</p>`;
  const spendButton = snapshot.isSpent
    ? `<button class="wu-btn wu-btn--ghost wu-btn--sm undo-goal-spent" data-index="${snapshot.index}" type="button">Undo</button>`
    : snapshot.isComplete
      ? `<button class="wu-btn wu-btn--secondary wu-btn--sm mark-goal-spent" data-index="${snapshot.index}" type="button">Mark as done</button>`
      : "";
  return `<div class="wu-goal-detail">
      ${note ? `<p class="wu-goal-detail__note">${escapeHtml(note)}</p>` : `<p class="wu-goal-detail__note wu-goal-detail__note--empty">No note yet</p>`}
      ${status}
      <div class="wu-goal-detail__actions">
        <button class="wu-btn wu-btn--secondary wu-btn--sm edit-goal" type="button">Edit</button>
        ${spendButton}
      </div>
    </div>`;
}

function goalRow(state: WealthState, snapshot: GoalSnapshot, featuredId: string): string {
  const open = openGoalIndex === snapshot.index;
  const featured = snapshot.id === featuredId;
  const ratio = snapshot.progress;
  // "Done" is kept for a goal marked done; one merely at its target is "Reached".
  const spentLabel = snapshot.isSpent && snapshot.spentAt ? `Done ${spentDate(snapshot.spentAt)}` : "";
  const pace = spentLabel
    ? spentLabel
    : snapshot.isComplete
    ? "Reached"
    : snapshot.estimatedMonthsToTarget
      ? `${snapshot.estimatedMonthsToTarget} months left`
      : snapshot.targetAmount <= 0 ? "No target yet" : "Nothing put in each month";
  // The phone now shows the percentage (or a Reached chip) at the end of the
  // bar, so the caption under the name carries only what that cannot: the pace
  // of an open goal, or the date a finished one was used.
  const caption = spentLabel
    ? escapeHtml(spentLabel)
    : snapshot.isComplete
      ? ""
      : `${amt(`+${amountOf(snapshot.monthlyContribution)}`)} / mo · ${escapeHtml(pace)}`;
  const monthly = snapshot.isSpent
    ? `<span class="t-positive">Done</span>`
    : snapshot.isComplete
    ? `<span class="t-positive">Reached</span>`
    : snapshot.monthlyContribution > 0 ? amt(`+${amountOf(snapshot.monthlyContribution)}`) : `<span class="t-faint">0</span>`;
  return `<li class="wu-goal${open ? " is-open" : ""}${snapshot.isComplete ? " is-done" : ""}">
      <button class="wu-goal__row goal-row" type="button" data-index="${snapshot.index}" aria-expanded="${open}">
        <span class="wu-goal__title">${escapeHtml(snapshot.label || snapshot.name)}${featured ? ` <span class="wu-chip wu-chip--muted wu-goal__pin">On Dashboard</span>` : ""}${caption ? `<small>${caption}</small>` : ""}</span>
        <span class="wu-goal__monthly">${monthly}</span>
        <span class="wu-goal__bar"><span class="wu-bar"><span class="wu-bar__fill" style="width:${Math.round(ratio * 100)}%"></span></span></span>
        <span class="wu-goal__pct">${snapshot.isSpent ? `<span class="wu-chip">Done</span>` : snapshot.isComplete ? `<span class="wu-chip">Reached</span>` : percent(ratio)}</span>
        <span class="wu-goal__left">${timeLeftCell(snapshot)}</span>
        <span class="wu-goal__amount t-amt">${amountOf(snapshot.currentAmount)} / ${amountOf(snapshot.targetAmount)}</span>
        <span class="wu-goal__chev" aria-hidden="true">›</span>
      </button>
      ${open ? (editingGoal ? goalEditor(state, snapshot, featured) : goalDetails(snapshot)) : ""}
    </li>`;
}

export function goalsTemplate(state: WealthState): string {
  const goals = getGoalsSnapshot(state);
  // Incomplete first: goals.ordered already puts completed goals last.
  const rows = goals.ordered.map((snapshot) => goalRow(state, snapshot, goals.featuredGoalId)).join("");
  const overall = goals.totalTarget > 0 ? Math.min(1, goals.totalFunded / goals.totalTarget) : 0;
  // Done counts goals marked done; reached ones are still holding their money.
  const doneCount = goals.doneCount;
  const reachedCount = goals.completedCount - doneCount;
  const doneGoal = goals.ordered.find((goal) => goal.isSpent);
  const addButton = (extra: string) => `<button class="wu-btn ${extra ? "wu-btn--secondary" : "wu-btn--primary"} wu-btn--sm add-goal${extra}" type="button">+ Add goal</button>`;

  return `
    <div class="wu wu-goals-page">
      ${pageHeader({
        eyebrow: "Goal System",
        title: "Goals",
        sub: "What you're saving for, and how close you are.",
        actions: addButton(""),
      })}
      ${financialGoalBlock(state)}
      <div class="wu-dash">
        ${state.goals.length === 0
          ? `<section class="wu-card wu-dash__full wu-stack wu-stack--sm"><p class="wu-empty">No goals yet. A goal gives a specific amount of money a job &mdash; a trip, a purchase, a buffer &mdash; so surplus stops drifting. Add one to start tracking progress against a target.</p>${addButton(" wu-btn--block")}</section>`
          : `
        <!-- ROW 1 (desktop) — four figures -->
        <div class="wu-dash__full wu-dash__tiles wu-goals-tiles">
          <section class="wu-card wu-dash__tile" aria-labelledby="goalsSavedLabel">
            <div class="wu-tc__top"><span class="wu-label" id="goalsSavedLabel">Saved</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span class="t-amt">${amountOf(goals.totalFunded)}</span></p>
            <p class="wu-dash__note">${percent(overall)} of all targets</p>
            <div class="wu-bar"><span class="wu-bar__fill" style="width:${Math.round(overall * 100)}%"></span></div>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="goalsTargetLabel">
            <div class="wu-tc__top"><span class="wu-label" id="goalsTargetLabel">All targets</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span class="t-amt">${amountOf(goals.totalTarget)}</span></p>
            <p class="wu-dash__note">Across ${state.goals.length} ${state.goals.length === 1 ? "goal" : "goals"}</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="goalsMonthLabel">
            <div class="wu-tc__top"><span class="wu-label" id="goalsMonthLabel">Each month</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span class="t-amt">${amountOf(goals.totalMonthlyContribution)}</span></p>
            <p class="wu-dash__note">Into ${goals.activeCount} open ${goals.activeCount === 1 ? "goal" : "goals"}</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="goalsDoneLabel">
            <div class="wu-tc__top"><span class="wu-label" id="goalsDoneLabel">Done</span></div>
            <p class="wu-money wu-money--md"><span>${doneCount}</span><span class="wu-money__of">of ${state.goals.length}</span></p>
            <p class="wu-dash__note">${doneGoal ? escapeHtml(doneGoal.label || doneGoal.name) : reachedCount ? `${reachedCount} reached` : "None finished yet"}</p>
          </section>
        </div>

        <!-- phone — overall progress in one card -->
        <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-goals-summary" aria-labelledby="goalsAllLabel">
          <div class="wu-tc__top"><span class="wu-label" id="goalsAllLabel">All goals</span>${doneCount ? `<span class="wu-chip">${doneCount} done</span>` : reachedCount ? `<span class="wu-chip">${reachedCount} reached</span>` : ""}</div>
          <p class="wu-money"><span class="t-amt">${amountOf(goals.totalFunded)}</span><span class="wu-money__of">of <span class="t-amt">${amountOf(goals.totalTarget)}</span> MYR</span></p>
          <div class="wu-bar"><span class="wu-bar__fill" style="width:${Math.round(overall * 100)}%"></span></div>
          <p class="wu-dash__note">Putting away MYR ${amt(amountOf(goals.totalMonthlyContribution))} a month across ${goals.activeCount} open ${goals.activeCount === 1 ? "goal" : "goals"}.</p>
        </section>

        <!-- GOALS — a table on a desktop, rows with a bar on a phone -->
        <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-goals-list" aria-labelledby="goalsListLabel">
          <div class="wu-tc__top"><span class="wu-label" id="goalsListLabel">Goals · tap one to open</span></div>
          <div class="wu-goal__row wu-goal__head" aria-hidden="true"><span>Goal</span><span>Monthly</span><span>Progress</span><span>%</span><span>Time left</span><span>Saved</span><span></span></div>
          <ul class="wu-goal-list">${rows}</ul>
          ${addButton(" wu-btn--block wu-goals-add-phone")}
        </section>`}
      </div>
    </div>
  `;
}

export function bindGoals(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  /** Re-render in place, keeping the reader where they were; save first when there is a change. */
  const repaint = (next?: WealthState, label?: string, focusSelector?: string): void => {
    const scrollPosition = { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 };
    if (next) setState(next, label);
    rerender(root, next ?? state, setState, "goals", navigate);
    const restore = () => {
      window.scrollTo(scrollPosition.x, scrollPosition.y);
      document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
    };
    restore();
    requestAnimationFrame(() => {
      restore();
      if (focusSelector) {
        const target = root.querySelector<HTMLElement>(focusSelector);
        target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        target?.focus({ preventScroll: true });
      }
    });
  };

  // --- The financial goal sentence ------------------------------------------
  root.querySelectorAll<HTMLButtonElement>(".financial-goal-edit").forEach((button) => button.addEventListener("click", () => {
    editingFinancialGoal = true;
    repaint(undefined, undefined, "#financialGoalInput");
  }));
  root.querySelector<HTMLButtonElement>(".financial-goal-cancel")?.addEventListener("click", () => {
    editingFinancialGoal = false;
    repaint();
  });
  root.querySelector<HTMLFormElement>("#financialGoalForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLInputElement>("#financialGoalInput");
    const financialGoal = normalizeFinancialGoal(input?.value ?? "");
    editingFinancialGoal = false;
    if (financialGoal === state.financialGoal) {
      repaint();
      return;
    }
    repaint({ ...state, financialGoal }, financialGoal ? "Set financial goal" : "Cleared financial goal");
  });

  // --- Goal rows --------------------------------------------------------------
  root.querySelectorAll<HTMLButtonElement>(".goal-row").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.index);
    openGoalIndex = openGoalIndex === index ? null : index;
    editingGoal = false;
    repaint();
  }));
  root.querySelectorAll<HTMLButtonElement>(".edit-goal").forEach((button) => button.addEventListener("click", () => {
    editingGoal = true;
    repaint(undefined, undefined, `.goalForm[data-index="${openGoalIndex}"] input[name="label"]`);
  }));
  // Cancel steps back to the goal's details rather than closing it.
  root.querySelectorAll<HTMLButtonElement>(".cancel-goal-edit").forEach((button) => button.addEventListener("click", () => {
    editingGoal = false;
    repaint();
  }));

  // The goal the Dashboard features, chosen here where the goals are.
  root.querySelectorAll<HTMLButtonElement>(".feature-goal").forEach((button) => button.addEventListener("click", () => {
    const overviewGoalId = button.dataset.goalId ?? "";
    if (!state.goals.some((goal) => goal.id === overviewGoalId)) return;
    repaint({ ...state, overviewGoalId }, "Changed featured Overview goal");
  }));

  // Mark a reached goal as done (its money used), or undo it. Marking records today and the
  // target, so the goal stays complete after the purchase empties its account.
  const setSpent = (button: HTMLButtonElement, spent: boolean): void => {
    const index = Number(button.dataset.index);
    const goal = state.goals[index];
    // Only a reached goal is marked, and only a marked one is undone.
    if (!goal || (spent ? !(goal.target > 0) || typeof goal.spentAt === "string" : typeof goal.spentAt !== "string")) return;
    const { spentAt: _spentAt, spentAmount: _spentAmount, ...unspent } = goal;
    const goals = [...state.goals];
    goals[index] = spent ? { ...unspent, spentAt: isoDate(new Date()), spentAmount: goal.target } : unspent;
    const next = { ...state, goals };
    // A spent goal takes no more money each month; undo brings its rule back.
    next.financialRules = syncGoalContributionRules(next);
    repaint(next, spent ? "Marked goal as done" : "Undid goal done");
  };
  root.querySelectorAll<HTMLButtonElement>(".mark-goal-spent").forEach((button) => button.addEventListener("click", () => setSpent(button, true)));
  root.querySelectorAll<HTMLButtonElement>(".undo-goal-spent").forEach((button) => button.addEventListener("click", () => setSpent(button, false)));

  // Save explicitly on click so the action remains reliable across browsers/PWA shells.
  root.querySelectorAll<HTMLFormElement>(".goalForm").forEach((form) => {
    const saveGoal = (): void => {
      const index = Number(form.dataset.index);
      const error = form.querySelector<HTMLElement>(".goal-form-error");
      const showError = (message: string): void => {
        if (!error) return;
        error.textContent = message;
        error.hidden = false;
      };
      if (!Number.isInteger(index) || index < 0 || index >= state.goals.length) {
        showError("This goal is no longer available. Please refresh the Goals page and try again.");
        return;
      }
      const data = new FormData(form);
      const label = String(data.get("label") ?? "").trim();
      const current = Number(data.get("current"));
      const target = Number(data.get("target"));
      const monthlyContribution = Number(data.get("monthlyContribution"));
      if (!label) {
        showError("Give the goal a name.");
        return;
      }
      if (![current, target, monthlyContribution].every((value) => Number.isFinite(value) && value >= 0)) {
        showError("Current, target, and monthly amounts must be zero or more.");
        return;
      }
      const goals = [...state.goals];
      goals[index] = {
        // goal.name is no longer edited here: it stays as stored, because
        // onboarding recognises its debt goal by that name.
        ...goals[index],
        label,
        current,
        target,
        monthlyContribution,
        accountId: String(data.get("accountId") ?? "") || undefined,
        note: String(data.get("note") ?? goals[index].note),
      };
      const next = { ...state, goals };
      // Each contributing goal has a goal-contribution rule the Advisor reads.
      next.financialRules = syncGoalContributionRules(next);
      // Back to the details, so the saved figures are read straight away.
      editingGoal = false;
      repaint(next, "Updated goal");
    };
    // Switching between manual and an account swaps the Current slot in place.
    const accountSelect = form.querySelector<HTMLSelectElement>(".goal-account");
    accountSelect?.addEventListener("change", () => {
      const option = accountSelect.selectedOptions[0];
      const linked = Boolean(accountSelect.value);
      const manualRow = form.querySelector<HTMLElement>(".goal-current-manual");
      const linkedRow = form.querySelector<HTMLElement>(".goal-current-linked");
      const linkedText = form.querySelector<HTMLElement>(".wu-goal-editor__linked");
      if (manualRow) manualRow.hidden = linked;
      if (linkedRow) linkedRow.hidden = !linked;
      if (linkedText) linkedText.innerHTML = linked ? linkedCurrentText(Number(option?.dataset.balance ?? 0), option?.text ?? "") : "";
    });
    form.querySelector<HTMLButtonElement>(".save-goal")?.addEventListener("click", saveGoal);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveGoal();
    });
  });

  // Delete goal
  root.querySelectorAll<HTMLButtonElement>(".delete-goal").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!confirm("Delete this goal?")) return;
      const goals = state.goals.filter((_, i) => i !== index);
      // Re-pick the featured goal through the canonical model so completion
      // here matches what the Goals rows show.
      const overviewGoalId = state.overviewGoalId === state.goals[index]?.id
        ? getGoalsSnapshot({ ...state, goals, overviewGoalId: "" }).featuredGoalId
        : state.overviewGoalId;
      const next = { ...state, goals, overviewGoalId };
      next.financialRules = syncGoalContributionRules(next);
      openGoalIndex = null;
      editingGoal = false;
      repaint(next);
    });
  });

  // Add a goal: it opens ready to be named, instead of waiting to be found.
  root.querySelectorAll<HTMLButtonElement>(".add-goal").forEach((button) => button.addEventListener("click", () => {
    const goals = [...state.goals, {
      id: createId("goal"),
      name: "New goal",
      label: "New goal",
      current: 0,
      target: 0,
      monthlyContribution: 0,
      note: "",
    }];
    const next = { ...state, goals };
    next.financialRules = syncGoalContributionRules(next);
    openGoalIndex = goals.length - 1;
    editingGoal = true;
    repaint(next, undefined, `.goalForm[data-index="${goals.length - 1}"] input[name="label"]`);
  }));
}
