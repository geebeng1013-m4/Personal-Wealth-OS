import type { LedgerAccount, LedgerAccountType, LedgerCategory, LedgerTransaction, LedgerTransactionType, RuleCardContent, RuleCardId, RuleNote, Trade, WealthState } from "./models";
import { getDefaultFinancialRules, normalizeFinancialRules } from "./financialRules";
import { normalizeActionRecords } from "./actionRecords";
import {
  saveToFirestore,
  loadFromFirestore,
  currentUser,
} from "./firebase";

export const STORAGE_KEY = "personal-wealth-os-state";
export const CURRENT_VERSION = 18;

function deviceId(): string {
  const key = "personal-wealth-os-device-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = createId("device");
  localStorage.setItem(key, created);
  return created;
}

const RULE_CARD_IDS = new Set<RuleCardId>([
  "monthly-cashflow",
  "dca-mandate",
  "emergency-fund",
  "opportunity-reserve",
  "bear-market-deployment",
  "age-stage-policy",
  "data-safety",
]);

const DEFAULT_LEDGER_CATEGORIES: LedgerCategory[] = [
  { id: "expense-food", label: "Food", icon: "🍜", type: "expense" },
  { id: "expense-transport", label: "Transport", icon: "🚌", type: "expense" },
  { id: "expense-shopping", label: "Shopping", icon: "🛍️", type: "expense" },
  { id: "expense-bills", label: "Bills", icon: "🧾", type: "expense" },
  { id: "expense-health", label: "Health", icon: "💊", type: "expense" },
  { id: "expense-other", label: "Other", icon: "📦", type: "expense" },
  { id: "income-salary", label: "Salary", icon: "💼", type: "income" },
  { id: "income-allowance", label: "Allowance", icon: "💵", type: "income" },
  { id: "income-bonus", label: "Bonus", icon: "🎁", type: "income" },
  { id: "income-other", label: "Other", icon: "✨", type: "income" },
];

const DEFAULT_LEDGER_ACCOUNTS: LedgerAccount[] = [
  { id: "account-bank", name: "Bank", type: "bank", openingBalance: 0, icon: "🏦" },
  { id: "account-wallet", name: "Wallet", type: "wallet", openingBalance: 0, icon: "👛" },
  { id: "account-moomoo-cash", name: "Moomoo Cash", type: "investment", openingBalance: 0, icon: "💵" },
  { id: "account-moomoo-mmf", name: "Moomoo MMF", type: "investment", openingBalance: 0, icon: "🪙" },
  { id: "account-moomoo-invest", name: "Moomoo Invest", type: "investment", openingBalance: 0, icon: "📈" },
];

function getUserStorageKey(uid?: string): string {
  return uid ? `${STORAGE_KEY}-${uid}` : STORAGE_KEY;
}

