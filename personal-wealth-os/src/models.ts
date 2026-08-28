export type Currency = "MYR" | "USD";

export type Ticker = string;

export type TradeType = "DCA" | "Dip Buy" | "Manual Buy" | "Sell";

export type AdviceSeverity = "positive" | "watch" | "action";

export interface Profile {
  name: string;
  age: number;
  stage: string;
  riskTolerance: "High" | "Medium" | "Low";
  investmentHorizonYears: number;
  baseCurrency: Currency;
}

export interface Cashflow {
  allowance: number;
  transport: number;
  food: number;
  otherFixed: number;
  irregularIncome: number;
}

export interface EmergencyFund {
  current: number;
  target: number;
  annualYield: number;
  monthlyTopUp: number;
}

export interface DcaPlan {
  monthly: number;
  targets: Record<Ticker, number>;
}

export interface OpportunityTranche {
  drawdown: number;
  percent: number;
  amount: number;
  deployed: boolean;
}

export interface OpportunityReserve {
  total: number;
  used: number;
  allocation: Record<Ticker, number>;
  tranches: OpportunityTranche[];
}

export interface Bucket {
  id: string;
  name: string;
  label: string;
  amount: number;
  cadence: "monthly" | "one-time";
  note: string;
}

export interface Goal {
  id: string;
  name: string;
  label: string;
  current: number;
  target: number;
  monthlyContribution: number;
  note: string;
  accountId?: string;
}

export interface Trade {
  id: string;
  date: string;
  platform: string;
  ticker: Ticker;
  type: TradeType;
  amountMyr: number;
  amountUsd: number;
  priceUsd: number;
  units?: number;
  feeMyr: number;
  exchangeRate?: number;
  notes?: string;
}

/** Which way a conversion went. */
export type ExchangeDirection = "myr-to-usd" | "usd-to-myr";

/**
 * One currency conversion, as it appears on the broker statement.
 *
 * This is the only place a real MYR/USD rate enters the system. A share order
 * is priced purely in dollars, so without these records the ringgit cost of a
 * holding can only be guessed at. Both amounts are stored and the rate is
 * derived from them, so the rate can never drift out of agreement with the
 * money — and it comes out inclusive of the spread actually paid.
 */
export interface CurrencyExchange {
  id: string;
  date: string;
  direction: ExchangeDirection;
  /** Ringgit side of the conversion. Always positive. */
  myrAmount: number;
  /** Dollar side of the conversion. Always positive. */
  usdAmount: number;
  notes?: string;
}

export interface Liability {
  id: string;
  name: string;
  balance: number;
  annualRate: number;
  minimumPayment: number;
}

export interface RecurringTransaction {
  id: string;
  label: string;
  amount: number;
  type: "income" | "expense";
  dayOfMonth: number;
  accountId?: string;
  active: boolean;
}

export interface NetWorthSnapshot {
  id: string;
  date: string;
  assets: number;
  liabilities: number;
}

export interface PrivacyPreferences {
  maskAmounts: boolean;
  requireExportConfirmation: boolean;
}

export interface Review {
  id: string;
  month: string;
  income: number;
  spending: number;
  dcaDone: boolean;
  disciplineScore: number;
  notes: string;
}

export type LedgerTransactionType = "income" | "expense" | "transfer";

export type LedgerAccountType = "bank" | "wallet" | "investment";

export interface LedgerAccount {
  id: string;
  name: string;
  type: LedgerAccountType;
  openingBalance: number;
  icon?: string;
  color?: string;
  /**
   * This account holds the shares tracked in the portfolio, so its balance and
   * the portfolio's value are the same money.
   *
   * When set, net worth takes the value from the portfolio (which follows the
   * live market price) and ignores this account's own balance, instead of
   * counting both. Without it a manually maintained brokerage balance is added
   * on top of the holdings it already represents, inflating net worth.
   *
   * Only meaningful on investment accounts. Brokerage CASH and money-market
   * balances are genuinely separate money and must NOT be flagged.
   */
  holdsTrackedPortfolio?: boolean;
}

export interface LedgerCategory {
  id: string;
  label: string;
  icon: string;
  type: LedgerTransactionType;
}

export interface LedgerTransaction {
  id: string;
  amount: number;
  type: LedgerTransactionType;
  categoryId?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  date: string;
  note?: string;
}

export type RuleCardId =
  | "monthly-cashflow"
  | "dca-mandate"
  | "emergency-fund"
  | "opportunity-reserve"
  | "bear-market-deployment"
  | "age-stage-policy"
  | "data-safety";

export interface RuleCardContent {
  title: string;
  body: string;
}

