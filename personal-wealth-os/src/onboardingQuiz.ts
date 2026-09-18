/**
 * The new-user Q&A (PLAN.md O series).
 *
 * A brand-new account answers six rough questions before it ever sees the
 * Overview, and gets back a plan built from its own numbers: what is left each
 * month, how long the cash would last, when the safety buffer is full, when
 * the goal is reached. Pressing "Start my plan" writes the answers into the
 * places the rest of the app already reads, in one save.
 *
 * Pure: no DOM, no storage. The quiz page (O-2) renders the questions and
 * calls into here; the Overview's next-step card (O-3) reads the saved answers
 * to say "Because: you said ...".
 *
 * Every answer is optional. A skipped question is `undefined` and writes
 * nothing. Answers are estimates, so the plan they produce is labelled as one
 * wherever it is shown.
 */

import type { WealthState } from "./models";
import { syncGoalContributionRules, syncPlanningRules } from "./financialRules";

export type PrimaryGoal = "buffer" | "invest" | "save" | "debt";
export const PRIMARY_GOALS: readonly PrimaryGoal[] = ["buffer", "invest", "save", "debt"];

/** What the user answered. `undefined` = skipped. (Schema v26) */
export interface OnboardingAnswers {
  primaryGoal?: PrimaryGoal;
  /** Take-home pay per month, base currency. */
  monthlyIncome?: number;
  /** Everything that goes out in a month, base currency. */
  monthlySpending?: number;
  /** Savings and current accounts together, not investments. */
  cashInBank?: number;
  invests?: boolean;
  goalName?: string;
  goalAmount?: number;
  /** ISO date the quiz was finished or skipped. */
  answeredAt: string;
}

/** The safety buffer the plan aims for, in months of spending. */
export const BUFFER_MONTHS = 3;
const MAX_AMOUNT = 1_000_000_000;
const MAX_GOAL_NAME = 60;

/**
 * How each month's leftover is split (decided 2026-09-19): buffer first while
 * it is short, then the goal and investing share it. An estimate for the plan
 * screen, not a rule the app enforces.
 */
const SPLIT_WHILE_BUFFER_SHORT = { buffer: 0.5, goal: 0.3, invest: 0.2 } as const;
const SPLIT_ONCE_BUFFER_FULL = { buffer: 0, goal: 0.6, invest: 0.4 } as const;

export interface MonthlySplit {
  buffer: number;
  goal: number;
  invest: number;
}

export interface OnboardingPlan {
  /** Income minus spending; null when either was skipped. Negative = overspending. */
  leftover: number | null;
  /** BUFFER_MONTHS of spending; null when spending was skipped. */
  bufferTarget: number | null;
  /** How many months of spending the cash covers; null without both answers. */
  monthsCovered: number | null;
  bufferFull: boolean;
  /** Whole ringgit, summing to the leftover. All zero when nothing is left over. */
  split: MonthlySplit;
  /** Months until the buffer is full at `split.buffer`; 0 when full, null when it never fills. */
  monthsToBufferFull: number | null;
  /** Months until the goal amount at `split.goal`; null when there is no goal or no money for it. */
  monthsToGoal: number | null;
}

function amountOrUndefined(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(MAX_AMOUNT, Math.round((value + Number.EPSILON) * 100) / 100);
}

/** Tidy stored answers. Anything unusable reads as skipped; a non-object is no answers at all. */
export function normalizeOnboardingAnswers(value: unknown): OnboardingAnswers | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const answers: OnboardingAnswers = {
    answeredAt: typeof raw.answeredAt === "string" ? raw.answeredAt.slice(0, 40) : "",
  };
  if (PRIMARY_GOALS.includes(raw.primaryGoal as PrimaryGoal)) answers.primaryGoal = raw.primaryGoal as PrimaryGoal;
  const income = amountOrUndefined(raw.monthlyIncome);
  if (income !== undefined) answers.monthlyIncome = income;
  const spending = amountOrUndefined(raw.monthlySpending);
  if (spending !== undefined) answers.monthlySpending = spending;
  const cash = amountOrUndefined(raw.cashInBank);
  if (cash !== undefined) answers.cashInBank = cash;
  if (typeof raw.invests === "boolean") answers.invests = raw.invests;
  const goalName = typeof raw.goalName === "string" ? raw.goalName.trim().slice(0, MAX_GOAL_NAME) : "";
  if (goalName) answers.goalName = goalName;
  const goalAmount = amountOrUndefined(raw.goalAmount);
  if (goalAmount !== undefined && goalAmount > 0) answers.goalAmount = goalAmount;
  return answers;
}

