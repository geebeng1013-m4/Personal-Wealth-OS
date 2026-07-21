import type { LedgerCategory, LedgerTransaction, LedgerTransactionType, RuleCardContent, RuleCardId, WealthState } from "./models";
import {
  saveToFirestore,
  loadFromFirestore,
  currentUser,
} from "./firebase";

export const STORAGE_KEY = "personal-wealth-os-state";
export const CURRENT_VERSION = 8;

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
  trades: [
    { id: "csv-001", date: "2025-10-28", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 21.42, amountUsd: 5.04, priceUsd: 630.54, feeMyr: 0.21 },
    { id: "csv-002", date: "2026-04-06", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 199.75, amountUsd: 47.00, priceUsd: 604.11, feeMyr: 1.99 },
    { id: "csv-003", date: "2026-04-06", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 69.36, amountUsd: 16.32, priceUsd: 241.73, feeMyr: 0.68 },
    { id: "csv-004", date: "2026-04-06", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 173.44, amountUsd: 40.81, priceUsd: 604.54, feeMyr: 1.70 },
    { id: "csv-005", date: "2026-04-06", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 69.45, amountUsd: 16.34, priceUsd: 241.67, feeMyr: 0.68 },
    { id: "csv-006", date: "2026-04-06", platform: "moomoo", ticker: "VOO", type: "Sell", amountMyr: 193.89, amountUsd: 45.62, priceUsd: 604.28, feeMyr: 1.91 },
    { id: "csv-007", date: "2026-04-06", platform: "moomoo", ticker: "QQQM", type: "Sell", amountMyr: 69.45, amountUsd: 16.34, priceUsd: 241.75, feeMyr: 0.68 },
    { id: "csv-008", date: "2026-05-04", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 44.54, amountUsd: 10.48, priceUsd: 663.51, feeMyr: 0.43 },
    { id: "csv-009", date: "2026-05-05", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 193.80, amountUsd: 45.60, priceUsd: 664.69, feeMyr: 1.90 },
    { id: "csv-010", date: "2026-05-05", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 96.31, amountUsd: 22.66, priceUsd: 280.16, feeMyr: 0.94 },
    { id: "csv-011", date: "2026-05-12", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 225.17, amountUsd: 52.98, priceUsd: 674.91, feeMyr: 2.21 },
    { id: "csv-012", date: "2026-05-12", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 112.63, amountUsd: 26.50, priceUsd: 289.61, feeMyr: 1.10 },
    { id: "csv-013", date: "2026-05-28", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 59.67, amountUsd: 14.04, priceUsd: 691.52, feeMyr: 0.59 },
    { id: "csv-014", date: "2026-05-28", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 23.08, amountUsd: 5.43, priceUsd: 301.60, feeMyr: 0.21 },
    { id: "csv-015", date: "2026-06-03", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 314.88, amountUsd: 74.09, priceUsd: 693.77, feeMyr: 3.10 },
    { id: "csv-016", date: "2026-06-05", platform: "moomoo", ticker: "VOO", type: "DCA", amountMyr: 143.23, amountUsd: 33.70, priceUsd: 685.00, feeMyr: 1.40 },
    { id: "csv-017", date: "2026-06-05", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 63.28, amountUsd: 14.89, priceUsd: 296.00, feeMyr: 0.64 },
    { id: "csv-018", date: "2026-06-26", platform: "moomoo", ticker: "QQQM", type: "DCA", amountMyr: 0.26, amountUsd: 0.06, priceUsd: 290.95, feeMyr: 0.04 },
  ],
  reviews: [],
  customTickers: [],
  ledgerCategories: DEFAULT_LEDGER_CATEGORIES,
  ledgerTransactions: [],
  ruleCardOverrides: {},
  ruleNoteTitle: "",
  ruleNotes: "",
  hiddenRuleIds: [],
};

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
  return {
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
    trades: [],
    reviews: [],
    customTickers: [],
    ledgerCategories: structuredClone(DEFAULT_LEDGER_CATEGORIES),
    ledgerTransactions: [],
    ruleCardOverrides: {},
    ruleNoteTitle: "",
    ruleNotes: "",
    hiddenRuleIds: [],
  };
}

