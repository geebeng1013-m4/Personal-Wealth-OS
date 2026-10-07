import type { Goal } from "./models";

type CompletionResult =
  | { ok: true; values: Required<Pick<Goal, "spentAt" | "spentAmount">> }
  | { ok: false; error: string };

/** Completion is a historical record, separate from today's account balance. */
export function validateGoalCompletion(amount: string, day: string, today: string): CompletionResult {
  const text = amount.trim();
  const spentAmount = Number(text);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(spentAmount)
    || spentAmount <= 0 || !Number.isSafeInteger(Math.round(spentAmount * 100))) {
    return { ok: false, error: "Enter the amount used in MYR, greater than zero, with at most two decimal places." };
  }
  const timestamp = Date.parse(day + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== day || day > today) {
    return { ok: false, error: "Choose a valid completion date, today or earlier." };
  }
  return { ok: true, values: { spentAt: day, spentAmount: Math.round(spentAmount * 100) / 100 } };
}
