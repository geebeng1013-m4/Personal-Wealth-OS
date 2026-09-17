/**
 * Keeps the signed-in account's assistant history the same on every device
 * (AH-2).
 *
 * Not live: there is no Firestore listener. A history is something the user
 * reads back when they open the assistant, not something that must appear the
 * instant another device writes it, so the account's cloud copy is read when
 * they sign in and each time they open the panel, and written a moment after
 * they change something here. Every sync is the same three steps — read the
 * cloud copy, merge it into this device's (assistantStore), write the result
 * back if the cloud's copy is not already it — so a write never drops what
 * another device added since the last read.
 *
 * The cloud is passed in rather than imported, so this runs in tests without
 * Firebase and the demo account simply never starts it.
 */

import { mergeAssistantHistory, onAssistantHistoryChange } from "./assistantStore";
import { parseHistory, sameHistory, type AssistantHistory } from "./historyMerge";

export interface AssistantCloud {
  /** The account's stored history document, or null if it has none. */
  load(uid: string): Promise<unknown>;
  save(uid: string, history: AssistantHistory): Promise<void>;
}

/** Long enough that a burst of changes (a record sent, then its outcome) is one write. */
export const SYNC_DELAY_MS = 2000;
/** How long sign-out waits for a last write before letting go. */
const FLUSH_TIMEOUT_MS = 1500;

interface Session {
  uid: string;
  cloud: AssistantCloud;
  delayMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  again: boolean;
  unsubscribe: () => void;
}

let session: Session | null = null;

function schedule(current: Session): void {
  if (current.timer) clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    current.timer = null;
    void syncSession(current);
  }, current.delayMs);
}

async function runOnce(current: Session): Promise<void> {
  try {
    const raw = await current.cloud.load(current.uid);
    if (session !== current) return;
    const stored = parseHistory(raw);
    const merged = mergeAssistantHistory(current.uid, stored);
    if (!merged || session !== current) return;
    if (stored && sameHistory(stored, merged)) return;
    await current.cloud.save(current.uid, merged);
  } catch (error) {
    // The device keeps its own copy either way; the next change or opening
    // of the panel tries again.
    console.warn("[Assistant] History sync failed; kept on this device:", error);
  }
}

/** One sync at a time; a request made while one runs gets one more after it. */
function syncSession(current: Session): Promise<void> {
  if (current.running) {
    current.again = true;
    return current.running;
  }
  current.running = (async () => {
    do {
      current.again = false;
      await runOnce(current);
    } while (current.again && session === current);
    current.running = null;
  })();
  return current.running;
}

/** Start keeping `uid`'s history in step with the cloud. Replaces any earlier account's sync. */
export function startAssistantSync(uid: string, cloud: AssistantCloud, options: { delayMs?: number } = {}): Promise<void> {
  stopAssistantSync();
  const current: Session = {
    uid,
    cloud,
    delayMs: options.delayMs ?? SYNC_DELAY_MS,
    timer: null,
    running: null,
    again: false,
    unsubscribe: () => {},
  };
  current.unsubscribe = onAssistantHistoryChange(() => schedule(current));
  session = current;
  return syncSession(current);
}

/** Stop syncing. A write not yet sent is dropped — call flushAssistantSync first to keep it. */
export function stopAssistantSync(): void {
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.unsubscribe();
  session = null;
}

/** Sync now, e.g. when the panel opens. Does nothing when no account is syncing. */
export function syncAssistantHistoryNow(): Promise<void> {
  if (!session) return Promise.resolve();
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  return syncSession(session);
}

/**
 * Send what is waiting before the account goes away. Bounded: offline, a
 * Firestore write only settles once the device reconnects, and signing out
 * must not hang on that. The history stays on this device regardless.
 */
export async function flushAssistantSync(): Promise<void> {
  const current = session;
  if (!current || (!current.timer && !current.running)) return;
  const pending = syncAssistantHistoryNow();
  await Promise.race([pending, new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS))]);
}