export const defaultState: WealthState = {
  version: CURRENT_VERSION,
  profile: {
    name: "Student Investor",
    age: 19,
    stage: "18-22 / University Year 1",
    riskTolerance: "High",
    investmentHorizonYears: 30,
    baseCurrency: "MYR",
  },
  cashflow: {
    allowance: 880,
    transport: 400,
    food: 320,
    otherFixed: 0,
    irregularIncome: 0,
  },
  emergency: {
    current: 4000,
    target: 4000,
    annualYield: 0.035,
    monthlyTopUp: 0,
  },
  dca: {
    monthly: 100,
    targets: {
      VOO: 0.7,
      QQQM: 0.3,
    },
  },
  opportunity: {
    total: 400,
    used: 0,
    allocation: {
      VOO: 200,
      QQQM: 200,
    },
    tranches: [
      { drawdown: 10, percent: 0.2, amount: 80, deployed: false },
      { drawdown: 15, percent: 0.3, amount: 120, deployed: false },
      { drawdown: 20, percent: 0.5, amount: 200, deployed: false },
    ],
  },
  buckets: [
    { id: "survival", name: "Survival", label: "Survival Bucket", amount: 720, cadence: "monthly", note: "Transport and food come first to keep cash flow stable." },
    { id: "safety", name: "Safety", label: "Safety Bucket", amount: 0, cadence: "monthly", note: "The Emergency Fund is complete. MYR 40 can be redirected to Growth or Freedom." },
    { id: "growth", name: "Growth", label: "Growth Bucket", amount: 100, cadence: "monthly", note: "Automated DCA split: 70% VOO and 30% QQQM." },
    { id: "freedom", name: "Freedom", label: "Freedom Bucket", amount: 50, cadence: "monthly", note: "Travel and wishlist funding, including MYR 20 redirected from Safety." },
    { id: "learning", name: "Learning", label: "Learning Bucket", amount: 10, cadence: "monthly", note: "Books, courses, tools, and investment education." },
    { id: "opportunity", name: "Opportunity", label: "Opportunity Bucket", amount: 400, cadence: "one-time", note: "One-time bear-market reserve deployed only according to the rules." },
  ],
  goals: [
    { id: "emergency", name: "Emergency Fund", label: "5-Month Safety Buffer ✅", current: 4000, target: 4000, monthlyContribution: 0, note: "The five-month safety-buffer goal is complete at MYR 4,000." },
    { id: "travel", name: "Travel Fund", label: "Travel Fund", current: 0, target: 1000, monthlyContribution: 30, note: "Start with the suggested target and adjust it later if needed." },
    { id: "wishlist", name: "Wishlist Fund", label: "Wishlist", current: 0, target: 500, monthlyContribution: 20, note: "MYR 20 is redirected from the Safety Bucket each month." },
    { id: "learning", name: "Learning Fund", label: "Learning Fund", current: 0, target: 300, monthlyContribution: 10, note: "For skills, courses, books, and tools." },
  ],
  overviewGoalId: "travel",
  trades: [
    { id: "csv-001", date: "2025-10-28", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 21.42, amountUsd: 5.04, priceUsd: 630.54, units: 0.008, feeMyr: 1.23 },
    { id: "csv-002", date: "2026-04-06T15:27:36.000Z", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 199.75, amountUsd: 47.00, priceUsd: 604.11, units: 0.0778, feeMyr: 3.06 },
    { id: "csv-003", date: "2026-04-06T15:22:37.000Z", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 69.36, amountUsd: 16.32, priceUsd: 241.73, units: 0.0675, feeMyr: 1.74 },
    { id: "csv-004", date: "2026-04-06T15:06:10.000Z", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 173.44, amountUsd: 40.81, priceUsd: 604.54, units: 0.0675, feeMyr: 2.76 },
    { id: "csv-005", date: "2026-04-06T15:07:09.000Z", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 69.45, amountUsd: 16.34, priceUsd: 241.67, units: 0.0676, feeMyr: 1.74 },
    { id: "csv-006", date: "2026-04-06T15:13:56.000Z", platform: "moomoo", ticker: "VOO", type: "Sell", amountMyr: 193.89, amountUsd: 45.62, priceUsd: 604.28, units: 0.0755, feeMyr: 2.98 },
    { id: "csv-007", date: "2026-04-06T15:13:55.000Z", platform: "moomoo", ticker: "QQQM", type: "Sell", amountMyr: 69.45, amountUsd: 16.34, priceUsd: 241.75, units: 0.0676, feeMyr: 1.74 },
    { id: "csv-008", date: "2026-05-04", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 44.54, amountUsd: 10.48, priceUsd: 663.51, units: 0.0158, feeMyr: 1.49 },
    { id: "csv-009", date: "2026-05-05", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 193.80, amountUsd: 45.60, priceUsd: 664.69, units: 0.0686, feeMyr: 2.98 },
    { id: "csv-010", date: "2026-05-05", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 96.31, amountUsd: 22.66, priceUsd: 280.16, units: 0.0809, feeMyr: 2.00 },
    { id: "csv-011", date: "2026-05-12", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 225.17, amountUsd: 52.98, priceUsd: 674.91, units: 0.0785, feeMyr: 3.32 },
    { id: "csv-012", date: "2026-05-12", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 112.63, amountUsd: 26.50, priceUsd: 289.61, units: 0.0915, feeMyr: 2.21 },
    { id: "csv-013", date: "2026-05-28", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 59.67, amountUsd: 14.04, priceUsd: 691.52, units: 0.0203, feeMyr: 1.66 },
    { id: "csv-014", date: "2026-05-28", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 23.08, amountUsd: 5.43, priceUsd: 301.60, units: 0.018, feeMyr: 1.28 },
    { id: "csv-015", date: "2026-06-03", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 314.88, amountUsd: 74.09, priceUsd: 693.77, units: 0.1068, feeMyr: 4.17 },
    { id: "csv-016", date: "2026-06-05", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 143.23, amountUsd: 33.70, priceUsd: 685.00, units: 0.0492, feeMyr: 2.47 },
    { id: "csv-017", date: "2026-06-05", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 63.28, amountUsd: 14.89, priceUsd: 296.00, units: 0.0503, feeMyr: 1.70 },
    { id: "csv-018", date: "2026-06-26", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 0.26, amountUsd: 0.06, priceUsd: 290.95, units: 0.0002, feeMyr: 1.06 },
    { id: "csv-019", date: "2026-07-06", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 88.32, amountUsd: 20.78, priceUsd: 688.00, units: 0.0302, feeMyr: 1.96 },
    { id: "csv-020", date: "2026-07-06", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 34.17, amountUsd: 8.04, priceUsd: 297.70, units: 0.027, feeMyr: 1.40 },
    { id: "csv-021", date: "2026-08-12", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 38.34, amountUsd: 9.02, priceUsd: 710.20, units: 0.0127, feeMyr: 1.40 },
    { id: "csv-022", date: "2026-08-12", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 168.56, amountUsd: 39.66, priceUsd: 298.00, units: 0.1331, feeMyr: 2.68 },
  ],
  reviews: [],
  customTickers: [],
  ledgerCategories: DEFAULT_LEDGER_CATEGORIES,
  ledgerAccounts: DEFAULT_LEDGER_ACCOUNTS,
  ledgerTransactions: [],
  liabilities: [],
  recurringTransactions: [],
  netWorthSnapshots: [],
  privacy: { maskAmounts: false, requireExportConfirmation: true },
  updatedAt: 0,
  deviceId: "default",
  ruleCardOverrides: {},
  ruleNoteTitle: "",
  ruleNotes: "",
  ruleNotesList: [],
  hiddenRuleIds: [],
  financialRules: [],
  actionRecords: [],
};

