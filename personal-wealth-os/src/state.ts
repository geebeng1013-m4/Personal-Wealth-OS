import type { WealthState } from "./models";
import {
  saveToFirestore,
  loadFromFirestore,
  currentUser,
} from "./firebase";

export const STORAGE_KEY = "personal-wealth-os-state";
export const CURRENT_VERSION = 2;

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
    { id: "survival", name: "Survival", label: "生存桶", amount: 720, cadence: "monthly", note: "交通 + 吃饭，先保证现金流稳定。" },
    { id: "safety", name: "Safety", label: "安全桶", amount: 0, cadence: "monthly", note: "Emergency Fund 已达标！MYR 40 可重分配到成长桶或自由桶。" },
    { id: "growth", name: "Growth", label: "成长桶", amount: 100, cadence: "monthly", note: "VOO 70% / QQQM 30% 自动 DCA。" },
    { id: "freedom", name: "Freedom", label: "自由桶", amount: 50, cadence: "monthly", note: "旅行基金和愿望清单（含原 Safety 桶 MYR 20 重分配）。" },
    { id: "learning", name: "Learning", label: "学习桶", amount: 10, cadence: "monthly", note: "书、课程、工具和投资学习成本。" },
    { id: "opportunity", name: "Opportunity", label: "机会桶", amount: 400, cadence: "one-time", note: "一次性熊市补仓资金，只按规则部署。" },
  ],
  goals: [
    { id: "emergency", name: "Emergency Fund", label: "5 个月安全垫 ✅", current: 4000, target: 4000, monthlyContribution: 0, note: "已达成 5 个月安全垫目标！MYR 4,000 存够。" },
    { id: "travel", name: "Travel Fund", label: "旅行基金", current: 0, target: 1000, monthlyContribution: 30, note: "先用系统建议目标，之后可调整。" },
    { id: "wishlist", name: "Wishlist Fund", label: "愿望清单", current: 0, target: 500, monthlyContribution: 20, note: "每月 MYR 20 从 Safety 桶重分配而来。" },
    { id: "learning", name: "Learning Fund", label: "学习基金", current: 0, target: 300, monthlyContribution: 10, note: "用于技能、课程、书籍、工具。" },
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
    return { ...cloneDefaultState(), ...parsed, trades: [] };
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
  };
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
