/**
 * Rules page — the rule list and the personal notes beside it, plus the
 * "How WealthUp works" guide.
 *
 * Seven rules are generated from the user's own policy figures rather than
 * stored as prose, so a rule never drifts from the figures it describes. Each
 * can be overridden or hidden per user (ruleCardOverrides / hiddenRuleIds), and
 * the override is stored, not the generated text — an edited rule keeps its own
 * words while an untouched one keeps following the figures.
 *
 * T-5d layout: one list, "rule · one line · key figure ›", each row opening its
 * full text with Edit and Hide; hidden rules can be shown and restored. Notes
 * are cards beside the list (below it on a phone), edited in place, with the
 * add form behind "+ Add note".
 *
 * The two categories share this page because they answer the same question —
 * what governs a decision here — and because a first-time user needs somewhere
 * to read what the app is for that they can find again later. The guide is
 * authored copy, not state: switching to it changes no data.
 */

import type { RuleCardId, RuleNote, WealthState } from "../models";
import { money, percent, projectedAnnualEmergencyYield } from "../rules";
import { amt, amtIn, escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import { getBudgetSnapshot } from "../budgetSummary";
import { rulesGuideTemplate } from "./rulesGuide";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

/**
 * Which category is showing. Module-level, like the Ledger page's filter, so
 * that editing a rule — which re-renders the page — doesn't bounce the user
 * back to the other tab. It lives until the tab is closed.
 */
let activeCategory: "rules" | "guide" = "rules";
/** The rule whose full text is open, the rule being edited, the note being edited ("new" for the add form), and whether hidden rules are listed. */
let openRuleId: RuleCardId | null = null;
let editingRuleId: RuleCardId | null = null;
let editingNoteId: string | null = null;
let showHiddenRules = false;

/** The id the pre-list single note (ruleNotes / ruleNoteTitle) is edited under. */
const LEGACY_NOTE_ID = "legacy";

interface RuleItem {
  id: RuleCardId;
  title: string;
  body: string;
  /** Quiet second line and the figure on the right, from the live figures. */
  sub: string;
  value: string;
  edited: boolean;
}

/** A figure without its currency prefix. */
function amountOf(value: number): string {
  return money(value, "").trim();
}

/**
 * The seven rules, their text generated from the current figures: every
 * ticker with a target or a reserve share, and the real deployment steps.
 */
function ruleItems(state: WealthState): RuleItem[] {
  const budget = getBudgetSnapshot(state);
  const targets = Object.entries(state.dca.targets)
    .map(([ticker, weight]) => `${escapeHtml(ticker)} ${percent(weight)}`);
  const split = Object.entries(state.opportunity.allocation)
    .filter(([, amount]) => amount > 0)
    .map(([ticker, amount]) => `${money(amount)} ${ticker}`);
  const steps = state.opportunity.tranches;
  const generated: Array<Omit<RuleItem, "edited">> = [
    {
      id: "monthly-cashflow",
      title: "Monthly Cashflow",
      body: `${money(budget.plannedAllowance)} allowance, ${money(budget.plannedSpending)} basic spending, ${money(budget.plannedSurplus)} assignable surplus.`,
      sub: `${amt(amountOf(budget.plannedAllowance))} allowance · ${amt(amountOf(budget.plannedSpending))} basics`,
      value: amt(`${budget.plannedSurplus >= 0 ? "+" : "−"}${amountOf(Math.abs(budget.plannedSurplus))}`),
    },
    {
      id: "dca-mandate",
      title: "DCA Mandate",
      body: `${money(state.dca.monthly)} per month.${targets.length ? ` ${targets.join(" / ")}.` : ""}`,
      sub: targets.join(" · ") || "No targets set",
      value: `${amt(amountOf(state.dca.monthly))} / mo`,
    },
    {
      id: "emergency-fund",
      title: "Emergency Fund",
      body: `${money(state.emergency.current)} / ${money(state.emergency.target)}. Estimated annual yield: ${money(projectedAnnualEmergencyYield(state))}.`,
      sub: `Est. yield ${amt(money(projectedAnnualEmergencyYield(state)))} a year`,
      value: amt(amountOf(state.emergency.current)),
    },
    {
      id: "opportunity-reserve",
      title: "Opportunity Reserve",
      body: `${money(state.opportunity.total)} one-time reserve.${split.length ? ` Split ${split.join(" / ")}.` : ""}`,
      sub: split.length
        ? Object.entries(state.opportunity.allocation).filter(([, amount]) => amount > 0).map(([ticker, amount]) => `${escapeHtml(ticker)} ${amt(amountOf(amount))}`).join(" · ")
        : "Not split yet",
      value: amt(amountOf(state.opportunity.total)),
    },
    {
      id: "bear-market-deployment",
      title: "Bear Market Deployment",
      body: steps.length
        ? `${steps.map((step) => `-${step.drawdown}% deploy ${money(step.amount)}`).join(", ")}.`
        : "No deployment steps set.",
      sub: steps.length ? `Deploy in ${steps.length} ${steps.length === 1 ? "step" : "steps"} as prices fall` : "No steps set",
      value: steps.length ? `−${steps.map((step) => step.drawdown).join("/")}%` : "",
    },
    {
      id: "age-stage-policy",
      title: "Age-stage Policy",
      body: `At ${state.profile.age}, growth assets may dominate only while emergency and cashflow rules remain intact.`,
      sub: "Growth first while the basics hold",
      value: `Age ${state.profile.age}`,
    },
    {
      id: "data-safety",
      title: "Data Safety",
      body: "All data is stored locally in this browser. Export JSON before switching browsers or devices.",
      sub: "Export before switching devices",
      value: "",
    },
  ];
  return generated.map((item) => {
    const override = state.ruleCardOverrides[item.id];
    if (!override) return { ...item, edited: false };
    // An edited rule speaks in its own words; the figure beside it would be
    // the generated one's, so it says "Edited" instead.
    const firstLine = override.body.split("\n").find((line) => line.trim()) ?? "";
    return { ...item, title: override.title, body: override.body, sub: firstLine, value: "Edited", edited: true };
  });
}

/** A note's lines as a numbered list when it has several, or one paragraph. */
function noteBody(body: string): string {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return `<p class="wu-rule-note__text">${amtIn(lines[0] ?? "")}</p>`;
  // Numbering the user typed ("1.", "-", "•") is dropped, since the list numbers itself.
  return `<ol class="wu-rule-note__list">${lines.map((line) => `<li>${amtIn(line.replace(/^(\d+[.)]|[-•*])\s+/, ""))}</li>`).join("")}</ol>`;
}