// Derived from defaultState's own planning config so the seed rules and the
// planning values they mirror can never drift apart.
defaultState.financialRules = getDefaultFinancialRules(defaultState);

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function cloneDefaultState(): WealthState {
  return structuredClone(defaultState);
}

const DEFAULT_TEMPLATE_KEY = "personal-wealth-os-default-template";

function getTemplateKey(uid?: string): string {
  return uid ? `${DEFAULT_TEMPLATE_KEY}-${uid}` : DEFAULT_TEMPLATE_KEY;
}

export function saveDefaultTemplate(state: WealthState, uid?: string): void {
  const { trades, ...rest } = state;
  const template = { ...rest, trades: [] };
  const key = getTemplateKey(uid);
  localStorage.setItem(key, JSON.stringify(template));
}

export function loadDefaultTemplate(uid?: string): WealthState {
  const key = getTemplateKey(uid);
  const raw = localStorage.getItem(key);
  if (!raw) return cloneDefaultState();
  try {
    const parsed = JSON.parse(raw) as Partial<WealthState>;
    return { ...migrateState(parsed), trades: [] };
  } catch {
    return cloneDefaultState();
  }
}

export function emptyState(): WealthState {
  const state: WealthState = {
    version: CURRENT_VERSION,
    profile: {
      name: "",
      age: 0,
      stage: "",
      riskTolerance: "Medium",
      investmentHorizonYears: 0,
      baseCurrency: "MYR",
    },
    cashflow: {
      allowance: 0,
      transport: 0,
      food: 0,
      otherFixed: 0,
      irregularIncome: 0,
    },
    emergency: {
      current: 0,
      target: 0,
      annualYield: 0,
      monthlyTopUp: 0,
    },
    dca: {
      monthly: 0,
      targets: { VOO: 0, QQQM: 0 },
    },
    opportunity: {
      total: 0,
      used: 0,
      allocation: { VOO: 0, QQQM: 0 },
      tranches: [],
    },
    buckets: [],
    goals: [],
    overviewGoalId: "",
    trades: [],
    reviews: [],
    customTickers: [],
    ledgerCategories: structuredClone(DEFAULT_LEDGER_CATEGORIES),
    ledgerAccounts: structuredClone(DEFAULT_LEDGER_ACCOUNTS),
    ledgerTransactions: [],
    liabilities: [],
    recurringTransactions: [],
    netWorthSnapshots: [],
    privacy: { maskAmounts: false, requireExportConfirmation: true },
    updatedAt: 0,
    deviceId: deviceId(),
    ruleCardOverrides: {},
    ruleNoteTitle: "",
    ruleNotes: "",
    ruleNotesList: [],
    hiddenRuleIds: [],
    financialRules: [],
    actionRecords: [],
  };
  // A brand-new user has no planning values yet, so these seed rules are
  // mostly disabled placeholders — present and valid, but asserting nothing.
  state.financialRules = getDefaultFinancialRules(state);
  return state;
}

function isLedgerType(value: unknown): value is LedgerTransactionType {
  return value === "income" || value === "expense" || value === "transfer";
}

function isLedgerAccountType(value: unknown): value is LedgerAccountType {
  return value === "bank" || value === "wallet" || value === "investment";
}