function isLedgerType(value: unknown): value is LedgerTransactionType {
  return value === "income" || value === "expense";
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

function validLedgerTransactions(value: unknown, categories: LedgerCategory[]): LedgerTransaction[] {
  if (!Array.isArray(value)) return [];
  const categoryTypes = new Map(categories.map((category) => [category.id, category.type]));
  return value.flatMap((candidate): LedgerTransaction[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const amount = typeof item.amount === "number" ? item.amount : Number(item.amount);
    const timestamp = typeof item.date === "string" ? new Date(item.date).getTime() : NaN;
    if (typeof item.id !== "string" || !item.id || !Number.isFinite(amount) || amount <= 0 || !isLedgerType(item.type) || typeof item.categoryId !== "string" || categoryTypes.get(item.categoryId) !== item.type || !Number.isFinite(timestamp)) return [];
    const note = typeof item.note === "string" ? item.note.trim().slice(0, 500) : undefined;
    return [{ id: item.id, amount: Math.round((amount + Number.EPSILON) * 100) / 100, type: item.type, categoryId: item.categoryId, date: new Date(timestamp).toISOString(), ...(note ? { note } : {}) }];
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

function migrateState(input: Partial<WealthState>): WealthState {
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
  merged.ledgerCategories = validLedgerCategories(input.ledgerCategories);
  merged.ledgerTransactions = validLedgerTransactions(input.ledgerTransactions, merged.ledgerCategories);
  merged.ruleCardOverrides = validRuleCardOverrides(input.ruleCardOverrides);
  merged.ruleNoteTitle = typeof input.ruleNoteTitle === "string" ? input.ruleNoteTitle.trim().slice(0, 80) : "";
  merged.ruleNotes = typeof input.ruleNotes === "string" ? input.ruleNotes.slice(0, 5000) : "";
  merged.hiddenRuleIds = Array.isArray(input.hiddenRuleIds)
    ? [...new Set(input.hiddenRuleIds.filter((id): id is RuleCardId => typeof id === "string" && RULE_CARD_IDS.has(id as RuleCardId)))]
    : [];

  if ((input.version ?? 0) < 3) {
    const legacyTextTranslations: Record<string, string> = {
      "生存桶": "Survival Bucket",
      "交通 + 吃饭，先保证现金流稳定。": "Transport and food come first to keep cash flow stable.",
      "安全桶": "Safety Bucket",
      "Emergency Fund 已达标！MYR 40 可重分配到成长桶或自由桶。": "The Emergency Fund is complete. MYR 40 can be redirected to Growth or Freedom.",
      "成长桶": "Growth Bucket",
      "VOO 70% / QQQM 30% 自动 DCA。": "Automated DCA split: 70% VOO and 30% QQQM.",
      "自由桶": "Freedom Bucket",
      "旅行基金和愿望清单（含原 Safety 桶 MYR 20 重分配）。": "Travel and wishlist funding, including MYR 20 redirected from Safety.",
      "学习桶": "Learning Bucket",
      "书、课程、工具和投资学习成本。": "Books, courses, tools, and investment education.",
      "机会桶": "Opportunity Bucket",
      "一次性熊市补仓资金，只按规则部署。": "One-time bear-market reserve deployed only according to the rules.",
      "5 个月安全垫 ✅": "5-Month Safety Buffer ✅",
      "已达成 5 个月安全垫目标！MYR 4,000 存够。": "The five-month safety-buffer goal is complete at MYR 4,000.",
      "旅行基金": "Travel Fund",
      "先用系统建议目标，之后可调整。": "Start with the suggested target and adjust it later if needed.",
      "愿望清单": "Wishlist",
      "每月 MYR 20 从 Safety 桶重分配而来。": "MYR 20 is redirected from the Safety Bucket each month.",
      "学习基金": "Learning Fund",
      "用于技能、课程、书籍、工具。": "For skills, courses, books, and tools.",
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
      } catch { /* ignore */ }
    }
  }

  const key = getUserStorageKey(uid);
  localStorage.setItem(key, JSON.stringify({ ...state, version: CURRENT_VERSION }));
  // Also sync to Firestore if logged in
  const user = currentUser();
  if (user) {
    saveToFirestore(user.uid, state).catch(console.error);
  }
}

export async function loadStateFromCloud(): Promise<WealthState | null> {
  const user = currentUser();
  if (!user) return null;
  // Don't catch errors here - let the caller distinguish "no data" from "load error"
  const cloudState = await loadFromFirestore(user.uid);
  if (cloudState) {
    // Save to user-specific localStorage key
    const key = getUserStorageKey(user.uid);
    localStorage.setItem(key, JSON.stringify({ ...cloudState, version: CURRENT_VERSION }));
    return migrateState(cloudState as Partial<WealthState>);
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
