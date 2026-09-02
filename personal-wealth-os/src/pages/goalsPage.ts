/**
 * Goals page — progress cards and the inline editor.
 *
 * Every figure on a card (current amount, progress, months to target, linked
 * account) comes from getGoalsSnapshot, the canonical model, so a card cannot
 * disagree with the Dashboard's featured goal. A goal linked to a ledger
 * account shows that account's live balance; an unlinked one tracks a manual
 * number.
 */

import type { WealthState } from "../models";
import { createId } from "../state";
import { money, percent } from "../rules";
import { escapeHtml } from "../html";
import { leakInsightStrip } from "../components/leakInsightStrip";
import { pageHeader } from "../components/pageHeader";
import { getGoalsSnapshot } from "../goalSummary";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

export function goalsTemplate(state: WealthState): string {
  // Goal facts come from the canonical read model.
  const goalCards = getGoalsSnapshot(state).ordered.map((snapshot) => {
    const goal = state.goals[snapshot.index];
    const originalIndex = snapshot.index;
    const current = snapshot.currentAmount;
    const linkedAccount = snapshot.linkedAccountName;
    const ratio = snapshot.progress;
    const months = snapshot.estimatedMonthsToTarget;
    // Three-way pace status: on track, part-way, early.
    const valueTone = ratio >= 0.8 ? " wu-metric__value--positive" : "";
    const barTone = ratio >= 0.8 ? "" : ratio >= 0.4 ? " wu-bar__fill--warning" : " wu-bar__fill--faint";
    const extra = months ? " &middot; " + months + " months" : "";
    const accountLine = linkedAccount
      ? "Linked account: " + escapeHtml(linkedAccount)
      : snapshot.isAccountLinked
        ? "Linked account: Account unavailable"
        : "Progress: Manual";
    return `<article class="wu-card">
      <div class="wu-stack">
        <div class="wu-row wu-row--between">
          <span class="wu-label">${escapeHtml(goal.name)}</span>
          <button class="wu-btn wu-btn--ghost wu-btn--sm edit-goal" data-index="${originalIndex}" type="button">Edit</button>
        </div>
        <div class="wu-stack wu-stack--sm">
          <h3 class="t-heading">${escapeHtml(goal.label)}</h3>
          <span class="wu-metric__value t-num${valueTone}">${percent(ratio)}</span>
          <div class="wu-bar"><span class="wu-bar__fill${barTone}" style="width:${Math.round(ratio * 100)}%"></span></div>
          <span class="wu-label--plain t-caption">${money(current)} / ${money(goal.target)}${extra}</span>
          <span class="wu-label--plain t-caption">${accountLine}</span>
        </div>
        <p class="t-body-sm t-muted">${escapeHtml(goal.note)}</p>
        <div class="goal-edit-form is-hidden" id="goalEdit${originalIndex}">
          <form class="wu-stack goalForm" data-index="${originalIndex}">
            <label class="wu-field-row"><span class="wu-field-row__label">Name</span><input class="wu-field" name="name" type="text" value="${escapeHtml(goal.name)}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Label</span><input class="wu-field" name="label" type="text" value="${escapeHtml(goal.label)}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Current MYR</span><input class="wu-field" name="current" type="number" min="0" step="1" value="${goal.current}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Target MYR</span><input class="wu-field" name="target" type="number" min="0" step="1" value="${goal.target}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Monthly MYR</span><input class="wu-field" name="monthlyContribution" type="number" min="0" step="1" value="${goal.monthlyContribution}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Linked account</span><select class="wu-field" name="accountId"><option value="">Manual progress</option>${state.ledgerAccounts.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === goal.accountId ? " selected" : ""}>${escapeHtml(account.name)}</option>`).join("")}</select></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Note</span><textarea class="wu-field" name="note" rows="2">${escapeHtml(goal.note)}</textarea></label>
            <p class="wu-field-row__error goal-form-error" role="alert" hidden></p>
            <div class="wu-row">
              <button class="wu-btn wu-btn--primary wu-btn--sm save-goal" type="button">Save</button>
              <button class="wu-btn wu-btn--secondary wu-btn--sm cancel-goal-edit" data-index="${originalIndex}" type="button">Cancel</button>
              <button class="wu-btn wu-btn--danger wu-btn--sm delete-goal" data-index="${originalIndex}" type="button">Delete</button>
            </div>
          </form>
        </div>
      </div>
    </article>`;
  }).join("");

  const addGoalCard =
    `<button class="wu-add" id="addGoalBtn" type="button">` +
    `<span class="wu-add__plus" aria-hidden="true">+</span><span>Add Goal</span></button>`;

  const goalsEmptyState = state.goals.length === 0
    ? `<p class="wu-empty">No goals yet. A goal gives a specific amount of money a job &mdash; a trip, a purchase, a buffer &mdash; so surplus stops drifting. Add one to start tracking progress against a target.</p>`
    : "";

  return `
    <div class="wu">
      ${pageHeader({
        eyebrow: "Goal System",
        title: "Goals and Wishlist",
        sub: "Goals do not restrict your life; they give every ringgit a clear direction.",
      })}
      ${leakInsightStrip(state, ["goal"], "Goal pace")}
      ${goalsEmptyState}
      <div class="wu-grid wu-grid--2">
        ${goalCards}
        ${addGoalCard}
      </div>
    </div>
  `;
}

export function bindGoals(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const doNavigate = navigate ?? ((page: string) => rerender(root, state, setState, page, navigate));

  // Edit button toggle
  root.querySelectorAll<HTMLButtonElement>(".edit-goal").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      root.querySelector<HTMLElement>("#goalEdit" + index)?.classList.toggle("is-hidden");
    });
  });

  // Cancel button
  root.querySelectorAll<HTMLButtonElement>(".cancel-goal-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      root.querySelector<HTMLElement>("#goalEdit" + index)?.classList.add("is-hidden");
    });
  });

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
      const name = String(data.get("name") ?? "").trim();
      const label = String(data.get("label") ?? "").trim();
      const current = Number(data.get("current"));
      const target = Number(data.get("target"));
      const monthlyContribution = Number(data.get("monthlyContribution"));
      if (!name || !label) {
        showError("Name and label are required.");
        return;
      }
      if (![current, target, monthlyContribution].every((value) => Number.isFinite(value) && value >= 0)) {
        showError("Current, target, and monthly amounts must be zero or more.");
        return;
      }
      const goals = [...state.goals];
      goals[index] = {
        ...goals[index],
        name,
        label,
        current,
        target,
        monthlyContribution,
        accountId: String(data.get("accountId") ?? "") || undefined,
        note: String(data.get("note") ?? goals[index].note),
      };
      const next = { ...state, goals };
      setState(next, "Updated goal");
      const saved = form.querySelector<HTMLElement>(".goal-form-error");
      if (saved) {
        saved.textContent = "Saved";
        saved.hidden = false;
        saved.classList.add("is-ok");
      }
      rerender(root, next, setState, "goals", navigate);
    };
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
      // here matches what the Goals cards show.
      const overviewGoalId = state.overviewGoalId === state.goals[index]?.id
        ? getGoalsSnapshot({ ...state, goals, overviewGoalId: "" }).featuredGoalId
        : state.overviewGoalId;
      const next = { ...state, goals, overviewGoalId };
      setState(next);
      doNavigate("goals");
    });
  });

  // Add new goal
  root.querySelector<HTMLElement>("#addGoalBtn")?.addEventListener("click", () => {
    const goals = [...state.goals, {
      id: createId("goal"),
      name: "NEW GOAL",
      label: "New Goal",
      current: 0,
      target: 0,
      monthlyContribution: 0,
      note: "",
    }];
    const next = { ...state, goals };
    setState(next);
    doNavigate("goals");
  });
}
