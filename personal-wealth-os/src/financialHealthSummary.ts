/**
 * Canonical Financial Health read model.
 *
 * Answers one question: WHAT IS THE USER'S CURRENT FINANCIAL CONDITION?
 *
 * Facts and status only — no advice, no actions, no destinations, no HTML,
 * never persisted. "Your safety buffer is 60% funded" belongs here; "top it up
 * by MYR 200" is advice and belongs to the Advisor.
 *
 * ── Dependency direction ──────────────────────────────────────────────────
 *   LedgerSnapshot → FinancialSnapshot → FinancialHealthSnapshot → UI
 *
 * The overall status has always been escalated to "action" when the Advisor
 * has an urgent recommendation. That behaviour is preserved, but the signal is
 * INJECTED by the caller rather than imported: health must not depend on the
 * Advisor, or the layering would invert (the Advisor consumes health, not the
 * other way round).
 */
import type { WealthState } from "./models";
import { getFinancialSnapshot, type FinancialSnapshot } from "./financialHealth";
import { getFinancialRule } from "./financialRules";
import { emergencyRatio } from "./rules";

export type HealthStatus = "healthy" | "watch" | "action";

export type HealthFactorId = "safetyBuffer" | "cashFlow" | "budget" | "planExecution" | "debtLoad";

export interface HealthFactor {
  id: HealthFactorId;
  label: string;
  status: HealthStatus;
  /** Short factual description. Never a recommendation. */
  detail: string;
  /** The number this factor is judged on, or null when it has none. */
  value: number | null;
  /** The threshold or target it is judged against, or null. */
  target: number | null;
}

/** Plan-execution facts. Shared with the Overview so both agree. */
export interface PlanExecution {
  plannedAmount: number;
  actualAmount: number;
  /** actualAmount / plannedAmount capped at 1, or null when nothing is planned. */
  progress: number | null;
  onTrack: boolean;
  hasActual: boolean;
}

export interface FinancialHealthSnapshot {
  status: HealthStatus;
  /** Plain-language status, so meaning never depends on colour alone. */
  label: string;
  summary: string;
  /** Ordered for display: safety, cash flow, budget, plan, debt. */
  factors: HealthFactor[];
  /** The figures the factors are derived from, for UI that shows detail. */
  supportingFacts: {
    emergencyRatio: number;
    emergencyCurrent: number;
    emergencyTarget: number;
    currentMonthSurplus: number;
    currentMonthExpenses: number;
    /** The monthly-spending-limit rule amount, or 0 when no limit is set. */
    monthlySpendingLimit: number;
    totalAssets: number;
    totalLiabilities: number;
    plannedContribution: number;
    actualContribution: number;
  };
}

/** Signals the health model needs but does not own. */
export interface HealthSignals {
  /**
   * True when the Advisor currently has an "action" recommendation. Escalates
   * the overall status, preserving long-standing behaviour.
   */
  hasUrgentAdvice?: boolean;
}

/**
 * Canonical inputs a caller may already hold. Purely an optimisation: anything
 * omitted is built here exactly as before, so the result never depends on which
 * of these were supplied. Whatever IS supplied must have been built from the
 * same state and the same `now`.
 */
export interface HealthInputs {
  snapshot?: FinancialSnapshot;
  plan?: PlanExecution;
}

const STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: "Healthy",
  watch: "Watch",
  action: "Action needed",
};

/** Worst status wins: action > watch > healthy. */
export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("action")) return "action";
  if (statuses.includes("watch")) return "watch";
  return "healthy";
}

