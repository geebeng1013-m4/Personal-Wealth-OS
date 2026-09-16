/**
 * Income routing preview — what one payment is allowed to do, at the moment it
 * is recorded.
 *
 * Answers: I AM RECORDING MYR X OF INCOME — WHERE DOES IT GO?
 *
 * Facts only, no HTML. The answer depends on what the month has already
 * received: the first payment of a month fills living costs, and the fourth
 * payment of a gig worker's month may go entirely to Growth because living
 * costs were covered by the first three. So the payment is always allocated on
 * top of the month so far, never on its own.
 */

import type { WealthState } from "./models";
import { allocateIncome } from "./allocation";
import { ledgerMonthTotals } from "./ledgerSummary";

export interface IncomeRoutingPart {
  stepId: string;
  name: string;
  amount: number;
}

export interface IncomeRoutingPreview {
  /** "YYYY-MM" the payment is dated in. */
  monthKey: string;
  amount: number;
  /** Personal income already recorded that month, excluding the payment itself. */
  receivedBefore: number;
  /** Sponsored money is kept out of the plan entirely. */
  sponsored: boolean;
  /** Each layer's share of this payment, in waterfall order. Zero shares omitted. */
  parts: IncomeRoutingPart[];
  /** The part of this payment no layer claimed, because nothing catches overflow. */
  unclaimed: number;
  /** What the essential layer still needs this month once this payment lands. */
  stillShort: number;
  /** Name of the essential layer, for saying what `stillShort` is short of. */
  essentialName?: string;
}

/** Money comparisons are in base-currency cents; below this is nothing. */
const EPSILON = 0.005;

export interface IncomeRoutingInput {
  amount: number;
  /** "YYYY-MM-DD" as the date input holds it. */
  date: string;
  sponsored: boolean;
  /** When editing an existing transaction, leave it out of the month so far. */
  excludeTransactionId?: string;
}

/**
 * Preview where a payment goes. Null when there is nothing to say: no amount
 * yet, an unreadable date, or a plan with no layers.
 */
export function previewIncomeRouting(state: WealthState, input: IncomeRoutingInput): IncomeRoutingPreview | null {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const monthKey = /^\d{4}-\d{2}/.test(input.date ?? "") ? input.date.slice(0, 7) : "";
  if (!monthKey) return null;

  const plan = state.allocation;
  if (!plan || (plan.steps ?? []).length === 0) return null;

  const others = (state.ledgerTransactions ?? []).filter((transaction) => transaction.id !== input.excludeTransactionId);
  const receivedBefore = ledgerMonthTotals(others, monthKey).personalIncome;

  if (input.sponsored) {
    return { monthKey, amount, receivedBefore, sponsored: true, parts: [], unclaimed: 0, stillShort: 0 };
  }

  const result = allocateIncome(plan, receivedBefore, amount);
  const parts = result.rows
    .filter((row) => row.added > EPSILON)
    .map((row) => ({ stepId: row.stepId, name: row.name, amount: row.added }));
  const claimed = parts.reduce((sum, part) => sum + part.amount, 0);
  const essential = result.rows.find((row) => row.stepKind === "fill");

  return {
    monthKey,
    amount,
    receivedBefore,
    sponsored: false,
    parts,
    unclaimed: Math.max(0, amount - claimed),
    stillShort: result.shortfall,
    ...(essential ? { essentialName: essential.name } : {}),
  };
}
