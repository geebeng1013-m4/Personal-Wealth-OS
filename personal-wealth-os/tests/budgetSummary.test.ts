import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getBudgetBucket, getBudgetSnapshot } from "../src/budgetSummary";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { getFinancialSnapshot } from "../src/financialHealth";
import { monthlyBasicExpense, monthlySurplus } from "../src/rules";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { Bucket, LedgerAccount, LedgerTransaction, WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0); // 2026-08-15 local

function iso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0).toISOString();
}

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-budget", ...overrides });
}

const accounts: LedgerAccount[] = [
  { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 5000 },
];

function bucket(overrides: Partial<Bucket> & Pick<Bucket, "id">): Bucket {
  return {
    name: overrides.id, label: overrides.id, amount: 0,
    cadence: "monthly", note: "", ...overrides,
  };
}

/** Plan: allowance 2000 + irregular 200, fixed 300+400+100 = 800 -> surplus 1400. */
function plannedState(overrides: Partial<WealthState> = {}): WealthState {
  return stateWith({
    cashflow: { allowance: 2000, transport: 300, food: 400, otherFixed: 100, irregularIncome: 200 },
    dca: { monthly: 500, targets: { VOO: 1 } },
    ...overrides,
  });
}

// --- A. monthly income ------------------------------------------------------

test("budget/A: planned income and allowance read the existing cashflow state", () => {
  const state = plannedState();
  const budget = getBudgetSnapshot(state, NOW);
  assert.equal(budget.plannedAllowance, 2000);
  assert.equal(budget.plannedIncome, 2200, "allowance + irregular income");
  assert.equal(budget.plannedDcaAmount, 500);
});

// --- B & C. actual figures come from the ledger snapshot --------------------

test("budget/B: actualSpending equals getLedgerSnapshot().currentMonth.expenses", () => {
  const state = plannedState({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "e1", amount: 250, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
      { id: "e2", amount: 90, type: "expense", categoryId: "expense-transport", accountId: "acc-bank", date: iso(2026, 7, 6) },
      { id: "old", amount: 999, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 6, 4) },
    ] as LedgerTransaction[],
  });
  const budget = getBudgetSnapshot(state, NOW);
  const ledger = getLedgerSnapshot(state, NOW);
  assert.equal(budget.actualSpending, ledger.currentMonth.expenses);
  assert.equal(budget.actualSpending, 340, "last month's expense is excluded");
});

test("budget/C: actual income and surplus match the canonical ledger snapshot", () => {
  const state = plannedState({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "i1", amount: 3000, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
      { id: "e1", amount: 250, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
      { id: "t1", amount: 500, type: "transfer", fromAccountId: "acc-bank", toAccountId: "acc-wallet", date: iso(2026, 7, 7) },
    ] as LedgerTransaction[],
  });
  const budget = getBudgetSnapshot(state, NOW);
  const ledger = getLedgerSnapshot(state, NOW);
  assert.equal(budget.actualIncome, ledger.currentMonth.income);
  assert.equal(budget.actualSurplus, ledger.currentMonth.surplus);
  assert.equal(budget.actualSurplus, 2750, "transfers excluded from both sides");
  assert.equal(budget.monthKey, ledger.currentMonth.key);
});

test("budget/C: actual figures also agree with the financial snapshot", () => {
  const state = plannedState({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "i1", amount: 1200, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 3) },
      { id: "e1", amount: 300, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
  });
  const budget = getBudgetSnapshot(state, NOW);
  const financial = getFinancialSnapshot(state, NOW);
  assert.equal(budget.actualIncome, financial.currentMonthIncome);
  assert.equal(budget.actualSpending, financial.currentMonthExpenses);
  assert.equal(budget.actualSurplus, financial.currentMonthSurplus);
});

// --- D & K. planned figures reuse the existing primitives -------------------

test("budget/D: planned spending and surplus use the existing rules.ts primitives", () => {
  const state = plannedState();
  const budget = getBudgetSnapshot(state, NOW);
  assert.equal(budget.plannedSpending, monthlyBasicExpense(state));
  assert.equal(budget.plannedSurplus, monthlySurplus(state));
  assert.equal(budget.plannedSpending, 800, "transport + food + otherFixed");
  assert.equal(budget.plannedSurplus, 1400, "2200 income - 800 fixed");
});

test("budget/K: planned calculations are unchanged for a range of states", () => {
  for (const state of [cloneDefaultState(), emptyState(), plannedState()]) {
    const budget = getBudgetSnapshot(state, NOW);
    assert.equal(budget.plannedSpending, monthlyBasicExpense(state));
    assert.equal(budget.plannedSurplus, monthlySurplus(state));
    assert.equal(budget.plannedAllowance, state.cashflow.allowance);
  }
});