function validLedgerAccounts(value: unknown): LedgerAccount[] {
  if (!Array.isArray(value)) return structuredClone(DEFAULT_LEDGER_ACCOUNTS);
  const accounts = value.flatMap((candidate): LedgerAccount[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim() || typeof item.name !== "string" || !item.name.trim() || !isLedgerAccountType(item.type)) return [];
    const openingBalance = typeof item.openingBalance === "number" ? item.openingBalance : Number(item.openingBalance ?? 0);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) return [];
    const icon = typeof item.icon === "string" ? item.icon.trim().slice(0, 12) : "";
    // Only investment accounts can mirror the portfolio; the flag is ignored
    // anywhere else so a stray value cannot quietly remove a bank balance from
    // net worth.
    const holdsTrackedPortfolio = item.holdsTrackedPortfolio === true && item.type === "investment";
    return [{ id: item.id, name: item.name.trim().slice(0, 40), type: item.type, openingBalance: Math.round((openingBalance + Number.EPSILON) * 100) / 100, ...(icon ? { icon } : {}), ...(holdsTrackedPortfolio ? { holdsTrackedPortfolio: true } : {}) }];
  });
  return accounts.length > 0 ? accounts : structuredClone(DEFAULT_LEDGER_ACCOUNTS);
}

function validLedgerCategories(value: unknown): LedgerCategory[] {
  if (!Array.isArray(value)) return structuredClone(DEFAULT_LEDGER_CATEGORIES);
  const categories = value.flatMap((candidate): LedgerCategory[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim() || typeof item.label !== "string" || !item.label.trim() || typeof item.icon !== "string" || !isLedgerType(item.type)) return [];
    return [{ id: item.id, label: item.label.trim().slice(0, 40), icon: item.icon.trim().slice(0, 12) || "•", type: item.type }];
  });
  return categories.length > 0 ? categories : structuredClone(DEFAULT_LEDGER_CATEGORIES);
}

function ledgerCandidateItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.transactions)) return record.transactions;
  if (Array.isArray(record.entries)) return record.entries;
  return [];
}

