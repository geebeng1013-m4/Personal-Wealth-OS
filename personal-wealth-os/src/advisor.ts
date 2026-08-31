/**
 * Advisor — deterministic, rules-based recommendations.
 *
 * Every recommendation is traceable as FACT → RULE → IMPACT → ACTION:
 *   FACT    an observation, sourced from recorded reality or planning config
 *   RULE    the structured FinancialRule / policy that gives the fact meaning
 *   IMPACT  why the fact matters
 *   ACTION  one concrete next step
 *
 * Source-of-truth discipline:
 *   - Recorded financial facts (net worth, cash, recorded monthly spending)
 *     come from getFinancialSnapshot().
 *   - Personal policies (emergency minimum, spending limit, DCA amount,
 *     allocation targets, drift tolerance, reserve ladder) come from
 *     state.financialRules.
 *   - Planning figures (state.cashflow) are used ONLY where the Advisor is
 *     deliberately evaluating a planning rule, never as recorded reality.
 *   - Portfolio trade cost basis stays separate from ledger balances.
 *
 * No AI, no market predictions, no automatic trading — same architecture as
 * before, with an explicit contract.
 *
 * This lives outside rules.ts because financialHealth.ts already imports
 * rules.ts; putting the advisor there would create an import cycle.
 */
import type {
  AdvisorAction,
  AdvisorEvidence,
  AdvisorMessage,
  AdvisorRecommendation,
  WealthState,
} from "./models";
import {
  emergencyRatio,
  money,
  monthsToEmergencyTarget,
  percent,
} from "./rules";
import { getPortfolioSnapshot, type PortfolioSnapshot } from "./portfolioSummary";
import { getBudgetSnapshot, type BudgetSnapshot } from "./budgetSummary";
import { getFinancialSnapshot, type FinancialSnapshot } from "./financialHealth";
import { DEFAULT_DRIFT_TOLERANCE, getFinancialRule, goalContributionRuleId } from "./financialRules";
import {
  detectMoneyLeakFindings,
  type MoneyLeakAction,
  type MoneyLeakCategory,
  type MoneyLeakFindings,
  type MoneyLeakObservation,
} from "./moneyLeaks";

/** Stable recommendation ids. Keyed by concern, not by outcome, so a card keeps its identity as the situation changes. */
export const ADVISOR_RECOMMENDATION_IDS = {
  emergencyFund: "advisor:emergency-fund",
  dcaMandate: "advisor:dca-mandate",
  allocationDrift: "advisor:allocation-drift",
  opportunityReserve: "advisor:opportunity-reserve",
  cashflowDiscipline: "advisor:cashflow-discipline",
  spendingLimit: "advisor:spending-limit",
} as const;

function evidence(label: string, value: string): AdvisorEvidence {
  return { label, value };
}

/**
 * Canonical facts the Advisor reasons over.
 *
 * The Advisor OWNS the rules and the ranking; it does not own these facts. A
 * caller that has already built them for this same state can pass them in so
 * the Advisor consumes the canonical facts instead of rescanning the state to
 * rebuild identical ones. Anything omitted is built here exactly as before.
 *
 * This keeps the pipeline pointing one way — facts → recommendations →
 * AdvisorSnapshot — and introduces no dependency on Overview or the UI: these
 * are plain read-model types, and the Advisor never asks who assembled them.
 */
export interface AdvisorInputs {
  /**
   * The instant to build against. Only used for a snapshot this call has to
   * build itself — a passed `snapshot` / `portfolio` / `budget` already carries
   * its own instant. Defaults to now, so production callers omit it; a test
   * pins it so "this month" does not drift with the clock.
   */
  now?: Date;
  snapshot?: FinancialSnapshot;
  portfolio?: PortfolioSnapshot;
  budget?: BudgetSnapshot;
}

/**
 * Deterministic recommendations for the given state.
 * Pure: the same state always produces the same recommendations in the same order.
 */