// --- E. plan and actual are never conflated --------------------------------

test("budget/E: planned and actual are independent of one another", () => {
  const base = {
    cashflow: { allowance: 2000, transport: 300, food: 400, otherFixed: 100, irregularIncome: 200 },
    ledgerAccounts: accounts,
  };
  // Changing the LEDGER must not move any planned figure.
  const noLedger = getBudgetSnapshot(stateWith(base), NOW);
  const withLedger = getBudgetSnapshot(stateWith({
    ...base,
    ledgerTransactions: [
      { id: "e1", amount: 5000, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
  }), NOW);
  assert.equal(withLedger.plannedSpending, noLedger.plannedSpending, "plan is untouched by recorded spending");
  assert.equal(withLedger.plannedSurplus, noLedger.plannedSurplus);
  assert.notEqual(withLedger.actualSpending, noLedger.actualSpending, "actual did move");

  // Changing the PLAN must not move any actual figure.
  const tighterPlan = getBudgetSnapshot(stateWith({
    ...base,
    cashflow: { allowance: 100, transport: 10, food: 10, otherFixed: 0, irregularIncome: 0 },
  }), NOW);
  assert.equal(tighterPlan.actualSpending, noLedger.actualSpending, "actual is untouched by plan edits");
});

test("budget/E: spending variance compares actual against plan without judging it", () => {
  const state = plannedState({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "e1", amount: 1000, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
  });
  const budget = getBudgetSnapshot(state, NOW);
  assert.equal(budget.spendingVariance, 1000 - 800);
  assert.equal(budget.isOverPlannedSpending, true);

  const under = getBudgetSnapshot(plannedState({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "e1", amount: 100, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
  }), NOW);
  assert.equal(under.spendingVariance, 100 - 800);
  assert.equal(under.isOverPlannedSpending, false);
});

test("budget/E: planCoversDca compares the PLANNED surplus, not recorded surplus", () => {
  // Planned surplus 1400 >= DCA 500 -> covered, even with huge real spending.
  const state = plannedState({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "e1", amount: 99999, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 4) },
    ] as LedgerTransaction[],
  });
  const budget = getBudgetSnapshot(state, NOW);
  assert.equal(budget.planCoversDca, true, "a planning question answered with planning data");
  assert.equal(budget.planCoversDca, budget.plannedSurplus >= budget.plannedDcaAmount);
});

// --- F. buckets -------------------------------------------------------------

test("budget/F: buckets mirror the existing state exactly", () => {
  const buckets: Bucket[] = [
    bucket({ id: "survival", name: "Survival", label: "Survival", amount: 800, note: "n1" }),
    bucket({ id: "growth", name: "Growth", label: "Growth", amount: 500, note: "n2" }),
    bucket({ id: "opportunity", name: "Opportunity", label: "Opportunity", amount: 400, cadence: "one-time", note: "n3" }),
  ];
  const snapshot = getBudgetSnapshot(plannedState({ buckets }), NOW);
  assert.equal(snapshot.buckets.length, 3);
  snapshot.buckets.forEach((b, i) => {
    assert.equal(b.id, buckets[i].id);
    assert.equal(b.name, buckets[i].name);
    assert.equal(b.label, buckets[i].label);
    assert.equal(b.amount, buckets[i].amount);
    assert.equal(b.cadence, buckets[i].cadence);
    assert.equal(b.note, buckets[i].note);
    assert.equal(b.index, i, "index points back at the original entry");
  });
});

test("budget/F: allocation base follows the existing Budget page rules", () => {
  // allowance 2000, planned surplus 1400.
  const snapshot = getBudgetSnapshot(plannedState({
    buckets: [
      bucket({ id: "survival", amount: 800 }),
      bucket({ id: "growth", amount: 700 }),
      bucket({ id: "opportunity", amount: 400, cadence: "one-time" }),
    ],
  }), NOW);

  assert.equal(getBudgetBucket(snapshot, "survival")!.allocationBase, 2000, "survival measures against the allowance");
  assert.equal(getBudgetBucket(snapshot, "growth")!.allocationBase, 1400, "monthly buckets measure against the surplus");
  assert.equal(getBudgetBucket(snapshot, "opportunity")!.allocationBase, 400, "one-time buckets measure against themselves");

  assert.equal(getBudgetBucket(snapshot, "survival")!.allocationRatio, 800 / 2000);
  assert.equal(getBudgetBucket(snapshot, "growth")!.allocationRatio, 700 / 1400);
  assert.equal(getBudgetBucket(snapshot, "opportunity")!.allocationRatio, 1, "a one-time bucket is always full");
});

