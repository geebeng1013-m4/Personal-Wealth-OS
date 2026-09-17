/**
 * The assistant's history as one account keeps it on every device, and how two
 * copies of it become one.
 *
 * Pure: no storage, no Firestore. assistantStore holds this device's copy and
 * assistantSync carries it to and from the account's cloud document; this is
 * the part both sides must agree on — what a valid entry is, and which copy of
 * an entry wins.
 *
 * Merging is by id, never by position. Ask messages never change after they
 * are written, so either copy of one will do. A Record entry does change — its
 * outcome is folded in after it is sent — but only on the device that sent it,
 * because a draft never survives a reload. The one conflict that can happen is
 * a device that reloaded (and so reads its unfinished entry back as "expired")
 * meeting the finished outcome from the device that finished it; the finished
 * outcome wins.
 *
 * A clear is remembered as a time, not as an empty list. An empty list would
 * lose to the other device's full one on the next merge and the cleared
 * history would come straight back. Anything written at or before the latest
 * clear on either copy is dropped from both.
 */

import { createId } from "../../state";
import type { AssistantMessage, RecordEntry, RecordStatus } from "./assistantTypes";

/** The proxy caps a conversation at 20 turns anyway. */
export const MAX_ASK_MESSAGES = 40;
/** The Record log is history the user is meant to browse, so it is kept longer. */
export const MAX_RECORD_ENTRIES = 120;

export interface AssistantHistory {
  ask: AssistantMessage[];
  records: RecordEntry[];
  /** When Ask was last cleared, on any device. 0 = never. */
  askClearedAt: number;
  /** When the Record log was last cleared, on any device. 0 = never. */
  recordsClearedAt: number;
}

export function emptyHistory(): AssistantHistory {
  return { ask: [], records: [], askClearedAt: 0, recordsClearedAt: 0 };
}

/** Stored Ask messages, however old or malformed, as valid messages. */
export function normalizeAsk(parsed: unknown): AssistantMessage[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is AssistantMessage =>
      typeof entry === "object" && entry !== null &&
      typeof (entry as AssistantMessage).content === "string" &&
      ((entry as AssistantMessage).role === "user" || (entry as AssistantMessage).role === "assistant"))
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : createId("msg"),
      role: entry.role,
      content: entry.content,
      at: typeof entry.at === "number" ? entry.at : Date.now(),
      ...(typeof entry.visit === "string" ? { visit: entry.visit } : {}),
      ...(entry.failed === true ? { failed: true as const } : {}),
    }))
    .slice(-MAX_ASK_MESSAGES);
}

const STATUSES: readonly RecordStatus[] = [
  "pending", "draft", "filled", "discarded", "expired", "unrecognised", "failed",
];

/** Stored Record entries as valid entries. Nothing read back is still in flight. */
export function normalizeRecords(parsed: unknown): RecordEntry[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is RecordEntry =>
      typeof entry === "object" && entry !== null && typeof (entry as RecordEntry).said === "string")
    .map((entry) => {
      const stored = STATUSES.includes(entry.status) ? entry.status : "expired";
      return {
        id: typeof entry.id === "string" ? entry.id : createId("rec"),
        at: typeof entry.at === "number" ? entry.at : Date.now(),
        said: entry.said,
        // A draft never survives a reload, so anything stored mid-flight or
        // still offering to fill a form comes back as history only.
        status: stored === "draft" || stored === "pending" ? "expired" : stored,
        ...(typeof entry.summary === "string" ? { summary: entry.summary } : {}),
        ...(entry.target === "ledger" || entry.target === "portfolio" ? { target: entry.target } : {}),
        ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
        ...(Array.isArray(entry.unresolved) ? { unresolved: entry.unresolved.filter((v) => typeof v === "string") } : {}),
        ...(Array.isArray(entry.dropped) ? { dropped: entry.dropped.filter((v) => typeof v === "string") } : {}),
      };
    })
    .slice(-MAX_RECORD_ENTRIES);
}

function clearedAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A cloud document, or anything else, as a history — null when it is not one. */
export function parseHistory(raw: unknown): AssistantHistory | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  return {
    ask: normalizeAsk(data.ask),
    records: normalizeRecords(data.records),
    askClearedAt: clearedAt(data.askClearedAt),
    recordsClearedAt: clearedAt(data.recordsClearedAt),
  };
}

/**
 * The history as it may be stored: an offered form's draft stays on the device
 * that offered it, and nothing undefined (which Firestore rejects) is left in.
 */
export function storableHistory(history: AssistantHistory): AssistantHistory {
  return {
    ask: history.ask.slice(-MAX_ASK_MESSAGES).map(({ id, role, content, at, visit, failed }) => ({
      id, role, content, at, ...(visit ? { visit } : {}), ...(failed ? { failed } : {}),
    })),
    records: history.records.slice(-MAX_RECORD_ENTRIES).map(({ draft: _draft, ...rest }) =>
      Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) as unknown as RecordEntry),
    askClearedAt: history.askClearedAt,
    recordsClearedAt: history.recordsClearedAt,
  };
}

/** A settled outcome beats "expired", which only means a device reloaded mid-flight. */
function pickRecord(mine: RecordEntry, theirs: RecordEntry): RecordEntry {
  return mine.status === "expired" && theirs.status !== "expired" ? theirs : mine;
}

function union<T extends { id: string; at: number }>(
  mine: readonly T[],
  theirs: readonly T[],
  after: number,
  cap: number,
  pick: (mine: T, theirs: T) => T,
): T[] {
  const byId = new Map<string, T>();
  for (const entry of theirs) byId.set(entry.id, entry);
  for (const entry of mine) {
    const other = byId.get(entry.id);
    byId.set(entry.id, other ? pick(entry, other) : entry);
  }
  return [...byId.values()]
    .filter((entry) => entry.at > after)
    .sort((a, b) => a.at - b.at)
    .slice(-cap);
}

/**
 * This device's history and the cloud's as one. `mine` wins a tie, so an entry
 * still in flight here keeps its offered draft.
 */
export function mergeHistory(mine: AssistantHistory, cloud: AssistantHistory | null): AssistantHistory {
  if (!cloud) {
    return {
      ...mine,
      ask: union(mine.ask, [], mine.askClearedAt, MAX_ASK_MESSAGES, (a) => a),
      records: union(mine.records, [], mine.recordsClearedAt, MAX_RECORD_ENTRIES, pickRecord),
    };
  }
  const askClearedAt = Math.max(mine.askClearedAt, cloud.askClearedAt);
  const recordsClearedAt = Math.max(mine.recordsClearedAt, cloud.recordsClearedAt);
  return {
    ask: union(mine.ask, cloud.ask, askClearedAt, MAX_ASK_MESSAGES, (a) => a),
    records: union(mine.records, cloud.records, recordsClearedAt, MAX_RECORD_ENTRIES, pickRecord),
    askClearedAt,
    recordsClearedAt,
  };
}

/** Whether storing `next` would change what `stored` already holds. */
export function sameHistory(stored: AssistantHistory, next: AssistantHistory): boolean {
  const askIds = (h: AssistantHistory) => h.ask.map((m) => m.id).join(",");
  const recordKeys = (h: AssistantHistory) => h.records.map((r) => `${r.id}:${r.status}:${r.summary ?? ""}`).join(",");
  return stored.askClearedAt === next.askClearedAt &&
    stored.recordsClearedAt === next.recordsClearedAt &&
    askIds(stored) === askIds(next) &&
    recordKeys(stored) === recordKeys(next);
}