export function advisorRecommendations(state: WealthState, inputs: AdvisorInputs = {}): AdvisorRecommendation[] {
  const snapshot = inputs.snapshot ?? getFinancialSnapshot(state, inputs.now);
  const portfolio = inputs.portfolio ?? getPortfolioSnapshot(state, inputs.now);
  const recommendations: AdvisorRecommendation[] = [];

  // --- Emergency fund: structured emergency rule vs configured progress ---
  const emergencyRule = getFinancialRule(state, "emergency-fund-minimum");
  const emergencyTarget = emergencyRule?.targetAmount ?? state.emergency.target;
  const emergency = emergencyRatio(state);
  const months = monthsToEmergencyTarget(state);
  const emergencyFunded = emergency >= 1;
  recommendations.push({
    id: ADVISOR_RECOMMENDATION_IDS.emergencyFund,
    severity: emergencyFunded ? "positive" : "watch",
    title: emergencyFunded ? "Safety bucket complete ✅" : "Safety still needs funding",
    fact: emergencyFunded
      ? `Emergency Fund reached ${money(emergencyTarget)}! You're safe.`
      : `Emergency Fund is ${percent(emergency)} complete.`,
    ruleId: emergencyRule?.id ?? null,
    rule: emergencyRule
      ? `Hold at least ${money(emergencyRule.targetAmount)} in the emergency fund.`
      : "No emergency-fund minimum is configured.",
    impact: emergencyFunded
      ? "A fully funded buffer means an unexpected bill no longer forces you to sell investments."
      : "Until the buffer is full, an unexpected bill could force you to sell investments at a bad time.",
    action: emergencyFunded
      ? "Consider redirecting savings to Happy Fun and Wishlist."
      : `Keep MYR ${state.emergency.monthlyTopUp}/month; estimated completion in ${months} months.`,
    destination: "goals",
    evidence: [
      evidence("Current", money(state.emergency.current)),
      evidence("Target", money(emergencyTarget)),
      evidence("Complete", percent(emergency)),
    ],
  });

  // --- DCA mandate: structured DCA amount + target allocation ---
  const dcaRule = getFinancialRule(state, "dca-monthly-amount");
  const allocationRule = getFinancialRule(state, "target-allocation");
  const dcaMonthly = dcaRule?.amount ?? state.dca.monthly;
  const allocationTargets = allocationRule?.targets ?? state.dca.targets;
  const targetEntries = Object.entries(allocationTargets).filter(([, allocation]) => allocation > 0);
  const allocationLabel = targetEntries.length > 0
    ? targetEntries.map(([ticker, allocation]) => `${ticker} ${money(dcaMonthly * allocation)}`).join(" / ")
    : "No target allocation configured";
  recommendations.push({
    id: ADVISOR_RECOMMENDATION_IDS.dcaMandate,
    severity: "positive",
    title: "Keep DCA mechanical",
    fact: `Monthly DCA remains ${money(dcaMonthly)}: ${allocationLabel}.`,
    ruleId: dcaRule?.id ?? null,
    rule: dcaRule
      ? `Invest ${money(dcaRule.amount)} every month regardless of market conditions.`
      : "No monthly DCA amount is configured.",
    impact: "Investing on a fixed schedule removes timing decisions, which is where most avoidable losses come from.",
    action: "Execute this month's contribution on schedule and record it.",
    destination: "portfolio",
    evidence: [
      evidence("Monthly amount", money(dcaMonthly)),
      evidence("Split", allocationLabel),
    ],
  });

  // --- Allocation drift: threshold comes from the structured drift rule ---
  const driftRule = getFinancialRule(state, "allocation-drift-tolerance");
  const driftTolerance = driftRule?.maxDrift ?? DEFAULT_DRIFT_TOLERANCE;
  const driftExceeded = portfolio.maxAbsoluteDrift > driftTolerance;
  const profileLabel = state.profile.age > 0
    ? `${state.profile.age}-year-old ${state.profile.riskTolerance.toLowerCase()}-risk investor`
    : `${state.profile.riskTolerance.toLowerCase()}-risk investor`;
  recommendations.push({
    id: ADVISOR_RECOMMENDATION_IDS.allocationDrift,
    severity: driftExceeded ? "action" : "positive",
    title: driftExceeded ? "Allocation drift is visible" : "Allocation drift is controlled",
    fact: driftExceeded
      ? `Largest drift is ${percent(portfolio.maxAbsoluteDrift)}.`
      : `Your configured allocation remains within a practical tolerance band for a ${profileLabel}.`,
    ruleId: driftRule?.id ?? null,
    rule: `Keep each holding within ${percent(driftTolerance)} of its target weight.`,
    impact: driftExceeded
      ? "Drifting past the tolerance band means your real risk no longer matches the allocation you chose."
      : "Staying inside the band keeps your actual risk aligned with the allocation you chose.",
    action: driftExceeded
      ? "Direct future buys toward the underweight ETF before changing strategy."
      : "No rebalancing needed — continue the scheduled contributions.",
    destination: "portfolio",
    evidence: [
      evidence("Largest drift", percent(portfolio.maxAbsoluteDrift)),
      evidence("Tolerance", percent(driftTolerance)),
    ],
  });

  // --- Opportunity reserve: ladder comes from the structured deployment rule ---
  const reserveRule = getFinancialRule(state, "opportunity-reserve-deployment");
  const reserveRemaining = state.opportunity.total - state.opportunity.used;
  const ladderLabel = reserveRule && reserveRule.tranches.length > 0
    ? reserveRule.tranches.map((tranche) => `-${tranche.drawdown}%`).join(", ")
    : "-10%, -15%, and -20%";
  recommendations.push({
    id: ADVISOR_RECOMMENDATION_IDS.opportunityReserve,
    severity: "watch",
    title: "Opportunity Reserve remains separate",
    fact: `${money(reserveRemaining)} is reserved for ${ladderLabel} deployment rules.`,
    ruleId: reserveRule?.id ?? null,
    rule: reserveRule
      ? `Deploy the reserve only at the configured drawdown steps (${ladderLabel}).`
      : "No deployment ladder is configured.",
    impact: "Spending the reserve on daily costs removes the only capital earmarked for buying a genuine downturn.",
    action: "Do not mix it with daily spending.",
    destination: "advisor",
    evidence: [
      evidence("Reserved", money(reserveRemaining)),
      evidence("Triggers", ladderLabel),
    ],
  });

  // --- Cashflow discipline ---
  // Deliberately PLANNING surplus (allowance/fixed costs) vs the planned DCA
  // amount. This rule asks "does my plan add up?", not "what did I actually
  // spend?", so recorded surplus must not be substituted here.
  // Planned surplus comes from the canonical budget read model.
  const surplus = (inputs.budget ?? getBudgetSnapshot(state, inputs.now)).plannedSurplus;
  const surplusCoversDca = surplus >= dcaMonthly;
  recommendations.push({
    id: ADVISOR_RECOMMENDATION_IDS.cashflowDiscipline,
    severity: surplusCoversDca ? "positive" : "action",
    title: "Cashflow discipline",
    fact: `Monthly assignable surplus is ${money(surplus)} after basic spending.`,
    ruleId: dcaRule?.id ?? null,
    rule: `The plan must leave at least ${money(dcaMonthly)} free for the monthly contribution.`,
    impact: surplusCoversDca
      ? "This currently covers the configured DCA plan."
      : `This is ${money(dcaMonthly - surplus)} below the configured DCA plan, so the plan cannot hold as written.`,
    action: surplusCoversDca
      ? "Keep the plan as configured."
      : "Reduce planned spending or lower the DCA amount so the plan is achievable.",
    destination: "buckets",
    evidence: [
      evidence("Planned surplus", money(surplus)),
      evidence("Planned DCA", money(dcaMonthly)),
    ],
  });

  // --- Spending limit: structured policy vs RECORDED spending ---
  // The only recommendation that compares a policy against recorded reality.
  const spendingRule = getFinancialRule(state, "monthly-spending-limit");
  if (spendingRule && spendingRule.enabled && spendingRule.limitAmount > 0) {
    const recorded = snapshot.currentMonthExpenses;
    const overLimit = recorded > spendingRule.limitAmount;
    recommendations.push({
      id: ADVISOR_RECOMMENDATION_IDS.spendingLimit,
      severity: overLimit ? "action" : "positive",
      title: overLimit ? "Spending is over your limit" : "Spending is within your limit",
      fact: `Recorded spending this month is ${money(recorded)}.`,
      ruleId: spendingRule.id,
      rule: `Keep monthly spending at or below ${money(spendingRule.limitAmount)}.`,
      impact: overLimit
        ? `You are ${money(recorded - spendingRule.limitAmount)} over the limit, which comes straight out of what you can invest.`
        : "Staying inside the limit protects the amount available for contributions.",
      action: overLimit
        ? "Review this month's ledger entries and cut the largest non-essential category."
        : "No change needed — keep recording entries so this stays accurate.",
      destination: "ledger",
      evidence: [
        evidence("Recorded spending", money(recorded)),
        evidence("Limit", money(spendingRule.limitAmount)),
      ],
    });
  }

  return recommendations;
}