test("budget/F: the allocation ratio is capped at 1", () => {
  const snapshot = getBudgetSnapshot(plannedState({
    buckets: [bucket({ id: "greedy", amount: 999999 })],
  }), NOW);
  assert.equal(getBudgetBucket(snapshot, "greedy")!.allocationRatio, 1);
});

test("budget/F: a non-positive surplus still yields a usable base, matching the old max(surplus, 1)", () => {
  const state = stateWith({
    cashflow: { allowance: 100, transport: 100, food: 100, otherFixed: 0, irregularIncome: 0 },
    buckets: [bucket({ id: "growth", amount: 50 })],
  });
  const snapshot = getBudgetSnapshot(state, NOW);
  assert.ok(monthlySurplus(state) < 0, "the fixture really does have a negative planned surplus");
  assert.equal(getBudgetBucket(snapshot, "growth")!.allocationBase, 1, "floored at 1, as before");
  assert.equal(getBudgetBucket(snapshot, "growth")!.allocationRatio, 1);
});

test("budget/F: a zero base yields 0 rather than NaN", () => {
  // A one-time bucket with no amount used to compute 0/0 -> NaN.
  const snapshot = getBudgetSnapshot(plannedState({
    buckets: [bucket({ id: "empty", amount: 0, cadence: "one-time" })],
  }), NOW);
  const b = getBudgetBucket(snapshot, "empty")!;
  assert.equal(b.allocationBase, 0);
  assert.equal(b.allocationRatio, 0);
  assert.ok(Number.isFinite(b.allocationRatio), "never NaN");
});

// --- G. empty / partial state ----------------------------------------------

test("budget/G: empty and partial states do not crash", () => {
  const partial = migrateState({ deviceId: "d", buckets: [] });
  for (const [label, state] of [["empty", emptyState()], ["partial", partial], ["default", cloneDefaultState()]] as const) {
    const budget = getBudgetSnapshot(state, NOW);
    for (const [key, value] of Object.entries(budget)) {
      if (typeof value !== "number") continue;
      assert.ok(Number.isFinite(value), `${label}: ${key} is not finite`);
    }
    for (const b of budget.buckets) {
      assert.ok(Number.isFinite(b.allocationRatio), `${label}: ${b.id} ratio`);
      assert.ok(b.allocationRatio >= 0 && b.allocationRatio <= 1, `${label}: ${b.id} ratio out of range`);
    }
  }
});

test("budget/G: a state with no buckets returns an empty list", () => {
  const snapshot = getBudgetSnapshot(stateWith({ buckets: [] }), NOW);
  assert.deepEqual(snapshot.buckets, []);
});

// --- H, I, J. read-model discipline ----------------------------------------

test("budget/H: the snapshot does not mutate WealthState or add fields", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  const keysBefore = Object.keys(state);
  getBudgetSnapshot(state, NOW);
  assert.equal(JSON.stringify(state), before, "state must not be mutated");
  assert.deepEqual(Object.keys(state), keysBefore);
  for (const forbidden of ["budgetSnapshot", "plannedSurplus", "actualSpending"]) {
    assert.equal(keysBefore.includes(forbidden), false, `${forbidden} must not be persisted`);
  }
  assert.equal(state.version, CURRENT_VERSION);
  // Read models never migrate: the version is whatever the schema says.
  assert.ok(Number.isInteger(CURRENT_VERSION) && CURRENT_VERSION > 0);
});

test("budget/I: the snapshot contains no recommendation or advice fields", () => {
  const serialized = JSON.stringify(getBudgetSnapshot(cloneDefaultState(), NOW));
  for (const forbidden of ["recommendation", "action", "destination", "severity", "impact", "ruleId", "actionLabel"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} belongs to the Advisor, not the budget model`);
  }
});

test("budget/I: no spending limit or rule leaks into the budget model", () => {
  // Limits stay in FinancialRules; the model only reports what was spent.
  const serialized = JSON.stringify(getBudgetSnapshot(cloneDefaultState(), NOW));
  for (const forbidden of ["limitAmount", "spendingLimit", "enabled", "kind"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} belongs to FinancialRules`);
  }
});

