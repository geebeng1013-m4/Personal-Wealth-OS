/**
 * Income allocation engine.
 *
 * Answers: MONEY CAME IN — WHAT IS THIS MONEY ALLOWED TO DO?
 *
 * Facts only — no advice, no recommendations, no HTML, never persisted. "The
 * essential layer is MYR 500 short" is a fact and belongs here. "Skip investing
 * this month" is advice and belongs to the Advisor.
 *
 * ── THE WATERFALL ─────────────────────────────────────────────────────────
 * A plan is an ordered list of steps. Money enters at the top and flows down;
 * a step only sees what the steps above it left behind. Three kinds of step:
 *
 *   fill   take a fixed amount, e.g. "fill to MYR 1,500"
 *   gross  take a share of everything that came in this month, untouched by
 *          the steps above — the only correct shape for tax withholding
 *   pct    split whatever survived the fills. The base is measured ONCE, at
 *          the first pct step, so the percentages divide one pot rather than
 *          compounding down the list
 *
 * Whatever reaches the bottom goes to the overflow step, so no ringgit is left
 * without a job.
 *
 * ── CUMULATIVE, NOT PER ARRIVAL ───────────────────────────────────────────
 * Allocation is a pure function of the month's cumulative income, never of the
 * single payment being recorded. A gig worker paid MYR 400 four times must end
 * the month with the essential layer filled to MYR 1,500 — splitting each
 * arrival on its own would leave it at 60% of MYR 1,600 and the month short.
 * So `allocateIncome` takes what the month has already received, allocates the
 * new total, and reports the difference as `added`.
 *
 * ── Boundaries ────────────────────────────────────────────────────────────
 * This module never decides where the money physically sits. Shortfalls are
 * reported, not covered: `shortfall` says how much the essential layer is
 * missing, and the caller decides what may fund it.
 */

import type { AllocationPlan, AllocationStep, AllocationStepKind } from "./models";

// The persisted shapes live in models.ts; re-exported here so a caller reading
// the engine does not have to know where they are declared.
export type { AllocationPlan, AllocationStep, AllocationStepKind };

/**
 * What the engine actually reads: the routing itself. A stored AllocationPlan
 * satisfies it, and so does a bare list of steps, so callers exploring a
 * what-if do not have to invent an income type to ask a question.
 */
export type AllocationRouting = Pick<AllocationPlan, "steps" | "overflowStepId">;

export interface AllocationRow {
  stepId: string;
  name: string;
  /**
   * The rule this layer was written with. Named stepKind rather than kind so a
   * snapshot carrying these rows cannot be mistaken for carrying rule records.
   */
  stepKind: AllocationStepKind;
  /** The rule's own figure: an amount for "fill", a percentage otherwise. */
  value: number;
  /** What this money is allowed to do, as the user wrote it. */
  note?: string;
  /** What the rule asks for, measured on the month's cumulative income. */
  want: number;
  /** What it has received this month, including any overflow. */
  got: number;
  /** The part of `got` contributed by this arrival. */
  added: number;
  /** The part of `got` that arrived as overflow rather than by the rule. */
  overflow: number;
}

export interface AllocationResult {
  rows: AllocationRow[];
  /** The month's cumulative income after this arrival. */
  income: number;
  /** Reached the bottom with no overflow step to take it. */
  unassigned: number;
  /**
   * How much the essential layer still needs. The essential layer is the first
   * "fill" step — the layer that must be covered before anything else runs,
   * whatever the user named it. Zero when a plan has no fill step at all.
   */
  shortfall: number;
}

export type PlanWarningCode =
  | "no-steps"
  | "duplicate-step-id"
  | "negative-value"
  | "percent-total-not-100"
  | "essential-is-percent"
  | "no-overflow-step";

export interface PlanWarning {
  code: PlanWarningCode;
  /** The step at fault, where one step is at fault. */
  stepId?: string;
  /** The measured figure, where the warning is about one — e.g. 95 for 95%. */
  value?: number;
}

/** Money comparisons are in base-currency cents; below this is nothing. */
const EPSILON = 0.005;

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Allocate one month's whole income. The cumulative building block. */
function allocateTotal(plan: AllocationRouting, income: number): { got: number[]; overflow: number[]; want: number[]; left: number } {
  const steps = plan.steps ?? [];
  const want: number[] = [];
  const got: number[] = [];
  const overflow: number[] = steps.map(() => 0);
  const total = positive(income);
  let left = total;
  // The pct base is fixed the first time a pct step runs, so percentages
  // divide one pot instead of compounding down the remaining steps.
  let pctBase: number | null = null;

  for (const step of steps) {
    let asked: number;
    if (step.kind === "fill") {
      asked = positive(step.value);
    } else if (step.kind === "gross") {
      asked = total * positive(step.value) / 100;
    } else {
      if (pctBase === null) pctBase = left;
      asked = pctBase * positive(step.value) / 100;
    }
    const taken = Math.min(asked, left);
    left -= taken;
    want.push(asked);
    got.push(taken);
  }

  const overflowIndex = plan.overflowStepId
    ? steps.findIndex((step) => step.id === plan.overflowStepId)
    : -1;
  if (overflowIndex >= 0 && left > EPSILON) {
    got[overflowIndex] += left;
    overflow[overflowIndex] = left;
    left = 0;
  }

  return { got, overflow, want, left };
}