// --- Money Leak findings → Advisor recommendations ---
//
// Money Leaks answer WHAT happened. Everything below — why it matters, which
// policy applies, what to do, where to go — is the Advisor's responsibility and
// lives here, not in the detectors.

/** Advisory copy per finding category. Deterministic; no AI, no predictions. */
const LEAK_ADVICE: Record<MoneyLeakCategory, {
  impact: string;
  action: (observation: MoneyLeakObservation) => string;
  actionLabel: string;
  primaryAction: MoneyLeakAction;
  destination: string;
}> = {
  subscription: {
    impact: "The recurring schedule marks this expense as active, so it will continue unless you intervene.",
    action: () => "Confirm that you still use it. Cancel, pause, or move to a cheaper tier if the value is no longer clear.",
    actionLabel: "Review recurring payments",
    primaryAction: "review-recurring",
    destination: "ledger",
  },
  fee: {
    impact: "Fees usually provide no lasting value and can often be removed by changing payment timing, account settings, or providers.",
    action: () => "Open the matching entries, confirm the cause, then add a reminder or payment rule that prevents the next charge.",
    actionLabel: "Review matching entries",
    primaryAction: "review-ledger",
    destination: "ledger",
  },
  duplicate: {
    impact: "Identical entries can be a duplicate ledger import or an accidental merchant charge.",
    action: () => "Compare the entries with your account statement. Delete only a duplicate record; dispute a duplicated bank charge with the provider.",
    actionLabel: "Inspect transactions",
    primaryAction: "review-ledger",
    destination: "ledger",
  },
  increase: {
    impact: "If the higher spending level continues, it reduces the monthly surplus available for goals, debt repayment, and investing.",
    action: () => "Compare the two months by category, then set a specific guardrail for the category responsible for most of the increase.",
    actionLabel: "Compare ledger months",
    primaryAction: "review-ledger",
    destination: "ledger",
  },
  unusual: {
    impact: "A large outlier may be intentional, but confirming it helps catch entry mistakes, impulse purchases, or charges that need follow-up.",
    action: () => "Confirm the amount and purpose against the account statement, then reclassify or correct the entry if needed.",
    actionLabel: "Inspect ledger entry",
    primaryAction: "review-ledger",
    destination: "ledger",
  },
  budget: {
    impact: "A repeated category overrun reduces the surplus available for goals and investing even when individual purchases look small.",
    // The category name is recoverable from the finding id ("budget-food").
    action: (observation) => {
      const label = observation.id.startsWith("budget-") ? observation.id.slice("budget-".length) : "category";
      return `Set a tighter ${label} guardrail and review its largest recent transactions before the next budget cycle.`;
    },
    actionLabel: "Adjust money plan",
    primaryAction: "review-budget",
    destination: "buckets",
  },
  goal: {
    impact: "An incomplete goal with no active contribution will remain stalled until money is assigned to it.",
    action: () => "Add a realistic monthly contribution or revise the target to match your current priorities.",
    actionLabel: "Update goal",
    primaryAction: "review-goal",
    destination: "goals",
  },
  debt: {
    impact: "High-interest debt compounds against your net worth and can outweigh expected investment returns.",
    action: () => "Prioritise payments above the minimum while preserving the essential emergency buffer.",
    actionLabel: "Review debt plan",
    primaryAction: "review-debt",
    destination: "ledger",
  },
};

