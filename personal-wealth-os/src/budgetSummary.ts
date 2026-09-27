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
 *           state.buckets, state.dca and state.monthPlans. Prefixed
 *           `planned*`, or held in allocation.ahead.
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
import { getLedgerSnapshot, monthKeyOf, recentMonthlyIncome, type LedgerSnapshot } from "./ledgerSummary";
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
/** How many complete months of recorded income the outlook looks back over. */
export const OUTLOOK_MONTHS = 6;

/** One recorded month, and what the current plan would do with that income. */
export interface OutlookMonth {
  /** "YYYY-MM" of the month this income was recorded in. */
  monthKey: string;
  income: number;
  result: AllocationResult;
}

/**
 * The plan measured against months the user actually had.
 *
 * An average month is the least useful thing to show someone whose income
 * swings: it is the month they never have. What decides whether a plan holds is
 * the worst one.
 */
export interface BudgetOutlook {
  /** Complete months only, oldest first. The current month is still being lived. */
  history: Array<{ monthKey: string; income: number }>;
  worst: OutlookMonth;
  median: OutlookMonth;
  best: OutlookMonth;
  /** How far apart the worst and best months are, as a fraction of the best. */
  spread: number;
  /** Whole worst months the spendable cash could cover the shortfall of. */
  worstMonthsCovered: number;
}

/**
 * Where a month's expected income came from.
 *
 *   month-plan  the user wrote it for this month on the Budget page
 *   me-page     nothing written for this month, so the Me page's allowance
 *               plus irregular income stands in — what every month used
 *               before month plans existed
 */
export type ExpectedIncomeSource = "month-plan" | "me-page";

/** One month planned ahead: what the user expects in, and where the plan sends it. */
export interface MonthAhead {
  /** "YYYY-MM". */
  monthKey: string;
  expectedIncome: number;
  source: ExpectedIncomeSource;
  /** The plan routed over expectedIncome. A plan, never a recorded figure. */
  result: AllocationResult;
}

/**
 * What the user expects a month to bring in. A month they wrote a figure for
 * uses it, zero included; any other month falls back to the Me page.
 */
export function expectedIncomeFor(state: WealthState, monthKey: string): { income: number; source: ExpectedIncomeSource } {
  const written = state.monthPlans?.[monthKey];
  if (written) return { income: written.expectedIncome, source: "month-plan" };
  return { income: state.cashflow.allowance + state.cashflow.irregularIncome, source: "me-page" };
}

/** "YYYY-MM" of the month after `now`. */
export function nextMonthKeyOf(now: Date): string {
  return monthKeyOf(new Date(now.getFullYear(), now.getMonth() + 1, 1));
}

/** One layer this month: what the plan expected it to get, and what it got. */
export interface LayerVersusPlan {
  stepId: string;
  name: string;
  /** From this month's expected income. A plan, not money. */
  planned: number;
  /** From the income the ledger recorded this month. */
  actual: number;
  /** actual - planned. Negative means the layer got less than planned. */
  difference: number;
}

/**
 * Pair this month's planned and actual layers. Both come from the same plan,
 * so the layers match one to one; they are paired by id all the same, so a
 * mismatch drops a layer rather than comparing two different ones.
 */
export function layersVersusPlan(planned: AllocationResult, actual: AllocationResult): LayerVersusPlan[] {
  return actual.rows.flatMap((row) => {
    const plan = planned.rows.find((entry) => entry.stepId === row.stepId);
    return plan
      ? [{ stepId: row.stepId, name: row.name, planned: plan.got, actual: row.got, difference: row.got - plan.got }]
      : [];
  });
}

export interface BudgetAllocationSnapshot {
  /**
   * The plan routed over this month's expected income: the figure written for
   * this month on the Budget page, or the Me page's when there is none. The
   * same result as ahead[0].
   */
  planned: AllocationResult;
  /** This month and next, planned before the money arrives. */
  ahead: [MonthAhead, MonthAhead];
  /** This month's layers, planned against received, in plan order. */
  versusPlan: LayerVersusPlan[];
  /** The plan routed over the income the ledger recorded this month. */
  actual: AllocationResult;
  /** Facts about a plan the user could have mis-configured. Wording is the UI's. */
  warnings: PlanWarning[];
  /**
   * The money a lean month may be covered from: bank and wallet balances, less
   * the emergency fund. Investment accounts are excluded because selling to eat
   * is a different decision; the emergency fund is excluded because the user
   * decided it is for emergencies, and a predictable lean month is not one.
   * Counting it would tell them they are safer than they are.
   */
  spendableCash: number;
  /**
   * How the emergency fund was kept out of spendableCash, so the page can say
   * so rather than let an assumption pass as a fact.
   *
   *   linked-account   the Emergency Fund goal is linked to a ledger account;
   *                    that account is excluded exactly
   *   assumed-in-cash  not linked, so the recorded fund is assumed to sit in
   *                    bank or wallet and subtracted — the cautious reading
   *   none             no emergency fund recorded
   */
  emergencyBasis: "linked-account" | "assumed-in-cash" | "none";
  /** How much was held back as the emergency fund. */
  emergencyHeldBack: number;
  /** spendableCash measured in months of the plan's essential layer. */
  cashMonths: number;
  /**
   * The plan against the months actually recorded. Null when fewer than two
   * complete months carry income: a worst month invented from one data point
   * would be a guess wearing a fact's clothes.
   */
  outlook: BudgetOutlook | null;
}

