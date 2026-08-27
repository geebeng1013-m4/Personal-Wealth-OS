/**
 * ActionRecord lifecycle.
 *
 * Records whether the user acted on an Advisor recommendation — nothing else.
 * This module owns creation, completion, validation and lookup. It never
 * computes financial facts, never ranks anything, and never produces a
 * recommendation.
 *
 * Dependency direction:
 *   facts → recommendations → AdvisorSnapshot → ActionRecord
 *
 * It imports only the domain types, so it cannot reach the UI, Firebase,
 * localStorage, the market layer or the recommendation engine.
 *
 * Duplicate rule: a recommendation has AT MOST ONE record. Recommendation ids
 * are stable and concern-keyed (see ADVISOR_RECOMMENDATION_IDS), so a second
 * record for the same id would just be the same task twice. Accepting an
 * already-tracked recommendation is therefore a no-op rather than an error.
 */
import type { ActionRecord, ActionRecordStatus, WealthState } from "./models";

/** Max records kept, so the list cannot grow without bound. */
export const MAX_ACTION_RECORDS = 500;

const STATUSES: ActionRecordStatus[] = ["pending", "completed"];

function isStatus(value: unknown): value is ActionRecordStatus {
  return typeof value === "string" && STATUSES.includes(value as ActionRecordStatus);
}

/**
 * Validate and normalize one persisted record.
 * Returns null for anything malformed, so a single bad entry can be dropped
 * without taking the rest of the state down with it.
 */
export function validateActionRecord(candidate: unknown): ActionRecord | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;

  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (typeof record.recommendationId !== "string" || !record.recommendationId.trim()) return null;
  if (!isStatus(record.status)) return null;
  if (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) return null;

  const action = typeof record.action === "string" ? record.action.trim().slice(0, 500) : "";
  const completedAt = typeof record.completedAt === "number" && Number.isFinite(record.completedAt)
    ? record.completedAt
    : undefined;

  return {
    id: record.id.trim().slice(0, 120),
    recommendationId: record.recommendationId.trim().slice(0, 120),
    action,
    status: record.status,
    createdAt: record.createdAt,
    // A pending record must never carry a completion time.
    ...(record.status === "completed" && completedAt !== undefined ? { completedAt } : {}),
  };
}

/**
 * Normalize a persisted array: drop malformed entries and keep only the first
 * record per recommendation, matching the one-record-per-recommendation rule.
 */
export function normalizeActionRecords(value: unknown): ActionRecord[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenRecommendations = new Set<string>();
  const records: ActionRecord[] = [];
  for (const candidate of value) {
    const record = validateActionRecord(candidate);
    if (!record) continue;
    if (seenIds.has(record.id) || seenRecommendations.has(record.recommendationId)) continue;
    if (records.length >= MAX_ACTION_RECORDS) break;
    seenIds.add(record.id);
    seenRecommendations.add(record.recommendationId);
    records.push(record);
  }
  return records;
}

/** All records. Pure. */
export function getActionRecords(state: Pick<WealthState, "actionRecords">): ActionRecord[] {
  return state.actionRecords ?? [];
}

/** The record tracking a recommendation, or undefined. */
export function getActionRecordFor(
  state: Pick<WealthState, "actionRecords">,
  recommendationId: string,
): ActionRecord | undefined {
  return getActionRecords(state).find((record) => record.recommendationId === recommendationId);
}

/** Whether a recommendation has been marked done. */
export function isRecommendationCompleted(
  state: Pick<WealthState, "actionRecords">,
  recommendationId: string,
): boolean {
  return getActionRecordFor(state, recommendationId)?.status === "completed";
}

/**
 * Start tracking a recommendation.
 *
 * Returns the records unchanged when one already exists for that
 * recommendation — the duplicate rule. Pure: never mutates the input.
 */
export function createActionRecord(
  records: ActionRecord[],
  input: { id: string; recommendationId: string; action: string; now?: number },
): ActionRecord[] {
  const recommendationId = input.recommendationId.trim();
  if (!recommendationId || !input.id.trim()) return records;
  if (records.some((record) => record.recommendationId === recommendationId)) return records;
  if (records.length >= MAX_ACTION_RECORDS) return records;

  const record: ActionRecord = {
    id: input.id.trim().slice(0, 120),
    recommendationId: recommendationId.slice(0, 120),
    action: input.action.trim().slice(0, 500),
    status: "pending",
    createdAt: input.now ?? Date.now(),
  };
  return [...records, record];
}

/**
 * Mark a recommendation's record complete.
 *
 * Returns the records unchanged when there is no record, or when it is already
 * complete — completing twice must not move the timestamp. Pure.
 */
export function completeActionRecord(
  records: ActionRecord[],
  recommendationId: string,
  now: number = Date.now(),
): ActionRecord[] {
  let changed = false;
  const next = records.map((record) => {
    if (record.recommendationId !== recommendationId) return record;
    if (record.status === "completed") return record;
    changed = true;
    return { ...record, status: "completed" as const, completedAt: now };
  });
  return changed ? next : records;
}

/**
 * Accept a recommendation and mark it done in one step, creating the record
 * first when it does not exist yet. This is what the "Mark as done" control
 * needs. Pure.
 */
export function markRecommendationDone(
  records: ActionRecord[],
  input: { id: string; recommendationId: string; action: string; now?: number },
): ActionRecord[] {
  const now = input.now ?? Date.now();
  const withRecord = createActionRecord(records, { ...input, now });
  return completeActionRecord(withRecord, input.recommendationId.trim(), now);
}