function noteForm(id: string, title: string, body: string): string {
  const isNew = id === "new";
  return `<form class="wu-stack wu-stack--sm rule-note-form" data-note-id="${escapeHtml(id)}">
      <label class="wu-field-row"><span class="wu-field-row__label">Title</span><input class="wu-field" name="ruleNoteTitle" maxlength="80" value="${escapeHtml(title)}" placeholder="e.g. Investment rules for 2026"></label>
      <label class="wu-field-row"><span class="wu-field-row__label">Note — one reminder per line</span><textarea class="wu-field" name="ruleNotes" maxlength="5000" rows="6" placeholder="Never skip a DCA month.">${escapeHtml(body)}</textarea></label>
      <p class="wu-field-row__error" role="alert"></p>
      <div class="wu-row wu-row--tight">
        <button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">${isNew ? "Add note" : "Save"}</button>
        <button class="wu-btn wu-btn--ghost wu-btn--sm cancel-note-edit" type="button">Cancel</button>
        ${isNew ? "" : `<button class="wu-btn wu-btn--ghost wu-btn--sm wu-rule-danger delete-rule-notes" data-note-id="${escapeHtml(id)}" type="button">Delete note</button>`}
      </div>
    </form>`;
}

function noteCard(id: string, title: string, body: string): string {
  const editing = editingNoteId === id;
  return `<section class="wu-card wu-stack wu-stack--sm wu-rule-note" aria-label="${escapeHtml(title)}">
      <div class="wu-tc__top"><span class="wu-label">${escapeHtml(title)}</span>${editing ? "" : `<button class="wu-btn wu-btn--ghost wu-btn--sm edit-rule-notes" data-note-id="${escapeHtml(id)}" type="button" aria-label="Edit ${escapeHtml(title)}">Edit</button>`}</div>
      ${editing ? noteForm(id, title === "Personal Rule Notes" ? "" : title, body) : noteBody(body)}
    </section>`;
}

