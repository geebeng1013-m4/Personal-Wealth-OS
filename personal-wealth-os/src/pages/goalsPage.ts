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
import { escapeHtml, numberInput } from "../html";
import { leakInsightStrip } from "../components/leakInsightStrip";
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
    const color = ratio >= 0.8 ? "var(--green)" : ratio >= 0.4 ? "var(--amber)" : "var(--ink)";
    const barColor = ratio >= 0.8 ? "var(--green)" : ratio >= 0.4 ? "var(--amber)" : "var(--blue)";
    const extra = months ? " · " + months + " months" : "";
    return '<article class="card data-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<span class="eyebrow">' + escapeHtml(goal.name) + '</span>' +
        '<button class="edit-goal secondary-button" data-index="' + originalIndex + '" type="button" style="font-size:11px;padding:4px 8px;">Edit</button>' +
      '</div>' +
      '<h3>' + escapeHtml(goal.label) + '</h3>' +
      '<strong style="color:' + color + ';">' + percent(ratio) + '</strong>' +
      '<div class="bar"><span style="width:' + Math.round(ratio * 100) + '%;background:' + barColor + ';"></span></div>' +
      '<small style="color:var(--ink-3);">' + money(current) + ' / ' + money(goal.target) + extra + '</small>' +
      '<small class="goal-account-link" style="color:var(--ink-3);">' + (linkedAccount ? 'Linked account: ' + escapeHtml(linkedAccount) : snapshot.isAccountLinked ? 'Linked account: Account unavailable' : 'Progress: Manual') + '</small>' +
      '<p>' + escapeHtml(goal.note) + '</p>' +
      '<div class="goal-edit-form" id="goalEdit' + originalIndex + '" style="display:none;margin-top:12px;">' +
        '<form class="form-grid goalForm" data-index="' + originalIndex + '">' +
          '<label>Name<input name="name" type="text" value="' + escapeHtml(goal.name) + '"></label>' +
          '<label>Label<input name="label" type="text" value="' + escapeHtml(goal.label) + '"></label>' +
          numberInput("current", "Current MYR", String(goal.current), "1") +
          numberInput("target", "Target MYR", String(goal.target), "1") +
          numberInput("monthlyContribution", "Monthly MYR", String(goal.monthlyContribution), "1") +
          '<label>Linked account<select name="accountId"><option value="">Manual progress</option>' + state.ledgerAccounts.map((account) => '<option value="' + escapeHtml(account.id) + '"' + (account.id === goal.accountId ? ' selected' : '') + '>' + escapeHtml(account.name) + '</option>').join('') + '</select></label>' +
          '<label>Note<textarea name="note" rows="2">' + escapeHtml(goal.note) + '</textarea></label>' +
          '<p class="form-error goal-form-error" role="alert" hidden></p>' +
          '<div style="display:flex;gap:8px;">' +
            '<button class="primary-button save-goal" type="button">Save</button>' +
            '<button class="secondary-button cancel-goal-edit" type="button" data-index="' + originalIndex + '">Cancel</button>' +
            '<button class="danger-button delete-goal" type="button" data-index="' + originalIndex + '">Delete</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
      '</article>';
  }).join("");

  // A real button: the card was previously an <article> with a click handler,
  // so it could not be reached or activated from the keyboard.
  const addGoalCard = '<button class="card data-card" type="button" style="display:flex;align-items:center;justify-content:center;min-height:120px;border-style:dashed;cursor:pointer;width:100%;" id="addGoalBtn">' +
    '<div style="text-align:center;color:var(--ink-3);">' +
      '<div style="font-size:24px;margin-bottom:4px;" aria-hidden="true">+</div>' +
      '<span>Add Goal</span>' +
    '</div>' +
  '</button>';

  // With no goals the page was otherwise blank: no explanation of what a goal
  // is for, and nothing but a dashed card to click.
  const goalsEmptyState = state.goals.length === 0
    ? '<p class="empty-state">No goals yet. A goal gives a specific amount of money a job — a trip, a purchase, a buffer — so surplus stops drifting. Add one to start tracking progress against a target.</p>'
    : "";

  return `
    <div class="section-title"><span class="eyebrow">Goal System</span><h3>Goals and Wishlist</h3><p>Goals do not restrict your life; they give every ringgit a clear direction.</p></div>
    ${leakInsightStrip(state, ["goal"], "Goal pace")}
    ${goalsEmptyState}
    <div class="two-col-grid">
      ${goalCards}
      ${addGoalCard}
    </div>
  `;
}

export function bindGoals(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const doNavigate = navigate ?? ((page: string) => rerender(root, state, setState, page, navigate));

  // Edit button toggle
  root.querySelectorAll<HTMLButtonElement>(".edit-goal").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      const form = root.querySelector<HTMLElement>("#goalEdit" + index);
      if (form) form.style.display = form.style.display === "none" ? "block" : "none";
    });
  });

  // Cancel button
  root.querySelectorAll<HTMLButtonElement>(".cancel-goal-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      const form = root.querySelector<HTMLElement>("#goalEdit" + index);
      if (form) form.style.display = "none";
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
        saved.classList.add("form-success");
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