export interface BudgetSnapshot {
  /** "YYYY-MM" the actual figures describe. */
  monthKey: string;

  // --- PLAN (from state.cashflow / state.dca) ---
  /** Monthly allowance alone. */
  plannedAllowance: number;
  /**
   * allowance + irregular income: the Me page's usual month. A month the user
   * planned on the Budget page may expect something else — see allocation.ahead.
   */
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
  const plan: AllocationPlan = state.allocation ?? { incomeType: "fixed", steps: [] };
  const cash = spendableCashOf(state, ledger);
  const monthAhead = (monthKey: string): MonthAhead => {
    const expected = expectedIncomeFor(state, monthKey);
    return { monthKey, expectedIncome: expected.income, source: expected.source, result: allocateMonth(plan, expected.income) };
  };
  const ahead: [MonthAhead, MonthAhead] = [monthAhead(ledger.currentMonth.key), monthAhead(nextMonthKeyOf(now))];
  const actual = allocateMonth(plan, ledger.currentMonth.personalIncome);
  const allocation: BudgetAllocationSnapshot = {
    planned: ahead[0].result,
    ahead,
    actual,
    versusPlan: layersVersusPlan(ahead[0].result, actual),
    warnings: validatePlan(plan),
    spendableCash: cash.spendableCash,
    emergencyBasis: cash.emergencyBasis,
    emergencyHeldBack: cash.emergencyHeldBack,
    cashMonths: cashMonths(cash.spendableCash, plan),
    outlook: buildOutlook(state, now, plan, cash.spendableCash),
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

/**
 * Bank and wallet money the user may spend on a lean month.
 *
 * The emergency fund is found through the Emergency Fund goal. When that goal
 * is linked to a ledger account, the fund is exactly that account: taken out
 * of cash if it is a bank or wallet account, and left alone if it is anything
 * else — a money-market fund at a broker is already outside cash and must not
 * be taken out a second time. When it is not linked, the recorded amount is
 * assumed to sit in cash and subtracted, because understating what can be
 * spent is recoverable and overstating it is not.
 */
function spendableCashOf(
  state: WealthState,
  ledger: LedgerSnapshot,
): Pick<BudgetAllocationSnapshot, "spendableCash" | "emergencyBasis" | "emergencyHeldBack"> {
  const cash = ledger.accountTypeBalances.bank + ledger.accountTypeBalances.wallet;
  const goal = (state.goals ?? []).find((entry) => entry.id === "emergency");
  const linked = goal?.accountId
    ? ledger.accountBalances.find((entry) => entry.account.id === goal.accountId)
    : undefined;

  if (linked) {
    const inCash = linked.account.type === "bank" || linked.account.type === "wallet";
    return {
      spendableCash: Math.max(0, cash - (inCash ? Math.max(0, linked.balance) : 0)),
      emergencyBasis: "linked-account",
      emergencyHeldBack: Math.max(0, linked.balance),
    };
  }

  const recorded = Math.max(0, state.emergency?.current ?? 0);
  if (recorded > 0) {
    return {
      spendableCash: Math.max(0, cash - recorded),
      emergencyBasis: "assumed-in-cash",
      emergencyHeldBack: recorded,
    };
  }
  return { spendableCash: Math.max(0, cash), emergencyBasis: "none", emergencyHeldBack: 0 };
}

/**
 * Build the outlook from the months the ledger recorded.
 *
 * Months with no income at all are dropped rather than counted as the worst
 * month: a month before the user started recording is missing data, not a bad
 * month, and treating the two alike would frighten people with their own
 * onboarding.
 */
function buildOutlook(
  state: WealthState,
  now: Date,
  plan: AllocationPlan,
  spendableCash: number,
): BudgetOutlook | null {
  const history = recentMonthlyIncome(state.ledgerTransactions, now, OUTLOOK_MONTHS)
    .filter((month) => month.income > 0);
  if (history.length < 2) return null;

  const sorted = [...history].sort((a, b) => a.income - b.income);
  const at = (month: { monthKey: string; income: number }): OutlookMonth => ({
    monthKey: month.monthKey,
    income: month.income,
    result: allocateMonth(plan, month.income),
  });

  const worst = at(sorted[0]);
  const best = at(sorted[sorted.length - 1]);
  const median = at(sorted[Math.floor((sorted.length - 1) / 2)]);
  const worstShortfall = worst.result.shortfall;

  return {
    history,
    worst,
    median,
    best,
    spread: best.income > 0 ? (best.income - worst.income) / best.income : 0,
    worstMonthsCovered: worstShortfall > 0.005 ? Math.floor(spendableCash / worstShortfall) : 0,
  };
}

/** One bucket by id, or undefined. */
export function getBudgetBucket(snapshot: BudgetSnapshot, bucketId: string): BudgetBucketSnapshot | undefined {
  return snapshot.buckets.find((bucket) => bucket.id === bucketId);
}
