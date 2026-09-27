/**
 * The demo shown to financial advisors: Daniel Lim, 36, a salaried parent in
 * Kuala Lumpur working with a financial planner.
 *
 * Every value is fictional. The fixture tells one story an advisor recognises
 * at a glance — a household with a house deposit, a child's education fund and
 * a car loan, plus the planner's recorded advice (the Rules page notes).
 *
 * Money is authored to balance: each full month the salary exactly covers the
 * plan's layers, so the bank balance only grows by the trip savings left in it,
 * and the linked goal accounts end the anchor month at the balances their goals
 * describe. Dates sit around DEMO_ANCHOR_MONTH in demoData.ts and are shifted
 * to the viewer's month the same way as the other demo.
 */

import type { CurrencyExchange, LedgerTransaction, Trade, WealthState } from "./models";
import { getDefaultFinancialRules } from "./financialRules";
import { CURRENT_VERSION } from "./state";

export const DANIEL_DISPLAY_NAME = "Daniel Lim";
export const DANIEL_EMAIL = "daniel.demo@wealthup.cc";

const SALARY = 10500;
const INVEST_MONTHLY = 1200;
const VOO_SHARE = 0.7;

/**
 * One DCA month: the ringgit→dollar rate converted at and the fill prices.
 * The rate is MYR per USD. Fictional but in a plausible range.
 */
