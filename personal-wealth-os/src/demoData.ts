/**
 * Deterministic demo data for the Design Review / Preview environment.
 *
 * Every value is fictional. No real financial records, user IDs or API keys
 * are included. The data is loaded when VITE_DEMO_MODE=true so an external
 * reviewer can browse the entire WealthUp product without logging in.
 */

import type { WealthState } from "./models";

export const DEMO_USER_DISPLAY_NAME = "Alex Chen";
export const DEMO_USER_EMAIL = "demo@wealthup.cc";
export const DEMO_USER_PHOTO = "";

export const demoState: WealthState = {
  version: 14,
  profile: {
    name: "Alex Chen",
    age: 22,
    stage: "18-22 / University Year 3",
    riskTolerance: "High",
    investmentHorizonYears: 30,
    baseCurrency: "MYR",
  },
  cashflow: {
    allowance: 1800,
    transport: 350,
    food: 600,
    otherFixed: 250,
    irregularIncome: 500,
  },
  emergency: {
    current: 4800,
    target: 4800,
    annualYield: 0.035,
    monthlyTopUp: 0,
  },
  dca: {
    monthly: 300,
    targets: {
      VOO: 0.55,
      QQQM: 0.25,
      VXUS: 0.1,
    },
  },
  opportunity: {
    total: 1500,
    used: 0,
    allocation: {
      VOO: 825,
      QQQM: 375,
      VXUS: 150,
    },
    tranches: [
      { drawdown: 10, percent: 0.2, amount: 300, deployed: false },
      { drawdown: 15, percent: 0.3, amount: 450, deployed: false },
      { drawdown: 20, percent: 0.5, amount: 750, deployed: false },
    ],
  },
  buckets: [
    { id: "survival", name: "Survival", label: "Survival Bucket", amount: 1200, cadence: "monthly", note: "Transport, food, and essential living costs." },
    { id: "safety", name: "Safety", label: "Safety Bucket", amount: 0, cadence: "monthly", note: "Emergency fund is complete. Surplus redirected to Growth." },
    { id: "growth", name: "Growth", label: "Growth Bucket", amount: 300, cadence: "monthly", note: "Automated DCA split: 55% VOO, 25% QQQM, 10% VXUS." },
    { id: "freedom", name: "Freedom", label: "Freedom Bucket", amount: 150, cadence: "monthly", note: "Travel, entertainment, and personal wishlist." },
    { id: "learning", name: "Learning", label: "Learning Bucket", amount: 50, cadence: "monthly", note: "Books, courses, online tools, and workshops." },
    { id: "opportunity", name: "Opportunity", label: "Opportunity Bucket", amount: 1500, cadence: "one-time", note: "Bear-market reserve deployed according to drawdown tranches." },
  ],
  goals: [
    { id: "emergency", name: "Emergency Fund", label: "5-Month Safety Buffer ✅", current: 4800, target: 4800, monthlyContribution: 0, note: "Five-month safety buffer complete at MYR 4,800." },
    { id: "travel", name: "Japan Trip", label: "Japan Trip 2027 🇯🇵", current: 680, target: 2500, monthlyContribution: 150, note: "Saving for a two-week backpacking trip across Japan." },
    { id: "wishlist", name: "MacBook Upgrade", label: "MacBook Upgrade 💻", current: 2100, target: 4500, monthlyContribution: 200, note: "Upgrading to a MacBook Pro for coursework and side projects." },
    { id: "learning", name: "Skills Fund", label: "Skills & Education 📚", current: 180, target: 500, monthlyContribution: 50, note: "Online courses, certifications, and study materials." },
    { id: "giving", name: "Giving Back", label: "Charity & Gifts 🎁", current: 120, target: 300, monthlyContribution: 20, note: "Monthly charity donations and birthday gifts for family." },
  ],
  overviewGoalId: "travel",
  trades: [
    // Early exploratory buys
    { id: "demo-t001", date: "2025-07-15", platform: "moomoo", ticker: "VOO", type: "Manual Buy", amountMyr: 500, amountUsd: 113.12, priceUsd: 535.20, feeMyr: 1.99 },
    { id: "demo-t002", date: "2025-08-10", platform: "moomoo", ticker: "QQQM", type: "Manual Buy", amountMyr: 300, amountUsd: 67.87, priceUsd: 205.40, feeMyr: 1.50 },
    // August 2025 DCA
    { id: "demo-t003", date: "2025-08-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.33, priceUsd: 540.80, feeMyr: 1.00 },
    { id: "demo-t004", date: "2025-08-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 16.96, priceUsd: 210.15, feeMyr: 0.50 },
    { id: "demo-t005", date: "2025-08-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.78, priceUsd: 58.90, feeMyr: 0.30 },
    // September 2025 DCA
    { id: "demo-t006", date: "2025-09-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.50, priceUsd: 550.40, feeMyr: 1.00 },
    { id: "demo-t007", date: "2025-09-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 17.04, priceUsd: 218.30, feeMyr: 0.50 },
    { id: "demo-t008", date: "2025-09-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.82, priceUsd: 59.40, feeMyr: 0.30 },
    // October 2025 DCA
    { id: "demo-t009", date: "2025-10-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.18, priceUsd: 545.60, feeMyr: 1.00 },
    { id: "demo-t010", date: "2025-10-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 16.89, priceUsd: 215.80, feeMyr: 0.50 },
    { id: "demo-t011", date: "2025-10-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.76, priceUsd: 58.20, feeMyr: 0.30 },
    // November 2025 — dip buy
    { id: "demo-t012", date: "2025-11-05", platform: "moomoo", ticker: "VOO", type: "Dip Buy", amountMyr: 400, amountUsd: 90.50, priceUsd: 520.30, feeMyr: 2.00 },
    { id: "demo-t013", date: "2025-11-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.70, priceUsd: 530.80, feeMyr: 1.00 },
    { id: "demo-t014", date: "2025-11-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 17.10, priceUsd: 212.40, feeMyr: 0.50 },
    { id: "demo-t015", date: "2025-11-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.85, priceUsd: 57.60, feeMyr: 0.30 },
    // December 2025 DCA
    { id: "demo-t016", date: "2025-12-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 36.90, priceUsd: 548.90, feeMyr: 1.00 },
    { id: "demo-t017", date: "2025-12-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 16.78, priceUsd: 220.50, feeMyr: 0.50 },
    { id: "demo-t018", date: "2025-12-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.71, priceUsd: 58.10, feeMyr: 0.30 },
    // January 2026 DCA
    { id: "demo-t019", date: "2026-01-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.05, priceUsd: 560.20, feeMyr: 1.00 },
    { id: "demo-t020", date: "2026-01-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 16.85, priceUsd: 225.80, feeMyr: 0.50 },
    { id: "demo-t021", date: "2026-01-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.74, priceUsd: 59.80, feeMyr: 0.30 },
    // February 2026 DCA
    { id: "demo-t022", date: "2026-02-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.28, priceUsd: 555.10, feeMyr: 1.00 },
    { id: "demo-t023", date: "2026-02-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 16.92, priceUsd: 230.40, feeMyr: 0.50 },
    { id: "demo-t024", date: "2026-02-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.78, priceUsd: 60.50, feeMyr: 0.30 },
    // March 2026 DCA
    { id: "demo-t025", date: "2026-03-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.50, priceUsd: 548.60, feeMyr: 1.00 },
    { id: "demo-t026", date: "2026-03-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 16.98, priceUsd: 228.90, feeMyr: 0.50 },
    { id: "demo-t027", date: "2026-03-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.82, priceUsd: 61.20, feeMyr: 0.30 },
    // April 2026 DCA
    { id: "demo-t028", date: "2026-04-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.65, priceUsd: 552.40, feeMyr: 1.00 },
    { id: "demo-t029", date: "2026-04-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 17.02, priceUsd: 232.10, feeMyr: 0.50 },
    { id: "demo-t030", date: "2026-04-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.85, priceUsd: 62.30, feeMyr: 0.30 },
    // May 2026 DCA
    { id: "demo-t031", date: "2026-05-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.40, priceUsd: 565.80, feeMyr: 1.00 },
    { id: "demo-t032", date: "2026-05-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 16.90, priceUsd: 240.50, feeMyr: 0.50 },
    { id: "demo-t033", date: "2026-05-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.80, priceUsd: 63.10, feeMyr: 0.30 },
    // June 2026 DCA
    { id: "demo-t034", date: "2026-06-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.55, priceUsd: 570.20, feeMyr: 1.00 },
    { id: "demo-t035", date: "2026-06-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 16.95, priceUsd: 245.30, feeMyr: 0.50 },
    { id: "demo-t036", date: "2026-06-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.82, priceUsd: 64.50, feeMyr: 0.30 },
    // July 2026 DCA
    { id: "demo-t037", date: "2026-07-15", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.70, priceUsd: 575.40, feeMyr: 1.00 },
    { id: "demo-t038", date: "2026-07-15", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 17.00, priceUsd: 248.60, feeMyr: 0.50 },
    { id: "demo-t039", date: "2026-07-15", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.85, priceUsd: 65.20, feeMyr: 0.30 },
    // August 2026 DCA
    { id: "demo-t040", date: "2026-08-01", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 165, amountUsd: 37.80, priceUsd: 578.90, feeMyr: 1.00 },
    { id: "demo-t041", date: "2026-08-01", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 75, amountUsd: 17.05, priceUsd: 250.20, feeMyr: 0.50 },
    { id: "demo-t042", date: "2026-08-01", platform: "moomoo", ticker: "VXUS", type: "DCA", amountMyr: 30, amountUsd: 6.88, priceUsd: 65.80, feeMyr: 0.30 },
  ],
  reviews: [
    { id: "review-2025-11", month: "2025-11", income: 2800, spending: 1420, dcaDone: true, disciplineScore: 9, notes: "First full month of DCA. Stayed consistent despite the dip. Emergency fund untouched." },
    { id: "review-2025-12", month: "2025-12", income: 3100, spending: 1650, dcaDone: true, disciplineScore: 8, notes: "Holiday spending slightly over budget. Offset with reduced dining out in week 4." },
    { id: "review-2026-01", month: "2026-01", income: 2800, spending: 1380, dcaDone: true, disciplineScore: 10, notes: "Perfect month. Automated everything. Started tracking via the Activity page." },
    { id: "review-2026-02", month: "2026-02", income: 3200, spending: 1520, dcaDone: true, disciplineScore: 9, notes: "Freelance project bonus added. Extra RM 200 routed to MacBook goal." },
    { id: "review-2026-03", month: "2026-03", income: 2800, spending: 1450, dcaDone: true, disciplineScore: 9, notes: "Consistent month. VXUS allocation adjusted from 10% to 10% — no change needed." },
    { id: "review-2026-04", month: "2026-04", income: 3500, spending: 1600, dcaDone: true, disciplineScore: 10, notes: "Internship bonus. Added RM 500 to Japan Trip goal. DCA on track." },
    { id: "review-2026-05", month: "2026-05", income: 2800, spending: 1480, dcaDone: true, disciplineScore: 9, notes: "Markets recovered strongly. Portfolio up 8.4% overall. Staying the course." },
    { id: "review-2026-06", month: "2026-06", income: 3000, spending: 1550, dcaDone: true, disciplineScore: 9, notes: "Mid-year review. All goals on track. Opportunity reserve untouched." },
    { id: "review-2026-07", month: "2026-07", income: 2800, spending: 1420, dcaDone: true, disciplineScore: 10, notes: "Disciplined month. Read 'The Psychology of Money' from Learning fund." },
  ],
  customTickers: ["VXUS"],
  ledgerCategories: [
    { id: "expense-food", label: "Food", icon: "🍜", type: "expense" },
    { id: "expense-transport", label: "Transport", icon: "🚌", type: "expense" },
    { id: "expense-shopping", label: "Shopping", icon: "🛍️", type: "expense" },
    { id: "expense-bills", label: "Bills", icon: "🧾", type: "expense" },
    { id: "expense-health", label: "Health", icon: "💊", type: "expense" },
    { id: "expense-entertainment", label: "Entertainment", icon: "🎬", type: "expense" },
    { id: "expense-education", label: "Education", icon: "📖", type: "expense" },
    { id: "expense-other", label: "Other", icon: "📦", type: "expense" },
    { id: "income-salary", label: "Salary", icon: "💼", type: "income" },
    { id: "income-allowance", label: "Allowance", icon: "💵", type: "income" },
    { id: "income-freelance", label: "Freelance", icon: "💻", type: "income" },
    { id: "income-bonus", label: "Bonus", icon: "🎁", type: "income" },
    { id: "income-other", label: "Other", icon: "✨", type: "income" },
    { id: "transfer-self", label: "Self Transfer", icon: "🔄", type: "transfer" },
  ],
  ledgerAccounts: [
    { id: "account-bank", name: "Maybank Savings", type: "bank", openingBalance: 5000, icon: "🏦" },
    { id: "account-wallet", name: "Touch 'n Go", type: "wallet", openingBalance: 200, icon: "👛" },
    { id: "account-moomoo-cash", name: "Moomoo Cash", type: "investment", openingBalance: 500, icon: "💵" },
    { id: "account-moomoo-mmf", name: "Moomoo MMF", type: "investment", openingBalance: 4800, icon: "🪙" },
    { id: "account-moomoo-invest", name: "Moomoo Invest", type: "investment", openingBalance: 0, icon: "📈" },
  ],
  ledgerTransactions: [
    // August 2026 — current month
    { id: "lt-001", amount: 1800, type: "income", categoryId: "income-allowance", accountId: "account-bank", date: "2026-08-01", note: "Monthly allowance from parents" },
    { id: "lt-002", amount: 500, type: "income", categoryId: "income-freelance", accountId: "account-bank", date: "2026-08-03", note: "UI design freelance project" },
    { id: "lt-003", amount: 45, type: "expense", categoryId: "expense-food", accountId: "account-wallet", date: "2026-08-02", note: "Groceries at Jaya Grocer" },
    { id: "lt-004", amount: 12, type: "expense", categoryId: "expense-transport", accountId: "account-wallet", date: "2026-08-03", note: "Grab to campus" },
    { id: "lt-005", amount: 35, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: "2026-08-04", note: "Dinner with friends" },
    { id: "lt-006", amount: 25, type: "expense", categoryId: "expense-entertainment", accountId: "account-wallet", date: "2026-08-05", note: "Movie tickets" },
    { id: "lt-007", amount: 89, type: "expense", categoryId: "expense-bills", accountId: "account-bank", date: "2026-08-05", note: "Phone bill (postpaid)" },
    { id: "lt-008", amount: 15, type: "expense", categoryId: "expense-transport", accountId: "account-wallet", date: "2026-08-06", note: "Grab to internship office" },
    { id: "lt-009", amount: 28, type: "expense", categoryId: "expense-food", accountId: "account-wallet", date: "2026-08-07", note: "Lunch at mamak" },
    { id: "lt-010", amount: 150, type: "transfer", fromAccountId: "account-bank", toAccountId: "account-moomoo-cash", date: "2026-08-01", note: "Monthly DCA funding" },
    // July 2026
    { id: "lt-011", amount: 1800, type: "income", categoryId: "income-allowance", accountId: "account-bank", date: "2026-07-01", note: "Monthly allowance" },
    { id: "lt-012", amount: 600, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: "2026-07-15", note: "Food spending (first half)" },
    { id: "lt-013", amount: 120, type: "expense", categoryId: "expense-transport", accountId: "account-wallet", date: "2026-07-15", note: "Transport (first half)" },
    { id: "lt-014", amount: 89, type: "expense", categoryId: "expense-bills", accountId: "account-bank", date: "2026-07-05", note: "Phone bill" },
    { id: "lt-015", amount: 55, type: "expense", categoryId: "expense-entertainment", accountId: "account-wallet", date: "2026-07-12", note: "Concert livestream subscription" },
    { id: "lt-016", amount: 200, type: "expense", categoryId: "expense-shopping", accountId: "account-bank", date: "2026-07-20", note: "New running shoes" },
    { id: "lt-017", amount: 45, type: "expense", categoryId: "expense-education", accountId: "account-bank", date: "2026-07-22", note: "Udemy course on data analysis" },
    { id: "lt-018", amount: 400, type: "income", categoryId: "income-freelance", accountId: "account-bank", date: "2026-07-18", note: "Logo design project" },
    { id: "lt-019", amount: 150, type: "transfer", fromAccountId: "account-bank", toAccountId: "account-moomoo-cash", date: "2026-07-01", note: "Monthly DCA funding" },
    // June 2026
    { id: "lt-020", amount: 1800, type: "income", categoryId: "income-allowance", accountId: "account-bank", date: "2026-06-01", note: "Monthly allowance" },
    { id: "lt-021", amount: 800, type: "income", categoryId: "income-bonus", accountId: "account-bank", date: "2026-06-15", note: "Internship mid-term bonus" },
    { id: "lt-022", amount: 580, type: "expense", categoryId: "expense-food", accountId: "account-bank", date: "2026-06-30", note: "Food spending (full month)" },
    { id: "lt-023", amount: 135, type: "expense", categoryId: "expense-transport", accountId: "account-wallet", date: "2026-06-30", note: "Transport (full month)" },
    { id: "lt-024", amount: 89, type: "expense", categoryId: "expense-bills", accountId: "account-bank", date: "2026-06-05", note: "Phone bill" },
    { id: "lt-025", amount: 120, type: "expense", categoryId: "expense-entertainment", accountId: "account-wallet", date: "2026-06-20", note: "Weekend trip to Melaka" },
    { id: "lt-026", amount: 150, type: "transfer", fromAccountId: "account-bank", toAccountId: "account-moomoo-cash", date: "2026-06-01", note: "Monthly DCA funding" },
  ],
  liabilities: [
    { id: "liab-ptptn", name: "PTPTN Student Loan", balance: 12000, annualRate: 0.01, minimumPayment: 150 },
    { id: "liab-cc", name: "Credit Card", balance: 850, annualRate: 0.18, minimumPayment: 50 },
  ],
  recurringTransactions: [
    { id: "recur-allowance", label: "Monthly Allowance", amount: 1800, type: "income", dayOfMonth: 1, accountId: "account-bank", active: true },
    { id: "recur-phone", label: "Phone Bill", amount: 89, type: "expense", dayOfMonth: 5, accountId: "account-bank", active: true },
    { id: "recur-spotify", label: "Spotify", amount: 15.90, type: "expense", dayOfMonth: 10, accountId: "account-bank", active: true },
    { id: "recur-netflix", label: "Netflix", amount: 18.90, type: "expense", dayOfMonth: 15, accountId: "account-bank", active: true },
    { id: "recur-dca", label: "DCA Transfer", amount: 300, type: "expense", dayOfMonth: 15, accountId: "account-bank", active: true },
  ],
  netWorthSnapshots: [
    { id: "nw-2025-07", date: "2025-07-01", assets: 8200, liabilities: 13200 },
    { id: "nw-2025-08", date: "2025-08-01", assets: 12500, liabilities: 13100 },
    { id: "nw-2025-09", date: "2025-09-01", assets: 15800, liabilities: 13000 },
    { id: "nw-2025-10", date: "2025-10-01", assets: 18200, liabilities: 12900 },
    { id: "nw-2025-11", date: "2025-11-01", assets: 22400, liabilities: 12800 },
    { id: "nw-2025-12", date: "2025-12-01", assets: 26100, liabilities: 12700 },
    { id: "nw-2026-01", date: "2026-01-01", assets: 29500, liabilities: 12600 },
    { id: "nw-2026-02", date: "2026-02-01", assets: 32800, liabilities: 12500 },
    { id: "nw-2026-03", date: "2026-03-01", assets: 35200, liabilities: 12400 },
    { id: "nw-2026-04", date: "2026-04-01", assets: 38600, liabilities: 12300 },
    { id: "nw-2026-05", date: "2026-05-01", assets: 41200, liabilities: 12200 },
    { id: "nw-2026-06", date: "2026-06-01", assets: 44800, liabilities: 12100 },
    { id: "nw-2026-07", date: "2026-07-01", assets: 47500, liabilities: 12000 },
    { id: "nw-2026-08", date: "2026-08-01", assets: 50200, liabilities: 11850 },
  ],
  privacy: { maskAmounts: false, requireExportConfirmation: true },
  updatedAt: Date.now(),
  deviceId: "demo-device",
  ruleCardOverrides: {},
  ruleNoteTitle: "Investment Rules for 2026",
  ruleNotes: "1. Never skip a DCA month — consistency beats timing.\n2. Only deploy opportunity reserve when drawdown thresholds are hit.\n3. Review portfolio allocation quarterly.\n4. Keep emergency fund untouched unless true emergency.\n5. Track every ringgit — awareness is the first step to control.",
  hiddenRuleIds: [],
  ruleNotesList: [
    {
      id: "default",
      title: "Investment Rules for 2026",
      body: "1. Never skip a DCA month — consistency beats timing.\n2. Only deploy opportunity reserve when drawdown thresholds are hit.\n3. Review portfolio allocation quarterly.\n4. Keep emergency fund untouched unless true emergency.\n5. Track every ringgit — awareness is the first step to control.",
      createdAt: Date.now(),
    },
  ],
};
