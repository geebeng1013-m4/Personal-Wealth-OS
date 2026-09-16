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
 * `allocation` holds both, routed through the same plan and kept apart by name.
 *
 * ── Boundaries ────────────────────────────────────────────────────────────
 * Ledger facts are read from the canonical ledger snapshot rather than
 * re-scanning transactions. Spending *limits* stay in FinancialRules; this
 * module reports what was spent, and the Advisor compares the two.
 */
import type { AllocationPlan, WealthState } from "./models";
import { getLedgerSnapshot, type LedgerSnapshot } from "./ledgerSummary";
import { monthlyBasicExpense, monthlySurplus } from "./rules";
import { allocateMonth, cashMonths, validatePlan, type AllocationResult, type PlanWarning } from "./allocation";

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

/**
 * The allocation plan applied twice: to the month the user planned for, and to
 * the money that actually arrived. Same waterfall, two inputs — which is the
 * whole point, since a thin month routes differently from a normal one.
 */
export interface BudgetAllocationSnapshot {
  /** The plan routed over plannedIncome — what a normal month looks like. */
  planned: AllocationResult;
  /** The plan routed over the income the ledger recorded this month. */
  actual: AllocationResult;
  /** Facts about a plan the user could have mis-configured. Wording is the UI's. */
  warnings: PlanWarning[];
  /**
   * Bank and wallet balances — the money a shortfall could be covered from.
   * Investment accounts are excluded: selling to eat is a different decision.
   */
  cashOnHand: number;
  /** cashOnHand measured in months of the plan's essential layer. */
  cashMonths: number;
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

  // --- Allocation ---
  allocation: BudgetAllocationSnapshot;
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

  const actualSpending = ledger.currentMonth.personalExpenses;

  // The plan routes the month the user planned for and the month they actually
  // had. Sponsored money is already excluded upstream (personalIncome), so a
  // parent's dinner money never reads as income the plan may invest.
  const plan: AllocationPlan = state.allocation ?? { incomeType: "fixed", baseIncome: 0, steps: [] };
  const cashOnHand = ledger.accountTypeBalances.bank + ledger.accountTypeBalances.wallet;
  const allocation: BudgetAllocationSnapshot = {
    planned: allocateMonth(plan, plannedIncome),
    actual: allocateMonth(plan, ledger.currentMonth.personalIncome),
    warnings: validatePlan(plan),
    cashOnHand,
    cashMonths: cashMonths(cashOnHand, plan),
  };

  return {
    monthKey: ledger.currentMonth.key,
    plannedAllowance,
    plannedIncome,
    plannedSpending,
    plannedSurplus,
    plannedDcaAmount,
    planCoversDca: plannedSurplus >= plannedDcaAmount,
    actualIncome: ledger.currentMonth.personalIncome,
    actualSpending,
    actualSurplus: ledger.currentMonth.personalSurplus,
    spendingVariance: actualSpending - plannedSpending,
    isOverPlannedSpending: actualSpending > plannedSpending,
    buckets,
    allocation,
  };
}

/** One bucket by id, or undefined. */
export function getBudgetBucket(snapshot: BudgetSnapshot, bucketId: string): BudgetBucketSnapshot | undefined {
  return snapshot.buckets.find((bucket) => bucket.id === bucketId);
}
