/**
 * Canonical Budget / Bucket read model.
 *
 * Answers: WHAT IS THE PLAN, AND HOW DOES REALITY COMPARE?
 *
 * Facts only — no advice, no recommendations, no HTML, never persisted.
 * "Spending is over plan" is a fact and belongs here. "You should cut food
 * spending" is advice and belongs to the Advisor.
 *
 * ── PLAN vs ACTUAL ────────────────────────────────────────────────────────
 * These are different things and are deliberately never merged:
 *
 *   PLAN    what the user intends to allocate. Comes from state.cashflow,
 *           state.buckets and state.dca. Prefixed `planned*`.
 *
 *   ACTUAL  what the ledger actually recorded this month. Comes from
 *           getLedgerSnapshot(). Prefixed `actual*`.
 *
 * A planned figure must never be presented as a recorded one, or vice versa.
 *
 * ── Boundaries ────────────────────────────────────────────────────────────
 * Ledger facts are read from the canonical ledger snapshot rather than
 * re-scanning transactions. Spending *limits* stay in FinancialRules; this
 * module reports what was spent, and the Advisor compares the two.
 */
import type { WealthState } from "./models";
import { getLedgerSnapshot, type LedgerSnapshot } from "./ledgerSummary";
import { monthlyBasicExpense, monthlySurplus } from "./rules";

export type BucketCadence = "monthly" | "one-time";

export interface BudgetBucketSnapshot {
  id: string;
  name: string;
  label: string;
  note: string;
  cadence: BucketCadence;
  /** Position in state.buckets, so edit forms can address the original entry. */
  index: number;
  /** Planned allocation for this bucket. */
  amount: number;
  /**
   * Denominator the Budget page measures this bucket against: the monthly
   * allowance for the survival bucket, its own amount for one-time buckets,
   * and the assignable surplus otherwise.
   */
  allocationBase: number;
  /** amount / allocationBase, capped at 1. Zero when the base is zero. */
  allocationRatio: number;
}

export interface BudgetSnapshot {
  /** "YYYY-MM" the actual figures describe. */
  monthKey: string;

  // --- PLAN (from state.cashflow / state.dca) ---
  /** Monthly allowance alone. */
  plannedAllowance: number;
  /** allowance + irregular income. */
  plannedIncome: number;
  /** Planned fixed outgoings: transport + food + otherFixed. */
  plannedSpending: number;
  /** plannedIncome - plannedSpending. The assignable surplus. */
  plannedSurplus: number;
  /** Configured monthly DCA amount. */
  plannedDcaAmount: number;
  /** Whether the plan leaves enough surplus to fund the configured DCA. */
  planCoversDca: boolean;

  // --- ACTUAL (from the canonical ledger snapshot) ---
  actualIncome: number;
  actualSpending: number;
  actualSurplus: number;

  // --- Variance (facts, not judgements) ---
  /** actualSpending - plannedSpending. Positive means overspending. */
  spendingVariance: number;
  isOverPlannedSpending: boolean;

  // --- Buckets ---
  buckets: BudgetBucketSnapshot[];
}

/**
 * Build the canonical budget snapshot.
 * Pure: the same state + same `now` always produces the same result.
 *
 * `ledger` lets a caller that already holds the canonical LedgerSnapshot for
 * this same `now` reuse it rather than rescanning every transaction. Omitting it
 * behaves exactly as before. The ledger passed in must describe the same `now`.
 */
export function getBudgetSnapshot(
  state: WealthState,
  now = new Date(),
  ledger: LedgerSnapshot = getLedgerSnapshot(state, now),
): BudgetSnapshot {

  // PLAN — composed from the existing rules.ts primitives, unchanged.
  const plannedAllowance = state.cashflow.allowance;
  const plannedIncome = plannedAllowance + state.cashflow.irregularIncome;
  const plannedSpending = monthlyBasicExpense(state);
  const plannedSurplus = monthlySurplus(state);
  const plannedDcaAmount = state.dca.monthly;

  // The Budget page measures every bucket against at least 1, so a zero or
  // negative surplus cannot make the bars meaningless. Preserved exactly.
  const surplusBase = Math.max(plannedSurplus, 1);

  const buckets: BudgetBucketSnapshot[] = (state.buckets ?? []).map((bucket, index) => {
    const allocationBase = bucket.id === "survival"
      ? plannedAllowance
      : bucket.cadence === "one-time"
        ? bucket.amount
        : surplusBase;
    // Same ratio the Budget page has always drawn. Guarded so a zero base
    // yields 0 rather than NaN; both render as an empty bar, so nothing the
    // user sees changes.
    const allocationRatio = allocationBase > 0
      ? Math.min(bucket.amount / allocationBase, 1)
      : 0;
    return {
      id: bucket.id,
      name: bucket.name,
      label: bucket.label,
      note: bucket.note,
      cadence: bucket.cadence,
      index,
      amount: bucket.amount,
      allocationBase,
      allocationRatio,
    };
  });

  const actualSpending = ledger.currentMonth.expenses;

  return {
    monthKey: ledger.currentMonth.key,
    plannedAllowance,
    plannedIncome,
    plannedSpending,
    plannedSurplus,
    plannedDcaAmount,
    planCoversDca: plannedSurplus >= plannedDcaAmount,
    actualIncome: ledger.currentMonth.income,
    actualSpending,
    actualSurplus: ledger.currentMonth.surplus,
    spendingVariance: actualSpending - plannedSpending,
    isOverPlannedSpending: actualSpending > plannedSpending,
    buckets,
  };
}

/** One bucket by id, or undefined. */
export function getBudgetBucket(snapshot: BudgetSnapshot, bucketId: string): BudgetBucketSnapshot | undefined {
  return snapshot.buckets.find((bucket) => bucket.id === bucketId);
}
