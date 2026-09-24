/**
 * The floating assistant — a button in the bottom-right corner and the panel it
 * opens.
 *
 * Mounted once per render by renderApp, outside #pageMount, so it survives a
 * page change: the shell is rebuilt but the widget is rebuilt with it, and its
 * state (see assistantStore) is module-level, so the panel stays open and the
 * history stays put across navigation. That matters most in Record mode, where
 * applying a draft NAVIGATES to another page and the panel has to still be there
 * afterwards to say what happened.
 *
 * The two modes look different because they ARE different:
 *
 *   Ask    — a conversation. Chat bubbles, turns build on each other, and this
 *            visit's turns are sent back to the model as context. Earlier
 *            visits stay on screen, below a divider, but are not sent.
 *   Record — a log. Each entry is one thing the user wanted recorded, shown as a
 *            card with what they said, what it was read as, and what became of
 *            it. Newest first, grouped by day, so past entries can be found.
 *            Each request stands alone; no history is sent to the model.
 *
 * Applying a draft NEVER saves. It navigates and pre-fills; the user presses
 * Save, and every existing validation still runs on the way in.
 */

import type { WealthState } from "../../models";
import { escapeHtml } from "../../html";
import type { Navigate } from "../../pages/pageTypes";
import { applyLedgerDraft } from "../../pages/ledgerPage";
import { knownPlatforms, queueTradePrefill } from "../../pages/portfolioPage";
import { askAssistant, assistantSignedIn } from "./assistantClient";
import { syncAssistantHistoryNow } from "./assistantSync";
import { buildAssistantContext } from "./assistantContext";
import { describeDraft, draftPage, parseAssistantAction } from "./assistantActions";
import { parseAnswerLinks } from "./assistantLinks";
import {
  appendAskMessage,
  askMessages,
  askMessagesThisVisit,
  assistantMode,
  beginRecord,
  beginSending,
  clearHistory,
  dismissNotice,
  endSending,
  findRecordDraft,
  isCurrent,
  isFromThisVisit,
  isPanelOpen,
  isSending,
  noticeDismissed,
  recordEntries,
  setAssistantMode,
  setPanelOpen,
  onAssistantHistoryMerged,
  setShareFigures,
  shareFigures,
  updateRecord,
} from "./assistantStore";
import type { AssistantDraft, AssistantMessage, RecordEntry, RecordStatus } from "./assistantTypes";

/** The proxy accepts at most 20 turns; send the most recent ones. */
const MAX_TURNS_SENT = 20;
const MAX_INPUT_CHARS = 4000;
const COMPOSER_MAX_HEIGHT = 132;

interface WidgetContext {
  root: HTMLElement;
  state: WealthState;
  navigate: Navigate;
  /** The page id behind the panel, re-read on every render. */
  page: string;
}

let ctx: WidgetContext | null = null;
/** Survives a refresh so a half-typed message is not lost to a re-render. */
let composerText = "";
let escapeBound = false;

const ICON_SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.8L18.7 9.7 13.9 11.6 12 16.4 10.1 11.6 5.3 9.7l4.8-1.9Z"/><path d="M18 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h14"/><path d="M13 6l6 6-6 6"/></svg>';

const SUGGESTIONS: Record<"help" | "fill", string[]> = {
  help: [
    "How is my net worth worked out?",
    "What does the emergency fund ratio mean?",
    "Where do I record a broker fee?",
  ],
  fill: [
    "Spent 12.50 on coffee yesterday",
    "Salary 3200 came in today",
    "Bought 500 USD of VOO on moomoo",
  ],
};

