/**
 * The assistant's per-account daily allowance — the pure half.
 *
 * Every call to the model costs money now, so something has to stand between a
 * signed-in account and an unbounded bill. The sliding-window limiter in
 * rateLimit.ts cannot: its counter lives in one instance's memory, so a cold
 * start forgets it and several warm instances each count separately. This
 * counts in Firestore instead, where a day's total survives both.
 *
 * Everything here is total and dependency-free: no Firestore, no clock of its
 * own, no throwing. `assistant.ts` supplies `now` and the document it read, and
 * does the transaction. That seam is what the unit tests exercise.
 */

import type { AssistantMode } from "./deepseekRequest.js";

/**
 * How many turns one account gets per day, per mode.
 *
 * Two buckets rather than one total: somebody with a talkative afternoon should
 * not find they can no longer record this morning's coffee. Deliberately tight
 * to start with — raising a number later is a one-line deploy, while an
 * unnoticed bill is not.
 *
 * At list prices this ceiling is worth about $0.048 a day for one account.
 */
export const DAILY_LIMITS: Record<AssistantMode, number> = { help: 30, fill: 30 };

/**
 * The day is Malaysia's, not UTC.
 *
 * Every user of this app is in UTC+8, and "today's allowance" has to end when
 * their day does. On a UTC day key the reset would land at 8am local — halfway
 * through a morning, which is exactly when someone would be asking why they ran
 * out. A fixed offset is enough: Malaysia has no daylight saving.
 */
export const DAY_OFFSET_MS = 8 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The local calendar day `now` falls in, as YYYY-MM-DD. Also the document id. */
export function dayKeyFor(now: number): string {
  return new Date(now + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight local time at the end of `now`'s day, as epoch ms. */
export function nextResetAt(now: number): number {
  const shifted = now + DAY_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS - DAY_OFFSET_MS;
}

/** The document id for one account's one day. */
export function usageDocId(uid: string, now: number): string {
  return `${uid}_${dayKeyFor(now)}`;
}

/**
 * What one account has already spent today.
 *
 * The stored document is treated as untrusted input like any other: a missing
 * document, a missing field, a string where a number belongs, a negative or a
 * NaN all read as 0 — never as "unlimited". The one reading that would be
 * dangerous to get wrong is a count that is really higher than it looks, and
 * nothing here can produce that from a value it cannot understand.
 */
export function countsFrom(data: unknown): Record<AssistantMode, number> {
  const source = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const read = (mode: AssistantMode): number => {
    const value = source[mode];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
  };
  return { help: read("help"), fill: read("fill") };
}

export type QuotaDecision =
  | { allowed: true; used: number; limit: number; remaining: number }
  | { allowed: false; used: number; limit: number; resetAt: number };

/**
 * Whether this turn fits in today's allowance.
 *
 * The count is of turns actually allowed through, so a refused turn costs
 * nothing and extends nothing — the same rule the in-memory limiter follows.
 */
export function decideQuota(
  data: unknown,
  mode: AssistantMode,
  now: number,
  limits: Record<AssistantMode, number> = DAILY_LIMITS,
): QuotaDecision {
  const limit = limits[mode];
  const used = countsFrom(data)[mode];
  if (used >= limit) return { allowed: false, used, limit, resetAt: nextResetAt(now) };
  return { allowed: true, used, limit, remaining: limit - used - 1 };
}

/**
 * The bearer token on a request, or "" when there is none to read.
 *
 * Shape only — whether the token is real is Firebase's answer, not ours.
 */
export function bearerToken(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : "";
}
