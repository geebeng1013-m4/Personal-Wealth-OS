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
  feeMyr: number;
  notes?: string;
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

export type LedgerTransactionType = "income" | "expense";

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
  categoryId: string;
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

export interface WealthState {
  version: number;
  profile: Profile;
  cashflow: Cashflow;
  emergency: EmergencyFund;
  dca: DcaPlan;
  opportunity: OpportunityReserve;
  buckets: Bucket[];
  goals: Goal[];
  trades: Trade[];
  reviews: Review[];
  customTickers: string[];
  ledgerCategories: LedgerCategory[];
  ledgerTransactions: LedgerTransaction[];
  ruleCardOverrides: Partial<Record<RuleCardId, RuleCardContent>>;
  ruleNoteTitle: string;
  ruleNotes: string;
  hiddenRuleIds: RuleCardId[];
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

export interface AdvisorMessage {
  title: string;
  body: string;
  severity: AdviceSeverity;
}