export function rulesTemplate(state: WealthState): string {
  const items = ruleItems(state);
  const visible = items.filter((item) => !state.hiddenRuleIds.includes(item.id));
  const hidden = items.filter((item) => state.hiddenRuleIds.includes(item.id));

  /** sub/value are markup when generated, the user's own words when edited. */
  const line = (item: RuleItem, text: string): string => item.edited ? escapeHtml(text) : text;

  const ruleRows = visible.map((item) => {
    const open = openRuleId === item.id;
    const editing = editingRuleId === item.id;
    return `<li class="wu-rule${open ? " is-open" : ""}">
        <button class="wu-rule__row rule-row" type="button" data-rule-id="${item.id}" aria-expanded="${open}">
          <span class="wu-rule__title">${escapeHtml(item.title)}<small>${line(item, item.sub)}</small></span>
          <span class="wu-rule__value${item.edited ? " t-faint" : ""}">${line(item, item.value)}</span>
          <span class="wu-rule__chev" aria-hidden="true">›</span>
        </button>
        ${open ? `<div class="wu-rule__detail wu-stack wu-stack--sm">
          ${editing
            ? `<form class="rule-edit-form wu-stack wu-stack--sm" data-rule-id="${item.id}">
              <label class="wu-field-row"><span class="wu-field-row__label">Title</span><input class="wu-field" name="title" maxlength="80" required value="${escapeHtml(item.title)}"></label>
              <label class="wu-field-row"><span class="wu-field-row__label">Content</span><textarea class="wu-field" name="body" maxlength="2000" rows="5" required>${escapeHtml(item.body)}</textarea></label>
              <p class="form-error wu-field-row__error" role="alert"></p>
              <div class="wu-row wu-row--tight"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save</button><button class="wu-btn wu-btn--ghost wu-btn--sm cancel-rule-edit" type="button">Cancel</button></div>
            </form>`
            : `<p class="wu-dash__note t-prewrap">${amtIn(item.body)}</p>
          <div class="wu-row wu-row--tight">
            <button class="wu-btn wu-btn--secondary wu-btn--sm edit-rule" data-rule-id="${item.id}" type="button">Edit</button>
            <button class="wu-btn wu-btn--ghost wu-btn--sm hide-rule" data-rule-id="${item.id}" type="button">Hide</button>
          </div>`}
        </div>` : ""}
      </li>`;
  }).join("");

  const hiddenBlock = hidden.length
    ? `<div class="wu-rule-hidden">
        <button class="wu-btn wu-btn--ghost wu-btn--sm" id="toggleHiddenRules" type="button" aria-expanded="${showHiddenRules}">${hidden.length} hidden · ${showHiddenRules ? "Hide list" : "Show"}</button>
        ${showHiddenRules ? `<ul class="wu-rule-list">${hidden.map((item) => `<li class="wu-rule"><div class="wu-rule__row wu-rule__row--static"><span class="wu-rule__title t-faint">${escapeHtml(item.title)}<small>${line(item, item.sub)}</small></span><button class="wu-btn wu-btn--secondary wu-btn--sm restore-rule" data-rule-id="${item.id}" type="button">Restore</button></div></li>`).join("")}</ul>` : ""}
      </div>`
    : "";

  const notes: Array<{ id: string; title: string; body: string }> = state.ruleNotesList.length > 0
    ? state.ruleNotesList.map((note) => ({ id: note.id, title: note.title || "Personal Rule Notes", body: note.body.trim() }))
    : state.ruleNotes.trim()
      ? [{ id: LEGACY_NOTE_ID, title: state.ruleNoteTitle || "Personal Rule Notes", body: state.ruleNotes.trim() }]
      : [];

  const addNoteButton = (extra: string) => `<button class="wu-btn wu-btn--secondary wu-btn--sm add-rule-note${extra}" type="button" aria-expanded="${editingNoteId === "new"}">+ Add note</button>`;
  const onRules = activeCategory === "rules";
  const tab = (id: "rules" | "guide", label: string): string =>
    `<button class="wu-segmented__option rules-category${activeCategory === id ? " is-active" : ""}" data-category="${id}" type="button" role="tab" aria-selected="${activeCategory === id}" aria-controls="rulesPanel-${id}">${label}</button>`;

  return `<div class="wu wu-rules-page">
    ${pageHeader({
      eyebrow: "Decision Framework",
      title: "Rules",
      sub: "The plan you've set for yourself.",
      actions: addNoteButton(""),
    })}
    <div class="wu-stack wu-stack--lg">
    <div class="wu-segmented" role="tablist" aria-label="Rules category">
      ${tab("rules", "Your rules")}${tab("guide", "How WealthUp works")}
    </div>

    <div id="rulesPanel-rules" role="tabpanel" class="wu-dash"${onRules ? "" : " hidden"}>
      <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-rules-list" aria-labelledby="rulesPlanLabel">
        <div class="wu-tc__top"><span class="wu-label" id="rulesPlanLabel">Your plan</span><span class="wu-chip wu-chip--muted">${visible.length} ${visible.length === 1 ? "rule" : "rules"}</span></div>
        ${visible.length
          ? `<ul class="wu-rule-list">${ruleRows}</ul>`
          : `<p class="wu-empty">Every rule is hidden. Show them below, or add a note.</p>`}
        ${hiddenBlock}
      </section>
      <div class="wu-dash__half wu-dash__col wu-rules-notes">
        ${editingNoteId === "new" ? `<section class="wu-card wu-stack wu-stack--sm wu-rule-note" aria-labelledby="newNoteLabel"><div class="wu-tc__top"><span class="wu-label" id="newNoteLabel">New note</span></div>${noteForm("new", "", "")}</section>` : ""}
        ${notes.map((note) => noteCard(note.id, note.title, note.body)).join("")}
        ${notes.length === 0 && editingNoteId !== "new"
          ? `<section class="wu-card wu-stack wu-stack--sm wu-rule-note"><div class="wu-tc__top"><span class="wu-label">Notes</span></div><p class="wu-dash__note">No notes yet. Add reminders, principles or action items to keep beside your rules.</p></section>`
          : ""}
        <div class="wu-rules-add-phone">${addNoteButton(" wu-btn--block")}</div>
      </div>
    </div>

    <div id="rulesPanel-guide" role="tabpanel"${onRules ? " hidden" : ""}>${rulesGuideTemplate()}</div>
    </div>
  </div>`;
}