/** A detected leak is never good news, so it is never "positive". */
function severityForLeak(observation: MoneyLeakObservation): "watch" | "action" {
  return observation.severity === "high" ? "action" : "watch";
}

/**
 * The structured rule that gives a finding its meaning, or null when no
 * structured policy genuinely applies. Rule ids are never invented: a rule is
 * only referenced when it actually exists on the state.
 */
function ruleIdForLeak(state: WealthState, observation: MoneyLeakObservation): string | null {
  switch (observation.category) {
    // Recurring spending measured against the user's own spending limit.
    case "budget":
    case "subscription":
    case "fee":
    case "increase":
      return getFinancialRule(state, "monthly-spending-limit")?.id ?? null;
    case "goal": {
      const goalId = observation.relatedEntityIds[0];
      if (!goalId) return null;
      const ruleId = goalContributionRuleId(goalId);
      return state.financialRules.some((rule) => rule.id === ruleId) ? ruleId : null;
    }
    // One-off findings and debt have no governing structured rule yet.
    case "duplicate":
    case "unusual":
    case "debt":
      return null;
  }
}

function ruleTextForLeak(state: WealthState, observation: MoneyLeakObservation, ruleId: string | null): string {
  if (!ruleId) return "No structured rule governs this finding yet.";
  const spendingRule = getFinancialRule(state, "monthly-spending-limit");
  if (spendingRule && ruleId === spendingRule.id) {
    return `Keep monthly spending at or below ${money(spendingRule.limitAmount)}.`;
  }
  if (observation.category === "goal") {
    return "Every active goal should have a monthly contribution assigned.";
  }
  return "A configured rule applies to this finding.";
}