function normalizedAccountReference(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function recoveredAccountId(reference: string, role: "account" | "source" | "destination"): string {
  let hash = 2166136261;
  for (const character of `${role}:${reference}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `account-recovered-${role}-${(hash >>> 0).toString(36)}`;
}

function validLedgerTransactions(value: unknown, categories: LedgerCategory[], accounts: LedgerAccount[]): LedgerTransaction[] {
  const candidates = ledgerCandidateItems(value);
  const categoryTypes = new Map(categories.map((category) => [category.id, category.type]));
  const accountByReference = new Map<string, string>();
  const registerAccount = (account: LedgerAccount): void => {
    accountByReference.set(account.id, account.id);
    const normalizedId = normalizedAccountReference(account.id);
    const normalizedName = normalizedAccountReference(account.name);
    if (normalizedId) accountByReference.set(normalizedId, account.id);
    if (normalizedName) accountByReference.set(normalizedName, account.id);
  };
  accounts.forEach(registerAccount);

  const resolveAccount = (item: Record<string, unknown>, fields: string[], role: "account" | "source" | "destination"): string => {
    const rawReference = fields
      .map((field) => item[field])
      .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
    if (rawReference) {
      const reference = rawReference.trim();
      const normalizedReference = normalizedAccountReference(reference);
      const existingId = accountByReference.get(reference) ?? (normalizedReference ? accountByReference.get(normalizedReference) : undefined);
      if (existingId) return existingId;

      const id = recoveredAccountId(reference, role);
      const recovered: LedgerAccount = {
        id,
        name: reference.slice(0, 40),
        type: "bank",
        openingBalance: 0,
        icon: "↺",
      };
      accounts.push(recovered);
      registerAccount(recovered);
      accountByReference.set(reference, id);
      return id;
    }

    const roleName = role === "source" ? "Recovered transfer source" : role === "destination" ? "Recovered transfer destination" : "Recovered legacy account";
    const id = recoveredAccountId(roleName, role);
    const existingId = accountByReference.get(id);
    if (existingId) return existingId;
    const recovered: LedgerAccount = { id, name: roleName, type: "bank", openingBalance: 0, icon: "↺" };
    accounts.push(recovered);
    registerAccount(recovered);
    return id;
  };

  return candidates.flatMap((candidate): LedgerTransaction[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const amount = typeof item.amount === "number" ? item.amount : Number(item.amount);
    const timestamp = typeof item.date === "string" ? new Date(item.date).getTime() : NaN;
    const type = item.type;
    const categoryValid = type === "transfer" ? !item.categoryId || typeof item.categoryId === "string" : typeof item.categoryId === "string" && categoryTypes.get(item.categoryId) === type;
    if (typeof item.id !== "string" || !item.id || !Number.isFinite(amount) || amount <= 0 || !isLedgerType(type) || !categoryValid || !Number.isFinite(timestamp)) return [];
    const accountId = type !== "transfer"
      ? resolveAccount(item, ["accountId", "account", "accountName"], "account")
      : undefined;
    const fromAccountId = type === "transfer"
      ? resolveAccount(item, ["fromAccountId", "fromAccount", "fromAccountName", "sourceAccountId", "sourceAccount"], "source")
      : undefined;
    const toAccountId = type === "transfer"
      ? resolveAccount(item, ["toAccountId", "toAccount", "toAccountName", "destinationAccountId", "destinationAccount"], "destination")
      : undefined;
    if (type === "transfer" && fromAccountId === toAccountId) return [];
    const note = typeof item.note === "string" ? item.note.trim().slice(0, 500) : undefined;
    return [{ id: item.id, amount: Math.round((amount + Number.EPSILON) * 100) / 100, type, ...(type !== "transfer" && typeof item.categoryId === "string" ? { categoryId: item.categoryId } : {}), ...(type !== "transfer" ? { accountId } : {}), ...(type === "transfer" ? { fromAccountId, toAccountId } : {}), date: new Date(timestamp).toISOString(), ...(note ? { note } : {}) }];
  });
}

function validRuleCardOverrides(value: unknown): Partial<Record<RuleCardId, RuleCardContent>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<Record<RuleCardId, RuleCardContent>> = {};
  Object.entries(value).forEach(([id, candidate]) => {
    if (!RULE_CARD_IDS.has(id as RuleCardId) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const item = candidate as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.body !== "string") return;
    const title = item.title.trim().slice(0, 80);
    const body = item.body.trim().slice(0, 2000);
    if (title && body) result[id as RuleCardId] = { title, body };
  });
  return result;
}

export function migrateState(input: Partial<WealthState>): WealthState {
  const candidate = input as Partial<WealthState> & Record<string, unknown>;
  const merged = {
    ...cloneDefaultState(),
    ...input,
    version: CURRENT_VERSION,
  } as WealthState;

  merged.profile = { ...defaultState.profile, ...input.profile };
  merged.cashflow = { ...defaultState.cashflow, ...input.cashflow };
  merged.emergency = { ...defaultState.emergency, ...input.emergency };
  merged.dca = { ...defaultState.dca, ...input.dca, targets: { ...defaultState.dca.targets, ...input.dca?.targets } };
  merged.opportunity = {
    ...defaultState.opportunity,
    ...input.opportunity,
    allocation: { ...defaultState.opportunity.allocation, ...input.opportunity?.allocation },
    tranches: input.opportunity?.tranches ?? defaultState.opportunity.tranches,
  };
  merged.customTickers = Array.isArray(input.customTickers)
    ? [...new Set(input.customTickers
      .filter((ticker): ticker is string => typeof ticker === "string")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter((ticker) => /^[A-Z0-9._^:-]{1,20}$/.test(ticker) && ticker !== "VOO" && ticker !== "QQQM"))]
      .slice(0, 30)
    : [];
  const legacyLedger = candidate.ledger && typeof candidate.ledger === "object" ? candidate.ledger as Record<string, unknown> : undefined;
  const ledgerCategories = validLedgerCategories(candidate.ledgerCategories ?? legacyLedger?.categories);
  let ledgerAccounts = validLedgerAccounts(input.ledgerAccounts);
  if ((input.version ?? 0) < 11) {
    const existingIds = new Set(ledgerAccounts.map((account) => account.id));
    const investmentAccounts = DEFAULT_LEDGER_ACCOUNTS.filter((account) => account.type === "investment" && !existingIds.has(account.id));
    ledgerAccounts = [...ledgerAccounts, ...structuredClone(investmentAccounts)];
  }
  const transactionSource = candidate.ledgerTransactions ?? candidate.transactions ?? candidate.ledgerEntries ?? legacyLedger?.transactions ?? legacyLedger?.entries;
  const ledgerTransactions = validLedgerTransactions(transactionSource, ledgerCategories, ledgerAccounts);
  merged.ledgerCategories = ledgerCategories;
  merged.ledgerAccounts = ledgerAccounts;
  merged.ledgerTransactions = ledgerTransactions;
  const defaultTradesById = new Map(defaultState.trades.map((trade) => [trade.id, trade]));
  const hasLegacySeedPortfolio = (input.version ?? 0) < 15
    && Array.isArray(input.trades)
    && input.trades.length === 18
    && input.trades.every((trade, index) => trade.id === `csv-${String(index + 1).padStart(3, "0")}`)
    && input.trades[0]?.ticker === "VOO"
    && input.trades[0]?.amountUsd === 5.04
    && input.trades[17]?.ticker === "QQQM"
    && input.trades[17]?.amountUsd === 0.06;
  merged.trades = Array.isArray(input.trades) ? input.trades.map((trade): Trade => {
    const migratedDefault = hasLegacySeedPortfolio ? defaultTradesById.get(trade.id) : undefined;
    const source = migratedDefault ?? trade;
    const units = Number(source.units);
    return {
      ...source,
      ...(Number.isFinite(units) && units > 0 ? { units } : {}),
      exchangeRate: Number.isFinite(source.exchangeRate) && Number(source.exchangeRate) > 0
        ? Number(source.exchangeRate)
        : source.amountUsd > 0 && source.amountMyr > 0 ? source.amountMyr / source.amountUsd : 4.25,
    };
  }) : [];
  if (hasLegacySeedPortfolio) {
    const existingTradeIds = new Set(merged.trades.map((trade) => trade.id));
    merged.trades.push(...defaultState.trades.filter((trade) => !existingTradeIds.has(trade.id)).map((trade) => structuredClone(trade)));
  }
  merged.goals = Array.isArray(input.goals) ? input.goals.map((goal) => ({
    ...goal,
    ...(typeof goal.accountId === "string" && ledgerAccounts.some((account) => account.id === goal.accountId) ? { accountId: goal.accountId } : {}),
  })) : [];
  merged.liabilities = Array.isArray(input.liabilities) ? input.liabilities.filter((item) =>
    item && typeof item.id === "string" && typeof item.name === "string" && Number.isFinite(item.balance) && item.balance >= 0 && Number.isFinite(item.annualRate) && item.annualRate >= 0 && Number.isFinite(item.minimumPayment) && item.minimumPayment >= 0
  ) : [];
  merged.recurringTransactions = Array.isArray(input.recurringTransactions) ? input.recurringTransactions.filter((item) =>
    item && typeof item.id === "string" && typeof item.label === "string" && Number.isFinite(item.amount) && item.amount > 0 && (item.type === "income" || item.type === "expense") && Number.isInteger(item.dayOfMonth) && item.dayOfMonth >= 1 && item.dayOfMonth <= 31
  ) : [];
  merged.netWorthSnapshots = Array.isArray(input.netWorthSnapshots) ? input.netWorthSnapshots.filter((item) =>
    item && typeof item.id === "string" && typeof item.date === "string" && Number.isFinite(Date.parse(item.date)) && Number.isFinite(item.assets) && item.assets >= 0 && Number.isFinite(item.liabilities) && item.liabilities >= 0
  ) : [];
  merged.privacy = {
    maskAmounts: input.privacy?.maskAmounts === true,
    requireExportConfirmation: input.privacy?.requireExportConfirmation !== false,
  };
  merged.updatedAt = Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : 0;
  merged.deviceId = typeof input.deviceId === "string" && input.deviceId ? input.deviceId : deviceId();
  merged.ruleCardOverrides = validRuleCardOverrides(input.ruleCardOverrides);
  merged.ruleNoteTitle = typeof input.ruleNoteTitle === "string" ? input.ruleNoteTitle.trim().slice(0, 80) : "";
  merged.ruleNotes = typeof input.ruleNotes === "string" ? input.ruleNotes.slice(0, 5000) : "";
  merged.ruleNotesList = Array.isArray(input.ruleNotesList)
    ? input.ruleNotesList
        .filter((n): n is RuleNote => {
          if (!n || typeof n !== "object") return false;
          const note = n as unknown as Record<string, unknown>;
          return typeof note.id === "string" && typeof note.title === "string" && typeof note.body === "string";
        })
        .map((n) => ({ id: n.id, title: n.title.trim().slice(0, 80), body: n.body.slice(0, 5000), createdAt: typeof n.createdAt === "number" ? n.createdAt : 0 }))
        .slice(0, 100)
    : [];
  merged.hiddenRuleIds = Array.isArray(input.hiddenRuleIds)
    ? [...new Set(input.hiddenRuleIds.filter((id): id is RuleCardId => typeof id === "string" && RULE_CARD_IDS.has(id as RuleCardId)))]
    : [];

  // v16: structured financial rules. Seed from the user's own planning config
  // only when the field is absent (pre-v16 states, or an import that predates
  // it). An explicitly stored array — including an empty one — is the user's
  // configuration and is normalized rather than replaced, which also makes the
  // migration idempotent.
  merged.financialRules = Array.isArray(candidate.financialRules)
    ? normalizeFinancialRules(candidate.financialRules)
    : getDefaultFinancialRules(merged);

  // v17: action records. Purely additive — a state without them starts empty,
  // and an existing array is normalized rather than replaced. Malformed
  // entries are dropped individually so the rest of the state survives.
  merged.actionRecords = normalizeActionRecords(candidate.actionRecords);
  const requestedOverviewGoalId = typeof candidate.overviewGoalId === "string" ? candidate.overviewGoalId : "";
  merged.overviewGoalId = merged.goals.some((goal) => goal.id === requestedOverviewGoalId)
    ? requestedOverviewGoalId
    : merged.goals.find((goal) => goal.target > 0 && goal.current < goal.target)?.id ?? merged.goals[0]?.id ?? "";

  if ((input.version ?? 0) < 3) {
    const legacyTextTranslations: Record<string, string> = {
      "\u751f\u5b58\u6876": "Survival Bucket",
      "\u4ea4\u901a + \u5403\u996d，\u5148\u4fdd\u8bc1\u73b0\u91d1\u6d41\u7a33\u5b9a。": "Transport and food come first to keep cash flow stable.",
      "\u5b89\u5168\u6876": "Safety Bucket",
      "Emergency Fund \u5df2\u8fbe\u6807\uff01MYR 40 \u53ef\u91cd\u5206\u914d\u5230\u6210\u957f\u6876\u6216\u81ea\u7531\u6876。": "The Emergency Fund is complete. MYR 40 can be redirected to Growth or Freedom.",
      "\u6210\u957f\u6876": "Growth Bucket",
      "VOO 70% / QQQM 30% \u81ea\u52a8 DCA。": "Automated DCA split: 70% VOO and 30% QQQM.",
      "\u81ea\u7531\u6876": "Freedom Bucket",
      "\u65c5\u884c\u57fa\u91d1\u548c\u613f\u671b\u6e05\u5355（\u542b\u539f Safety \u6876 MYR 20 \u91cd\u5206\u914d）。": "Travel and wishlist funding, including MYR 20 redirected from Safety.",
      "\u5b66\u4e60\u6876": "Learning Bucket",
      "\u4e66、\u8bfe\u7a0b、\u5de5\u5177\u548c\u6295\u8d44\u5b66\u4e60\u6210\u672c。": "Books, courses, tools, and investment education.",
      "\u673a\u4f1a\u6876": "Opportunity Bucket",
      "\u4e00\u6b21\u6027\u718a\u5e02\u8865\u4ed3\u8d44\u91d1，\u53ea\u6309\u89c4\u5219\u90e8\u7f72。": "One-time bear-market reserve deployed only according to the rules.",
      "5 \u4e2a\u6708\u5b89\u5168\u57ab ✅": "5-Month Safety Buffer ✅",
      "\u5df2\u8fbe\u6210 5 \u4e2a\u6708\u5b89\u5168\u57ab\u76ee\u6807\uff01MYR 4,000 \u5b58\u591f。": "The five-month safety-buffer goal is complete at MYR 4,000.",
      "\u65c5\u884c\u57fa\u91d1": "Travel Fund",
      "\u5148\u7528\u7cfb\u7edf\u5efa\u8bae\u76ee\u6807，\u4e4b\u540e\u53ef\u8c03\u6574。": "Start with the suggested target and adjust it later if needed.",
      "\u613f\u671b\u6e05\u5355": "Wishlist",
      "\u6bcf\u6708 MYR 20 \u4ece Safety \u6876\u91cd\u5206\u914d\u800c\u6765。": "MYR 20 is redirected from the Safety Bucket each month.",
      "\u5b66\u4e60\u57fa\u91d1": "Learning Fund",
      "\u7528\u4e8e\u6280\u80fd、\u8bfe\u7a0b、\u4e66\u7c4d、\u5de5\u5177。": "For skills, courses, books, and tools.",
    };
    const translate = (value: string): string => legacyTextTranslations[value] ?? value;
    merged.buckets = merged.buckets.map((bucket) => ({ ...bucket, label: translate(bucket.label), note: translate(bucket.note) }));
    merged.goals = merged.goals.map((goal) => ({ ...goal, label: translate(goal.label), note: translate(goal.note) }));
  }

  return merged;
}

export function loadState(uid?: string): WealthState {
  const key = getUserStorageKey(uid);
  const raw = localStorage.getItem(key);
  if (!raw) return cloneDefaultState();

  try {
    return migrateState(JSON.parse(raw) as Partial<WealthState>);
  } catch {
    return cloneDefaultState();
  }
}

export function saveState(state: WealthState, uid?: string, changeLabel?: string): void {
  if (!uid) return; // Don't save to global key — prevents cross-user contamination

  // Auto-save snapshot of previous state before overwriting
  if (changeLabel) {
    const key = getUserStorageKey(uid);
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const prevState = JSON.parse(raw) as WealthState;
        saveSnapshot(prevState, changeLabel, uid);
      } catch { /* ignore snapshot parse errors */ }
    }
  }

  const key = getUserStorageKey(uid);
  const persisted = { ...state, version: CURRENT_VERSION, updatedAt: Date.now(), deviceId: state.deviceId || deviceId() };
  try {
    localStorage.setItem(key, JSON.stringify(persisted));
  } catch (err) {
    // localStorage quota exceeded or serialization failure — surface to UI
    console.error("[saveState] localStorage write failed:", err);
    window.dispatchEvent(new CustomEvent("pwo-save-error", { detail: { message: "Local storage save failed. Data may not persist." } }));
    return;
  }
  // Also sync to Firestore if logged in
  const user = currentUser();
  if (user) {
    saveToFirestore(user.uid, persisted).catch((err) => {
      console.error("[saveState] Firestore sync failed:", err);
      window.dispatchEvent(new CustomEvent("pwo-save-error", { detail: { message: "Cloud sync failed. Local copy is safe." } }));
    });
  }
}

export async function loadStateFromCloud(): Promise<WealthState | null> {
  const user = currentUser();
  if (!user) return null;
  // Don't catch errors here - let the caller distinguish "no data" from "load error"
  const cloudState = await loadFromFirestore(user.uid);
  if (cloudState) {
    const key = getUserStorageKey(user.uid);
    const previousRaw = localStorage.getItem(key);
    if (previousRaw) {
      try {
        saveSnapshot(JSON.parse(previousRaw) as WealthState, "Before cloud data refresh", user.uid);
      } catch { /* Keep loading cloud data if the old local copy is invalid. */ }
    }
    const migrated = migrateState(cloudState as Partial<WealthState>);
    localStorage.setItem(key, JSON.stringify(migrated));
    return migrated;
  }
  return null;
}

export async function syncLocalToCloud(state: WealthState): Promise<void> {
  const user = currentUser();
  if (!user) return;
  try {
    await saveToFirestore(user.uid, state);
  } catch (err) {
    console.error("Failed to sync to cloud:", err);
  }
}

// --- Version History (Snapshots) ---

export interface Snapshot {
  id: string;
  timestamp: number;
  label: string;
  state: WealthState;
}

const SNAPSHOTS_KEY = "personal-wealth-os-snapshots";
const MAX_SNAPSHOTS = 20;

function getSnapshotsKey(uid?: string): string {
  return uid ? `${SNAPSHOTS_KEY}-${uid}` : SNAPSHOTS_KEY;
}

export function saveSnapshot(prevState: WealthState, label: string, uid?: string): void {
  const key = getSnapshotsKey(uid);
  let snapshots: Snapshot[] = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) snapshots = JSON.parse(raw);
  } catch { /* ignore */ }

  const snapshot: Snapshot = {
    id: createId("snap"),
    timestamp: Date.now(),
    label,
    state: structuredClone(prevState),
  };

  // Remove duplicate if last snapshot has identical timestamp (within 1 second)
  if (snapshots.length > 0 && Math.abs(snapshots[0].timestamp - snapshot.timestamp) < 1000) {
    snapshots.shift();
  }

  snapshots.unshift(snapshot);

  // Trim to max
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots = snapshots.slice(0, MAX_SNAPSHOTS);
  }

  localStorage.setItem(key, JSON.stringify(snapshots));
}

export function loadSnapshots(uid?: string): Snapshot[] {
  const key = getSnapshotsKey(uid);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as Snapshot[];
  } catch {
    return [];
  }
}

export function restoreSnapshot(snapshotId: string, uid?: string): WealthState | null {
  const snapshots = loadSnapshots(uid);
  const found = snapshots.find((s) => s.id === snapshotId);
  if (!found) return null;
  return migrateState(found.state as Partial<WealthState>);
}

export function clearSnapshots(uid?: string): void {
  const key = getSnapshotsKey(uid);
  localStorage.removeItem(key);
}

export function exportState(state: WealthState): void {
  const payload = JSON.stringify({ ...state, version: CURRENT_VERSION }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `personal-wealth-os-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importStateFromFile(file: File): Promise<WealthState> {
  const raw = await file.text();
  return migrateState(JSON.parse(raw) as Partial<WealthState>);
}
