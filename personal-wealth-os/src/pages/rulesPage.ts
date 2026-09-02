/**
 * Rules page — the rule cards and the personal notes beneath them.
 *
 * Seven cards are generated from the user's own policy figures rather than
 * stored as prose, so a card never drifts from the rule it describes. Each can
 * be overridden or hidden per user (ruleCardOverrides / hiddenRuleIds), and the
 * override is stored, not the generated text — an edited card keeps its own
 * words while an untouched one keeps following the figures.
 */

import type { RuleCardId, RuleNote, WealthState } from "../models";
import { money, percent, projectedAnnualEmergencyYield } from "../rules";
import { escapeHtml } from "../html";
import { leakInsightStrip } from "../components/leakInsightStrip";
import { pageHeader } from "../components/pageHeader";
import { getBudgetSnapshot } from "../budgetSummary";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

export function rulesTemplate(state: WealthState): string {
  const rulesBudget = getBudgetSnapshot(state);
  const defaultItems: Array<{ id: RuleCardId; title: string; body: string }> = [
    { id: "monthly-cashflow", title: "Monthly Cashflow", body: "💰 " + money(rulesBudget.plannedAllowance) + " allowance, " + money(rulesBudget.plannedSpending) + " basic spending, " + money(rulesBudget.plannedSurplus) + " assignable surplus." },
    { id: "dca-mandate", title: "DCA Mandate", body: "📈 " + money(state.dca.monthly) + " per month. VOO " + percent(state.dca.targets.VOO) + " / QQQM " + percent(state.dca.targets.QQQM) + "." },
    { id: "emergency-fund", title: "Emergency Fund", body: "🛡️ " + money(state.emergency.current) + " / " + money(state.emergency.target) + ". Estimated annual yield: " + money(projectedAnnualEmergencyYield(state)) + "." },
    { id: "opportunity-reserve", title: "Opportunity Reserve", body: "🎯 " + money(state.opportunity.total) + " one-time reserve. Split " + money(state.opportunity.allocation.VOO) + " VOO / " + money(state.opportunity.allocation.QQQM) + " QQQM." },
    { id: "bear-market-deployment", title: "Bear Market Deployment", body: "🐻 -10% deploy MYR 80, -15% deploy MYR 120, -20% deploy MYR 200." },
    { id: "age-stage-policy", title: "Age-stage Policy", body: "👤 At " + state.profile.age + ", growth assets may dominate only while emergency and cashflow rules remain intact." },
    { id: "data-safety", title: "Data Safety", body: "💾 All data is stored locally in this browser. Export JSON before switching browsers or devices." },
  ];
  const items = defaultItems.map((item) => ({ ...item, ...state.ruleCardOverrides[item.id] }));

  const ruleCard = (title: string, body: string, actions: string, editForm = ""): string => `<article class="wu-card rule-card">
    <div class="wu-card__header">
      <span class="wu-label">${escapeHtml(title)}</span>
      <div class="wu-row wu-row--tight">${actions}</div>
    </div>
    <p class="t-body t-prewrap">${escapeHtml(body)}</p>
    ${editForm}
  </article>`;

  const cards = items
    .filter((item) => !state.hiddenRuleIds.includes(item.id))
    .map((item) => ruleCard(
      item.title,
      item.body,
      `<button class="wu-btn wu-btn--secondary wu-btn--sm edit-rule" data-rule-id="${item.id}" type="button" aria-label="Edit ${escapeHtml(item.title)} rule">Edit</button><button class="wu-btn wu-btn--ghost wu-btn--icon delete-rule" data-rule-id="${item.id}" type="button" aria-label="Delete ${escapeHtml(item.title)} rule" title="Delete rule">&times;</button>`,
      `<form class="rule-edit-form wu-stack" data-rule-id="${item.id}" hidden>
        <label class="wu-field-row"><span class="wu-field-row__label">Title</span><input class="wu-field" name="title" maxlength="80" required value="${escapeHtml(item.title)}"></label>
        <label class="wu-field-row"><span class="wu-field-row__label">Content</span><textarea class="wu-field" name="body" maxlength="2000" rows="5" required>${escapeHtml(item.body)}</textarea></label>
        <p class="form-error wu-field-row__error" role="alert"></p>
        <div class="wu-row"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save</button><button class="wu-btn wu-btn--ghost wu-btn--sm cancel-rule-edit" type="button">Cancel</button></div>
      </form>`,
    ));
  if (state.ruleNotesList.length > 0) {
    state.ruleNotesList.forEach((note) => {
      const title = note.title || "Personal Rule Notes";
      cards.push(ruleCard(
        title,
        note.body.trim(),
        `<button class="wu-btn wu-btn--secondary wu-btn--sm edit-rule-notes" data-note-id="${note.id}" type="button" aria-label="Edit ${escapeHtml(title)}">Edit</button><button class="wu-btn wu-btn--ghost wu-btn--icon delete-rule-notes" data-note-id="${note.id}" type="button" aria-label="Delete ${escapeHtml(title)}" title="Delete note">&times;</button>`,
      ));
    });
  } else if (state.ruleNotes.trim()) {
    cards.push(ruleCard(
      state.ruleNoteTitle || "Personal Rule Notes",
      state.ruleNotes.trim(),
      `<button class="wu-btn wu-btn--secondary wu-btn--sm edit-rule-notes" type="button" aria-label="Edit personal rule notes">Edit</button><button class="wu-btn wu-btn--ghost wu-btn--icon delete-rule-notes" type="button" aria-label="Delete personal rule notes" title="Delete rule">&times;</button>`,
    ));
  }
  return `<div class="wu">
    ${pageHeader({
      eyebrow: "Decision Framework",
      title: "Rules",
      sub: "Seven cards generated from your own policy figures, plus any personal notes you add.",
    })}
    ${leakInsightStrip(state, ["debt", "budget", "goal"], "Rule check")}
    <div class="wu-stack wu-stack--lg">
    <div class="wu-grid wu-grid--3">${cards.join("") || `<p class="wu-empty">No rule cards remain. Add personal notes below to create a new rule.</p>`}</div>
    <article class="wu-card">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm"><span class="wu-label">Custom Rules</span><h3 class="wu-card__title t-heading">Rule Notes</h3></div>
        <span class="wu-badge wu-badge--neutral">Up to 5,000 characters</span>
      </div>
      <form id="ruleNotesForm" class="wu-stack">
        <label class="wu-field-row"><span class="wu-field-row__label">Title</span><input class="wu-field" id="ruleNoteTitle" name="ruleNoteTitle" maxlength="80" value="" placeholder="e.g. Monthly Cashflow"></label>
        <label class="wu-field-row"><span class="wu-field-row__label">Add reminders, principles, or action items to your rules</span><textarea class="wu-field" id="ruleNotes" name="ruleNotes" maxlength="5000" rows="8" placeholder="Write your personal rules here..."></textarea></label>
        <div class="wu-row">
          <button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save Notes</button>
          <span id="ruleNotesStatus" class="wu-field-row__error is-ok" role="status"></span>
        </div>
      </form>
    </article>
    </div>
  </div>`;
}

