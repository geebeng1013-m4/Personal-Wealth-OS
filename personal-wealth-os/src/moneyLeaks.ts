import type { Goal, LedgerTransaction, WealthState } from "./models";

export type MoneyLeakSeverity = "high" | "medium" | "low";
export type MoneyLeakCategory = "subscription" | "fee" | "duplicate" | "increase" | "unusual" | "budget" | "goal" | "debt";
export type MoneyLeakAction = "review-recurring" | "review-ledger" | "review-budget" | "review-goal" | "review-debt";
export type MoneyLeakImpactBasis = "recurring" | "one-time";

export interface MoneyLeakEvidence {
  label: string;
  value: string;
}

/**
 * A detection result: WHAT was observed, nothing more.
 *
 * Observations deliberately carry no advice. "Why it matters" and "what to do"
 * belong to the Advisor, which combines an observation with a FinancialRule.
 * An observation is complete and valid on its own without any recommendation.
 */
export interface MoneyLeakObservation {
  id: string;
  title: string;
  category: MoneyLeakCategory;
  severity: MoneyLeakSeverity;
  monthlyImpact: number;
  annualImpact: number;
  impactBasis: MoneyLeakImpactBasis;
  confidence: number;
  /** Neutral description of what was detected. */
  summary: string;
  /** Ledger transactions this finding was derived from. */
  transactionIds: string[];
  /** Non-transaction sources: goal, liability or recurring-transaction ids. */
  relatedEntityIds: string[];
  evidence: MoneyLeakEvidence[];
}

export interface MoneyLeakFindings {
  leaks: MoneyLeakObservation[];
  monthlyImpact: number;
  annualImpact: number;
  highCount: number;
  categoryCount: number;
  topLeak?: MoneyLeakObservation;
}

const feePattern = /\b(fee|charge|penalty|interest|late|overdraft|atm)\b/i;
const subscriptionPattern = /\b(spotify|netflix|youtube|icloud|google one|adobe|canva|notion|subscription|membership|gym|prime)\b/i;

