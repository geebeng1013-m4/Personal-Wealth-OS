import type { VisitActivity, WealthState } from "./models";

export const EMPTY_VISIT_ACTIVITY: VisitActivity = {
  lastActiveOn: "",
  previousActiveOn: "",
  returnedOn: "",
  dismissedOn: "",
};

function calendarDay(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

function todayOn(date: Date): string {
  if (!Number.isFinite(date.getTime())) return "";
  return calendarDay(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
}

/** Calendar days, independent of daylight-saving changes and clock time. */
function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export function normalizeVisitActivity(value: unknown): VisitActivity {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const activity = {
    lastActiveOn: calendarDay(input.lastActiveOn),
    previousActiveOn: calendarDay(input.previousActiveOn),
    returnedOn: calendarDay(input.returnedOn),
    dismissedOn: calendarDay(input.dismissedOn),
  };
  if (!activity.lastActiveOn || !activity.returnedOn || activity.returnedOn > activity.lastActiveOn
    || !activity.previousActiveOn || daysBetween(activity.previousActiveOn, activity.returnedOn) <= 7) {
    activity.previousActiveOn = "";
    activity.returnedOn = "";
  }
  return activity;
}

/** Returns the same state when today was already recorded; never writes storage. */
export function recordVisitActivity(state: WealthState, now = new Date()): WealthState {
  const today = todayOn(now);
  const activity = state.visitActivity;
  if (!today || today <= activity.lastActiveOn) return state;
  const returning = Boolean(activity.lastActiveOn) && daysBetween(activity.lastActiveOn, today) > 7;
  return { ...state, visitActivity: {
    ...activity,
    lastActiveOn: today,
    ...(returning ? { previousActiveOn: activity.lastActiveOn, returnedOn: today, dismissedOn: "" } : {}),
  } };
}

export function returningVisitDays(state: WealthState, now = new Date()): number | null {
  const today = todayOn(now);
  if (!today) return null;
  const activity = state.visitActivity;
  if (!activity.returnedOn || activity.returnedOn > today || activity.dismissedOn >= activity.returnedOn) return null;
  const days = daysBetween(activity.previousActiveOn, activity.returnedOn);
  return Number.isFinite(days) && days > 7 ? days : null;
}

export function dismissReturnReminder(state: WealthState, now = new Date()): WealthState {
  const next = recordVisitActivity(state, now);
  if (returningVisitDays(next, now) === null) return next;
  return { ...next, visitActivity: { ...next.visitActivity, dismissedOn: todayOn(now) } };
}
