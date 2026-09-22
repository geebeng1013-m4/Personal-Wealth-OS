/**
 * Canonical Goal read model.
 *
 * Answers one question: WHAT IS THE STATE OF EACH GOAL?
 *
 * Facts only — target, current, remaining, progress, contribution, estimated
 * completion, status. No advice, no recommendations, no HTML. Turning "this
 * goal is stalled" into "you should do X" is the Advisor's job.
 *
 * This layer does not define new goal arithmetic. It composes the existing
 * calculations (linkedGoalCurrent, and the progress/months formulas the Goals
 * page and Dashboard already use) so behaviour is unchanged.
 *
 * ── A note on "current amount" ────────────────────────────────────────────
 * A goal holds two different amounts when it is linked to a ledger account:
 *
 *   currentAmount   linkedGoalCurrent() — the linked account's balance when
 *                   an accountId is set, otherwise goal.current.
 *                   CANONICAL. Everything the user sees or that classifies a
 *                   goal derives from this: progress, remaining, estimated
 *                   months, isComplete, status, sorting and featured
 *                   selection.
 *
 *   recordedAmount  goal.current, the raw stored field. Kept because it is
 *                   the historical record the user typed, and the Goals edit
 *                   form still writes it. It must NOT drive completion,
 *                   sorting or featured selection — doing so previously meant
 *                   a linked goal could display 100% funded while the system
 *                   still treated it as incomplete.
 *
 * Runtime read model: never persisted to WealthState.
 */
import type { Goal, WealthState } from "./models";
import { heldGoalAmount, isGoalSpent, linkedGoalCurrent } from "./financialHealth";

export type GoalStatus = "complete" | "funding" | "stalled" | "no-target";

export interface GoalSnapshot {
  id: string;
  name: string;
  label: string;
  note: string;
  /** Position in state.goals, so edit forms can address the original entry. */
  index: number;

  targetAmount: number;
  /**
   * CANONICAL current value: linked account balance when linked, else
   * goal.current. Drives progress, completion, sorting and featured selection.
   */
  currentAmount: number;
  /**
   * Money the goal holds right now: the linked account's balance, or the typed
   * figure. Equals currentAmount unless the goal is marked done, when it can
   * fall (the money was used) or stay (a buffer kept). What a done goal
   * takes from an account it shares with others.
   */
  heldAmount: number;
  /**
   * Raw goal.current as stored. Historical record only — never used for
   * completion, sorting or featured selection.
   */
  recordedAmount: number;
  /** Never negative. */
  remainingAmount: number;
  /** 0..1, capped at 1. Zero when there is no target. */
  progress: number;

  monthlyContribution: number;
  /** ceil(remaining / contribution), or null when nothing is being contributed. */
  estimatedMonthsToTarget: number | null;
  /** estimatedMonthsToTarget in years, one decimal, or null. */
  estimatedYearsToTarget: number | null;

  isAccountLinked: boolean;
  accountId?: string;
  /** Name of the linked account, or null when the link is broken. */
  linkedAccountName: string | null;

  /**
   * Marked done. The goal stays complete at its target however its account
   * moves afterwards, and puts nothing in each month. Saved still counts the
   * money it holds: a buffer marked done keeps its money, a purchase does not.
   */
  isSpent: boolean;
  /** "2026-09-22" when marked done, otherwise null. */
  spentAt: string | null;

  /** Complete by the canonical currentAmount. The single completion flag. */
  isComplete: boolean;
  status: GoalStatus;
}

export interface GoalsSnapshot {
  /** In the original state.goals order. */
  goals: GoalSnapshot[];
  /** Incomplete first, matching the existing Goals page ordering. */
  ordered: GoalSnapshot[];
  /** Goals marked done. */
  doneCount: number;
  totalTarget: number;
  /**
   * How much of the targets is achieved — the Goals page's Saved: a goal
   * marked done counts its target, however its account moves afterwards; any
   * other goal counts what it holds, capped at its own target so one
   * overfunded goal cannot fill another. An account shared by several goals
   * is split in list order and never counted past its balance.
   * totalFunded / totalTarget is the "% of all targets".
   */
  totalFunded: number;
  totalRemaining: number;
  totalMonthlyContribution: number;
  completedCount: number;
  activeCount: number;
  /** The goal the Overview features, using the existing selection rules. */
  featuredGoalId: string;
  featured: GoalSnapshot | null;
}

function statusOf(goal: Goal, isComplete: boolean): GoalStatus {
  if (goal.target <= 0) return "no-target";
  if (isComplete) return "complete";
  // Mirrors the existing goal-drift condition: incomplete with nothing assigned.
  if (goal.monthlyContribution <= 0) return "stalled";
  return "funding";
}