/** Label and tone for each outcome in the Record log. */
const STATUS_META: Record<RecordStatus, { label: string; tone: string }> = {
  pending: { label: "Reading", tone: "pending" },
  draft: { label: "Ready", tone: "ready" },
  filled: { label: "Filled in", tone: "done" },
  discarded: { label: "Discarded", tone: "muted" },
  expired: { label: "Not used", tone: "muted" },
  unrecognised: { label: "Not recognised", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
};

function noticeHtml(): string {
  if (noticeDismissed()) return "";
  return `<div class="assistant-notice">
    <p class="assistant-notice__body">Your messages are answered by DeepSeek, whose servers are in China. <strong>Ask</strong> sends no figures unless you switch on “Share my figures”. <strong>Record</strong> sends your category, account and ticker <em>names</em> — never amounts — because filling a form needs them.</p>
    <button class="assistant-notice__ok" type="button" data-assistant-action="dismiss-notice">Got it</button>
  </div>`;
}

function suggestionChips(mode: "help" | "fill"): string {
  return SUGGESTIONS[mode]
    .map((text) => `<button class="assistant-chip" type="button" data-assistant-suggest="${escapeHtml(text)}">${escapeHtml(text)}</button>`)
    .join("");
}

/**
 * The empty log. Ask shows its examples here and only here — once a
 * conversation starts they go away. Record's examples live permanently above
 * the composer instead (see panelHtml), so they are not repeated here.
 */
function emptyStateHtml(mode: "help" | "fill"): string {
  return `<div class="assistant-empty">
    <p class="assistant-empty__title">${mode === "fill" ? "Describe what to record" : "Ask about anything in WealthUp"}</p>
    <p class="assistant-empty__body">${mode === "fill"
      ? "Say it however you like. You will see a draft to check before anything is filled in."
      : "How a figure is worked out, what a page is for, where to record something."}</p>
    ${mode === "help" ? `<div class="assistant-empty__chips">${suggestionChips("help")}</div>` : ""}
  </div>`;
}

// --- Ask: a conversation ---------------------------------------------------

function messageHtml(message: AssistantMessage): string {
  const tone = message.failed ? " assistant-msg--error" : "";
  // Only an answer carries page markers. What the user typed is shown as
  // typed, marker-looking text and all: those are their words, not ours to
  // rewrite. A failed turn holds one of our own error sentences, not the
  // model's, so it has nothing to parse either.
  const { text, links } = message.role === "assistant" && !message.failed
    ? parseAnswerLinks(message.content)
    : { text: message.content, links: [] };
  const buttons = links.length === 0
    ? ""
    : `<div class="assistant-goto">${links
        .map((link) => `<button class="assistant-goto__btn" type="button" data-assistant-go="${escapeHtml(link.page)}">Open ${escapeHtml(link.label)}<span aria-hidden="true"> &rarr;</span></button>`)
        .join("")}</div>`;
  return `<div class="assistant-msg assistant-msg--${message.role}${tone}">`
    + `<div class="assistant-msg__bubble">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`
    + buttons
    + `</div>`;
}

/**
 * Marks where this visit's conversation starts. Everything above it is history
 * the model no longer sees, so the line says so rather than letting a reply
 * that ignores an earlier exchange look like the model forgot.
 */
const NEW_CONVERSATION_DIVIDER = '<div class="assistant-divider" role="separator"><span>New conversation</span></div>';

function askLogHtml(): string {
  const messages = askMessages();
  if (messages.length === 0) return emptyStateHtml("help");

  const firstThisVisit = messages.findIndex(isFromThisVisit);
  const hasEarlier = firstThisVisit !== 0;
  // With earlier history, the divider goes where this visit begins — or at the
  // end, before anything has been sent this visit.
  const cut = firstThisVisit === -1 ? messages.length : firstThisVisit;
  const before = messages.slice(0, cut).map(messageHtml).join("");
  const after = messages.slice(cut).map(messageHtml).join("");

  const thinking = isSending()
    ? '<div class="assistant-msg assistant-msg--assistant"><div class="assistant-msg__bubble assistant-typing"><span></span><span></span><span></span></div></div>'
    : "";
  return before + (hasEarlier ? NEW_CONVERSATION_DIVIDER : "") + after + thinking;
}

// --- Record: a log ---------------------------------------------------------

/** "Today" / "Yesterday" / a written date, for the day separators. */
function dayLabel(at: number, now: Date): string {
  const day = new Date(at);
  const startOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, { day: "numeric", month: "short", year: day.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function clockLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function draftNotesHtml(draft: AssistantDraft): string {
  const notes: string[] = [];
  if (draft.unresolved.length > 0) {
    notes.push(`Could not match ${escapeHtml(draft.unresolved.join(", "))} — left for you to pick.`);
  }
  if (draft.dropped.length > 0) {
    notes.push(`Left ${escapeHtml(draft.dropped.join(", "))} blank — you did not give ${draft.dropped.length > 1 ? "those figures" : "that figure"}, and I will not guess ${draft.dropped.length > 1 ? "them" : "it"}.`);
  }
  return notes.map((text) => `<p class="assistant-rec__warn">${text}</p>`).join("");
}

function recordEntryHtml(entry: RecordEntry): string {
  const meta = STATUS_META[entry.status];
  const target = entry.target === "ledger" ? "Ledger" : entry.target === "portfolio" ? "Portfolio" : "";

  let body = "";
  if (entry.status === "pending") {
    body = '<div class="assistant-typing assistant-rec__typing"><span></span><span></span><span></span></div>';
  } else if (entry.summary) {
    body = `<p class="assistant-rec__summary">${escapeHtml(entry.summary)}</p>`;
    if (target) body += `<p class="assistant-rec__target">→ ${target}</p>`;
  } else if (entry.reason) {
    body = `<p class="assistant-rec__reason">${escapeHtml(entry.reason)}</p>`;
  }

  const draft = entry.status === "draft" && entry.draft ? entry.draft : undefined;
  const notes = draft ? draftNotesHtml(draft) : "";
  const actions = draft
    ? `<p class="assistant-rec__note">Nothing is saved — this only fills the form in.</p>
       <div class="assistant-rec__actions">
         <button class="assistant-btn assistant-btn--primary" type="button" data-assistant-apply="${escapeHtml(entry.id)}">Fill in the form</button>
         <button class="assistant-btn" type="button" data-assistant-dismiss="${escapeHtml(entry.id)}">Discard</button>
       </div>`
    : "";

  return `<article class="assistant-rec assistant-rec--${meta.tone}">
    <header class="assistant-rec__head">
      <span class="assistant-rec__status">${escapeHtml(meta.label)}</span>
      <time class="assistant-rec__time" datetime="${new Date(entry.at).toISOString()}">${escapeHtml(clockLabel(entry.at))}</time>
    </header>
    <p class="assistant-rec__said">${escapeHtml(entry.said)}</p>
    ${body}
    ${notes}
    ${actions}
  </article>`;
}

function recordLogHtml(): string {
  const entries = recordEntries();
  if (entries.length === 0) return emptyStateHtml("fill");

  const now = new Date();
  // Newest first: this is history to scan, not a conversation to read downward.
  const ordered = [...entries].reverse();
  const chunks: string[] = [];
  let currentDay = "";

  for (const entry of ordered) {
    const label = dayLabel(entry.at, now);
    if (label !== currentDay) {
      currentDay = label;
      chunks.push(`<p class="assistant-rec-day">${escapeHtml(label)}</p>`);
    }
    chunks.push(recordEntryHtml(entry));
  }
  return `<div class="assistant-rec-list">${chunks.join("")}</div>`;
}

function logHtml(): string {
  return assistantMode() === "fill" ? recordLogHtml() : askLogHtml();
}

// --- panel -----------------------------------------------------------------

function panelHtml(): string {
  const mode = assistantMode();
  const sending = isSending();
  const tab = (id: "help" | "fill", label: string): string =>
    `<button class="assistant-tab${mode === id ? " is-active" : ""}" type="button" data-assistant-mode="${id}"${mode === id ? ' aria-current="true"' : ""}>${label}</button>`;

  const hasHistory = mode === "fill" ? recordEntries().length > 0 : askMessages().length > 0;
  const figures = mode === "help"
    ? `<label class="assistant-share">
        <input type="checkbox" data-assistant-action="share"${shareFigures() ? " checked" : ""}>
        <span>Share my figures for a specific answer</span>
      </label>`
    : `<p class="assistant-share assistant-share--static">Sends your category and account names to DeepSeek, in China — never amounts.</p>`;

  // Signed out (including demo mode, which never signs in): the assistant is
  // counted and paid for per account, so there is nothing to offer here but
  // the reason. A composer would only produce a 401 on every send.
  if (!assistantSignedIn()) {
    // No mode tabs here: switching between Ask and Record would change nothing
    // on screen, and a control that does nothing is worse than no control.
    return `<div class="assistant-panel wu-glass wu-glass--sheet" id="assistantPanel" role="dialog" aria-label="WealthUp assistant" aria-modal="false">
    <header class="assistant-head">
      <p class="assistant-head__title">Assistant</p>
      <div class="assistant-head__actions">
        <button class="assistant-icon-btn assistant-icon-btn--glyph" type="button" data-assistant-action="close" aria-label="Close assistant">${ICON_CLOSE}</button>
      </div>
    </header>
    <div class="assistant-log" id="assistantLog" aria-live="polite">
      <div class="assistant-empty">
        <p class="assistant-empty__title">Available once you sign in</p>
        <p class="assistant-empty__body">The assistant answers from your own figures and has its own daily allowance, so it needs an account. Everything else in WealthUp works as usual.</p>
      </div>
    </div>
  </div>`;
  }

  return `<div class="assistant-panel wu-glass wu-glass--sheet" id="assistantPanel" role="dialog" aria-label="WealthUp assistant" aria-modal="false">
    <header class="assistant-head">
      <div class="assistant-tabs" role="group" aria-label="Assistant mode">${tab("help", "Ask")}${tab("fill", "Record")}</div>
      <div class="assistant-head__actions">
        ${hasHistory ? `<button class="assistant-icon-btn" type="button" data-assistant-action="clear" aria-label="Clear ${mode === "fill" ? "record history" : "conversation"}">Clear</button>` : ""}
        <button class="assistant-icon-btn assistant-icon-btn--glyph" type="button" data-assistant-action="close" aria-label="Close assistant">${ICON_CLOSE}</button>
      </div>
    </header>
    ${noticeHtml()}
    <div class="assistant-log${mode === "fill" ? " assistant-log--records" : ""}" id="assistantLog" aria-live="polite">${logHtml()}</div>
    <div class="assistant-foot">
      ${mode === "fill" ? `<div class="assistant-prompts" aria-label="Examples">${suggestionChips("fill")}</div>` : ""}
      ${figures}
      <form class="assistant-composer" id="assistantComposer">
        <textarea class="assistant-input" id="assistantInput" rows="1" maxlength="${MAX_INPUT_CHARS}"
          placeholder="${mode === "fill" ? "e.g. Spent 30 on groceries today" : "Ask a question"}"
          aria-label="Message"${sending ? " disabled" : ""}>${escapeHtml(composerText)}</textarea>
        <button class="assistant-send" type="submit" aria-label="Send"${sending || composerText.trim().length === 0 ? " disabled" : ""}>${ICON_SEND}</button>
      </form>
      <p class="assistant-disclaimer">Answers can be wrong. Check anything before you act on it.</p>
    </div>
  </div>`;
}

/** The whole widget, for shellTemplate. */
export function assistantTemplate(): string {
  const open = isPanelOpen();
  return `<div class="assistant${open ? " is-open" : ""}" id="assistant">
    ${open ? panelHtml() : ""}
    <button class="assistant-fab wu-glass wu-glass--tint wu-glass--press" id="assistantFab" type="button"
      aria-expanded="${open ? "true" : "false"}" aria-controls="assistantPanel"
      aria-label="${open ? "Close assistant" : "Open assistant"}">
      <span class="assistant-fab__icon" aria-hidden="true">${open ? ICON_CLOSE : ICON_SPARK}</span>
    </button>
  </div>`;
}

/**
 * History from another device arrived. The panel is rebuilt as usual — the
 * draft being typed survives in composerText — and if the user was typing,
 * the caret goes back to the end of it so the rebuild does not interrupt them.
 */
function refreshAfterMerge(): void {
  if (!isPanelOpen()) return;
  const typing = document.activeElement?.id === "assistantInput";
  refresh();
  if (!typing) return;
  const input = ctx?.root.querySelector<HTMLTextAreaElement>("#assistantInput");
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function refresh(): void {
  const host = ctx?.root.querySelector<HTMLElement>("#assistant");
  if (!host) return;
  host.outerHTML = assistantTemplate();
  bind();
  scrollLogToNewest();
}

/**
 * Put the newest thing in view.
 *
 * Ask reads downward, so that is the bottom. The Record log is newest-first, so
 * it is the top.
 */
function scrollLogToNewest(): void {
  const log = ctx?.root.querySelector<HTMLElement>("#assistantLog");
  if (!log) return;
  log.scrollTop = assistantMode() === "fill" ? 0 : log.scrollHeight;
}

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  const needed = input.scrollHeight;
  input.style.height = `${Math.min(needed, COMPOSER_MAX_HEIGHT)}px`;
  // Only a capped field may scroll; see the note in assistant.css.
  input.style.overflowY = needed > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
}

// --- sending ---------------------------------------------------------------

async function sendAsk(text: string): Promise<void> {
  const context = ctx;
  if (!context) return;

  appendAskMessage({ role: "user", content: text });
  const controller = beginSending();
  refresh();

  const contextText = buildAssistantContext(context.state, new Date(), {
    mode: "help",
    shareFigures: shareFigures(),
    platforms: knownPlatforms(context.state),
    page: context.page,
  });
  // Only this visit's turns: earlier visits stay on screen but are never sent
  // again (see visitId in assistantStore). A failed turn holds an error
  // sentence, not something the model said — sending it back would have the
  // model explaining our own error messages.
  const history = askMessagesThisVisit()
    .filter((message) => !message.failed)
    .slice(-MAX_TURNS_SENT)
    .map(({ role, content }) => ({ role, content }));

  const result = await askAssistant({ messages: history, mode: "help", context: contextText }, controller.signal);
  if (!isCurrent(controller)) return;
  endSending(controller);

  appendAskMessage(result.ok
    ? { role: "assistant", content: result.reply }
    : { role: "assistant", content: result.error, failed: true });
  refresh();
}

async function sendRecord(text: string): Promise<void> {
  const context = ctx;
  if (!context) return;

  const entry = beginRecord(text);
  const controller = beginSending();
  refresh();

  const now = new Date();
  const contextText = buildAssistantContext(context.state, now, {
    mode: "fill",
    shareFigures: shareFigures(),
    platforms: knownPlatforms(context.state),
  });

  // One request, one record: no history is sent. Each entry stands alone, and
  // nothing about an earlier entry should colour how this one is read.
  const result = await askAssistant(
    { messages: [{ role: "user", content: text }], mode: "fill", context: contextText },
    controller.signal,
  );
  if (!isCurrent(controller)) return;
  endSending(controller);

  if (!result.ok) {
    updateRecord(entry.id, { status: "failed", reason: result.error });
  } else {
    // ctx.state, not the value captured above: a save may have landed while the
    // request was in flight, and the draft must resolve against what is true now.
    const live = ctx?.state ?? context.state;
    const parsed = parseAssistantAction({
      reply: result.reply,
      // The user's own words, so every figure the model proposes can be checked
      // against something they actually said.
      sourceText: text,
      state: live,
      now: new Date(),
      platforms: knownPlatforms(live),
    });
    if (parsed.ok) {
      updateRecord(entry.id, {
        status: "draft",
        draft: parsed.draft,
        summary: describeDraft(parsed.draft),
        target: draftPage(parsed.draft),
      });
    } else {
      updateRecord(entry.id, { status: "unrecognised", reason: parsed.reason });
    }
  }
  refresh();
}

function send(): void {
  const text = composerText.trim();
  if (text.length === 0 || isSending() || !ctx) return;
  composerText = "";
  void (assistantMode() === "fill" ? sendRecord(text) : sendAsk(text));
}

function applyDraft(entryId: string): void {
  const context = ctx;
  if (!context) return;
  const draft = findRecordDraft(entryId);
  if (!draft) return;

  if (draft.kind === "ledger") {
    applyLedgerDraft(draft);
  } else {
    queueTradePrefill(draft);
  }
  // The draft is dropped as it is used, so the same entry cannot fill a form
  // twice — the log keeps what it was, not the ability to repeat it.
  updateRecord(entryId, { status: "filled", draft: undefined });
  // Navigating rebuilds the shell, which re-mounts this widget from module
  // state — so the panel stays open, showing the entry now marked "Filled in".
  context.navigate(draftPage(draft));
}

// --- binding ---------------------------------------------------------------

function bind(): void {
  const context = ctx;
  if (!context) return;
  const root = context.root;

  root.querySelector<HTMLButtonElement>("#assistantFab")?.addEventListener("click", () => {
    setPanelOpen(!isPanelOpen());
    refresh();
    if (isPanelOpen()) {
      root.querySelector<HTMLTextAreaElement>("#assistantInput")?.focus();
      // Pick up what the account's other devices added since sign-in.
      void syncAssistantHistoryNow();
    }
  });

  root.querySelectorAll<HTMLButtonElement>("[data-assistant-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.assistantMode === "fill" ? "fill" : "help";
      if (mode === assistantMode()) return;
      setAssistantMode(mode);
      refresh();
    });
  });

  root.querySelectorAll<HTMLElement>("[data-assistant-action]").forEach((element) => {
    const action = element.dataset.assistantAction;
    if (action === "share") {
      element.addEventListener("change", (event) => {
        setShareFigures((event.currentTarget as HTMLInputElement).checked);
      });
      return;
    }
    element.addEventListener("click", () => {
      if (action === "close") setPanelOpen(false);
      else if (action === "clear") clearHistory(assistantMode());
      else if (action === "dismiss-notice") dismissNotice();
      refresh();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-assistant-suggest]").forEach((button) => {
    button.addEventListener("click", () => {
      composerText = button.dataset.assistantSuggest ?? "";
      refresh();
      const input = root.querySelector<HTMLTextAreaElement>("#assistantInput");
      if (input) {
        input.focus();
        autoGrow(input);
      }
    });
  });

  // The Record examples row scrolls sideways. A touch swipe or trackpad does
  // that natively, but a plain mouse wheel only moves vertically — translate it,
  // and only while the row actually has more to show, so the wheel still
  // scrolls the page once the row is at either end.
  root.querySelector<HTMLElement>(".assistant-prompts")?.addEventListener("wheel", (event) => {
    const row = event.currentTarget as HTMLElement;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const max = row.scrollWidth - row.clientWidth;
    if (max <= 0) return;
    const atStart = row.scrollLeft <= 0 && event.deltaY < 0;
    const atEnd = row.scrollLeft >= max - 1 && event.deltaY > 0;
    if (atStart || atEnd) return;
    event.preventDefault();
    row.scrollLeft += event.deltaY;
  }, { passive: false });

  root.querySelectorAll<HTMLButtonElement>("[data-assistant-go]").forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.assistantGo ?? "";
      // The panel survives a page change by design (see the module comment),
      // so the answer is still on screen to read once they arrive.
      if (page) ctx?.navigate(page);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-assistant-apply]").forEach((button) => {
    button.addEventListener("click", () => applyDraft(button.dataset.assistantApply ?? ""));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-assistant-dismiss]").forEach((button) => {
    button.addEventListener("click", () => {
      updateRecord(button.dataset.assistantDismiss ?? "", { status: "discarded", draft: undefined });
      refresh();
    });
  });

  const input = root.querySelector<HTMLTextAreaElement>("#assistantInput");
  if (input) {
    autoGrow(input);
    input.addEventListener("input", () => {
      const hadText = composerText.trim().length > 0;
      composerText = input.value;
      autoGrow(input);
      // Only the send button's disabled state changes on the first or last
      // character — flip it directly rather than re-rendering, which would take
      // the caret with it.
      const nowHasText = composerText.trim().length > 0;
      if (hadText !== nowHasText) {
        const button = root.querySelector<HTMLButtonElement>(".assistant-send");
        if (button) button.disabled = !nowHasText || isSending();
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
  }

  root.querySelector<HTMLFormElement>("#assistantComposer")?.addEventListener("submit", (event) => {
    event.preventDefault();
    send();
  });
}

/**
 * Wire the widget up after a render. Safe to call on every renderApp: it only
 * re-reads the DOM and re-binds, and the history lives outside the DOM.
 */
export function mountAssistant(root: HTMLElement, state: WealthState, navigate: Navigate, page: string): void {
  ctx = { root, state, navigate, page };
  bind();
  if (isPanelOpen()) scrollLogToNewest();

  if (!escapeBound) {
    escapeBound = true;
    onAssistantHistoryMerged(refreshAfterMerge);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isPanelOpen()) {
        setPanelOpen(false);
        refresh();
      }
    });
  }
}