test("budget/J: ledger facts are delegated, not re-derived", () => {
  // Every actual figure must be exactly a ledger-snapshot figure — if the
  // model re-scanned transactions itself these could drift apart.
  const state = plannedState({
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "i1", amount: 800, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: iso(2026, 7, 2) },
      { id: "e1", amount: 120, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: iso(2026, 7, 5) },
      { id: "bad", amount: 50, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: "not-a-date" },
    ] as LedgerTransaction[],
  });
  const budget = getBudgetSnapshot(state, NOW);
  const ledger = getLedgerSnapshot(state, NOW);
  assert.equal(budget.actualIncome, ledger.currentMonth.income);
  assert.equal(budget.actualSpending, ledger.currentMonth.expenses);
  assert.equal(budget.actualSurplus, ledger.currentMonth.surplus);
  assert.equal(budget.actualSpending, 120, "malformed dates are dropped by the shared filter");
});

test("budget: the snapshot is pure and deterministic", () => {
  const state = cloneDefaultState();
  assert.deepEqual(getBudgetSnapshot(state, NOW), getBudgetSnapshot(state, new Date(NOW)));
});

// --- L. consumers receive equivalent values ---------------------------------

test("budget/L: the Budget page bar width matches the previous inline formula", () => {
  const state = plannedState({
    buckets: [
      bucket({ id: "survival", amount: 800 }),
      bucket({ id: "growth", amount: 700 }),
      bucket({ id: "opportunity", amount: 400, cadence: "one-time" }),
      bucket({ id: "learning", amount: 2000 }),
    ],
  });
  const snapshot = getBudgetSnapshot(state, NOW);
  // Replicate the exact pre-migration expression.
  const surplus = Math.max(monthlySurplus(state), 1);
  state.buckets.forEach((b, i) => {
    const base = b.id === "survival" ? state.cashflow.allowance : b.cadence === "one-time" ? b.amount : surplus;
    const oldWidth = Math.min((b.amount / base) * 100, 100);
    const newWidth = snapshot.buckets[i].allocationRatio * 100;
    if (Number.isNaN(oldWidth)) {
      assert.equal(newWidth, 0, `${b.id}: NaN is now 0, which renders identically`);
    } else {
      assert.equal(newWidth, oldWidth, `${b.id}: width changed`);
    }
  });
});

test("budget/L: Dashboard planOnTrack matches the previous inline comparison", () => {
  for (const state of [cloneDefaultState(), plannedState(), emptyState()]) {
    const budget = getBudgetSnapshot(state, NOW);
    assert.equal(budget.planCoversDca, monthlySurplus(state) >= state.dca.monthly);
  }
});

// --- Boundaries unchanged ---------------------------------------------------

test("budget: Money Leak budget-drift detection is unchanged", () => {
  const state = stateWith({
    cashflow: { allowance: 2000, transport: 50, food: 100, otherFixed: 0, irregularIncome: 0 },
    ledgerAccounts: accounts,
    ledgerTransactions: [
      { id: "f1", amount: 600, type: "expense", categoryId: "expense-food", accountId: "acc-bank", date: "2026-07-05T00:00:00.000Z" },
    ] as LedgerTransaction[],
  });
  const findings = detectMoneyLeakFindings(state);
  const drift = findings.leaks.find((leak) => leak.id === "budget-food");
  assert.ok(drift, "budget drift is still detected");
  assert.equal(drift!.confidence, 0.82);
  assert.equal(drift!.category, "budget");
});

test("budget: the snapshot exposes exactly the expected fact keys", () => {
  // A shape guard: any new field must be a deliberate, reviewed addition, and
  // advice-shaped keys can never appear here.
  const snapshot = getBudgetSnapshot(cloneDefaultState(), NOW);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "actualIncome", "actualSpending", "actualSurplus",
    "buckets",
    "isOverPlannedSpending",
    "monthKey",
    "plannedAllowance", "plannedDcaAmount", "plannedIncome",
    "plannedSpending", "plannedSurplus",
    "planCoversDca",
    "spendingVariance",
  ].sort());

  for (const b of snapshot.buckets) {
    assert.deepEqual(Object.keys(b).sort(), [
      "allocationBase", "allocationRatio", "amount", "cadence",
      "id", "index", "label", "name", "note",
    ].sort());
  }
});

test("budget: every planned field is prefixed 'planned' and every recorded one 'actual'", () => {
  // Naming is the guard against re-conflating plan and reality.
  const snapshot = getBudgetSnapshot(plannedState(), NOW);
  const planned = Object.keys(snapshot).filter((k) => k.startsWith("planned"));
  const actual = Object.keys(snapshot).filter((k) => k.startsWith("actual"));
  assert.ok(planned.length >= 4, "planned facts are namespaced");
  assert.ok(actual.length >= 3, "actual facts are namespaced");
  for (const key of [...planned, ...actual]) {
    assert.equal(typeof (snapshot as unknown as Record<string, unknown>)[key], "number");
  }
});
