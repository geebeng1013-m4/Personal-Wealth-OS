/**
 * Where someone is on the road from "starting out" to "investing" (PLAN.md Q-2).
 *
 * Four stages and one side track, checked in order:
 *
 *   debt     the Q&A's main goal is paying off debt, and it is not yet cleared
 *   1 base   spending is at or above income, or savings cover under a month
 *   2 buffer between a month and the safety buffer target
 *   3 ready  the buffer is full, nothing invested yet
 *   4 growing the buffer is full and there is at least one trade
 *
 * Read from the user's real data every time, never stored: the Q&A only seeds
 * the figures (it writes the planned spending and the buffer), so an account
 * that never took the quiz gets a stage too, and the stage moves on by itself
 * as money is saved. The reason line says which number put the user here.
 *
 * Pure: no DOM, no storage.
 */

import type { WealthState } from "./models";
import { getLedgerSnapshot } from "./ledgerSummary";
import { money, suggestedEmergencyTarget } from "./rules";
import { totalLiabilities } from "./financialHealth";
import { bufferMonthsFor } from "./onboardingQuiz";

export type MoneyStageId = "debt" | "base" | "buffer" | "ready" | "growing";

/**
 * Which fact decided the stage. "unmeasured" is a base with nothing to measure
 * yet (no spending figure): not short of money, just not known.
 */
export type MoneyStageBasis = "debt" | "overspending" | "savings" | "unmeasured";

export interface MoneyStage {
  id: MoneyStageId;
  /** 1–4 on the main road; null on the debt track. */
  step: number | null;
  title: string;
  /** One line on why, from the user's own numbers. */
  reason: string;
  basis: MoneyStageBasis;
}

export const STAGE_COUNT = 4;

const TITLES: Record<MoneyStageId, string> = {
  debt: "Paying down debt",
  base: "Getting a base",
  buffer: "Building your buffer",
  ready: "Ready to invest",
  growing: "Growing",
};
const STEPS: Record<MoneyStageId, number | null> = { debt: null, base: 1, buffer: 2, ready: 3, growing: 4 };

function stage(id: MoneyStageId, reason: string, basis: MoneyStageBasis = "savings"): MoneyStage {
  return { id, step: STEPS[id], title: TITLES[id], reason, basis };
}

/** "1.4" but "2" — a month count people read, not a measurement. */
function months(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Is this month's money going out faster than it comes in? The last full month
 * when it has any recorded income (a month in progress would read as
 * overspending every payday eve); otherwise the planned figures.
 */
function spendingAboveIncome(state: WealthState, monthlySpending: number | null, now: Date): boolean {
  const previous = getLedgerSnapshot(state, now).previousMonth;
  if (previous.income > 0) return previous.expenses >= previous.income;
  const plannedIncome = state.cashflow.allowance;
  return plannedIncome > 0 && monthlySpending !== null && monthlySpending >= plannedIncome;
}

export function classifyStage(state: WealthState, now = new Date()): MoneyStage {
  // The debt track holds until the debts recorded are paid off. No debt
  // recorded yet still counts: the user said it is there.
  if (state.onboardingAnswers?.primaryGoal === "debt") {
    const owed = totalLiabilities(state.liabilities);
    if (owed > 0) return stage("debt", `${money(owed)} still owed.`, "debt");
    if (state.liabilities.length === 0) return stage("debt", "You said paying off debt comes first.", "debt");
  }

  // Planned monthly spending: the same figure the buffer suggestion and the
  // Q&A use (Settings' fixed costs, which the Q&A fills in).
  const monthly = suggestedEmergencyTarget(state, 1)?.monthlyEssential ?? null;
  const { current, target } = state.emergency;
  const cover = monthly ? current / monthly : null;
  // No target set: the usual size for this person (6 months when self-employed).
  const usualMonths = bufferMonthsFor(state.onboardingAnswers);
  const targetMonths = target > 0 && monthly ? target / monthly : usualMonths;
  const full = target > 0 ? current >= target : cover !== null && cover >= usualMonths;

  if (spendingAboveIncome(state, monthly, now)) {
    return stage("base", "Spending is at or above income. First, make some room each month.", "overspending");
  }
  if (full) {
    return state.trades.length > 0
      ? stage("growing", "Your safety buffer is in place, and you're investing.")
      : stage("ready", "Your safety buffer is full. Next: decide a monthly amount to invest.");
  }
  if (cover === null) {
    // No spending figure to measure months against.
    if (target > 0 && current > 0) {
      return stage("buffer", `${Math.round((current / target) * 100)}% of your ${money(target)} buffer saved.`);
    }
    return stage("base", "Add your monthly spending to measure your safety buffer.", "unmeasured");
  }
  if (cover < 1) return stage("base", "Your savings cover less than a month of spending.");
  return stage("buffer", `About ${months(cover)} of ${months(targetMonths)} months of spending saved.`);
}