function hasGoal(answers: OnboardingAnswers): boolean {
  return Boolean(answers.goalName) && (answers.goalAmount ?? 0) > 0;
}

export function buildOnboardingPlan(answers: OnboardingAnswers): OnboardingPlan {
  const { monthlyIncome: income, monthlySpending: spending, cashInBank: cash } = answers;
  const leftover = income !== undefined && spending !== undefined ? income - spending : null;
  const bufferTarget = spending !== undefined ? spending * BUFFER_MONTHS : null;
  const monthsCovered = cash !== undefined && spending !== undefined && spending > 0 ? cash / spending : null;
  // Unknown cash is treated as nothing saved yet: the plan then puts the buffer first.
  const bufferFull = bufferTarget !== null && bufferTarget > 0 && (cash ?? 0) >= bufferTarget;

  const split: MonthlySplit = { buffer: 0, goal: 0, invest: 0 };
  if (leftover !== null && leftover > 0) {
    const shares = bufferFull || bufferTarget === null || bufferTarget === 0 ? SPLIT_ONCE_BUFFER_FULL : SPLIT_WHILE_BUFFER_SHORT;
    split.buffer = Math.round(leftover * shares.buffer);
    // Without a goal its share is invested, so every ringgit still has a place.
    split.goal = hasGoal(answers) ? Math.round(leftover * shares.goal) : 0;
    split.invest = Math.round(leftover) - split.buffer - split.goal;
  }

  let monthsToBufferFull: number | null = null;
  if (bufferFull) monthsToBufferFull = 0;
  else if (bufferTarget !== null && bufferTarget > 0 && split.buffer > 0) {
    monthsToBufferFull = Math.ceil((bufferTarget - (cash ?? 0)) / split.buffer);
  }
  const monthsToGoal = hasGoal(answers) && split.goal > 0 ? Math.ceil((answers.goalAmount ?? 0) / split.goal) : null;

  return { leftover, bufferTarget, monthsCovered, bufferFull, split, monthsToBufferFull, monthsToGoal };
}

/** One line for the Overview's goal sentence, from the goal question; "" when there is nothing to say. */
export function goalSentence(answers: OnboardingAnswers, plan: OnboardingPlan = buildOnboardingPlan(answers)): string {
  const money = (value: number) => `RM${Math.round(value).toLocaleString("en-MY")}`;
  if (answers.primaryGoal === "debt" && hasGoal(answers)) return `Clear ${money(answers.goalAmount ?? 0)} of ${answers.goalName}.`;
  if (hasGoal(answers)) return `${money(answers.goalAmount ?? 0)} for ${answers.goalName}.`;
  if (answers.primaryGoal === "buffer" && plan.bufferTarget) return `A ${BUFFER_MONTHS}-month safety buffer of ${money(plan.bufferTarget)}.`;
  if (answers.primaryGoal === "invest") return "Invest every month, once the safety buffer is in place.";
  return "";
}

export interface ApplyOptions {
  /** Id for the goal the answers create; the caller owns id generation. */
  goalId: string;
  /** Stamped as `answeredAt`. */
  today: string;
}

/**
 * The state after "Start my plan": the answers saved, and each one written
 * where the app already reads it.
 *
 * Only fills what is still empty — a value already there (from another device,
 * or set before the quiz) is never overwritten, and the goal is appended. So
 * applying twice, or to an account that is not quite new, cannot erase data.
 */