/** One goal's facts. Composes the existing display formulas exactly. */
export function buildGoalSnapshot(goal: Goal, index: number, state: WealthState): GoalSnapshot {
  const isSpent = isGoalSpent(goal);
  const currentAmount = linkedGoalCurrent(goal, state);
  const recordedAmount = goal.current;
  const progress = goal.target > 0 ? Math.min(currentAmount / goal.target, 1) : 0;
  const remainingAmount = Math.max(goal.target - currentAmount, 0);
  const monthlyContribution = isSpent ? 0 : goal.monthlyContribution;
  const estimatedMonthsToTarget = monthlyContribution > 0
    ? Math.ceil(remainingAmount / monthlyContribution)
    : null;
  const linkedAccount = goal.accountId
    ? state.ledgerAccounts.find((account) => account.id === goal.accountId)
    : undefined;
  // Spent means it was reached and used, even if the target was edited since.
  const isComplete = isSpent || (goal.target > 0 && currentAmount >= goal.target);

  return {
    id: goal.id,
    name: goal.name,
    label: goal.label,
    note: goal.note,
    index,
    targetAmount: goal.target,
    currentAmount,
    heldAmount: isSpent ? heldGoalAmount(goal, state) : currentAmount,
    recordedAmount,
    remainingAmount,
    progress,
    monthlyContribution,
    estimatedMonthsToTarget,
    estimatedYearsToTarget: estimatedMonthsToTarget === null
      ? null
      : Math.round((estimatedMonthsToTarget / 12) * 10) / 10,
    isAccountLinked: Boolean(goal.accountId),
    ...(goal.accountId ? { accountId: goal.accountId } : {}),
    linkedAccountName: linkedAccount?.name ?? null,
    isSpent,
    spentAt: isSpent ? goal.spentAt ?? null : null,
    isComplete,
    status: statusOf(goal, isComplete),
  };
}

function fundedTotal(goals: GoalSnapshot[]): number {
  const accountLeft = new Map<string, number>();
  let total = 0;
  for (const goal of goals) {
    const target = Math.max(goal.targetAmount, 0);
    const shared = goal.accountId && goal.linkedAccountName !== null ? goal.accountId : null;
    if (!shared) {
      total += goal.isSpent ? target : Math.min(Math.max(goal.currentAmount, 0), target);
      continue;
    }
    // A done goal still takes its share of the account (the money may be
    // there), but counts in full whether or not it is.
    const left = accountLeft.get(shared) ?? Math.max(goal.heldAmount, 0);
    const funded = Math.min(left, target);
    accountLeft.set(shared, left - funded);
    total += goal.isSpent ? target : funded;
  }
  return total;
}

/**
 * Build the canonical goals snapshot.
 * Pure: the same state always produces the same result.
 *
 * `now` is accepted for signature consistency with the other snapshots; no
 * goal fact currently depends on the current time.
 */
export function getGoalsSnapshot(state: WealthState, _now = new Date()): GoalsSnapshot {
  const goals = (state.goals ?? []).map((goal, index) => buildGoalSnapshot(goal, index, state));

  // Incomplete first, by the canonical completion state. Stable within groups.
  const ordered = goals
    .map((goal, position) => ({ goal, position }))
    .sort((a, b) => {
      const bySort = Number(a.goal.isComplete) - Number(b.goal.isComplete);
      return bySort !== 0 ? bySort : a.position - b.position;
    })
    .map(({ goal }) => goal);

  // Featured goal: the configured one, else the first incomplete goal in the
  // ordered list, else the first goal. Completion here matches what the Goals
  // cards show, so the two can never disagree.
  // A spent goal has nothing left to watch, so the Dashboard moves on; the
  // choice itself is kept, and comes back if the spend is undone.
  const configured = goals.find((goal) => goal.id === state.overviewGoalId && !goal.isSpent);
  const firstIncomplete = ordered.find((goal) => goal.targetAmount > 0 && !goal.isComplete);
  const featured = configured ?? firstIncomplete ?? goals[0] ?? null;

  return {
    goals,
    ordered,
    doneCount: goals.filter((goal) => goal.isSpent).length,
    totalTarget: goals.reduce((sum, goal) => sum + goal.targetAmount, 0),
    totalFunded: fundedTotal(goals),
    totalRemaining: goals.reduce((sum, goal) => sum + goal.remainingAmount, 0),
    totalMonthlyContribution: goals.reduce((sum, goal) => sum + goal.monthlyContribution, 0),
    completedCount: goals.filter((goal) => goal.isComplete).length,
    activeCount: goals.filter((goal) => !goal.isComplete && goal.targetAmount > 0).length,
    featuredGoalId: featured?.id ?? "",
    featured,
  };
}

/** One goal by id, or undefined. */
export function getGoal(snapshot: GoalsSnapshot, goalId: string): GoalSnapshot | undefined {
  return snapshot.goals.find((goal) => goal.id === goalId);
}