/**
 * Allocate `amount` on top of the `allocatedSoFar` this month already received.
 *
 * Pure: the same plan + same figures always produce the same result. Pass
 * `allocatedSoFar` as 0 (or use `allocateMonth`) for a month's whole income at
 * once; pass the month's running total to allocate one arrival of many.
 */
export function allocateIncome(plan: AllocationRouting, allocatedSoFar: number, amount: number): AllocationResult {
  const before = positive(allocatedSoFar);
  const income = before + positive(amount);
  const previous = allocateTotal(plan, before);
  const current = allocateTotal(plan, income);
  const steps = plan.steps ?? [];

  const rows: AllocationRow[] = steps.map((step, index) => ({
    stepId: step.id,
    name: step.name,
    stepKind: step.kind,
    value: step.value,
    ...(step.note ? { note: step.note } : {}),
    want: current.want[index],
    got: current.got[index],
    added: current.got[index] - previous.got[index],
    overflow: current.overflow[index],
  }));

  const essential = rows.find((row) => row.stepKind === "fill");

  return {
    rows,
    income,
    unassigned: current.left,
    shortfall: essential ? Math.max(0, essential.want - essential.got) : 0,
  };
}

/** One month's income allocated in a single pass. */
export function allocateMonth(plan: AllocationRouting, income: number): AllocationResult {
  return allocateIncome(plan, 0, income);
}

/** One row by step id, or undefined. */
export function getAllocationRow(result: AllocationResult, stepId: string): AllocationRow | undefined {
  return result.rows.find((row) => row.stepId === stepId);
}

/**
 * The monthly cost the plan treats as essential: the first "fill" step. Zero
 * when the plan has none, which is itself reported by `validatePlan`.
 */
export function essentialMonthlyNeed(plan: AllocationRouting): number {
  const essential = (plan.steps ?? []).find((step) => step.kind === "fill");
  return essential ? positive(essential.value) : 0;
}

/**
 * How many months of essential spending a cash balance covers. Infinity is
 * never returned — a plan with no essential layer answers 0, since "how long
 * would this last" has no meaning without a monthly cost.
 */
export function cashMonths(cash: number, plan: AllocationRouting): number {
  const need = essentialMonthlyNeed(plan);
  return need > 0 ? positive(cash) / need : 0;
}

/** Sum of every "pct" step, in percentage points. */
export function percentTotal(plan: AllocationRouting): number {
  return (plan.steps ?? [])
    .filter((step) => step.kind === "pct")
    .reduce((sum, step) => sum + positive(step.value), 0);
}

/**
 * Facts about a plan a user could have mis-configured. Wording is the caller's
 * job: this reports what is true, not what to say about it.
 */
export function validatePlan(plan: AllocationRouting): PlanWarning[] {
  const steps = plan.steps ?? [];
  const warnings: PlanWarning[] = [];

  if (steps.length === 0) {
    warnings.push({ code: "no-steps" });
    return warnings;
  }

  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) warnings.push({ code: "duplicate-step-id", stepId: step.id });
    seen.add(step.id);
    if (!Number.isFinite(step.value) || step.value < 0) {
      warnings.push({ code: "negative-value", stepId: step.id, value: step.value });
    }
  }

  const percent = percentTotal(plan);
  const hasPercentStep = steps.some((step) => step.kind === "pct");
  if (hasPercentStep && Math.abs(percent - 100) > 0.05) {
    warnings.push({ code: "percent-total-not-100", value: percent });
  }

  // A percentage first layer means the month's living costs shrink with a bad
  // month, which is the one thing the waterfall exists to prevent.
  if (steps[0].kind === "pct") {
    warnings.push({ code: "essential-is-percent", stepId: steps[0].id });
  }

  const hasOverflow = steps.some((step) => step.id === plan.overflowStepId);
  if (!hasOverflow) warnings.push({ code: "no-overflow-step" });

  return warnings;
}

/**
 * The same plan with its "pct" steps scaled to total 100%, keeping their
 * relative sizes. Returns a new plan; the original is untouched. A plan whose
 * percentages already total zero cannot be scaled, so it comes back unchanged.
 */
export function normalizePercentSteps<T extends AllocationRouting>(plan: T): T {
  const total = percentTotal(plan);
  if (total <= 0) return { ...plan, steps: [...(plan.steps ?? [])] };
  return {
    ...plan,
    steps: (plan.steps ?? []).map((step) => step.kind === "pct"
      ? { ...step, value: Math.round(positive(step.value) * 100 / total * 10) / 10 }
      : { ...step }),
  };
}
