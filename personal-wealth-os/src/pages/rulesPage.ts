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
  const cards = items
    .filter((item) => !state.hiddenRuleIds.includes(item.id))
    .map((item) => '<article class="card data-card rule-card"><div class="rule-card-head"><span class="eyebrow">' + escapeHtml(item.title) + '</span><div class="rule-card-actions"><button class="secondary-button edit-rule" data-rule-id="' + item.id + '" type="button" aria-label="Edit ' + escapeHtml(item.title) + ' rule">Edit</button><button class="icon-button danger delete-rule" data-rule-id="' + item.id + '" type="button" aria-label="Delete ' + escapeHtml(item.title) + ' rule" title="Delete rule">X</button></div></div><p style="white-space:pre-wrap;">' + escapeHtml(item.body) + '</p><form class="rule-edit-form" data-rule-id="' + item.id + '" hidden><label>Title<input name="title" maxlength="80" required value="' + escapeHtml(item.title) + '"></label><label>Content<textarea name="body" maxlength="2000" rows="5" required>' + escapeHtml(item.body) + '</textarea></label><p class="form-error" role="alert"></p><div class="rule-form-actions"><button class="primary-button" type="submit">Save</button><button class="secondary-button cancel-rule-edit" type="button">Cancel</button></div></form></article>');
  if (state.ruleNotesList.length > 0) {
    state.ruleNotesList.forEach((note) => {
      const title = note.title || "Personal Rule Notes";
      cards.push('<article class="card data-card rule-card"><div class="rule-card-head"><span class="eyebrow">' + escapeHtml(title) + '</span><div class="rule-card-actions"><button class="secondary-button edit-rule-notes" data-note-id="' + note.id + '" type="button" aria-label="Edit ' + escapeHtml(title) + '">Edit</button><button class="icon-button danger delete-rule-notes" data-note-id="' + note.id + '" type="button" aria-label="Delete ' + escapeHtml(title) + '" title="Delete note">X</button></div></div><p style="white-space:pre-wrap;">' + escapeHtml(note.body.trim()) + '</p></article>');
    });
  } else if (state.ruleNotes.trim()) {
    cards.push('<article class="card data-card rule-card"><div class="rule-card-head"><span class="eyebrow">' + escapeHtml(state.ruleNoteTitle || "Personal Rule Notes") + '</span><div class="rule-card-actions"><button class="secondary-button edit-rule-notes" type="button" aria-label="Edit personal rule notes">Edit</button><button class="icon-button danger delete-rule-notes" type="button" aria-label="Delete personal rule notes" title="Delete rule">X</button></div></div><p style="white-space:pre-wrap;">' + escapeHtml(state.ruleNotes.trim()) + '</p></article>');
  }
  return leakInsightStrip(state, ["debt", "budget", "goal"], "Rule check") + '<div class="three-col-grid">' + (cards.join("") || '<p class="empty-state">No rule cards remain. Add personal notes below to create a new rule.</p>') + '</div>' +
    '<article class="card panel" style="margin-top:16px;">' +
      '<div class="panel-head"><div><span class="eyebrow">Custom Rules</span><h3>Rule Notes</h3></div><span style="color:var(--muted);font-size:12px;">Up to 5,000 characters</span></div>' +
      '<form id="ruleNotesForm">' +
        '<label for="ruleNoteTitle">Title</label>' +
        '<input id="ruleNoteTitle" name="ruleNoteTitle" maxlength="80" value="" placeholder="e.g. Monthly Cashflow">' +
        '<label for="ruleNotes">Add reminders, principles, or action items to your rules</label>' +
        '<textarea id="ruleNotes" name="ruleNotes" maxlength="5000" rows="8" placeholder="Write your personal rules here..."></textarea>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-top:10px;">' +
          '<button class="primary-button" type="submit">Save Notes</button>' +
          '<span id="ruleNotesStatus" role="status" style="color:var(--green);font-size:12px;"></span>' +
        '</div>' +
      '</form>' +
    '</article>';
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
