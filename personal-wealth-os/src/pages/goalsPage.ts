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
import { escapeHtml } from "../html";
import { accountBalances } from "../ledger";
import { pageHeader } from "../components/pageHeader";
import { getGoalsSnapshot, type GoalSnapshot } from "../goalSummary";
import { syncGoalContributionRules } from "../financialRules";
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

/** What the linked account puts in the Current slot, e.g. "28 · from MAE wallet". */
function linkedCurrentText(balance: number, accountName: string): string {
  return `${escapeHtml(amountOf(balance))} · from ${escapeHtml(accountName)}`;
}

function goalEditor(state: WealthState, snapshot: GoalSnapshot): string {
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
        <button class="wu-btn wu-btn--ghost wu-btn--sm wu-goal-danger delete-goal" data-index="${index}" type="button">Delete</button>
        <span class="wu-goal-editor__grow"></span>
        <button class="wu-btn wu-btn--ghost wu-btn--sm cancel-goal-edit" type="button">Cancel</button>
        <button class="wu-btn wu-btn--primary wu-btn--sm save-goal" type="button">Save</button>
      </div>
    </form>`;
}

/** "199 months", with the years beside it once it runs past a year. */
function monthsText(months: number, years: number | null): string {
  const unit = months === 1 ? "month" : "months";
  return years !== null && months >= 12 ? `${months} ${unit} (about ${years} years)` : `${months} ${unit}`;
}

/**
 * What an open goal shows before any editing: its note, and the facts the row
 * has no room for. The form only appears behind Edit, so reading a goal does
 * not mean facing a wall of inputs.
 */
function goalDetails(state: WealthState, snapshot: GoalSnapshot, featured: boolean): string {
  const goal = state.goals[snapshot.index];
  const note = snapshot.note.trim();
  const reach = snapshot.isComplete
    ? "Reached"
    : snapshot.targetAmount <= 0
      ? "Set a target first"
      : snapshot.estimatedMonthsToTarget !== null
        ? `In ${monthsText(snapshot.estimatedMonthsToTarget, snapshot.estimatedYearsToTarget)}`
        : "Not while nothing goes in each month";
  const source = snapshot.linkedAccountName
    ? escapeHtml(snapshot.linkedAccountName)
    : snapshot.isAccountLinked ? "Linked account unavailable" : "Typed in by hand";
  const fact = (label: string, value: string) => `<div class="wu-goal-detail__fact"><dt>${label}</dt><dd>${value}</dd></div>`;
  return `<div class="wu-goal-detail">
      ${note ? `<p class="wu-goal-detail__note">${escapeHtml(note)}</p>` : ""}
      <dl class="wu-goal-detail__facts">
        ${fact("Still to go", `MYR ${amountOf(snapshot.remainingAmount)}`)}
        ${fact("Each month", `MYR ${amountOf(snapshot.monthlyContribution)}`)}
        ${fact("Reaches target", reach)}
        ${fact("Progress from", source)}
      </dl>
      <div class="wu-row wu-row--tight wu-goal-detail__actions">
        ${featured ? "" : `<button class="wu-btn wu-btn--ghost wu-btn--sm feature-goal" data-goal-id="${escapeHtml(goal.id)}" type="button">Show on Dashboard</button>`}
        <span class="wu-goal-editor__grow"></span>
        <button class="wu-btn wu-btn--secondary wu-btn--sm edit-goal" type="button">${note ? "Edit" : "Edit or add a note"}</button>
      </div>
    </div>`;
}

function goalRow(state: WealthState, snapshot: GoalSnapshot, featuredId: string): string {
  const open = openGoalIndex === snapshot.index;
  const featured = snapshot.id === featuredId;
  const ratio = snapshot.progress;
  const pace = snapshot.isComplete
    ? "Done"
    : snapshot.estimatedMonthsToTarget
      ? `${snapshot.estimatedMonthsToTarget} months left`
      : snapshot.targetAmount <= 0 ? "No target yet" : "Nothing put in each month";
  const monthly = snapshot.isComplete
    ? `<span class="t-positive">Done</span>`
    : snapshot.monthlyContribution > 0 ? `+${amountOf(snapshot.monthlyContribution)}` : `<span class="t-faint">0</span>`;
  return `<li class="wu-goal${open ? " is-open" : ""}${snapshot.isComplete ? " is-done" : ""}">
      <button class="wu-goal__row goal-row" type="button" data-index="${snapshot.index}" aria-expanded="${open}">
        <span class="wu-goal__title">${escapeHtml(snapshot.label || snapshot.name)}${featured ? ` <span class="wu-chip wu-chip--muted wu-goal__pin">On Dashboard</span>` : ""}<small>${snapshot.isComplete ? "Complete" : `+${amountOf(snapshot.monthlyContribution)} / mo`} · ${escapeHtml(pace)}</small></span>
        <span class="wu-goal__monthly">${monthly}</span>
        <span class="wu-goal__bar"><span class="wu-bar"><span class="wu-bar__fill" style="width:${Math.round(ratio * 100)}%"></span></span></span>
        <span class="wu-goal__pct">${snapshot.isComplete ? `<span class="wu-chip">Done</span>` : percent(ratio)}</span>
        <span class="wu-goal__amount">${amountOf(snapshot.currentAmount)} / ${amountOf(snapshot.targetAmount)}</span>
        <span class="wu-goal__chev" aria-hidden="true">›</span>
      </button>
      ${open ? (editingGoal ? goalEditor(state, snapshot) : goalDetails(state, snapshot, featured)) : ""}
    </li>`;
}

export function goalsTemplate(state: WealthState): string {
  const goals = getGoalsSnapshot(state);
  // Incomplete first: goals.ordered already puts completed goals last.
  const rows = goals.ordered.map((snapshot) => goalRow(state, snapshot, goals.featuredGoalId)).join("");
  const overall = goals.totalTarget > 0 ? Math.min(1, goals.totalCurrent / goals.totalTarget) : 0;
  const doneGoal = goals.ordered.find((goal) => goal.isComplete);
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
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(goals.totalCurrent)}</span></p>
            <p class="wu-dash__note">${percent(overall)} of all targets</p>
            <div class="wu-bar"><span class="wu-bar__fill" style="width:${Math.round(overall * 100)}%"></span></div>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="goalsTargetLabel">
            <div class="wu-tc__top"><span class="wu-label" id="goalsTargetLabel">All targets</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(goals.totalTarget)}</span></p>
            <p class="wu-dash__note">Across ${state.goals.length} ${state.goals.length === 1 ? "goal" : "goals"}</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="goalsMonthLabel">
            <div class="wu-tc__top"><span class="wu-label" id="goalsMonthLabel">Each month</span></div>
            <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(goals.totalMonthlyContribution)}</span></p>
            <p class="wu-dash__note">Into ${goals.activeCount} open ${goals.activeCount === 1 ? "goal" : "goals"}</p>
          </section>
          <section class="wu-card wu-dash__tile" aria-labelledby="goalsDoneLabel">
            <div class="wu-tc__top"><span class="wu-label" id="goalsDoneLabel">Done</span></div>
            <p class="wu-money wu-money--md"><span>${goals.completedCount}</span><span class="wu-money__of">of ${state.goals.length}</span></p>
            <p class="wu-dash__note">${doneGoal ? escapeHtml(doneGoal.label || doneGoal.name) : "None finished yet"}</p>
          </section>
        </div>

        <!-- phone — overall progress in one card -->
        <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-goals-summary" aria-labelledby="goalsAllLabel">
          <div class="wu-tc__top"><span class="wu-label" id="goalsAllLabel">All goals</span>${goals.completedCount ? `<span class="wu-chip">${goals.completedCount} done</span>` : ""}</div>
          <p class="wu-money"><span>${amountOf(goals.totalCurrent)}</span><span class="wu-money__of">of ${amountOf(goals.totalTarget)} MYR</span></p>
          <div class="wu-bar"><span class="wu-bar__fill" style="width:${Math.round(overall * 100)}%"></span></div>
          <p class="wu-dash__note">Putting away MYR ${amountOf(goals.totalMonthlyContribution)} a month across ${goals.activeCount} open ${goals.activeCount === 1 ? "goal" : "goals"}.</p>
        </section>

        <!-- GOALS — a table on a desktop, rows with a bar on a phone -->
        <section class="wu-card wu-dash__full wu-stack wu-stack--sm wu-goals-list" aria-labelledby="goalsListLabel">
          <div class="wu-tc__top"><span class="wu-label" id="goalsListLabel">Goals · tap one to open</span></div>
          <div class="wu-goal__row wu-goal__head" aria-hidden="true"><span>Goal</span><span>Monthly</span><span>Progress</span><span>%</span><span>Saved</span><span></span></div>
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
