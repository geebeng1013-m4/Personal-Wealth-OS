/**
 * The new-user "Get started" checklist (PLAN.md F-7).
 *
 * A brand-new account opens on an Overview of zeroes with no hint of where to
 * begin. This read model lists the first few things to fill in and ticks each
 * one from the user's own data — nothing is ticked by hand, so the list can
 * never claim a step the data does not show.
 *
 * It only reads. Whether to persist `onboardingDone` once the list completes
 * is the Dashboard's call; this file just reports `complete`.
 */

import type { WealthState } from "./models";

export type OnboardingStepId = "balances" | "first-entry" | "goal" | "safety-buffer" | "investment";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  /** Where to go and what to fill in, in one line. */
  hint: string;
  /** The page that holds the field this step asks for. */
  page: string;
  done: boolean;
  /** Optional steps are shown but never hold the checklist open. */
  optional: boolean;
}

export interface OnboardingChecklist {
  steps: OnboardingStep[];
  doneCount: number;
  requiredCount: number;
  requiredDoneCount: number;
  /** Every required step is done. */
  complete: boolean;
  /** Show the card: not dismissed for good, and not yet complete. */
  visible: boolean;
}

export function buildOnboardingChecklist(state: WealthState): OnboardingChecklist {
  const steps: OnboardingStep[] = [
    {
      id: "balances",
      title: "Set your account balances",
      hint: "In Ledger, enter what each account holds today.",
      page: "ledger",
      done: state.ledgerAccounts.some((account) => account.openingBalance !== 0),
      optional: false,
    },
    {
      id: "first-entry",
      title: "Record your first income or expense",
      hint: "In Ledger, add one transaction.",
      page: "ledger",
      done: state.ledgerTransactions.length > 0,
      optional: false,
    },
    {
      id: "goal",
      title: "Set a savings goal",
      hint: "In Goals, add something you are saving for.",
      page: "goals",
      done: state.goals.length > 0,
      optional: false,
    },
    {
      id: "safety-buffer",
      title: "Set your safety buffer target",
      hint: "In Settings, enter your emergency fund target.",
      page: "settings",
      done: state.emergency.target > 0,
      optional: false,
    },
    {
      id: "investment",
      title: "Log your first investment",
      hint: "In Portfolio, record a trade you have made.",
      page: "portfolio",
      done: state.trades.length > 0,
      optional: true,
    },
  ];

  const required = steps.filter((step) => !step.optional);
  const requiredDoneCount = required.filter((step) => step.done).length;
  const complete = requiredDoneCount === required.length;
  return {
    steps,
    doneCount: steps.filter((step) => step.done).length,
    requiredCount: required.length,
    requiredDoneCount,
    complete,
    visible: !state.onboardingDone && !complete,
  };
}

// --- The Overview's "Your next step" card (PLAN.md O-3) ---------------------
//
// After the first-run Q&A the Get started list becomes one next step at a
// time. Each step says why ("Because: you said about RM 4,500 comes in each
// month"), opens a form already filled from that answer, and is ticked from
// the data — never by hand, except moving money into the buffer, which only
// the user can confirm because it happens in their bank app.
//
// Steps the quiz already covered never appear; a question that was skipped
// comes back here as its step. Accounts that never took the quiz get the same
// steps with a general reason.

export type NextStepId = "record-pay" | "balances" | "safety-buffer" | "move-to-buffer" | "log-spending" | "goal" | "investment";

export interface NextStep {
  id: NextStepId;
  title: string;
  /** One line after "Because:". */
  because: string;
  /** "guide": go to the page, form filled in where we can. "confirm": tick it off on the card. */
  action: "guide" | "confirm";
  /** What the button says. */
  cta: string;
  /** For "confirm" steps: what doing it outside the app looks like. */
  detail?: string;
  /** For "move-to-buffer": the amount the plan moves each month. */
  amount?: number;
  done: boolean;
  optional: boolean;
}

export interface NextStepPlan {
  bufferCurrent: number;
  bufferTarget: number;
  /** The buffer figure still rests on a quiz answer, not on anything confirmed. */
  bufferEstimate: boolean;
  goalName: string;
  /** The Overview goal's saved and target amounts; both 0 without a goal. */
  goalCurrent: number;
  goalTarget: number;
  /** Months to the Overview goal at its monthly contribution; null when it has none. */
  goalMonths: number | null;
  /** The goal date still rests on estimated income: no real pay recorded yet. */
  goalEstimate: boolean;
}

