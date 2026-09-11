/**
 * What-if: a hypothetical expense weighed against real Emergency Fund and
 * Goal pace — "if I spend this, how much later do I reach them?"
 *
 * Two spending shapes:
 *   "once"    A one-time spend does not withdraw from money already saved —
 *             it eats into future contribution capacity. The delay is the
 *             amount divided by the existing pace, added on top of the
 *             current estimate.
 *   "monthly" A new recurring cost (a subscription, a rent increase) instead
 *             permanently lowers the pace itself. Rather than reimplementing
 *             monthsToEmergencyTarget's / GoalSnapshot's own ceil/Infinity
 *             conventions here, the hypothetical is fed through those SAME
 *             canonical functions with only the rate swapped out — so the
 *             "after" figure can never drift from how "now" is computed.
 *
 * `Infinity` means "no pace to estimate against" throughout (mirrors
 * monthsToEmergencyTarget's own convention; GoalSnapshot's `null` is
 * normalised to `Infinity` here so both impacts share one sentinel).
 *
 * Session-only, like the TVM calculator: nothing here is persisted, and it
 * never mutates WealthState.
 */
import type { WealthState } from "./models";
import { monthsToEmergencyTarget } from "./rules";
import { buildGoalSnapshot, getGoalsSnapshot, type GoalSnapshot } from "./goalSummary";

export type SpendMode = "once" | "monthly";

export interface EmergencyImpact {
  monthsToTargetNow: number;
  monthsToTargetAfter: number;
  /** The permanent new monthly top-up pace — set only in "monthly" mode. */
  newMonthlyRate: number | null;
}

export interface GoalImpact {
  id: string;
  name: string;
  monthsToTargetNow: number;
  monthsToTargetAfter: number;
  /** The permanent new monthly contribution — set only in "monthly" mode. */
  newMonthlyRate: number | null;
}

export interface SpendingImpact {
  /** The hypothetical amount actually used — invalid input is treated as 0. */
  amount: number;
  mode: SpendMode;
  emergency: EmergencyImpact;
  /** The first actively-funded goal, or null when none is being contributed to. */
  goal: GoalImpact | null;
}

/** Non-negative finite amount. Anything else (NaN, negative, Infinity) becomes 0 — a no-op hypothetical. */
function safeSpend(amount: number): number {
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function emergencyImpact(state: WealthState, amount: number, mode: SpendMode): EmergencyImpact {
  const monthsToTargetNow = monthsToEmergencyTarget(state);
  if (amount <= 0) return { monthsToTargetNow, monthsToTargetAfter: monthsToTargetNow, newMonthlyRate: null };

  if (mode === "once") {
    const monthlyTopUp = state.emergency.monthlyTopUp;
    const delayMonths = monthlyTopUp > 0 ? Math.ceil(amount / monthlyTopUp) : Infinity;
    return { monthsToTargetNow, monthsToTargetAfter: monthsToTargetNow + delayMonths, newMonthlyRate: null };
  }

  // "monthly": the recurring cost permanently eats into the top-up pace.
  const newMonthlyRate = Math.max(state.emergency.monthlyTopUp - amount, 0);
  const monthsToTargetAfter = monthsToEmergencyTarget({
    ...state,
    emergency: { ...state.emergency, monthlyTopUp: newMonthlyRate },
  });
  return { monthsToTargetNow, monthsToTargetAfter, newMonthlyRate };
}

/** The goal this hypothetical would actually delay: the first one being actively funded. */
function activeGoal(state: WealthState, now: Date): GoalSnapshot | null {
  const snapshot = getGoalsSnapshot(state, now);
  return snapshot.ordered.find((goal) => goal.status === "funding") ?? null;
}

function goalImpact(state: WealthState, goal: GoalSnapshot, amount: number, mode: SpendMode): GoalImpact {
  // status === "funding" guarantees monthlyContribution > 0, so
  // estimatedMonthsToTarget is a number, never null, here.
  const monthsToTargetNow = goal.estimatedMonthsToTarget ?? 0;
  const base = { id: goal.id, name: goal.name, monthsToTargetNow };
  if (amount <= 0) return { ...base, monthsToTargetAfter: monthsToTargetNow, newMonthlyRate: null };

  if (mode === "once") {
    const delayMonths = Math.ceil(amount / goal.monthlyContribution);
    return { ...base, monthsToTargetAfter: monthsToTargetNow + delayMonths, newMonthlyRate: null };
  }

  // "monthly": rebuild the same goal snapshot with only the rate swapped, so
  // "after" comes from buildGoalSnapshot's own formula, not a copy of it.
  const newMonthlyRate = Math.max(goal.monthlyContribution - amount, 0);
  const rawGoal = state.goals[goal.index];
  const hypothetical = buildGoalSnapshot({ ...rawGoal, monthlyContribution: newMonthlyRate }, goal.index, state);
  return { ...base, monthsToTargetAfter: hypothetical.estimatedMonthsToTarget ?? Infinity, newMonthlyRate };
}

/**
 * Build the hypothetical-spend impact. Pure: same state + same amount + same
 * mode + same `now` always produce the same result. Never mutates or
 * persists anything.
 */
export function getSpendingImpact(
  state: WealthState,
  amount: number,
  mode: SpendMode = "once",
  now = new Date(),
): SpendingImpact {
  const spend = safeSpend(amount);
  const goal = activeGoal(state, now);
  return {
    amount: spend,
    mode,
    emergency: emergencyImpact(state, spend, mode),
    goal: goal ? goalImpact(state, goal, spend, mode) : null,
  };
}