/**
 * Advisor recommendations derived from Money Leak observations.
 * The Advisor is the only place that turns a finding into advice.
 */
export function moneyLeakRecommendations(state: WealthState): AdvisorRecommendation[] {
  return detectMoneyLeakFindings(state).leaks.map((observation) => {
    const advice = LEAK_ADVICE[observation.category];
    const ruleId = ruleIdForLeak(state, observation);
    return {
      id: `advisor:leak:${observation.id}`,
      severity: severityForLeak(observation),
      title: observation.title,
      fact: observation.summary,
      ruleId,
      rule: ruleTextForLeak(state, observation, ruleId),
      impact: advice.impact,
      action: advice.action(observation),
      destination: advice.destination,
      evidence: observation.evidence,
    };
  });
}

/**
 * A Money Leak observation decorated with the Advisor's guidance.
 *
 * @deprecated Compatibility shape for the existing Money Leaks UI. New code
 * should read observations from detectMoneyLeakFindings() and advice from
 * moneyLeakRecommendations() instead of relying on these merged fields.
 */
export interface MoneyLeak extends MoneyLeakObservation {
  /** @deprecated Advisor-owned. Use AdvisorRecommendation.impact. */
  why: string;
  /** @deprecated Advisor-owned. Use AdvisorRecommendation.action. */
  recommendation: string;
  /** @deprecated Advisor-owned. */
  primaryAction: MoneyLeakAction;
  /** @deprecated Advisor-owned. */
  actionLabel: string;
}

/** @deprecated Compatibility shape for the existing Money Leaks UI. */
export interface MoneyLeakSummary extends Omit<MoneyLeakFindings, "leaks" | "topLeak"> {
  leaks: MoneyLeak[];
  topLeak?: MoneyLeak;
}

/**
 * Findings plus Advisor guidance, in the shape the current Money Leaks UI
 * expects. Detection values pass through untouched; only advisory fields are
 * added, and they are sourced from the Advisor.
 *
 * @deprecated See MoneyLeak.
 */
export function detectMoneyLeaks(state: WealthState): MoneyLeakSummary {
  const findings = detectMoneyLeakFindings(state);
  const annotate = (observation: MoneyLeakObservation): MoneyLeak => {
    const advice = LEAK_ADVICE[observation.category];
    return {
      ...observation,
      why: advice.impact,
      recommendation: advice.action(observation),
      primaryAction: advice.primaryAction,
      actionLabel: advice.actionLabel,
    };
  };
  const leaks = findings.leaks.map(annotate);
  return {
    ...findings,
    leaks,
    topLeak: leaks[0],
  };
}

/**
 * Canonical Advisor read model.
 *
 * One pipeline: FACTS → RULES → RECOMMENDATIONS → PRIORITY.
 * Every consumer (Dashboard, Advisor page, Overview) reads from here, so the
 * "most important thing right now" can never differ between screens.
 *
 * Pure read model: nothing here is persisted, and refreshing regenerates it
 * deterministically from the current state.
 */