export interface NextSteps {
  steps: NextStep[];
  doneCount: number;
  /** Every required step is done: the card retires for good. */
  complete: boolean;
  visible: boolean;
  /** The plan strip on the card; null for an account that never answered the quiz. */
  plan: NextStepPlan | null;
}

// The app's own way of writing an amount (see money() in rules.ts), so the card reads like the page it sits on.
const rm = (value: number) => `MYR ${Math.round(value).toLocaleString("en-MY")}`;

export function buildNextSteps(state: WealthState): NextSteps {
  const answers = state.onboardingAnswers;
  const income = state.ledgerTransactions.some((tx) => tx.type === "income");
  const expense = state.ledgerTransactions.some((tx) => tx.type === "expense");
  const hasBalances = state.ledgerAccounts.some((account) => account.openingBalance !== 0);
  const { current: bufferCurrent, target: bufferTarget, monthlyTopUp } = state.emergency;
  // The buffer grew past what the quiz recorded, or is simply full.
  const bufferMoved = bufferTarget > 0 && (bufferCurrent >= bufferTarget || bufferCurrent > (answers?.cashInBank ?? 0));

  const steps: NextStep[] = [{
    id: "record-pay",
    title: "Record this month's pay",
    because: answers?.monthlyIncome ? `You said about ${rm(answers.monthlyIncome)} comes in each month.` : "Your plan splits each payday. It starts with one.",
    action: "guide",
    cta: "Record it",
    done: income,
    optional: false,
  }];
  if (!hasBalances || answers?.cashInBank === undefined) {
    steps.push({
      id: "balances",
      title: "Set your account balances",
      because: "Your net worth starts from what your accounts hold today.",
      action: "guide",
      cta: "Set balances",
      done: hasBalances,
      optional: false,
    });
  }
  if (bufferTarget === 0 || !answers?.monthlySpending) {
    steps.push({
      id: "safety-buffer",
      title: "Set your safety buffer target",
      because: "A safety buffer is the first thing your plan protects.",
      action: "guide",
      cta: "Set a target",
      done: bufferTarget > 0,
      optional: false,
    });
  }
  if (answers && bufferTarget > 0 && monthlyTopUp > 0 && (answers.cashInBank ?? 0) < bufferTarget) {
    steps.push({
      id: "move-to-buffer",
      title: `Move ${rm(monthlyTopUp)} into your safety buffer`,
      because: `Your buffer is ${rm(Math.max(0, bufferTarget - (answers.cashInBank ?? 0)))} short of ${rm(bufferTarget)}.`,
      action: "confirm",
      cta: `I've moved ${rm(monthlyTopUp)}`,
      detail: "Transfer it in your bank app, from your current account to your savings. WealthUp never moves money; it keeps score.",
      amount: monthlyTopUp,
      done: bufferMoved,
      optional: false,
    });
  }
  steps.push({
    id: "log-spending",
    title: "Add something you spent this week",
    because: answers?.monthlySpending ? `You estimated about ${rm(answers.monthlySpending)} a month. Real entries show how close that is.` : "Real spending is what keeps the plan honest.",
    action: "guide",
    cta: "Add spending",
    done: expense,
    optional: false,
  });
  if (state.goals.length === 0) {
    steps.push({
      id: "goal",
      title: "Set a savings goal",
      because: "One goal gives your plan a date to aim for.",
      action: "guide",
      cta: "Add a goal",
      done: false,
      optional: false,
    });
  }
  if (!answers || answers.invests === true) {
    steps.push({
      id: "investment",
      title: "Log your first investment",
      because: answers?.invests ? "You said you already invest. One trade and your real return starts counting." : "Your real return, after fees and currency, starts with one trade.",
      action: "guide",
      cta: "Add a trade",
      done: state.trades.length > 0,
      optional: true,
    });
  }

  const complete = steps.every((step) => step.done || step.optional);
  const goal = state.goals.find((item) => item.id === state.overviewGoalId) ?? state.goals[0];
  const goalMonths = goal && goal.monthlyContribution > 0 && goal.target > goal.current
    ? Math.ceil((goal.target - goal.current) / goal.monthlyContribution)
    : null;

  return {
    steps,
    doneCount: steps.filter((step) => step.done).length,
    complete,
    visible: !state.onboardingDone && !complete,
    plan: answers ? {
      bufferCurrent,
      bufferTarget,
      bufferEstimate: !bufferMoved,
      goalName: goal?.name ?? "",
      goalCurrent: goal?.current ?? 0,
      goalTarget: goal?.target ?? 0,
      goalMonths,
      goalEstimate: !income,
    } : null,
  };
}