export function bindRules(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const showRules = (next: WealthState, label: string): void => {
    setState(next, label);
    if (navigate) navigate("rules");
    else rerender(root, next, setState, "rules");
  };

  root.querySelectorAll<HTMLButtonElement>(".edit-rule").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest<HTMLElement>(".rule-card")?.querySelector<HTMLFormElement>(".rule-edit-form");
      if (!form) return;
      form.hidden = false;
      button.closest<HTMLElement>(".rule-card")?.classList.add("editing");
      form.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".cancel-rule-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>(".rule-card");
      const form = button.closest<HTMLFormElement>(".rule-edit-form");
      if (form) form.hidden = true;
      card?.classList.remove("editing");
    });
  });

  root.querySelectorAll<HTMLFormElement>(".rule-edit-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const ruleId = form.dataset.ruleId as RuleCardId | undefined;
      const error = form.querySelector<HTMLElement>(".form-error");
      const data = new FormData(form);
      const title = String(data.get("title") ?? "").trim().slice(0, 80);
      const body = String(data.get("body") ?? "").trim().slice(0, 2000);
      if (!ruleId || !title || !body) {
        if (error) error.textContent = "Title and content are required.";
        return;
      }
      showRules({ ...state, ruleCardOverrides: { ...state.ruleCardOverrides, [ruleId]: { title, body } } }, "Edit rule card");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-rule").forEach((button) => {
    button.addEventListener("click", () => {
      const ruleId = button.dataset.ruleId as RuleCardId | undefined;
      if (!ruleId || state.hiddenRuleIds.includes(ruleId) || !confirm("Delete this rule card? A snapshot will be saved first.")) return;
      showRules({ ...state, hiddenRuleIds: [...state.hiddenRuleIds, ruleId] }, "Delete rule card");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-rule-notes").forEach((btn) => {
    btn.addEventListener("click", () => {
      const noteId = btn.dataset.noteId;
      if (!confirm("Delete this rule note? A snapshot will be saved first.")) return;
      if (noteId) {
        const nextNotes = state.ruleNotesList.filter((n) => n.id !== noteId);
        showRules({ ...state, ruleNotesList: nextNotes }, "Delete rule note");
      } else {
        showRules({ ...state, ruleNoteTitle: "", ruleNotes: "" }, "Delete rule notes");
      }
    });
  });

    let editingNoteId: string | null = null;
    let lastUpdatedState: WealthState | null = null;
  root.querySelectorAll<HTMLButtonElement>(".edit-rule-notes").forEach((btn) => {
    btn.addEventListener("click", () => {
      const noteId = btn.dataset.noteId;
      const titleInput = root.querySelector<HTMLInputElement>("#ruleNoteTitle");
      const notesInput = root.querySelector<HTMLTextAreaElement>("#ruleNotes");
      if (noteId) {
        const note = state.ruleNotesList.find((n) => n.id === noteId);
        if (note) {
          if (titleInput) titleInput.value = note.title;
          if (notesInput) notesInput.value = note.body;
          editingNoteId = noteId;
        }
      } else {
        if (titleInput) titleInput.value = state.ruleNoteTitle;
        if (notesInput) notesInput.value = state.ruleNotes;
        editingNoteId = null;
      }
      titleInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      titleInput?.focus({ preventScroll: true });
    });
  });

  root.querySelector<HTMLFormElement>("#ruleNotesForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const title = String(data.get("ruleNoteTitle") ?? "").trim().slice(0, 80);
    const body = String(data.get("ruleNotes") ?? "").slice(0, 5000);
    if (!body.trim()) return;
    // Use lastUpdatedState when available so multiple sequential edits/adds
    // build on the latest persisted list instead of the stale closure `state`.
    const baseState = lastUpdatedState ?? state;
    if (editingNoteId) {
      const nextNotes = baseState.ruleNotesList.map((n) => n.id === editingNoteId ? { ...n, title, body } : n);
      lastUpdatedState = { ...baseState, ruleNotesList: nextNotes };
      setState(lastUpdatedState, "Edit rule note");
    } else {
      const newNote: RuleNote = { id: `rulenote-${Date.now()}-${Math.random().toString(16).slice(2)}`, title, body, createdAt: Date.now() };
      lastUpdatedState = { ...baseState, ruleNotesList: [...baseState.ruleNotesList, newNote] };
      setState(lastUpdatedState, "Add rule note");
    }
    const updatedState = lastUpdatedState ?? state;
    rerender(root, updatedState, setState, "rules", navigate);
  });
}