export interface AdvisorSnapshot {
  /** Every recommendation, already ranked action > watch > positive. */
  recommendations: AdvisorRecommendation[];
  /** The single most important recommendation, or null when there are none. */
  priority: AdvisorRecommendation | null;
  /** Structured next steps, ranked identically and traceable to a recommendation. */
  actions: AdvisorAction[];
  /**
   * Recommendations derived from Money Leak observations, ranked.
   *
   * Deliberately NOT merged into `recommendations`: nothing consumes these in
   * the product today, so merging them would add cards to the Advisor page and
   * potentially change the Dashboard priority — a product change, not a
   * consolidation. Exposed here so a future step can wire them up on purpose.
   */
  leakRecommendations: AdvisorRecommendation[];
}

/**
 * Build the canonical Advisor snapshot. Pure and deterministic.
 *
 * `inputs` is optional throughout: supplying already-built canonical facts only
 * avoids rebuilding identical ones, and never changes the recommendations, the
 * ranking or the priority.
 */
export function getAdvisorSnapshot(state: WealthState, inputs: AdvisorInputs = {}): AdvisorSnapshot {
  const recommendations = prioritizeRecommendations(advisorRecommendations(state, inputs));
  return {
    recommendations,
    priority: recommendations[0] ?? null,
    actions: recommendations.map(toAdvisorAction),
    leakRecommendations: prioritizeRecommendations(moneyLeakRecommendations(state)),
  };
}

/** One structured action from one recommendation. */
function toAdvisorAction(recommendation: AdvisorRecommendation): AdvisorAction {
  return {
    id: `action:${recommendation.id}`,
    label: recommendation.action,
    ...(recommendation.destination ? { destination: recommendation.destination } : {}),
    recommendationId: recommendation.id,
  };
}

/**
 * The structured next steps derived from recommendations, most urgent first.
 * Each action traces back to exactly one recommendation.
 */
export function advisorActions(state: WealthState): AdvisorAction[] {
  return getAdvisorSnapshot(state).actions;
}

const SEVERITY_ORDER = { action: 0, watch: 1, positive: 2 } as const;

/** Most urgent first. Stable: equal severities keep their original order. */
export function prioritizeRecommendations(recommendations: AdvisorRecommendation[]): AdvisorRecommendation[] {
  return [...recommendations]
    .map((recommendation, index) => ({ recommendation, index }))
    .sort((left, right) => {
      const bySeverity = SEVERITY_ORDER[left.recommendation.severity] - SEVERITY_ORDER[right.recommendation.severity];
      return bySeverity !== 0 ? bySeverity : left.index - right.index;
    })
    .map(({ recommendation }) => recommendation);
}

/**
 * Compatibility wrapper for UI that still expects flat title/body/severity.
 * The body recomposes FACT + ACTION, preserving the original message wording.
 */
export function advisorMessages(state: WealthState): AdvisorMessage[] {
  // Ranked, so the first message is the same recommendation the Dashboard
  // shows as the Priority Action.
  return getAdvisorSnapshot(state).recommendations.map((recommendation) => ({
    title: recommendation.title,
    body: `${recommendation.fact} ${recommendation.action}`.trim(),
    severity: recommendation.severity,
  }));
}

/**
 * Compatibility wrapper: the original plain-string next actions.
 * Preserved verbatim so existing Dashboard rendering is unchanged.
 * Structured equivalents are available via advisorActions().
 */
export function nextActions(state: WealthState): string[] {
  const driftRule = getFinancialRule(state, "allocation-drift-tolerance");
  const driftTolerance = driftRule?.maxDrift ?? DEFAULT_DRIFT_TOLERANCE;
  const actions = [
    `DCA ${money(state.dca.monthly)} this month unless cashflow breaks.`,
    state.emergency.monthlyTopUp > 0
      ? `Top up Safety by ${money(state.emergency.monthlyTopUp)} until Emergency Fund reaches ${money(state.emergency.target)}.`
      : `Emergency Fund is complete! Consider redirecting ${money(state.emergency.monthlyTopUp || 40)} to Happy Fun and Wishlist buckets.`,
    "Review spending at month end and record whether DCA was executed.",
  ];

  if (getPortfolioSnapshot(state).maxAbsoluteDrift > driftTolerance) {
    actions.push("Use the next buy to reduce allocation drift toward your configured targets.");
  }

  return actions;
}
