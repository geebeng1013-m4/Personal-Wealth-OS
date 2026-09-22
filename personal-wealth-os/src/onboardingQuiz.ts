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

// --- Q-3: the sentence-style answers (Schema v28) ------------------------------

export type LifeStage = "student" | "working" | "self-employed" | "between-jobs" | "retired";
export const LIFE_STAGES: readonly LifeStage[] = ["student", "working", "self-employed", "between-jobs", "retired"];

/**
 * Income as a band rather than a figure: easier to answer, and less to hand
 * over. The plan uses the band's `estimate` (labelled as one); a student's
 * bands are an allowance's size.
 */
export interface IncomeRange {
  id: string;
  label: string;
  estimate: number;
}
export const STUDENT_INCOME_RANGES: readonly IncomeRange[] = [
  { id: "under-500", label: "under RM500", estimate: 400 },
  { id: "500-1000", label: "RM500–1,000", estimate: 750 },
  { id: "1000-2500", label: "RM1,000–2,500", estimate: 1750 },
  { id: "over-2500", label: "over RM2,500", estimate: 3000 },
];
export const INCOME_RANGES: readonly IncomeRange[] = [
  { id: "under-2500", label: "under RM2,500", estimate: 2000 },
  { id: "2500-4000", label: "RM2,500–4,000", estimate: 3250 },
  { id: "4000-6000", label: "RM4,000–6,000", estimate: 5000 },
  { id: "6000-9000", label: "RM6,000–9,000", estimate: 7500 },
  { id: "over-9000", label: "over RM9,000", estimate: 10000 },
];
const ALL_INCOME_RANGE_IDS = new Set([...STUDENT_INCOME_RANGES, ...INCOME_RANGES].map((range) => range.id));

/** The bands a person at this life stage picks from. */
export function incomeRangesFor(lifeStage: LifeStage | undefined): readonly IncomeRange[] {
  return lifeStage === "student" ? STUDENT_INCOME_RANGES : INCOME_RANGES;
}

/** "I have [1–2 months] saved": how many months of spending the savings cover, as a band. */
export type BufferBand = "none" | "under-1" | "1-2" | "3-5" | "6-plus";
export const BUFFER_BANDS: Readonly<Record<BufferBand, { label: string; months: number }>> = {
  none: { label: "no months yet", months: 0 },
  "under-1": { label: "less than 1 month", months: 0.5 },
  "1-2": { label: "1–2 months", months: 1.5 },
  "3-5": { label: "3–5 months", months: 4 },
  "6-plus": { label: "6+ months", months: 6 },
};

/** "…mostly in [a money market fund]". */
export type CashKeptIn = "savings" | "fixed-deposit" | "money-market" | "asb" | "e-wallet" | "cash";
export const CASH_KEPT_IN: readonly CashKeptIn[] = ["savings", "fixed-deposit", "money-market", "asb", "e-wallet", "cash"];

export type LongTermGoal = "retirement" | "home" | "kids-education" | "self-education" | "travel" | "not-sure";
export const LONG_TERM_GOALS: readonly LongTermGoal[] = ["retirement", "home", "kids-education", "self-education", "travel", "not-sure"];

/** What the user answered. `undefined` = skipped. (Schema v26; the Q-3 fields v28) */
export interface OnboardingAnswers {
  primaryGoal?: PrimaryGoal;
  /** v28. */
  lifeStage?: LifeStage;
  /** v28: the band picked, when the income was not typed as a figure. `monthlyIncome` then holds its estimate. */
  incomeRange?: string;
  /** Take-home pay per month, base currency. */
  monthlyIncome?: number;
  /** Everything that goes out in a month, base currency. */
  monthlySpending?: number;
  /** Savings and current accounts together, not investments. A typed figure, from the v26 quiz. */
  cashInBank?: number;
  /** v28: savings as months of spending, when no figure was typed. */
  bufferMonthsHave?: BufferBand;
  /** v28: where those savings mostly sit. */
  cashKeptIn?: CashKeptIn;
  /** v28: what matters in the long run; any number of them. */
  longTermGoals?: LongTermGoal[];
  invests?: boolean;
  goalName?: string;
  goalAmount?: number;
  /** ISO date the quiz was finished or skipped. */
  answeredAt: string;
}

/** The safety buffer the plan aims for, in months of spending. */
export const BUFFER_MONTHS = 3;
/** For income that moves month to month: a longer stretch without pay to cover. */
export const SELF_EMPLOYED_BUFFER_MONTHS = 6;

/** How many months of spending this person's buffer should hold. */
export function bufferMonthsFor(answers: Pick<OnboardingAnswers, "lifeStage"> | null | undefined): number {
  return answers?.lifeStage === "self-employed" ? SELF_EMPLOYED_BUFFER_MONTHS : BUFFER_MONTHS;
}

/**
 * The savings the answers describe: the typed figure, else the months band
 * times the spending. Null when neither says.
 */
export function answeredCash(answers: Pick<OnboardingAnswers, "cashInBank" | "bufferMonthsHave" | "monthlySpending">): number | null {
  if (answers.cashInBank !== undefined) return answers.cashInBank;
  if (answers.bufferMonthsHave === undefined || answers.monthlySpending === undefined) return null;
  return Math.round(BUFFER_BANDS[answers.bufferMonthsHave].months * answers.monthlySpending);
}
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
  if (LIFE_STAGES.includes(raw.lifeStage as LifeStage)) answers.lifeStage = raw.lifeStage as LifeStage;
  if (typeof raw.incomeRange === "string" && ALL_INCOME_RANGE_IDS.has(raw.incomeRange)) answers.incomeRange = raw.incomeRange;
  if (typeof raw.bufferMonthsHave === "string" && Object.hasOwn(BUFFER_BANDS, raw.bufferMonthsHave)) answers.bufferMonthsHave = raw.bufferMonthsHave as BufferBand;
  if (CASH_KEPT_IN.includes(raw.cashKeptIn as CashKeptIn)) answers.cashKeptIn = raw.cashKeptIn as CashKeptIn;
  if (Array.isArray(raw.longTermGoals)) {
    const goals = [...new Set(raw.longTermGoals.filter((goal): goal is LongTermGoal => LONG_TERM_GOALS.includes(goal as LongTermGoal)))];
    // "Not sure yet" means none of the others.
    const tidy: LongTermGoal[] = goals.includes("not-sure") ? ["not-sure"] : goals;
    if (tidy.length) answers.longTermGoals = tidy;
  }
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
  const { monthlyIncome: income, monthlySpending: spending } = answers;
  const cash = answeredCash(answers) ?? undefined;
  const leftover = income !== undefined && spending !== undefined ? income - spending : null;
  const bufferTarget = spending !== undefined ? spending * bufferMonthsFor(answers) : null;
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
  if (answers.primaryGoal === "buffer" && plan.bufferTarget) return `A ${bufferMonthsFor(answers)}-month safety buffer of ${money(plan.bufferTarget)}.`;
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
  } else {
    // v28: savings given as months of spending. An estimate, so it only sets
    // what the buffer holds; no account balance is made up from it — the
    // money may sit in a fund or an FD, and the balances step still asks.
    const estimated = answeredCash(answers);
    if (estimated !== null && estimated > 0 && next.emergency.current === 0) next.emergency.current = estimated;
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