export function applyOnboardingAnswers(state: WealthState, input: Omit<OnboardingAnswers, "answeredAt">, options: ApplyOptions): WealthState {
  const answers = normalizeOnboardingAnswers({ ...input, answeredAt: options.today }) ?? { answeredAt: options.today };
  const plan = buildOnboardingPlan(answers);
  const next: WealthState = {
    ...state,
    onboardingAnswers: answers,
    cashflow: { ...state.cashflow },
    emergency: { ...state.emergency },
  };

  // Q2 → the planned monthly income the Budget reads.
  if (answers.monthlyIncome !== undefined && next.cashflow.allowance === 0) {
    next.cashflow.allowance = answers.monthlyIncome;
  }

  // Q3 → one spending total. Settings keeps it as "other fixed costs", and the
  // spending-limit rule follows it the same way a Settings save does.
  const plannedSpending = next.cashflow.transport + next.cashflow.food + next.cashflow.otherFixed;
  const kinds: Array<"monthly-spending-limit" | "emergency-fund-minimum"> = [];
  if (answers.monthlySpending !== undefined && answers.monthlySpending > 0 && plannedSpending === 0) {
    next.cashflow.otherFixed = answers.monthlySpending;
    kinds.push("monthly-spending-limit");
  }
  // Q3 → the safety buffer target.
  if (plan.bufferTarget !== null && plan.bufferTarget > 0 && next.emergency.target === 0) {
    next.emergency.target = plan.bufferTarget;
    kinds.push("emergency-fund-minimum");
  }
  if (plan.split.buffer > 0 && next.emergency.monthlyTopUp === 0) {
    next.emergency.monthlyTopUp = plan.split.buffer;
  }

  // Q4 → the bank account's balance, and what the safety buffer holds today.
  if (answers.cashInBank !== undefined && answers.cashInBank > 0) {
    const bank = state.ledgerAccounts.find((account) => account.id === "account-bank")
      ?? state.ledgerAccounts.find((account) => account.type === "bank");
    if (bank && bank.openingBalance === 0) {
      next.ledgerAccounts = state.ledgerAccounts.map((account) =>
        account.id === bank.id ? { ...account, openingBalance: answers.cashInBank ?? 0 } : account);
    }
    if (next.emergency.current === 0) next.emergency.current = answers.cashInBank;
  }

  // Q6 → the first goal, contributing its share of the monthly split.
  if (answers.goalName && answers.goalAmount) {
    next.goals = [...state.goals, {
      id: options.goalId,
      name: answers.goalName,
      label: answers.goalName,
      current: 0,
      target: answers.goalAmount,
      monthlyContribution: plan.split.goal,
      note: "",
    }];
    if (!next.overviewGoalId) next.overviewGoalId = options.goalId;
  }

  // Q1 + Q6 → the one-line goal on the Overview, only if the user has none.
  const sentence = goalSentence(answers, plan);
  if (sentence && !state.financialGoal) next.financialGoal = sentence;

  if (kinds.length > 0) next.financialRules = syncPlanningRules(next, kinds);
  if (next.goals !== state.goals) next.financialRules = syncGoalContributionRules(next);
  return next;
}

/** "I'll set up myself": the quiz is done, nothing was answered. */
export function skipOnboardingQuiz(state: WealthState, today: string): WealthState {
  return { ...state, onboardingAnswers: { answeredAt: today } };
}

/**
 * Show the quiz: the account has never taken or skipped it and holds nothing
 * yet. Anything already entered means someone past getting started — including
 * every account from before the quiz existed that was ever used.
 */
export function shouldShowOnboardingQuiz(state: WealthState): boolean {
  return state.onboardingAnswers === null
    && !state.onboardingDone
    && state.ledgerAccounts.every((account) => account.openingBalance === 0)
    && state.ledgerTransactions.length === 0
    && state.goals.length === 0
    && state.trades.length === 0;
}
