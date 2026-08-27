/**
 * Structured financial rules — the user's PERSONAL POLICY / PLANNING layer.
 *
 * These describe intent ("I want to invest MYR 100 a month"), never recorded
 * reality. Recorded balances always come from the ledger via
 * getFinancialSnapshot(). Nothing here should be used to compute what the user
 * actually holds.
 *
 * This module owns the shape, defaults, validation and lookup of rules.
 * Evaluating them against reality is deliberately left to rules.ts later.
 */
import type {
  FinancialRule,
  FinancialRuleKind,
  FinancialRuleOfKind,
  Ticker,
  WealthState,
} from "./models";

/** Existing de-facto drift policy, matching the 8% threshold already used by advisorMessages(). */
export const DEFAULT_DRIFT_TOLERANCE = 0.08;

const TICKER_PATTERN = /^[A-Z0-9._^:-]{1,20}$/;
const MAX_GOAL_CONTRIBUTION_RULES = 100;
const MAX_TRANCHES = 20;

/** Singleton rules use their kind as a stable id; goal rules are keyed by goal. */
export function goalContributionRuleId(goalId: string): string {
  return `goal-contribution:${goalId}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Non-negative finite amount, rounded to cents. Returns null when unusable. */
function safeAmount(value: unknown): number | null {
  if (!isFiniteNumber(value) || value < 0) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Fraction in [0, 1]. Returns null when out of bounds or unusable. */
function safeFraction(value: unknown): number | null {
  if (!isFiniteNumber(value) || value < 0 || value > 1) return null;
  return value;
}

function safeTargets(value: unknown): Record<Ticker, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const targets: Record<Ticker, number> = {};
  for (const [rawTicker, rawWeight] of Object.entries(value as Record<string, unknown>)) {
    const ticker = rawTicker.trim().toUpperCase();
    if (!TICKER_PATTERN.test(ticker)) continue;
    const weight = safeFraction(rawWeight);
    if (weight === null) continue;
    targets[ticker] = weight;
  }
  return Object.keys(targets).length > 0 ? targets : null;
}

/**
 * Validate and normalize one candidate rule.
 * Returns null for anything malformed so a single bad rule can be dropped
 * without taking the rest of the state down with it.
 */
export function validateFinancialRule(candidate: unknown): FinancialRule | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const rule = candidate as Record<string, unknown>;
  if (typeof rule.id !== "string" || !rule.id.trim()) return null;
  const id = rule.id.trim().slice(0, 120);
  // Default to enabled: a rule persisted without the flag is still a rule.
  const enabled = rule.enabled !== false;

  switch (rule.kind) {
    case "emergency-fund-minimum": {
      const targetAmount = safeAmount(rule.targetAmount);
      if (targetAmount === null) return null;
      return { id, kind: "emergency-fund-minimum", enabled, targetAmount };
    }
    case "monthly-spending-limit": {
      const limitAmount = safeAmount(rule.limitAmount);
      if (limitAmount === null) return null;
      return { id, kind: "monthly-spending-limit", enabled, limitAmount };
    }
    case "dca-monthly-amount": {
      const amount = safeAmount(rule.amount);
      if (amount === null) return null;
      return { id, kind: "dca-monthly-amount", enabled, amount };
    }
    case "target-allocation": {
      const targets = safeTargets(rule.targets);
      if (targets === null) return null;
      return { id, kind: "target-allocation", enabled, targets };
    }
    case "allocation-drift-tolerance": {
      const maxDrift = safeFraction(rule.maxDrift);
      if (maxDrift === null) return null;
      return { id, kind: "allocation-drift-tolerance", enabled, maxDrift };
    }
    case "opportunity-reserve-deployment": {
      if (!Array.isArray(rule.tranches)) return null;
      const tranches = rule.tranches.flatMap((entry): Array<{ drawdown: number; percent: number }> => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        const percent = safeFraction(item.percent);
        // Drawdown is stored as a positive percentage: 10 means a -10% move.
        if (percent === null || !isFiniteNumber(item.drawdown) || item.drawdown <= 0 || item.drawdown > 100) return [];
        return [{ drawdown: item.drawdown, percent }];
      })
        .sort((left, right) => left.drawdown - right.drawdown)
        .slice(0, MAX_TRANCHES);
      if (tranches.length === 0) return null;
      return { id, kind: "opportunity-reserve-deployment", enabled, tranches };
    }
    case "goal-contribution": {
      if (typeof rule.goalId !== "string" || !rule.goalId.trim()) return null;
      const monthlyAmount = safeAmount(rule.monthlyAmount);
      if (monthlyAmount === null) return null;
      return { id, kind: "goal-contribution", enabled, goalId: rule.goalId.trim(), monthlyAmount };
    }
    default:
      return null;
  }
}

/**
 * Normalize a persisted rule array: drop malformed entries and de-duplicate by
 * id, keeping the first occurrence.
 */
export function normalizeFinancialRules(value: unknown): FinancialRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rules: FinancialRule[] = [];
  let goalRuleCount = 0;
  for (const candidate of value) {
    const rule = validateFinancialRule(candidate);
    if (!rule || seen.has(rule.id)) continue;
    if (rule.kind === "goal-contribution") {
      if (goalRuleCount >= MAX_GOAL_CONTRIBUTION_RULES) continue;
      goalRuleCount += 1;
    }
    seen.add(rule.id);
    rules.push(rule);
  }
  return rules;
}

/**
 * Seed rules from the user's existing planning configuration, so an upgrading
 * user gets rules that already match what they had set up rather than
 * arbitrary defaults. Where no sensible mapping exists the rule is created
 * disabled with a zero value rather than inventing a financial decision.
 */
export function getDefaultFinancialRules(state: Pick<WealthState, "emergency" | "cashflow" | "dca" | "opportunity" | "goals">): FinancialRule[] {
  const rules: FinancialRule[] = [];

  const emergencyTarget = safeAmount(state.emergency?.target) ?? 0;
  rules.push({
    id: "emergency-fund-minimum",
    kind: "emergency-fund-minimum",
    enabled: emergencyTarget > 0,
    targetAmount: emergencyTarget,
  });

  // Planned basic spending is the closest existing analogue of a spending cap.
  const cashflow = state.cashflow;
  const basicSpending = safeAmount(
    (cashflow?.transport ?? 0) + (cashflow?.food ?? 0) + (cashflow?.otherFixed ?? 0),
  ) ?? 0;
  rules.push({
    id: "monthly-spending-limit",
    kind: "monthly-spending-limit",
    enabled: basicSpending > 0,
    limitAmount: basicSpending,
  });

  const dcaMonthly = safeAmount(state.dca?.monthly) ?? 0;
  rules.push({
    id: "dca-monthly-amount",
    kind: "dca-monthly-amount",
    enabled: dcaMonthly > 0,
    amount: dcaMonthly,
  });

  const targets = safeTargets(state.dca?.targets);
  rules.push({
    id: "target-allocation",
    kind: "target-allocation",
    // An all-zero target map is a placeholder, not a policy the user set.
    enabled: targets !== null && Object.values(targets).some((weight) => weight > 0),
    targets: targets ?? {},
  });

  rules.push({
    id: "allocation-drift-tolerance",
    kind: "allocation-drift-tolerance",
    enabled: true,
    maxDrift: DEFAULT_DRIFT_TOLERANCE,
  });

  const tranches = Array.isArray(state.opportunity?.tranches)
    ? state.opportunity.tranches
        .flatMap((tranche): Array<{ drawdown: number; percent: number }> => {
          const percent = safeFraction(tranche?.percent);
          if (percent === null || !isFiniteNumber(tranche?.drawdown) || tranche.drawdown <= 0 || tranche.drawdown > 100) return [];
          return [{ drawdown: tranche.drawdown, percent }];
        })
        .sort((left, right) => left.drawdown - right.drawdown)
    : [];
  rules.push({
    id: "opportunity-reserve-deployment",
    kind: "opportunity-reserve-deployment",
    enabled: tranches.length > 0,
    tranches,
  });

  for (const goal of state.goals ?? []) {
    if (!goal || typeof goal.id !== "string" || !goal.id.trim()) continue;
    const monthlyAmount = safeAmount(goal.monthlyContribution);
    if (monthlyAmount === null || monthlyAmount <= 0) continue;
    if (rules.length >= MAX_GOAL_CONTRIBUTION_RULES) break;
    rules.push({
      id: goalContributionRuleId(goal.id),
      kind: "goal-contribution",
      enabled: true,
      goalId: goal.id,
      monthlyAmount,
    });
  }

  // A zero-tranche deployment rule would fail validateFinancialRule on the next
  // load, so drop it rather than persist something that cannot round-trip.
  return normalizeFinancialRules(rules.filter((rule) => rule.kind !== "opportunity-reserve-deployment" || rule.tranches.length > 0));
}

/** All structured rules on the state. Pure. */
export function getFinancialRules(state: Pick<WealthState, "financialRules">): FinancialRule[] {
  return state.financialRules ?? [];
}

/**
 * The first rule of a given kind, or undefined. Returns the correctly narrowed
 * variant so callers get typed access to that rule's parameters.
 */
export function getFinancialRule<K extends FinancialRuleKind>(
  state: Pick<WealthState, "financialRules">,
  kind: K,
): FinancialRuleOfKind<K> | undefined {
  return getFinancialRules(state).find((rule): rule is FinancialRuleOfKind<K> => rule.kind === kind);
}

/** Rules of a given kind — useful for goal-contribution, which can repeat. */
export function getFinancialRulesOfKind<K extends FinancialRuleKind>(
  state: Pick<WealthState, "financialRules">,
  kind: K,
): Array<FinancialRuleOfKind<K>> {
  return getFinancialRules(state).filter((rule): rule is FinancialRuleOfKind<K> => rule.kind === kind);
}
