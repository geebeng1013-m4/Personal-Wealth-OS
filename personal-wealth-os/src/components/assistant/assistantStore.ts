/**
 * The assistant's own state.
 *
 * Module-level, exactly like the Ledger page's filters and the TVM calculator's
 * inputs: renderApp() rebuilds the whole shell on every navigation, so anything
 * the widget must survive a page change has to live outside the DOM. Nothing
 * here goes into WealthState — a conversation is not a financial fact, and
 * putting it there would sync chat history to Firestore and bump the schema.
 *
 * The two modes keep SEPARATE histories, because they are different kinds of
 * thing. Ask is a conversation: turns build on each other, so it is stored as a
 * transcript and sent back to the model as one. Record is a log: each entry is
 * one thing the user wanted recorded, standing alone, with its own outcome. A
 * record request is therefore sent WITHOUT history — nothing about last week's
 * coffee should colour how today's is read — and the log is kept longer,
 * because finding what was recorded is the point of keeping it.
 *
 * Everything is mirrored to localStorage. Every access is guarded: private
 * windows and blocked site data make the accessor itself throw, and an
 * assistant that cannot open is a worse outcome than one that forgets.
 *
 * The two histories belong to the signed-in account, not to the browser: they
 * are stored under that account's uid and swapped out when the account
 * changes (see setAssistantOwner). Kept under one browser-wide key, the next
 * person to sign in on the same browser read the last one's questions and
 * records. Preferences stay per browser — they say nothing about anyone.
 *
 * This is the device's copy. assistantSync keeps it and the account's cloud
 * copy converged (AH-2); historyMerge decides how two copies become one.
 */

import { createId } from "../../state";
import type {
  AssistantDraft,
  AssistantMessage,
  AssistantMode,
  RecordEntry,
} from "./assistantTypes";
import {
  MAX_ASK_MESSAGES,
  MAX_RECORD_ENTRIES,
  mergeHistory,
  normalizeAsk,
  normalizeRecords,
  storableHistory,
  type AssistantHistory,
} from "./historyMerge";

const ASK_KEY = "wealthup-assistant-ask";
const RECORDS_KEY = "wealthup-assistant-records";
const PREFS_KEY = "wealthup-assistant-prefs";
const CLEARED_KEY = "wealthup-assistant-cleared";
/**
 * Where an account's history is kept. The bare keys, with no uid, are what
 * builds before AH-1 wrote for whoever was signed in.
 */
function askKey(uid: string): string { return `${ASK_KEY}:${uid}`; }
function recordsKey(uid: string): string { return `${RECORDS_KEY}:${uid}`; }
function clearedKey(uid: string): string { return `${CLEARED_KEY}:${uid}`; }
/** Pre-split storage, where both modes shared one transcript. */
const LEGACY_MESSAGES_KEY = "wealthup-assistant-messages";


/**
 * What is remembered across visits. Figure sharing is deliberately NOT here —
 * see `sharingFigures` below.
 */
interface AssistantPrefs {
  mode: AssistantMode;
  noticeDismissed: boolean;
}

const defaultPrefs: AssistantPrefs = {
  mode: "help",
  noticeDismissed: false,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* a convenience, never a requirement */ }
}

function readPrefs(): AssistantPrefs {
  const parsed = read<Partial<AssistantPrefs>>(PREFS_KEY, {});
  return {
    mode: parsed.mode === "fill" ? "fill" : "help",
    // Any shareFigures stored by an earlier version is ignored on purpose.
    noticeDismissed: parsed.noticeDismissed === true,
  };
}

function readAsk(): AssistantMessage[] {
  if (!owner) return [];
  return normalizeAsk(read<unknown>(askKey(owner), []));
}

function readRecords(): RecordEntry[] {
  if (!owner) return [];
  return normalizeRecords(read<unknown>(recordsKey(owner), []));
}

function readCleared(): { ask: number; records: number } {
  if (!owner) return { ask: 0, records: 0 };
  const parsed = read<Partial<{ ask: number; records: number }>>(clearedKey(owner), {});
  return {
    ask: typeof parsed.ask === "number" ? parsed.ask : 0,
    records: typeof parsed.records === "number" ? parsed.records : 0,
  };
}

function writeAsk(): void {
  if (!owner) return;
  write(askKey(owner), storableHistory(currentHistory()).ask);
}

function writeRecords(): void {
  if (!owner) return;
  // `draft` is stripped: see RecordStatus in assistantTypes.
  write(recordsKey(owner), storableHistory(currentHistory()).records);
}

function writeCleared(): void {
  if (!owner) return;
  write(clearedKey(owner), cleared);
}

function currentHistory(): AssistantHistory {
  return { ask: askLog, records: recordLog, askClearedAt: cleared.ask, recordsClearedAt: cleared.records };
}