const DCA_MONTHS: Array<{ month: string; fx: number; voo: number; vxus: number }> = [
  { month: "2025-09", fx: 4.22, voo: 550.2, vxus: 66.1 },
  { month: "2025-10", fx: 4.2, voo: 556.4, vxus: 66.9 },
  { month: "2025-11", fx: 4.25, voo: 548.1, vxus: 65.3 },
  { month: "2025-12", fx: 4.18, voo: 562.7, vxus: 67.8 },
  { month: "2026-01", fx: 4.15, voo: 570.3, vxus: 68.6 },
  { month: "2026-02", fx: 4.12, voo: 560.9, vxus: 67.9 },
  { month: "2026-03", fx: 4.1, voo: 545.5, vxus: 66.2 },
  { month: "2026-04", fx: 4.08, voo: 558.2, vxus: 67.4 },
  { month: "2026-05", fx: 4.05, voo: 572.6, vxus: 68.9 },
  { month: "2026-06", fx: 4.02, voo: 580.1, vxus: 69.7 },
  { month: "2026-07", fx: 4.0, voo: 586.4, vxus: 70.8 },
  { month: "2026-08", fx: 3.98, voo: 592.3, vxus: 71.6 },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// One conversion per month, the whole DCA amount, so every dollar spent traces
// to a rate actually paid.
const exchanges: CurrencyExchange[] = DCA_MONTHS.map(({ month, fx }, index) => ({
  id: `daniel-fx${String(index + 1).padStart(3, "0")}`,
  date: `${month}-14`,
  direction: "myr-to-usd",
  myrAmount: INVEST_MONTHLY,
  usdAmount: round2(INVEST_MONTHLY / fx),
  notes: "Monthly DCA funding",
}));

const trades: Trade[] = DCA_MONTHS.flatMap(({ month, fx, voo, vxus }, index) => {
  const vooMyr = INVEST_MONTHLY * VOO_SHARE;
  const vxusMyr = INVEST_MONTHLY - vooMyr;
  const n = index * 2;
  return [
    { id: `daniel-t${String(n + 1).padStart(3, "0")}`, date: `${month}-15`, platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: vooMyr, amountUsd: round2(vooMyr / fx), priceUsd: voo, feeMyr: 3.5 },
    { id: `daniel-t${String(n + 2).padStart(3, "0")}`, date: `${month}-15`, platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: vxusMyr, amountUsd: round2(vxusMyr / fx), priceUsd: vxus, feeMyr: 3.5 },
  ];
});

/** What leaves the bank on payday, in the order the plan pays it. */
function paydayEntries(month: string, prefix: string): LedgerTransaction[] {
  return [
    { id: `${prefix}-salary`, amount: SALARY, type: "income", categoryId: "income-salary", accountId: "account-bank", date: `${month}-01`, note: "Salary" },
    { id: `${prefix}-to-gx`, amount: 800, type: "transfer", fromAccountId: "account-bank", toAccountId: "account-gx", date: `${month}-01`, note: "Emergency fund top-up" },
    { id: `${prefix}-to-moomoo`, amount: INVEST_MONTHLY, type: "transfer", fromAccountId: "account-bank", toAccountId: "account-moomoo", date: `${month}-01`, note: "Monthly investing" },
    { id: `${prefix}-to-sspn`, amount: 400, type: "transfer", fromAccountId: "account-bank", toAccountId: "account-sspn", date: `${month}-01`, note: "Sophia's education (SSPN)" },
    { id: `${prefix}-to-asb`, amount: 1450, type: "transfer", fromAccountId: "account-bank", toAccountId: "account-asb", date: `${month}-01`, note: "House deposit" },
    { id: `${prefix}-rent`, amount: 1800, type: "expense", categoryId: "expense-housing", accountId: "account-bank", date: `${month}-03`, note: "Rent" },
    { id: `${prefix}-kinder`, amount: 600, type: "expense", categoryId: "expense-family", accountId: "account-bank", date: `${month}-05`, note: "Kindergarten fees" },
    { id: `${prefix}-insurance`, amount: 450, type: "expense", categoryId: "expense-insurance", accountId: "account-bank", date: `${month}-05`, note: "Life & medical insurance" },
    { id: `${prefix}-car`, amount: 950, type: "expense", categoryId: "expense-loan", accountId: "account-bank", date: `${month}-07`, note: "Car loan instalment" },
  ];
}

/**
 * The rest of a full month's spending. Without `foodOver` it totals exactly
 * 2,550 — utilities 350, food 1,500, transport 700 — so a full month balances
 * against the plan; `foodOver` is spent on top of it.
 */
function restOfMonth(month: string, prefix: string, foodOver: number): LedgerTransaction[] {
  return [
    { id: `${prefix}-groceries1`, amount: 320, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: `${month}-06`, note: "Groceries" },
    { id: `${prefix}-petrol1`, amount: 240, type: "expense", categoryId: "expense-transport", accountId: "account-bank", date: `${month}-08`, note: "Petrol" },
    { id: `${prefix}-utilities`, amount: 350, type: "expense", categoryId: "expense-bills", accountId: "account-bank", date: `${month}-12`, note: "Electricity, water, internet" },
    { id: `${prefix}-groceries2`, amount: 310, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: `${month}-13`, note: "Groceries" },
    { id: `${prefix}-dining`, amount: 260 + foodOver, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: `${month}-16`, note: "Family dinners" },
    { id: `${prefix}-petrol2`, amount: 230, type: "expense", categoryId: "expense-transport", accountId: "account-bank", date: `${month}-18`, note: "Petrol" },
    { id: `${prefix}-groceries3`, amount: 330, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: `${month}-20`, note: "Groceries" },
    { id: `${prefix}-tolls`, amount: 230, type: "expense", categoryId: "expense-transport", accountId: "account-bank", date: `${month}-24`, note: "Tolls & parking" },
    { id: `${prefix}-groceries4`, amount: 280, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: `${month}-27`, note: "Groceries" },
  ];
}

export const danielDemoState: WealthState = {
  // Written in the current shape, so it is read as authored rather than
  // routed through the migrations for older data.
  version: CURRENT_VERSION,
  profile: {
    name: DANIEL_DISPLAY_NAME,
    age: 36,
    stage: "Mid Career",
    riskTolerance: "Medium",
    investmentHorizonYears: 24,
    baseCurrency: "MYR",
  },
  cashflow: {
    allowance: SALARY,
    transport: 700,
    food: 1500,
    otherFixed: 3200,
    irregularIncome: 0,
  },
  emergency: {
    current: 21600,
    target: 36000,
    annualYield: 0.03,
    monthlyTopUp: 800,
  },
  dca: {
    monthly: INVEST_MONTHLY,
    targets: { VOO: 0.7, VXUS: 0.3 },
  },
  opportunity: {
    total: 3000,
    used: 0,
    allocation: { VOO: 2100, VXUS: 900 },
    tranches: [
      { drawdown: 10, percent: 0.2, amount: 600, deployed: false },
      { drawdown: 20, percent: 0.3, amount: 900, deployed: false },
      { drawdown: 30, percent: 0.5, amount: 1500, deployed: false },
    ],
  },
  buckets: [
    { id: "living", name: "Living", label: "Living", amount: 5400, cadence: "monthly", note: "Rent, food, transport, utilities, insurance, kindergarten." },
    { id: "car", name: "Car loan", label: "Car loan", amount: 950, cadence: "monthly", note: "Fixed instalment until the loan ends." },
    { id: "safety", name: "Safety", label: "Safety", amount: 800, cadence: "monthly", note: "To the emergency fund until it holds six months." },
    { id: "invest", name: "Invest", label: "Invest", amount: INVEST_MONTHLY, cadence: "monthly", note: "Long-term DCA: 70% VOO, 30% VXUS." },
    { id: "education", name: "Education", label: "Education", amount: 400, cadence: "monthly", note: "Sophia's SSPN account." },
    { id: "trip", name: "Family trip", label: "Family trip", amount: 300, cadence: "monthly", note: "Japan trip, kept in the savings account." },
    { id: "house", name: "House deposit", label: "House deposit", amount: 1450, cadence: "monthly", note: "Everything left over goes here." },
  ],
  allocation: {
    incomeType: "fixed",
    steps: [
      { id: "living", name: "Living", kind: "fill", value: 5400, note: "Rent, food, transport, utilities, insurance, kindergarten." },
      { id: "car", name: "Car loan", kind: "fill", value: 950, note: "Fixed instalment until the loan ends." },
      { id: "safety", name: "Safety", kind: "fill", value: 800, note: "To the emergency fund until it holds six months." },
      { id: "invest", name: "Invest", kind: "fill", value: INVEST_MONTHLY, note: "Long-term DCA: 70% VOO, 30% VXUS." },
      { id: "education", name: "Education", kind: "fill", value: 400, note: "Sophia's SSPN account." },
      { id: "trip", name: "Family trip", kind: "fill", value: 300, note: "Japan trip, kept in the savings account." },
      { id: "house", name: "House deposit", kind: "fill", value: 1450, note: "Everything left over goes here." },
    ],
    overflowStepId: "house",
  },
  monthPlans: {},
  goals: [
    { id: "house", name: "House deposit", label: "First home deposit", current: 38000, target: 80000, monthlyContribution: 1450, note: "10% down on a home around RM650k, plus legal fees and moving.", accountId: "account-asb" },
    { id: "emergency", name: "Emergency fund", label: "Six months of expenses", current: 21600, target: 36000, monthlyContribution: 800, note: "Six months of household spending, kept in a savings account.", accountId: "account-gx" },
    { id: "education", name: "Sophia's education", label: "Sophia's university fund", current: 18500, target: 60000, monthlyContribution: 400, note: "A local degree, in today's money. Reviewed when she starts primary school.", accountId: "account-sspn" },
    { id: "trip", name: "Japan family trip", label: "Japan family trip", current: 5400, target: 8000, monthlyContribution: 300, note: "Two weeks for the three of us." },
  ],
  overviewGoalId: "house",
  currencyExchanges: exchanges,
  dividends: [],
  trades,
  reviews: [
    { id: "review-2026-02", month: "2026-02", income: SALARY, spending: 6420, dcaDone: true, disciplineScore: 8, notes: "Chinese New Year spending ran over. Covered from the trip savings, not the emergency fund." },
    { id: "review-2026-03", month: "2026-03", income: SALARY, spending: 6310, dcaDone: true, disciplineScore: 9, notes: "Back on plan. Markets dipped; kept the DCA going as agreed with Sarah." },
    { id: "review-2026-04", month: "2026-04", income: SALARY, spending: 6350, dcaDone: true, disciplineScore: 9, notes: "Quarterly review with Sarah. Moved the house deposit into ASB." },
    { id: "review-2026-05", month: "2026-05", income: SALARY, spending: 6280, dcaDone: true, disciplineScore: 9, notes: "Steady month." },
    { id: "review-2026-06", month: "2026-06", income: SALARY, spending: 6350, dcaDone: true, disciplineScore: 9, notes: "School holiday trip to Penang paid from the trip fund." },
    { id: "review-2026-07", month: "2026-07", income: SALARY, spending: 6530, dcaDone: true, disciplineScore: 8, notes: "Food over plan by about RM180. Fewer dinners out next month." },
  ],
  customTickers: ["VXUS"],
  ledgerCategories: [
    { id: "expense-housing", label: "Housing", icon: "🏠", type: "expense" },
    { id: "expense-food", label: "Food", icon: "🍜", type: "expense" },
    { id: "expense-transport", label: "Transport", icon: "🚗", type: "expense" },
    { id: "expense-bills", label: "Bills", icon: "🧾", type: "expense" },
    { id: "expense-family", label: "Family", icon: "🧒", type: "expense" },
    { id: "expense-insurance", label: "Insurance", icon: "🛡️", type: "expense" },
    { id: "expense-loan", label: "Loan", icon: "🏦", type: "expense" },
    { id: "expense-health", label: "Health", icon: "💊", type: "expense" },
    { id: "expense-other", label: "Other", icon: "📦", type: "expense" },
    { id: "income-salary", label: "Salary", icon: "💼", type: "income" },
    { id: "income-bonus", label: "Bonus", icon: "🎁", type: "income" },
    { id: "income-other", label: "Other", icon: "✨", type: "income" },
    { id: "transfer-self", label: "Self Transfer", icon: "🔄", type: "transfer" },
  ],
  // Opening balances are three payday transfers short of each goal's figure,
  // so the three authored months land every linked goal exactly on it.
  ledgerAccounts: [
    { id: "account-bank", name: "Maybank Current", type: "bank", openingBalance: 9000, icon: "🏦" },
    { id: "account-gx", name: "GXBank Savings", type: "bank", openingBalance: 19200, icon: "🛟" },
    { id: "account-sspn", name: "SSPN (Sophia)", type: "investment", openingBalance: 17300, icon: "🎓" },
    { id: "account-asb", name: "ASB", type: "investment", openingBalance: 33650, icon: "🏡" },
    { id: "account-moomoo", name: "Moomoo", type: "investment", openingBalance: 0, icon: "📈", holdsTrackedPortfolio: true },
  ],
  ledgerTransactions: [
    // Anchor month: in progress — payday and the first week.
    ...paydayEntries("2026-08", "dl-08"),
    { id: "dl-08-groceries1", amount: 340, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: "2026-08-06", note: "Groceries" },
    { id: "dl-08-petrol1", amount: 240, type: "expense", categoryId: "expense-transport", accountId: "account-bank", date: "2026-08-08", note: "Petrol" },
    // Previous two months: complete. July ran RM180 over on food.
    ...paydayEntries("2026-07", "dl-07"),
    ...restOfMonth("2026-07", "dl-07", 180),
    ...paydayEntries("2026-06", "dl-06"),
    ...restOfMonth("2026-06", "dl-06", 0),
  ],
  liabilities: [
    { id: "liab-car", name: "Car loan (Honda City)", balance: 42000, annualRate: 0.052, minimumPayment: 950, kind: "car-loan", endMonth: "2030-06" },
    { id: "liab-cc", name: "Credit card", balance: 2300, annualRate: 0.18, minimumPayment: 115, kind: "credit-card", paidInFull: true },
  ],
  recurringTransactions: [
    { id: "recur-salary", label: "Salary", amount: SALARY, type: "income", dayOfMonth: 1, accountId: "account-bank", active: true },
    { id: "recur-rent", label: "Rent", amount: 1800, type: "expense", dayOfMonth: 3, accountId: "account-bank", active: true },
    { id: "recur-kinder", label: "Kindergarten fees", amount: 600, type: "expense", dayOfMonth: 5, accountId: "account-bank", active: true },
    { id: "recur-insurance", label: "Life & medical insurance", amount: 450, type: "expense", dayOfMonth: 5, accountId: "account-bank", active: true },
    { id: "recur-car", label: "Car loan instalment", amount: 950, type: "expense", dayOfMonth: 7, accountId: "account-bank", active: true },
  ],
  netWorthSnapshots: [
    { id: "nw-2025-08", date: "2025-08-01", assets: 84200, liabilities: 52900 },
    { id: "nw-2025-09", date: "2025-09-01", assets: 85900, liabilities: 52100 },
    { id: "nw-2025-10", date: "2025-10-01", assets: 87700, liabilities: 51300 },
    { id: "nw-2025-11", date: "2025-11-01", assets: 89100, liabilities: 50500 },
    { id: "nw-2025-12", date: "2025-12-01", assets: 91000, liabilities: 49800 },
    { id: "nw-2026-01", date: "2026-01-01", assets: 92900, liabilities: 49000 },
    { id: "nw-2026-02", date: "2026-02-01", assets: 94100, liabilities: 48300 },
    { id: "nw-2026-03", date: "2026-03-01", assets: 95300, liabilities: 47500 },
    { id: "nw-2026-04", date: "2026-04-01", assets: 97200, liabilities: 46800 },
    { id: "nw-2026-05", date: "2026-05-01", assets: 99000, liabilities: 46000 },
    { id: "nw-2026-06", date: "2026-06-01", assets: 100800, liabilities: 45300 },
    { id: "nw-2026-07", date: "2026-07-01", assets: 102500, liabilities: 44500 },
    { id: "nw-2026-08", date: "2026-08-01", assets: 104300, liabilities: 44300 },
  ],
  privacy: { maskAmounts: false, requireExportConfirmation: true },
  updatedAt: Date.now(),
  lastSyncedAt: 0,
  deviceId: "demo-device",
  ruleCardOverrides: {},
  ruleNoteTitle: "",
  ruleNotes: "",
  hiddenRuleIds: [],
  // The planner's recorded advice. Titles carry no month so they stay true
  // after the fixture's dates are shifted forward.
  ruleNotesList: [
    {
      id: "advice-quarterly",
      title: "Advisor Sarah Wong · quarterly review",
      body: `1. Emergency fund first: keep RM800 a month going to GXBank until it holds RM36,000 (six months). About 18 months at this pace.\n2. Car loan: keep paying the instalment only. At about 5% it costs less than it feels — don't prepay it before the emergency fund is full.\n3. Credit card: keep clearing it in full every month.\n4. Food ran RM180 over plan last month. Worth a look, not a worry.`,
      createdAt: Date.now() - 3 * 86400000,
    },
    {
      id: "advice-house",
      title: "Advisor Sarah Wong · house deposit plan",
      body: `Target RM80,000: 10% down on a home around RM650k, plus legal fees and moving costs.\nAt RM1,450 a month you get there in about two and a half years.\nKeep this money in ASB or fixed deposit, not in shares — you will need it within three years.`,
      createdAt: Date.now() - 40 * 86400000,
    },
    {
      id: "advice-education",
      title: "Advisor Sarah Wong · Sophia's education",
      body: `RM400 a month into SSPN.\nWe review the target again when Sophia starts primary school.`,
      createdAt: Date.now() - 95 * 86400000,
    },
  ],
  financialRules: [],
  actionRecords: [],
  financialGoal: "Own our first home and fully fund Sophia's university, with six months of safety first.",
  // An established user: no new-user checklist or Q&A.
  onboardingDone: true,
  onboardingAnswers: null,
  checkins: { weeklyCheckedOn: "", payPromptAnswered: false },
};

danielDemoState.financialRules = getDefaultFinancialRules(danielDemoState);
