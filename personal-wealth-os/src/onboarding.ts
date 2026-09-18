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