/** Told whenever the user changes the history on this device. */
const changeListeners = new Set<() => void>();
/** Told whenever history from another device has been merged in. */
const mergeListeners = new Set<() => void>();

function changed(): void {
  for (const listener of changeListeners) listener();
}

/** One-time move off the pre-split single transcript. */
function dropLegacyStorage(): void {
  try {
    localStorage.removeItem(LEGACY_MESSAGES_KEY);
  } catch { /* nothing to clean up */ }
}

/**
 * History kept under the bare keys, from before it was stored per account, is
 * handed to the first account that signs in on this browser — the person using
 * it — and the bare keys are removed, so no later account can pick it up.
 * An account that already has its own history keeps it untouched.
 */
function adoptUnownedHistory(uid: string): void {
  try {
    for (const [bare, own] of [[ASK_KEY, askKey(uid)], [RECORDS_KEY, recordsKey(uid)]]) {
      const unowned = localStorage.getItem(bare);
      if (unowned === null) continue;
      if (localStorage.getItem(own) === null) localStorage.setItem(own, unowned);
      localStorage.removeItem(bare);
    }
  } catch { /* storage blocked: nothing to hand over */ }
}

/** The signed-in account whose history is loaded. Nobody until auth says so. */
let owner: string | null = null;
let prefs: AssistantPrefs = readPrefs();
let askLog: AssistantMessage[] = [];
let recordLog: RecordEntry[] = [];
let cleared = { ask: 0, records: 0 };
dropLegacyStorage();

/**
 * This page visit. A new id on every load.
 *
 * The Ask transcript is kept across visits so it can be read back, but only the
 * current visit's turns are sent to the model. Otherwise an answer from an
 * earlier visit — one that quoted the user's figures while sharing was on —
 * would be sent again on every later question, long after sharing had reset to
 * off. It would also let a days-old topic colour how a new question is read.
 */
let visitId = createId("visit");

/** Panel visibility is session-only: a reload should not reopen it. */
let panelOpen = false;
/**
 * Whether Ask may send the user's figures. Session-only, and off on every page
 * load.
 *
 * It used to be saved with the other preferences, which meant switching it on
 * once kept sending figures on every later visit without the user ever deciding
 * that again. Sending financial figures to a third party is a decision to make
 * in the moment, so it resets: navigating between pages keeps it (this module
 * outlives a page change), but a reload or a new visit starts from off.
 */
let sharingFigures = false;
let sending = false;
/** Lets an in-flight request be dropped when the history is cleared. */
let inFlight: AbortController | null = null;

export function isPanelOpen(): boolean { return panelOpen; }
export function setPanelOpen(open: boolean): void { panelOpen = open; }

export function assistantMode(): AssistantMode { return prefs.mode; }
export function setAssistantMode(mode: AssistantMode): void {
  prefs.mode = mode;
  write(PREFS_KEY, prefs);
}

export function shareFigures(): boolean { return sharingFigures; }
export function setShareFigures(value: boolean): void {
  sharingFigures = value;
}

export function noticeDismissed(): boolean { return prefs.noticeDismissed; }
export function dismissNotice(): void {
  prefs.noticeDismissed = true;
  write(PREFS_KEY, prefs);
}

export function isSending(): boolean { return sending; }

export function beginSending(): AbortController {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  sending = true;
  return controller;
}

export function endSending(controller: AbortController): void {
  if (inFlight === controller) {
    inFlight = null;
    sending = false;
  }
}

/** True when this controller is still the current request. */
export function isCurrent(controller: AbortController): boolean {
  return inFlight === controller;
}

/**
 * Load the history of the account now signed in, or clear it on sign-out.
 *
 * Everything that belonged to the previous account goes: its transcript and log
 * from memory, a request still in flight, the open panel and figure sharing.
 * `adoptUnowned` is false for the demo account, which must never pick up the
 * history of a real person who used this browser.
 */
export function setAssistantOwner(uid: string | null, options: { adoptUnowned?: boolean } = {}): void {
  if (uid === owner) return;
  inFlight?.abort();
  inFlight = null;
  sending = false;
  panelOpen = false;
  sharingFigures = false;
  visitId = createId("visit");
  owner = uid;
  if (uid && options.adoptUnowned !== false) adoptUnownedHistory(uid);
  askLog = readAsk();
  recordLog = readRecords();
  cleared = readCleared();
}

/** The account whose history is loaded, or null when nobody is signed in. */
export function assistantOwner(): string | null { return owner; }

/** Listen for the user changing the history here. Returns the unsubscribe. */
export function onAssistantHistoryChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

/** Listen for history from another device arriving. Returns the unsubscribe. */
export function onAssistantHistoryMerged(listener: () => void): () => void {
  mergeListeners.add(listener);
  return () => { mergeListeners.delete(listener); };
}