function severityForMonthlyImpact(monthlyImpact: number): MoneyLeakSeverity {
  if (monthlyImpact >= 100) return "high";
  if (monthlyImpact >= 30) return "medium";
  return "low";
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function categoryLabel(state: WealthState, transaction: LedgerTransaction): string {
  return state.ledgerCategories.find((category) => category.id === transaction.categoryId)?.label ?? "Uncategorised";
}

function comparableLabel(state: WealthState, transaction: LedgerTransaction): string {
  const note = transaction.note?.trim().toLowerCase();
  return note || categoryLabel(state, transaction).toLowerCase();
}

function expenseMonths(state: WealthState): Map<string, LedgerTransaction[]> {
  const months = new Map<string, LedgerTransaction[]>();
  state.ledgerTransactions
    .filter((transaction) => transaction.type === "expense")
    .forEach((transaction) => {
      const key = monthKey(transaction.date);
      months.set(key, [...(months.get(key) ?? []), transaction]);
    });
  return months;
}

function detectRecurringSubscriptions(state: WealthState): MoneyLeakObservation[] {
  return state.recurringTransactions
    .filter((transaction) => transaction.active && transaction.type === "expense" && subscriptionPattern.test(transaction.label))
    .map((transaction) => ({
      id: `subscription-${transaction.id}`,
      title: `Review ${transaction.label}`,
      category: "subscription" as const,
      severity: severityForMonthlyImpact(transaction.amount),
      monthlyImpact: transaction.amount,
      annualImpact: transaction.amount * 12,
      impactBasis: "recurring" as const,
      confidence: 0.98,
      summary: `${transaction.label} repeats every month and is a direct cancellation or downgrade candidate.`,
      transactionIds: [],
      relatedEntityIds: [transaction.id],
      evidence: [
        { label: "Monthly charge", value: `MYR ${transaction.amount.toFixed(2)}` },
        { label: "Payment day", value: `Day ${transaction.dayOfMonth}` },
        { label: "Status", value: "Active recurring payment" },
      ],
    }));
}

function detectFees(state: WealthState): MoneyLeakObservation[] {
  const matching = state.ledgerTransactions.filter((transaction) => {
    if (transaction.type !== "expense") return false;
    return feePattern.test(`${transaction.note ?? ""} ${categoryLabel(state, transaction)}`);
  });
  if (matching.length === 0) return [];
  const months = new Set(matching.map((transaction) => monthKey(transaction.date))).size || 1;
  const monthlyImpact = matching.reduce((sum, transaction) => sum + transaction.amount, 0) / months;
  return [{
    id: "avoidable-fees",
    title: "Avoidable fees and charges",
    category: "fee",
    severity: severityForMonthlyImpact(monthlyImpact),
    monthlyImpact,
    annualImpact: monthlyImpact * 12,
    impactBasis: "recurring",
    confidence: 0.9,
    summary: `${matching.length} ledger ${matching.length === 1 ? "entry looks" : "entries look"} like a fee, penalty, or interest charge.`,
    transactionIds: matching.map((transaction) => transaction.id),
    relatedEntityIds: [],
    evidence: matching.slice(0, 4).map((transaction) => ({
      label: transaction.date,
      value: `${transaction.note || categoryLabel(state, transaction)} · MYR ${transaction.amount.toFixed(2)}`,
    })),
  }];
}

function detectDuplicates(state: WealthState): MoneyLeakObservation[] {
  const groups = new Map<string, LedgerTransaction[]>();
  state.ledgerTransactions
    .filter((transaction) => transaction.type === "expense")
    .forEach((transaction) => {
      const key = `${transaction.date}|${transaction.amount.toFixed(2)}|${comparableLabel(state, transaction)}`;
      groups.set(key, [...(groups.get(key) ?? []), transaction]);
    });
  return [...groups.values()]
    .filter((transactions) => transactions.length > 1)
    .map((transactions) => {
      const duplicateImpact = transactions.slice(1).reduce((sum, transaction) => sum + transaction.amount, 0);
      const first = transactions[0];
      return {
        id: `duplicate-${first.id}`,
        title: "Possible duplicate charge",
        category: "duplicate" as const,
        severity: severityForMonthlyImpact(duplicateImpact),
        monthlyImpact: duplicateImpact,
        annualImpact: duplicateImpact,
        impactBasis: "one-time" as const,
        confidence: 0.86,
        summary: `${transactions.length} expenses share the same date, amount, and description.`,
        transactionIds: transactions.map((transaction) => transaction.id),
        relatedEntityIds: [],
        evidence: transactions.map((transaction) => ({
          label: transaction.date,
          value: `${transaction.note || categoryLabel(state, transaction)} · MYR ${transaction.amount.toFixed(2)}`,
        })),
      };
    });
}

function detectSpendingIncrease(state: WealthState): MoneyLeakObservation[] {
  const months = [...expenseMonths(state).entries()].sort(([a], [b]) => b.localeCompare(a));
  if (months.length < 2) return [];
  const [[currentMonth, currentTransactions], [previousMonth, previousTransactions]] = months;
  const currentTotal = currentTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const previousTotal = previousTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const increase = currentTotal - previousTotal;
  if (previousTotal <= 0 || increase < Math.max(50, previousTotal * 0.15)) return [];
  const increasePercent = increase / previousTotal;
  return [{
    id: `increase-${currentMonth}`,
    title: "Monthly spending has increased",
    category: "increase",
    severity: severityForMonthlyImpact(increase),
    monthlyImpact: increase,
    annualImpact: increase * 12,
    impactBasis: "recurring",
    confidence: 0.92,
    summary: `Expenses rose by MYR ${increase.toFixed(0)} (${(increasePercent * 100).toFixed(0)}%) from ${previousMonth} to ${currentMonth}.`,
    transactionIds: currentTransactions.map((transaction) => transaction.id),
    relatedEntityIds: [],
    evidence: [
      { label: `${previousMonth} expenses`, value: `MYR ${previousTotal.toFixed(2)}` },
      { label: `${currentMonth} expenses`, value: `MYR ${currentTotal.toFixed(2)}` },
      { label: "Month-over-month increase", value: `${(increasePercent * 100).toFixed(1)}%` },
    ],
  }];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function detectUnusualSpending(state: WealthState): MoneyLeakObservation[] {
  const expenses = state.ledgerTransactions.filter((transaction) => transaction.type === "expense");
  if (expenses.length < 6) return [];
  const typicalAmount = median(expenses.map((transaction) => transaction.amount));
  const threshold = Math.max(150, typicalAmount * 3);
  return expenses
    .filter((transaction) => transaction.amount >= threshold)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 2)
    .map((transaction) => ({
      id: `unusual-${transaction.id}`,
      title: `Unusual ${categoryLabel(state, transaction).toLowerCase()} expense`,
      category: "unusual" as const,
      severity: severityForMonthlyImpact(transaction.amount),
      monthlyImpact: transaction.amount,
      annualImpact: transaction.amount,
      impactBasis: "one-time" as const,
      confidence: 0.84,
      summary: `This MYR ${transaction.amount.toFixed(0)} expense is more than three times the typical ledger expense of MYR ${typicalAmount.toFixed(0)}.`,
      transactionIds: [transaction.id],
      relatedEntityIds: [],
      evidence: [
        { label: "Transaction date", value: transaction.date },
        { label: "Description", value: transaction.note || categoryLabel(state, transaction) },
        { label: "Observed amount", value: `MYR ${transaction.amount.toFixed(2)}` },
        { label: "Typical expense", value: `MYR ${typicalAmount.toFixed(2)}` },
      ],
    }));
}

function detectBudgetDrift(state: WealthState): MoneyLeakObservation[] {
  const months = [...expenseMonths(state).entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 3);
  if (months.length === 0) return [];
  const categoryTotals = new Map<string, number>();
  months.forEach(([, transactions]) => transactions.forEach((transaction) => {
    const label = categoryLabel(state, transaction);
    categoryTotals.set(label, (categoryTotals.get(label) ?? 0) + transaction.amount);
  }));
  const planByCategory = new Map<string, number>([
    ["Food", state.cashflow.food],
    ["Transport", state.cashflow.transport],
    ["Bills", state.cashflow.otherFixed],
  ]);
  return [...planByCategory.entries()].flatMap(([label, planned]) => {
    if (planned <= 0) return [];
    const average = (categoryTotals.get(label) ?? 0) / months.length;
    const drift = average - planned;
    if (drift < Math.max(25, planned * 0.1)) return [];
    return [{
      id: `budget-${label.toLowerCase()}`,
      title: `${label} is drifting above plan`,
      category: "budget" as const,
      severity: severityForMonthlyImpact(drift),
      monthlyImpact: drift,
      annualImpact: drift * 12,
      impactBasis: "recurring" as const,
      confidence: 0.82,
      summary: `Recent ${label.toLowerCase()} spending averages MYR ${average.toFixed(0)} against a MYR ${planned.toFixed(0)} monthly plan.`,
      transactionIds: months.flatMap(([, transactions]) => transactions.filter((transaction) => categoryLabel(state, transaction) === label).map((transaction) => transaction.id)),
      relatedEntityIds: [],
      evidence: [
        { label: "Recent monthly average", value: `MYR ${average.toFixed(2)}` },
        { label: "Current monthly plan", value: `MYR ${planned.toFixed(2)}` },
        { label: "Average monthly drift", value: `MYR ${drift.toFixed(2)}` },
      ],
    }];
  });
}

function goalUrgency(goal: Goal): { shortfall: number; suggestedMonthly: number } | undefined {
  if (goal.target <= goal.current || goal.monthlyContribution > 0) return undefined;
  const suggestedMonthly = (goal.target - goal.current) / 12;
  return { shortfall: suggestedMonthly, suggestedMonthly };
}

function detectGoalDrift(state: WealthState): MoneyLeakObservation[] {
  return state.goals.flatMap((goal) => {
    const urgency = goalUrgency(goal);
    if (!urgency) return [];
    return [{
      id: `goal-${goal.id}`,
      title: `${goal.name} has no active contribution`,
      category: "goal" as const,
      severity: severityForMonthlyImpact(urgency.shortfall),
      monthlyImpact: urgency.shortfall,
      annualImpact: urgency.shortfall * 12,
      impactBasis: "recurring" as const,
      confidence: 0.95,
      summary: `No monthly contribution is assigned. A 12-month catch-up plan would require about MYR ${urgency.suggestedMonthly.toFixed(0)} per month.`,
      transactionIds: [],
      relatedEntityIds: [goal.id],
      evidence: [
        { label: "Current monthly contribution", value: `MYR ${goal.monthlyContribution.toFixed(2)}` },
        { label: "12-month catch-up estimate", value: `MYR ${urgency.suggestedMonthly.toFixed(2)}` },
        { label: "Amount remaining", value: `MYR ${Math.max(goal.target - goal.current, 0).toFixed(2)}` },
      ],
    }];
  });
}

function detectDebtDrag(state: WealthState): MoneyLeakObservation[] {
  return state.liabilities.flatMap((liability) => {
    if (liability.balance <= 0 || liability.annualRate < 0.12) return [];
    const monthlyInterest = liability.balance * liability.annualRate / 12;
    return [{
      id: `debt-${liability.id}`,
      title: `${liability.name} interest drag`,
      category: "debt" as const,
      severity: severityForMonthlyImpact(monthlyInterest),
      monthlyImpact: monthlyInterest,
      annualImpact: liability.balance * liability.annualRate,
      impactBasis: "recurring" as const,
      confidence: 0.99,
      summary: `At ${(liability.annualRate * 100).toFixed(1)}% APR, this balance creates about MYR ${monthlyInterest.toFixed(0)} in monthly interest drag.`,
      transactionIds: [],
      relatedEntityIds: [liability.id],
      evidence: [
        { label: "Outstanding balance", value: `MYR ${liability.balance.toFixed(2)}` },
        { label: "Annual rate", value: `${(liability.annualRate * 100).toFixed(1)}%` },
        { label: "Minimum payment", value: `MYR ${liability.minimumPayment.toFixed(2)}` },
      ],
    }];
  });
}

/**
 * Run all eight detectors. Returns observations only — no advice.
 * Detection thresholds, amounts, severity and confidence are unchanged.
 */
export function detectMoneyLeakFindings(state: WealthState): MoneyLeakFindings {
  const leaks = [
    ...detectRecurringSubscriptions(state),
    ...detectFees(state),
    ...detectDuplicates(state),
    ...detectSpendingIncrease(state),
    ...detectUnusualSpending(state),
    ...detectBudgetDrift(state),
    ...detectGoalDrift(state),
    ...detectDebtDrag(state),
  ].sort((a, b) => b.annualImpact - a.annualImpact || b.confidence - a.confidence);
  const annualImpact = leaks.reduce((sum, leak) => sum + leak.annualImpact, 0);
  return {
    leaks,
    monthlyImpact: leaks.filter((leak) => leak.impactBasis === "recurring").reduce((sum, leak) => sum + leak.monthlyImpact, 0),
    annualImpact,
    highCount: leaks.filter((leak) => leak.severity === "high").length,
    categoryCount: new Set(leaks.map((leak) => leak.category)).size,
    topLeak: leaks[0],
  };
}