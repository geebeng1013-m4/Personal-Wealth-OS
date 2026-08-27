/**
 * Dashboard read model.
 *
 * Assembles everything the Wealth Overview needs to answer its five questions:
 *   1. Net Worth      — what am I worth?
 *   2. Cash Flow      — income, expenses, surplus this month
 *   3. Wealth Health  — how healthy am I overall?
 *   4. Plan Status    — is the DCA plan being executed?
 *   5. Priority Action— the single most important next step
 *
 * Pure and HTML-free: this module never renders markup. Canonical figures come
 * from getFinancialSnapshot(); advice comes from the existing Advisor engine.
 * No new recommendation logic is invented here.
 */
import type { AdvisorRecommendation, WealthState } from "./models";
import { getFinancialSnapshot, type FinancialSnapshot } from "./financialHealth";
import { getLedgerSnapshot } from "./ledgerSummary";
import { getAdvisorSnapshot, prioritizeRecommendations, type AdvisorSnapshot } from "./advisor";
import {
  getFinancialHealthSnapshot,
  getPlanExecution,
  type HealthStatus,
  type PlanExecution,
} from "./financialHealthSummary";
import { getPortfolioSnapshot, type PortfolioSnapshot, type ValuationInputs } from "./portfolioSummary";
import { getGoalsSnapshot, type GoalsSnapshot } from "./goalSummary";
import { getBudgetSnapshot, type BudgetSnapshot } from "./budgetSummary";

/** Re-exported from the canonical health model so existing imports keep working. */
export type WealthHealthStatus = HealthStatus;

export interface OverviewCashFlow {
  income: number;
  expenses: number;
  surplus: number;
  /** Fraction change in recorded expenses vs last month, or null with no prior month. */
  expenseChange: number | null;
}

export interface WealthHealthFactor {
  label: string;
  detail: string;
  status: WealthHealthStatus;
}

export interface OverviewWealthHealth {
  status: WealthHealthStatus;
  /** Plain-language status, so meaning never depends on colour alone. */
  label: string;
  summary: string;
  factors: WealthHealthFactor[];
}

export interface OverviewPlanStatus {
  /** Planned monthly DCA, from the structured rule when present. */
  plannedAmount: number;
  /** Recorded contributions this calendar month. */
  actualAmount: number;
  /** actualAmount / plannedAmount, capped at 1. Null when nothing is planned. */
  progress: number | null;
  onTrack: boolean;
  /** True once at least one contribution exists this month. */
  hasActual: boolean;
  label: string;
  detail: string;
}

export interface OverviewPriorityAction {
  recommendationId: string;
  title: string;
  /** Why this matters — one short explanation. */
  explanation: string;
  actionLabel: string;
  destination: string;
  severity: AdvisorRecommendation["severity"];
}

/**
 * Tracked capital and its allocation shares. Previously computed inline by the
 * Dashboard, duplicating trackedCapital().
 */
export interface OverviewTrackedWealth {
  invested: number;
  safety: number;
  reserve: number;
  total: number;
  /** Share of the tracked base, each capped at 1. */
  investedShare: number;
  safetyShare: number;
  reserveShare: number;
}

export interface OverviewModel {
  greetingName: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  cashFlow: OverviewCashFlow;
  wealthHealth: OverviewWealthHealth;
  planStatus: OverviewPlanStatus;
  /** Exactly one, or null when there is genuinely nothing to advise. */
  priorityAction: OverviewPriorityAction | null;
  /** One-line summary shown under the page header. */
  headline: string;
  /** The CFO briefing body: the priority recommendation in prose. */
  briefing: string;
  /** Tracked capital and its allocation shares. */
  trackedWealth: OverviewTrackedWealth;
  /** Emergency-fund completion, from the canonical health facts. */
  emergencyRatio: number;

  // The canonical snapshots this model composed. Exposed so the Dashboard
  // reads them from here instead of rebuilding each one itself.
  snapshot: FinancialSnapshot;
  portfolio: PortfolioSnapshot;
  goals: GoalsSnapshot;
  budget: BudgetSnapshot;
  advisor: AdvisorSnapshot;
}

function buildPlanStatus(plan: PlanExecution): OverviewPlanStatus {
  // Figures come from the canonical plan-execution facts; this only adds the
  // display copy for the Plan Status section.
  const { plannedAmount, actualAmount, progress, onTrack, hasActual } = plan;

  if (plannedAmount <= 0) {
    return {
      plannedAmount, actualAmount, progress, onTrack, hasActual,
      label: "No plan set",
      detail: "Set a monthly contribution amount to start tracking plan execution.",
    };
  }
  if (onTrack) {
    return {
      plannedAmount, actualAmount, progress, onTrack, hasActual,
      label: "On plan",
      detail: "This month's contribution has been made.",
    };
  }
  return {
    plannedAmount, actualAmount, progress, onTrack, hasActual,
    label: hasActual ? "Partially funded" : "Not yet funded",
    detail: hasActual
      ? "Part of this month's contribution is still outstanding."
      : "No contribution has been recorded for this month yet.",
  };
}