/**
 * Fold another copy of `uid`'s history into this device's and keep the result.
 *
 * Merges against the history as it is NOW, not as it was when the other copy
 * was requested, so a message sent while the cloud read was on its way is not
 * lost. Returns what the cloud should hold, or null — touching nothing — when
 * `uid` is no longer the signed-in account.
 */
export function mergeAssistantHistory(uid: string, other: AssistantHistory | null): AssistantHistory | null {
  if (!owner || owner !== uid) return null;
  const before = currentHistory();
  const merged = mergeHistory(before, other);
  askLog = merged.ask;
  recordLog = merged.records;
  cleared = { ask: merged.askClearedAt, records: merged.recordsClearedAt };
  writeAsk();
  writeRecords();
  writeCleared();
  const arrived = merged.ask.length !== before.ask.length ||
    merged.records.length !== before.records.length ||
    merged.ask.some((m, i) => m.id !== before.ask[i]?.id) ||
    merged.records.some((r, i) => r.id !== before.records[i]?.id || r.status !== before.records[i]?.status);
  if (arrived) for (const listener of mergeListeners) listener();
  return storableHistory(merged);
}

// --- Ask: a conversation ---------------------------------------------------

/** Every stored Ask message, for display. */
export function askMessages(): readonly AssistantMessage[] { return askLog; }

/** Whether a message was sent during the current page visit. */
export function isFromThisVisit(message: AssistantMessage): boolean {
  return message.visit === visitId;
}

/** Only this visit's messages — the ones that may be sent to the model. */
export function askMessagesThisVisit(): readonly AssistantMessage[] {
  return askLog.filter(isFromThisVisit);
}

export function appendAskMessage(message: Omit<AssistantMessage, "id" | "at">): AssistantMessage {
  const full: AssistantMessage = {
    id: createId("msg"),
    at: Date.now(),
    role: message.role,
    content: message.content,
    visit: visitId,
    ...(message.failed ? { failed: message.failed } : {}),
  };
  askLog = [...askLog, full].slice(-MAX_ASK_MESSAGES);
  writeAsk();
  changed();
  return full;
}

// --- Record: a log ---------------------------------------------------------

export function recordEntries(): readonly RecordEntry[] { return recordLog; }

/** Open an entry the moment the user sends, so the log shows it in flight. */
export function beginRecord(said: string): RecordEntry {
  const entry: RecordEntry = { id: createId("rec"), at: Date.now(), said, status: "pending" };
  recordLog = [...recordLog, entry].slice(-MAX_RECORD_ENTRIES);
  writeRecords();
  changed();
  return entry;
}

/** Fold an outcome into an existing entry. Unknown ids are ignored. */
export function updateRecord(id: string, patch: Partial<Omit<RecordEntry, "id" | "at" | "said">>): void {
  recordLog = recordLog.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  writeRecords();
  changed();
}

export function findRecordDraft(id: string): AssistantDraft | undefined {
  return recordLog.find((entry) => entry.id === id)?.draft;
}

/**
 * Clear the history for one mode only.
 *
 * Per mode rather than both at once: the button sits beside a mode's own list,
 * and wiping a Record log the user was keeping because they pressed Clear while
 * reading an Ask answer would be a nasty surprise.
 */
export function clearHistory(mode: AssistantMode): void {
  inFlight?.abort();
  inFlight = null;
  sending = false;
  // Remembered as a time, so the other devices drop the same history instead
  // of handing it back on the next merge (see historyMerge). Never earlier than
  // the newest entry cleared, whatever this device's clock says.
  const latest = (entries: readonly { at: number }[]): number =>
    entries.reduce((max, entry) => Math.max(max, entry.at), Date.now());
  if (mode === "help") {
    cleared = { ...cleared, ask: latest(askLog) };
    askLog = [];
    writeAsk();
  } else {
    cleared = { ...cleared, records: latest(recordLog) };
    recordLog = [];
    writeRecords();
  }
  writeCleared();
  changed();
}

/** Test seam: back to a first-run assistant, signed in as `uid`. */
export function __resetAssistantStore(uid = "test-user"): void {
  owner = uid;
  visitId = createId("visit");
  prefs = { ...defaultPrefs };
  sharingFigures = false;
  askLog = [];
  recordLog = [];
  cleared = { ask: 0, records: 0 };
  panelOpen = false;
  sending = false;
  inFlight = null;
  writeAsk();
  writeRecords();
  writeCleared();
  write(PREFS_KEY, prefs);
}

/** Test seam: re-read everything from storage, as a page load would. */
export function __reloadAssistantStore(): void {
  visitId = createId("visit");
  prefs = readPrefs();
  // A page load re-runs this module, which resets everything session-only.
  sharingFigures = false;
  panelOpen = false;
  askLog = readAsk();
  recordLog = readRecords();
  cleared = readCleared();
}