export function bindRules(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  /** Re-render in place, keeping the reader where they were; saves first when there is a change. */
  const repaint = (next?: WealthState, label?: string, focusSelector?: string): void => {
    const scrollPosition = { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 };
    if (next) setState(next, label);
    rerender(root, next ?? state, setState, "rules", navigate);
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

  // Category switch. Shows and hides in place: the guide is static copy.
  root.querySelectorAll<HTMLButtonElement>(".rules-category").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.category === "guide" ? "guide" : "rules";
      if (next === activeCategory) return;
      activeCategory = next;
      root.querySelectorAll<HTMLButtonElement>(".rules-category").forEach((other) => {
        const isActive = other.dataset.category === activeCategory;
        other.classList.toggle("is-active", isActive);
        other.setAttribute("aria-selected", String(isActive));
      });
      const rulesPanel = root.querySelector<HTMLElement>("#rulesPanel-rules");
      const guidePanel = root.querySelector<HTMLElement>("#rulesPanel-guide");
      if (rulesPanel) rulesPanel.hidden = activeCategory !== "rules";
      if (guidePanel) guidePanel.hidden = activeCategory !== "guide";
    });
  });

  // --- Rules --------------------------------------------------------------
  root.querySelectorAll<HTMLButtonElement>(".rule-row").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.ruleId as RuleCardId;
    openRuleId = openRuleId === id ? null : id;
    editingRuleId = null;
    repaint();
  }));
  root.querySelectorAll<HTMLButtonElement>(".edit-rule").forEach((button) => button.addEventListener("click", () => {
    editingRuleId = button.dataset.ruleId as RuleCardId;
    repaint(undefined, undefined, ".rule-edit-form input[name='title']");
  }));
  root.querySelectorAll<HTMLButtonElement>(".cancel-rule-edit").forEach((button) => button.addEventListener("click", () => {
    editingRuleId = null;
    repaint();
  }));
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
      editingRuleId = null;
      repaint({ ...state, ruleCardOverrides: { ...state.ruleCardOverrides, [ruleId]: { title, body } } }, "Edit rule card");
    });
  });
  root.querySelectorAll<HTMLButtonElement>(".hide-rule").forEach((button) => button.addEventListener("click", () => {
    const ruleId = button.dataset.ruleId as RuleCardId | undefined;
    if (!ruleId || state.hiddenRuleIds.includes(ruleId) || !confirm("Hide this rule? You can show it again from the bottom of the list. A snapshot will be saved first.")) return;
    openRuleId = null;
    repaint({ ...state, hiddenRuleIds: [...state.hiddenRuleIds, ruleId] }, "Delete rule card");
  }));
  root.querySelector<HTMLButtonElement>("#toggleHiddenRules")?.addEventListener("click", () => {
    showHiddenRules = !showHiddenRules;
    repaint();
  });
  root.querySelectorAll<HTMLButtonElement>(".restore-rule").forEach((button) => button.addEventListener("click", () => {
    const ruleId = button.dataset.ruleId as RuleCardId | undefined;
    if (!ruleId) return;
    const hiddenRuleIds = state.hiddenRuleIds.filter((id) => id !== ruleId);
    if (hiddenRuleIds.length === 0) showHiddenRules = false;
    repaint({ ...state, hiddenRuleIds }, "Restore rule card");
  }));

  // --- Notes --------------------------------------------------------------
  root.querySelectorAll<HTMLButtonElement>(".add-rule-note").forEach((button) => button.addEventListener("click", () => {
    activeCategory = "rules";
    editingNoteId = editingNoteId === "new" ? null : "new";
    repaint(undefined, undefined, editingNoteId ? ".rule-note-form[data-note-id='new'] textarea" : undefined);
  }));
  root.querySelectorAll<HTMLButtonElement>(".edit-rule-notes").forEach((button) => button.addEventListener("click", () => {
    editingNoteId = button.dataset.noteId ?? null;
    repaint(undefined, undefined, `.rule-note-form[data-note-id='${editingNoteId}'] textarea`);
  }));
  root.querySelectorAll<HTMLButtonElement>(".cancel-note-edit").forEach((button) => button.addEventListener("click", () => {
    editingNoteId = null;
    repaint();
  }));
  root.querySelectorAll<HTMLButtonElement>(".delete-rule-notes").forEach((button) => button.addEventListener("click", () => {
    const noteId = button.dataset.noteId;
    if (!confirm("Delete this rule note? A snapshot will be saved first.")) return;
    editingNoteId = null;
    if (noteId && noteId !== LEGACY_NOTE_ID) {
      repaint({ ...state, ruleNotesList: state.ruleNotesList.filter((note) => note.id !== noteId) }, "Delete rule note");
    } else {
      repaint({ ...state, ruleNoteTitle: "", ruleNotes: "" }, "Delete rule notes");
    }
  }));
  root.querySelectorAll<HTMLFormElement>(".rule-note-form").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const noteId = form.dataset.noteId ?? "new";
    const data = new FormData(form);
    const title = String(data.get("ruleNoteTitle") ?? "").trim().slice(0, 80);
    const body = String(data.get("ruleNotes") ?? "").slice(0, 5000);
    if (!body.trim()) {
      const error = form.querySelector<HTMLElement>(".wu-field-row__error");
      if (error) error.textContent = "Write at least one line.";
      return;
    }
    editingNoteId = null;
    if (noteId === "new") {
      const newNote: RuleNote = { id: `rulenote-${Date.now()}-${Math.random().toString(16).slice(2)}`, title, body, createdAt: Date.now() };
      // The page shows the old single note only while the list is empty, so
      // carry it into the list first — otherwise adding a note would hide it.
      const legacy: RuleNote[] = state.ruleNotesList.length === 0 && state.ruleNotes.trim()
        ? [{ id: `rulenote-legacy-${Date.now()}`, title: state.ruleNoteTitle, body: state.ruleNotes, createdAt: Date.now() - 1 }]
        : [];
      repaint({
        ...state,
        ...(legacy.length ? { ruleNoteTitle: "", ruleNotes: "" } : {}),
        ruleNotesList: [...legacy, ...state.ruleNotesList, newNote],
      }, "Add rule note");
    } else if (noteId === LEGACY_NOTE_ID) {
      repaint({ ...state, ruleNoteTitle: title, ruleNotes: body }, "Edit rule note");
    } else {
      repaint({ ...state, ruleNotesList: state.ruleNotesList.map((note) => note.id === noteId ? { ...note, title, body } : note) }, "Edit rule note");
    }
  }));
}