/** Contributions recorded this calendar month (buys only, never sells). */
function contributionsThisMonth(state: WealthState, now: Date): number {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  // Rounded to the cent: this is shown as money on the Plan Status card and
  // divided by the monthly target, and summing cent-precise amounts in binary
  // floating point drifts into the far decimals.
  const total = state.trades
    .filter((trade) => trade.type !== "Sell" && trade.date.slice(0, 7) === monthKey)
    .reduce((sum, trade) => sum + trade.amountMyr + trade.feeMyr, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Canonical plan-execution facts: planned vs actual contribution this month.
 * Consumed by both this module and the Overview's Plan Status section.
 */
export function getPlanExecution(state: WealthState, now = new Date()): PlanExecution {
  const dcaRule = getFinancialRule(state, "dca-monthly-amount");
  const plannedAmount = dcaRule?.amount ?? state.dca.monthly;
  const actualAmount = contributionsThisMonth(state, now);
  return {
    plannedAmount,
    actualAmount,
    progress: plannedAmount > 0 ? Math.min(actualAmount / plannedAmount, 1) : null,
    onTrack: plannedAmount <= 0 || actualAmount >= plannedAmount,
    hasActual: actualAmount > 0,
  };
}

/** The plan-execution factor's wording, matching the Plan Status labels. */
function planExecutionLabel(plan: PlanExecution): string {
  if (plan.plannedAmount <= 0) return "No plan set";
  if (plan.onTrack) return "On plan";
  return plan.hasActual ? "Partially funded" : "Not yet funded";
}

/**
 * Build the canonical financial health snapshot.
 * Pure: same state + same `now` + same signals always produce the same result.
 *
 * Thresholds are unchanged from the original implementation:
 *   safety     >= 100% healthy, >= 50% watch, else action
 *   cash flow  surplus > 0 healthy, == 0 watch, < 0 action
 *   budget     no limit set or spending within it healthy, over it action
 *   plan       on track healthy, else watch
 *   debt       none healthy, exceeding assets action, else watch
 */
export function getFinancialHealthSnapshot(
  state: WealthState,
  now = new Date(),
  signals: HealthSignals = {},
  inputs: HealthInputs = {},
): FinancialHealthSnapshot {
  const snapshot: FinancialSnapshot = inputs.snapshot ?? getFinancialSnapshot(state, now);
  const plan = inputs.plan ?? getPlanExecution(state, now);

  // 1. Emergency buffer
  const emergency = emergencyRatio(state);
  const safetyBuffer: HealthFactor = {
    id: "safetyBuffer",
    label: "Safety buffer",
    status: emergency >= 1 ? "healthy" : emergency >= 0.5 ? "watch" : "action",
    detail: emergency >= 1 ? "Fully funded" : `${Math.round(emergency * 100)}% funded`,
    value: emergency,
    target: 1,
  };

  // 2. Recorded cash flow
  const surplus = snapshot.currentMonthSurplus;
  const cashFlow: HealthFactor = {
    id: "cashFlow",
    label: "Cash flow",
    status: surplus > 0 ? "healthy" : surplus === 0 ? "watch" : "action",
    detail: surplus >= 0 ? "Spending within income" : "Spending exceeds income",
    value: surplus,
    target: 0,
  };

  // 3. Spending limit vs recorded spending
  // A fact — "12% over limit" — never the advice to fix it. Mirrors the
  // Advisor's monthly-spending-limit check so the two cards never disagree:
  // recorded spending above the limit is an action, anything else is fine.
  const spendingRule = getFinancialRule(state, "monthly-spending-limit");
  const spendingLimit = spendingRule?.enabled ? spendingRule.limitAmount : 0;
  const recordedSpend = snapshot.currentMonthExpenses;
  const overBudget = spendingLimit > 0 && recordedSpend > spendingLimit;
  const budget: HealthFactor = {
    id: "budget",
    label: "Budget",
    status: overBudget ? "action" : "healthy",
    detail: spendingLimit <= 0
      ? "No limit set"
      : overBudget
        ? `${Math.round((recordedSpend / spendingLimit - 1) * 100)}% over limit`
        : `${Math.round((recordedSpend / spendingLimit) * 100)}% of limit`,
    value: spendingLimit > 0 ? recordedSpend : null,
    target: spendingLimit > 0 ? spendingLimit : null,
  };

  // 4. Plan execution
  const planExecution: HealthFactor = {
    id: "planExecution",
    label: "Plan execution",
    status: plan.onTrack ? "healthy" : "watch",
    detail: planExecutionLabel(plan),
    value: plan.actualAmount,
    target: plan.plannedAmount,
  };

  // 5. Debt load
  const debtLoad: HealthFactor = {
    id: "debtLoad",
    label: "Debt load",
    status: snapshot.totalLiabilities === 0
      ? "healthy"
      : snapshot.totalLiabilities > snapshot.totalAssets ? "action" : "watch",
    detail: snapshot.totalLiabilities === 0 ? "No recorded debt" : "Debt recorded against assets",
    value: snapshot.totalLiabilities,
    target: snapshot.totalAssets,
  };

  const factors = [safetyBuffer, cashFlow, budget, planExecution, debtLoad];

  const status = worstStatus([
    ...factors.map((factor) => factor.status),
    // An Advisor "action" is itself a health signal (injected, not imported).
    ...(signals.hasUrgentAdvice ? ["action" as const] : []),
  ]);

  const summary = status === "healthy"
    ? "Every tracked area is within its target range."
    : status === "watch"
      ? "Most areas are fine, but some need attention."
      : "One or more areas need action now.";

  return {
    status,
    label: STATUS_LABELS[status],
    summary,
    factors,
    supportingFacts: {
      emergencyRatio: emergency,
      emergencyCurrent: state.emergency.current,
      emergencyTarget: state.emergency.target,
      currentMonthSurplus: surplus,
      currentMonthExpenses: recordedSpend,
      monthlySpendingLimit: spendingLimit,
      totalAssets: snapshot.totalAssets,
      totalLiabilities: snapshot.totalLiabilities,
      plannedContribution: plan.plannedAmount,
      actualContribution: plan.actualAmount,
    },
  };
}

/** One factor by id, or undefined. */
export function getHealthFactor(
  snapshot: FinancialHealthSnapshot,
  id: HealthFactorId,
): HealthFactor | undefined {
  return snapshot.factors.find((factor) => factor.id === id);
}