/**
 * Choose exactly one priority action, using the existing Advisor engine.
 * Order is action > watch > positive; nothing is invented when the Advisor is
 * silent.
 */
export function selectPriorityAction(recommendations: AdvisorRecommendation[]): OverviewPriorityAction | null {
  // Kept for callers that already hold a recommendation list; it applies the
  // same canonical ranking rather than a second one.
  const [top] = prioritizeRecommendations(recommendations);
  if (!top) return null;
  return toPriorityAction(top);
}

/** Adapt one canonical recommendation into the Overview's display shape. */
function toPriorityAction(top: AdvisorRecommendation): OverviewPriorityAction {
  return {
    recommendationId: top.id,
    title: top.title,
    explanation: top.impact,
    actionLabel: top.action,
    destination: top.destination ?? "advisor",
    severity: top.severity,
  };
}

/** Build the Dashboard read model. Pure: same state + same `now` → same model. */
export function buildOverviewModel(
  state: WealthState,
  now = new Date(),
  market: ValuationInputs = {},
): OverviewModel {
  // --- Canonical snapshots: built ONCE here, then threaded to everything that
  // needs them. Each of these scans the state, so rebuilding one downstream is
  // pure waste: the inputs are identical, so the result is identical.
  const ledger = getLedgerSnapshot(state, now);
  // Live prices, when the caller has them, are threaded into the one portfolio
  // snapshot this model carries. Omitting them leaves every valuation field
  // null — the Dashboard then renders "--" rather than inventing a number.
  const portfolio = getPortfolioSnapshot(state, now, market);
  // Net worth folds in the portfolio's value (live price, falling back to cost
  // basis) — built here first so the snapshot below uses the SAME portfolio
  // figure the Dashboard displays, rather than computing its own.
  const snapshot = getFinancialSnapshot(state, now, ledger, portfolio);
  const budget = getBudgetSnapshot(state, now, ledger);
  const goals = getGoalsSnapshot(state);
  const plan = getPlanExecution(state, now);

  // One Advisor pipeline feeds both the priority action and the health signal.
  // It consumes the canonical facts above rather than rebuilding its own.
  const advisor = getAdvisorSnapshot(state, { snapshot, portfolio, budget });
  const recommendations = advisor.recommendations;
  const planStatus = buildPlanStatus(plan);
  // Health is canonical. The Advisor signal is injected so the health model
  // never has to import the Advisor.
  const wealthHealth = getFinancialHealthSnapshot(state, now, {
    hasUrgentAdvice: recommendations.some((recommendation) => recommendation.severity === "action"),
  }, { snapshot, plan });
  const priorityAction = advisor.priority ? toPriorityAction(advisor.priority) : null;

  // Expense trend vs the previous calendar month. Both months come from the
  // canonical ledger snapshot, so they share one definition of month bounds.
  const previousExpenses = ledger.previousMonth.expenses;
  const expenseChange = previousExpenses > 0
    ? (snapshot.currentMonthExpenses - previousExpenses) / previousExpenses
    : null;

  const trackedWealth = buildTrackedWealth(state, portfolio);

  return {
    greetingName: state.profile.name || "there",
    netWorth: snapshot.netWorth,
    totalAssets: snapshot.totalAssets,
    totalLiabilities: snapshot.totalLiabilities,
    cashFlow: {
      income: snapshot.currentMonthIncome,
      expenses: snapshot.currentMonthExpenses,
      surplus: snapshot.currentMonthSurplus,
      expenseChange,
    },
    wealthHealth,
    planStatus,
    priorityAction,
    headline: `${wealthHealth.summary} ${planStatus.label === "On plan" ? "Your plan is on track." : ""}`.trim(),
    briefing: advisor.priority
      ? `${advisor.priority.fact} ${advisor.priority.action}`.trim()
      : "Your plan has no urgent exceptions. Stay consistent with the next scheduled contribution.",
    trackedWealth,
    emergencyRatio: wealthHealth.supportingFacts.emergencyRatio,
    snapshot,
    portfolio,
    goals,
    budget,
    advisor,
  };
}

/** Tracked capital plus each component's share of it. */
function buildTrackedWealth(state: WealthState, portfolio: PortfolioSnapshot): OverviewTrackedWealth {
  const invested = portfolio.totalInvestedMyr;
  const safety = state.emergency.current;
  const reserve = state.opportunity.total - state.opportunity.used;
  const total = invested + safety + reserve;
  // Floored at 1 so an empty portfolio cannot produce a divide-by-zero share.
  const base = Math.max(total, 1);
  return {
    invested, safety, reserve, total,
    investedShare: Math.min(invested / base, 1),
    safetyShare: Math.min(safety / base, 1),
    reserveShare: Math.min(reserve / base, 1),
  };
}

/**
 * Tracked capital only. Delegates to the same builder the model uses, so there
 * is a single definition.
 */
export function trackedCapital(state: WealthState): { invested: number; safety: number; reserve: number; total: number } {
  const { invested, safety, reserve, total } = buildTrackedWealth(state, getPortfolioSnapshot(state));
  return { invested, safety, reserve, total };
}
