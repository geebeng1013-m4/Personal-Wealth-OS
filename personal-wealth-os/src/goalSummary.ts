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
import { linkedGoalCurrent } from "./financialHealth";

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

  /** Complete by the canonical currentAmount. The single completion flag. */
  isComplete: boolean;
  status: GoalStatus;
}

export interface GoalsSnapshot {
  /** In the original state.goals order. */
  goals: GoalSnapshot[];
  /** Incomplete first, matching the existing Goals page ordering. */
  ordered: GoalSnapshot[];
  totalTarget: number;
  /** Sum of displayed current amounts. */
  totalCurrent: number;
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
  const currentAmount = linkedGoalCurrent(goal, state);
  const recordedAmount = goal.current;
  const progress = goal.target > 0 ? Math.min(currentAmount / goal.target, 1) : 0;
  const remainingAmount = Math.max(goal.target - currentAmount, 0);
  const estimatedMonthsToTarget = goal.monthlyContribution > 0
    ? Math.ceil(remainingAmount / goal.monthlyContribution)
    : null;
  const linkedAccount = goal.accountId
    ? state.ledgerAccounts.find((account) => account.id === goal.accountId)
    : undefined;
  const isComplete = goal.target > 0 && currentAmount >= goal.target;

  return {
    id: goal.id,
    name: goal.name,
    label: goal.label,
    note: goal.note,
    index,
    targetAmount: goal.target,
    currentAmount,
    recordedAmount,
    remainingAmount,
    progress,
    monthlyContribution: goal.monthlyContribution,
    estimatedMonthsToTarget,
    estimatedYearsToTarget: estimatedMonthsToTarget === null
      ? null
      : Math.round((estimatedMonthsToTarget / 12) * 10) / 10,
    isAccountLinked: Boolean(goal.accountId),
    ...(goal.accountId ? { accountId: goal.accountId } : {}),
    linkedAccountName: linkedAccount?.name ?? null,
    isComplete,
    status: statusOf(goal, isComplete),
  };
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
  const configured = goals.find((goal) => goal.id === state.overviewGoalId);
  const firstIncomplete = ordered.find((goal) => goal.targetAmount > 0 && !goal.isComplete);
  const featured = configured ?? firstIncomplete ?? goals[0] ?? null;

  return {
    goals,
    ordered,
    totalTarget: goals.reduce((sum, goal) => sum + goal.targetAmount, 0),
    totalCurrent: goals.reduce((sum, goal) => sum + goal.currentAmount, 0),
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