export interface RuleNote {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

// --- Structured financial rules ---
//
// These are PERSONAL POLICY / PLANNING rules: what the user intends to do.
// They are not recorded financial reality — never derive balances from them.
// Recorded position comes from the ledger (see getFinancialSnapshot).
//
// Distinct from RuleCardId above, which is presentation-only (the seven
// editable rule cards) and stays untouched for compatibility.

export type FinancialRuleKind =
  | "emergency-fund-minimum"
  | "monthly-spending-limit"
  | "dca-monthly-amount"
  | "target-allocation"
  | "allocation-drift-tolerance"
  | "opportunity-reserve-deployment"
  | "goal-contribution";

interface FinancialRuleBase {
  /** Stable identifier. Singleton rules use their kind as the id. */
  id: string;
  enabled: boolean;
}

/** Minimum balance the emergency fund should hold, in base currency. */
export interface EmergencyFundMinimumRule extends FinancialRuleBase {
  kind: "emergency-fund-minimum";
  targetAmount: number;
}

/** Self-imposed ceiling on recorded monthly spending, in base currency. */
export interface MonthlySpendingLimitRule extends FinancialRuleBase {
  kind: "monthly-spending-limit";
  limitAmount: number;
}

/** Amount to invest each month regardless of market conditions, in base currency. */
export interface DcaMonthlyAmountRule extends FinancialRuleBase {
  kind: "dca-monthly-amount";
  amount: number;
}

/** Intended portfolio weights per ticker, as fractions that should sum to ~1. */
export interface TargetAllocationRule extends FinancialRuleBase {
  kind: "target-allocation";
  targets: Record<Ticker, number>;
}

/** Maximum acceptable absolute drift from target allocation, as a fraction (0.08 = 8%). */
export interface AllocationDriftToleranceRule extends FinancialRuleBase {
  kind: "allocation-drift-tolerance";
  maxDrift: number;
}

/** Bear-market deployment ladder: at each drawdown, deploy this share of the reserve. */
export interface OpportunityReserveDeploymentRule extends FinancialRuleBase {
  kind: "opportunity-reserve-deployment";
  /** drawdown is a positive percentage (10 = -10%); percent is a fraction of the reserve. */
  tranches: Array<{ drawdown: number; percent: number }>;
}

/** Intended monthly contribution toward one goal, in base currency. */
export interface GoalContributionRule extends FinancialRuleBase {
  kind: "goal-contribution";
  goalId: string;
  monthlyAmount: number;
}

export type FinancialRule =
  | EmergencyFundMinimumRule
  | MonthlySpendingLimitRule
  | DcaMonthlyAmountRule
  | TargetAllocationRule
  | AllocationDriftToleranceRule
  | OpportunityReserveDeploymentRule
  | GoalContributionRule;

/** Narrows a FinancialRule to the variant matching `kind`. */
export type FinancialRuleOfKind<K extends FinancialRuleKind> = Extract<FinancialRule, { kind: K }>;

export interface WealthState {
  version: number;
  profile: Profile;
  cashflow: Cashflow;
  emergency: EmergencyFund;
  dca: DcaPlan;
  opportunity: OpportunityReserve;
  buckets: Bucket[];
  goals: Goal[];
  overviewGoalId: string;
  trades: Trade[];
  /** MYR→USD conversions that funded the trades. The only source of real FX. */
  currencyExchanges: CurrencyExchange[];
  reviews: Review[];
  customTickers: string[];
  ledgerCategories: LedgerCategory[];
  ledgerAccounts: LedgerAccount[];
  ledgerTransactions: LedgerTransaction[];
  liabilities: Liability[];
  recurringTransactions: RecurringTransaction[];
  netWorthSnapshots: NetWorthSnapshot[];
  privacy: PrivacyPreferences;
  updatedAt: number;
  deviceId: string;
  ruleCardOverrides: Partial<Record<RuleCardId, RuleCardContent>>;
  ruleNoteTitle: string;
  ruleNotes: string;
  ruleNotesList: RuleNote[];
  hiddenRuleIds: RuleCardId[];
  /** Structured personal-policy rules. Planning intent, never recorded balances. */
  financialRules: FinancialRule[];
  /** Whether the user acted on Advisor recommendations. Execution state only. */
  actionRecords: ActionRecord[];
}

export interface PortfolioPosition {
  ticker: Ticker;
  investedMyr: number;
  investedUsd: number;
  units: number;
  averageCostUsd: number;
  actualAllocation: number;
  targetAllocation: number;
  drift: number;
}

export interface PortfolioSummary {
  totalInvestedMyr: number;
  totalInvestedUsd: number;
  totalUnits: number;
  positions: PortfolioPosition[];
  maxAbsoluteDrift: number;
}

// --- Advisor recommendations (FACT → RULE → IMPACT → ACTION) ---
//
// Every recommendation is traceable: an observed FACT, the RULE/policy that
// gives it meaning, the IMPACT of that fact, and one concrete ACTION.
// Recommendations are derived on demand and never persisted.

/** A structured supporting value shown alongside a recommendation. */
export interface AdvisorEvidence {
  label: string;
  value: string;
}

/** A concrete next step derived from exactly one recommendation. */
export interface AdvisorAction {
  /** Stable id, derived from the source recommendation. */
  id: string;
  label: string;
  /** Existing page id to route to, when one applies. */
  destination?: string;
  recommendationId: string;
}

export interface AdvisorRecommendation {
  /** Stable across runs for the same conclusion, so UI can key on it. */
  id: string;
  severity: AdviceSeverity;
  title: string;
  /** What the system observed. */
  fact: string;
  /**
   * The structured FinancialRule this recommendation is evaluated against.
   * null when no structured rule meaningfully applies — never invented.
   */
  ruleId: string | null;
  /** Short explanation of the applicable rule or policy. */
  rule: string;
  /** Why the fact matters. */
  impact: string;
  /** One concrete next step. */
  action: string;
  destination?: string;
  evidence: AdvisorEvidence[];
}

// --- Action records ---------------------------------------------------------
//
// Records whether the user acted on an Advisor recommendation. Deliberately
// minimal: it stores execution STATE, not a copy of the recommendation. Title,
// severity, impact, destination and copy all stay with the Advisor, which
// regenerates them from current facts — a stored copy would go stale.
//
// Dependency direction: facts → recommendations → AdvisorSnapshot → ActionRecord.
// An ActionRecord never produces or ranks a recommendation.

export type ActionRecordStatus = "pending" | "completed";

export interface ActionRecord {
  id: string;
  /** The AdvisorRecommendation this record tracks. The only link kept. */
  recommendationId: string;
  /** The action text as accepted, so a completed record stays readable. */
  action: string;
  status: ActionRecordStatus;
  createdAt: number;
  /** Set only when status is "completed". */
  completedAt?: number;
}

export interface AdvisorMessage {
  title: string;
  body: string;
  severity: AdviceSeverity;
}
