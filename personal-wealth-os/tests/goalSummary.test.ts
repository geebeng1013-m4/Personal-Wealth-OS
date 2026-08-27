import assert from "node:assert/strict";
import { test } from "./testHarness";
import { buildGoalSnapshot, getGoal, getGoalsSnapshot } from "../src/goalSummary";
import { linkedGoalCurrent } from "../src/financialHealth";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { cloneDefaultState, emptyState, migrateState, CURRENT_VERSION } from "../src/state";
import type { Goal, LedgerAccount, LedgerTransaction, WealthState } from "../src/models";

function stateWith(overrides: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-goals", ...overrides });
}

function goal(overrides: Partial<Goal> & Pick<Goal, "id">): Goal {
  return {
    name: overrides.id, label: overrides.id, current: 0, target: 0,
    monthlyContribution: 0, note: "", ...overrides,
  };
}

const accounts: LedgerAccount[] = [
  { id: "acc-bank", name: "Bank", type: "bank", openingBalance: 2500 },
];

test("goals: an empty goal list is safe", () => {
  const snapshot = getGoalsSnapshot(stateWith({ goals: [] }));
  assert.deepEqual(snapshot.goals, []);
  assert.deepEqual(snapshot.ordered, []);
  assert.equal(snapshot.totalTarget, 0);
  assert.equal(snapshot.totalCurrent, 0);
  assert.equal(snapshot.completedCount, 0);
  assert.equal(snapshot.activeCount, 0);
  assert.equal(snapshot.featured, null);
  assert.equal(snapshot.featuredGoalId, "");
});

test("goals: target, current, remaining and progress use the existing formulas", () => {
  const state = stateWith({
    goals: [goal({ id: "travel", name: "Travel", label: "Travel Fund", current: 250, target: 1000, monthlyContribution: 50 })],
  });
  const g = getGoal(getGoalsSnapshot(state), "travel")!;
  assert.equal(g.targetAmount, 1000);
  assert.equal(g.currentAmount, 250);
  assert.equal(g.remainingAmount, 750);
  assert.equal(g.progress, 0.25);
  assert.equal(g.monthlyContribution, 50);
});

test("goals: progress is capped at 1 and never negative", () => {
  const state = stateWith({
    goals: [
      goal({ id: "over", current: 5000, target: 1000 }),
      goal({ id: "none", current: 0, target: 0 }),
    ],
  });
  const snapshot = getGoalsSnapshot(state);
  assert.equal(getGoal(snapshot, "over")!.progress, 1, "capped at 100%");
  assert.equal(getGoal(snapshot, "over")!.remainingAmount, 0, "never negative");
  assert.equal(getGoal(snapshot, "none")!.progress, 0, "no target means no progress");
});

test("goals: estimated months matches the existing ceil formula", () => {
  const state = stateWith({
    goals: [goal({ id: "travel", current: 100, target: 1000, monthlyContribution: 75 })],
  });
  const g = getGoal(getGoalsSnapshot(state), "travel")!;
  assert.equal(g.estimatedMonthsToTarget, Math.ceil(900 / 75));
  assert.equal(g.estimatedMonthsToTarget, 12);
  assert.equal(g.estimatedYearsToTarget, 1);
});

test("goals: no contribution means no completion estimate, not a fake one", () => {
  const state = stateWith({ goals: [goal({ id: "stalled", current: 0, target: 1000, monthlyContribution: 0 })] });
  const g = getGoal(getGoalsSnapshot(state), "stalled")!;
  assert.equal(g.estimatedMonthsToTarget, null);
  assert.equal(g.estimatedYearsToTarget, null);
});

test("goals: a completed goal needs no further months", () => {
  const state = stateWith({ goals: [goal({ id: "done", current: 1000, target: 1000, monthlyContribution: 50 })] });
  const g = getGoal(getGoalsSnapshot(state), "done")!;
  assert.equal(g.remainingAmount, 0);
  assert.equal(g.estimatedMonthsToTarget, 0);
  assert.equal(g.isComplete, true);
  assert.equal(g.status, "complete");
});

test("goals: currentAmount follows the linked account, matching linkedGoalCurrent()", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [goal({ id: "linked", current: 10, target: 5000, accountId: "acc-bank" })],
  });
  const g = getGoal(getGoalsSnapshot(state), "linked")!;
  assert.equal(g.currentAmount, linkedGoalCurrent(state.goals[0], state));
  assert.equal(g.currentAmount, 2500, "the account balance wins over the stored field");
  assert.equal(g.recordedAmount, 10, "the raw field is still exposed");
  assert.equal(g.isAccountLinked, true);
  assert.equal(g.linkedAccountName, "Bank");
});

test("goals: an unlinked goal uses its stored amount for both readings", () => {
  const state = stateWith({ goals: [goal({ id: "manual", current: 400, target: 1000 })] });
  const g = getGoal(getGoalsSnapshot(state), "manual")!;
  assert.equal(g.currentAmount, 400);
  assert.equal(g.recordedAmount, 400);
  assert.equal(g.isAccountLinked, false);
  assert.equal(g.linkedAccountName, null);
});

test("goals: a broken account link reports null rather than crashing", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [goal({ id: "broken", current: 300, target: 1000, accountId: "acc-missing" })],
  });
  const g = getGoal(getGoalsSnapshot(state), "broken")!;
  assert.equal(g.isAccountLinked, true);
  assert.equal(g.linkedAccountName, null);
  assert.equal(g.currentAmount, 300, "falls back to the stored amount");
});

test("goals: completion follows the linked balance, and the raw amount is still kept", () => {
  // The account holds enough, but the stored field says otherwise.
  // Step 9.1: currentAmount is canonical, so this goal IS complete.
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [goal({ id: "linked", current: 0, target: 2000, accountId: "acc-bank" })],
  });
  const g = getGoal(getGoalsSnapshot(state), "linked")!;
  assert.equal(g.currentAmount, 2500, "canonical value is the linked balance");
  assert.equal(g.recordedAmount, 0, "the raw stored field is preserved, not overwritten");
  assert.equal(g.isComplete, true, "completion follows currentAmount");
  assert.equal(g.status, "complete");
  assert.equal(g.progress, 1, "progress follows currentAmount");
  assert.equal(g.remainingAmount, 0);
  assert.equal("isRecordedComplete" in g, false, "the raw-based completion flag is gone");
});

test("goals: status is derived from existing conditions only", () => {
  const state = stateWith({
    goals: [
      goal({ id: "complete", current: 100, target: 100, monthlyContribution: 10 }),
      goal({ id: "funding", current: 10, target: 100, monthlyContribution: 10 }),
      goal({ id: "stalled", current: 10, target: 100, monthlyContribution: 0 }),
      goal({ id: "no-target", current: 10, target: 0, monthlyContribution: 10 }),
    ],
  });
  const snapshot = getGoalsSnapshot(state);
  assert.equal(getGoal(snapshot, "complete")!.status, "complete");
  assert.equal(getGoal(snapshot, "funding")!.status, "funding");
  assert.equal(getGoal(snapshot, "stalled")!.status, "stalled");
  assert.equal(getGoal(snapshot, "no-target")!.status, "no-target");
});

test("goals: ordering puts incomplete goals first and is stable otherwise", () => {
  const state = stateWith({
    goals: [
      goal({ id: "done1", current: 100, target: 100 }),
      goal({ id: "open1", current: 10, target: 100 }),
      goal({ id: "done2", current: 200, target: 200 }),
      goal({ id: "open2", current: 20, target: 100 }),
    ],
  });
  const ordered = getGoalsSnapshot(state).ordered.map((g) => g.id);
  assert.deepEqual(ordered, ["open1", "open2", "done1", "done2"], "incomplete first, original order preserved within each group");
});

test("goals: a fully funded linked goal sorts as complete, matching what it displays", () => {
  // BEHAVIOUR CHANGE (Step 9.1). The old helper sorted by RAW goal.current, so
  // this goal displayed 100% funded yet sorted as incomplete. Sorting now uses
  // the same completion state the card shows, so it sorts last.
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [
      goal({ id: "linkedFull", current: 0, target: 1000, accountId: "acc-bank" }), // linked balance 2500
      goal({ id: "plainOpen", current: 10, target: 1000 }),
    ],
  });
  const snapshot = getGoalsSnapshot(state);
  assert.equal(getGoal(snapshot, "linkedFull")!.isComplete, true);
  assert.deepEqual(snapshot.ordered.map((g) => g.id), ["plainOpen", "linkedFull"],
    "the incomplete goal comes first; the funded linked goal is treated as complete");
});

test("goals: index points back at the original state entry", () => {
  const state = stateWith({
    goals: [
      goal({ id: "done", current: 100, target: 100 }),
      goal({ id: "open", current: 0, target: 100 }),
    ],
  });
  const snapshot = getGoalsSnapshot(state);
  // Ordered puts "open" first, but its index must still be 1.
  assert.equal(snapshot.ordered[0].id, "open");
  assert.equal(snapshot.ordered[0].index, 1);
  assert.equal(state.goals[snapshot.ordered[0].index].id, "open");
});

test("goals: the featured goal honours overviewGoalId when it exists", () => {
  const state = stateWith({
    goals: [goal({ id: "a", current: 0, target: 100 }), goal({ id: "b", current: 0, target: 100 })],
    overviewGoalId: "b",
  });
  assert.equal(getGoalsSnapshot(state).featuredGoalId, "b");
});

test("goals: the featured goal falls back to the first incomplete goal", () => {
  const state: WealthState = {
    ...stateWith({
      goals: [goal({ id: "done", current: 100, target: 100 }), goal({ id: "open", current: 0, target: 100 })],
    }),
    overviewGoalId: "does-not-exist",
  };
  assert.equal(getGoalsSnapshot(state).featuredGoalId, "open");
});

test("goals: the featured goal falls back to the first goal when all are complete", () => {
  const state: WealthState = {
    ...stateWith({ goals: [goal({ id: "one", current: 100, target: 100 }), goal({ id: "two", current: 50, target: 50 })] }),
    overviewGoalId: "",
  };
  assert.equal(getGoalsSnapshot(state).featuredGoalId, "one");
});

test("goals: totals aggregate across every goal", () => {
  const state = stateWith({
    goals: [
      goal({ id: "a", current: 100, target: 1000, monthlyContribution: 25 }),
      goal({ id: "b", current: 400, target: 500, monthlyContribution: 75 }),
      goal({ id: "c", current: 200, target: 200, monthlyContribution: 0 }),
    ],
  });
  const snapshot = getGoalsSnapshot(state);
  assert.equal(snapshot.totalTarget, 1700);
  assert.equal(snapshot.totalCurrent, 700);
  assert.equal(snapshot.totalRemaining, 900 + 100 + 0);
  assert.equal(snapshot.totalMonthlyContribution, 100);
  assert.equal(snapshot.completedCount, 1);
  assert.equal(snapshot.activeCount, 2);
});

test("goals: buildGoalSnapshot agrees with getGoalsSnapshot for the same goal", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [goal({ id: "travel", current: 100, target: 1000, monthlyContribution: 50, accountId: "acc-bank" })],
  });
  const direct = buildGoalSnapshot(state.goals[0], 0, state);
  const viaSnapshot = getGoal(getGoalsSnapshot(state), "travel")!;
  assert.deepEqual(direct, viaSnapshot);
});

test("goals: linked balances react to ledger activity", () => {
  const base = {
    ledgerAccounts: accounts,
    goals: [goal({ id: "linked", current: 0, target: 10000, accountId: "acc-bank" })],
  };
  const before = getGoal(getGoalsSnapshot(stateWith(base)), "linked")!;
  const after = getGoal(getGoalsSnapshot(stateWith({
    ...base,
    ledgerTransactions: [
      { id: "i1", amount: 500, type: "income", categoryId: "income-salary", accountId: "acc-bank", date: new Date(2026, 7, 3, 12).toISOString() },
    ] as LedgerTransaction[],
  })), "linked")!;
  assert.equal(before.currentAmount, 2500);
  assert.equal(after.currentAmount, 3000, "income into the linked account raises the goal");
  assert.equal(after.recordedAmount, 0, "the stored field is untouched");
});

test("goals: malformed and partial states do not crash", () => {
  const partial = migrateState({ deviceId: "d", goals: [] });
  for (const [label, state] of [["empty", emptyState()], ["partial", partial], ["default", cloneDefaultState()]] as const) {
    const snapshot = getGoalsSnapshot(state);
    for (const value of [snapshot.totalTarget, snapshot.totalCurrent, snapshot.totalRemaining, snapshot.totalMonthlyContribution]) {
      assert.ok(Number.isFinite(value), `${label} produced a non-finite total`);
    }
    for (const g of snapshot.goals) {
      assert.ok(Number.isFinite(g.progress), `${label}: ${g.id} progress`);
      assert.ok(Number.isFinite(g.remainingAmount), `${label}: ${g.id} remaining`);
      assert.ok(g.progress >= 0 && g.progress <= 1, `${label}: ${g.id} progress out of range`);
    }
  }
});

test("goals: the snapshot is pure and does not mutate state", () => {
  const state = cloneDefaultState();
  const before = JSON.stringify(state);
  getGoalsSnapshot(state);
  assert.equal(JSON.stringify(state), before);
});

test("goals: the snapshot is deterministic", () => {
  const state = cloneDefaultState();
  assert.deepEqual(getGoalsSnapshot(state), getGoalsSnapshot(state));
});

test("goals: the snapshot is a runtime read model and never persisted", () => {
  const state = cloneDefaultState();
  const keysBefore = Object.keys(state);
  getGoalsSnapshot(state);
  assert.deepEqual(Object.keys(state), keysBefore);
  for (const forbidden of ["goalsSnapshot", "goalSnapshot", "featuredGoalId"]) {
    assert.equal(keysBefore.includes(forbidden), false, `${forbidden} must not be part of WealthState`);
  }
  assert.equal(state.version, CURRENT_VERSION);
  // Read models never migrate: the version is whatever the schema says.
  assert.ok(Number.isInteger(CURRENT_VERSION) && CURRENT_VERSION > 0);
});

test("goals: the snapshot contains no advice fields", () => {
  const serialized = JSON.stringify(getGoalsSnapshot(cloneDefaultState()));
  for (const forbidden of ["severity", "impact", "recommendation", "actionLabel", "destination", "ruleId"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `${forbidden} belongs to the Advisor`);
  }
});

test("goals: Money Leak goal detection is unchanged", () => {
  const state = stateWith({
    goals: [
      goal({ id: "travel", name: "Travel", label: "Travel", current: 0, target: 2400, monthlyContribution: 0 }),
      goal({ id: "funded", name: "Funded", label: "Funded", current: 0, target: 1200, monthlyContribution: 50 }),
    ],
  });
  const findings = detectMoneyLeakFindings(state);
  const goalLeak = findings.leaks.find((leak) => leak.id === "goal-travel");
  assert.ok(goalLeak, "the un-funded goal is still flagged");
  assert.equal(goalLeak!.monthlyImpact, 2400 / 12);
  assert.equal(goalLeak!.confidence, 0.95);
  assert.equal(findings.leaks.some((leak) => leak.id === "goal-funded"), false, "a funded goal is still not flagged");
});

// --- Step 9.1: unified completion / sorting / featured semantics ------------

test("9.1/A: an unlinked goal keeps recordedAmount === currentAmount", () => {
  const state = stateWith({
    goals: [
      goal({ id: "m1", current: 0, target: 100 }),
      goal({ id: "m2", current: 60, target: 100, monthlyContribution: 10 }),
      goal({ id: "m3", current: 100, target: 100 }),
    ],
  });
  for (const g of getGoalsSnapshot(state).goals) {
    assert.equal(g.currentAmount, g.recordedAmount, `${g.id}: unlinked goals must agree`);
  }
  // ...and behaviour is unchanged: incomplete first.
  assert.deepEqual(getGoalsSnapshot(state).ordered.map((g) => g.id), ["m1", "m2", "m3"]);
});

test("9.1/B: a linked goal derives progress and completion from the linked balance", () => {
  // Account holds 2500; the stored field says 10.
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [goal({ id: "linked", current: 10, target: 5000, accountId: "acc-bank" })],
  });
  const g = getGoal(getGoalsSnapshot(state), "linked")!;
  assert.equal(g.currentAmount, 2500);
  assert.equal(g.progress, 0.5, "2500 / 5000 — not 10 / 5000");
  assert.equal(g.remainingAmount, 2500);
  assert.equal(g.isComplete, false);
  assert.equal(g.recordedAmount, 10, "raw value preserved");
});

test("9.1/C: a linked goal at 100% is complete and no longer sorts as incomplete", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [
      goal({ id: "linkedDone", current: 0, target: 2000, accountId: "acc-bank" }), // balance 2500
      goal({ id: "openGoal", current: 0, target: 5000, monthlyContribution: 100 }),
    ],
  });
  const snapshot = getGoalsSnapshot(state);
  const linked = getGoal(snapshot, "linkedDone")!;
  assert.equal(linked.progress, 1);
  assert.equal(linked.isComplete, true);
  assert.equal(linked.status, "complete");
  assert.deepEqual(snapshot.ordered.map((g) => g.id), ["openGoal", "linkedDone"]);
  assert.equal(snapshot.completedCount, 1);
  assert.equal(snapshot.activeCount, 1);
});

test("9.1/D: featured selection uses the same completion state as the cards", () => {
  const state: WealthState = {
    ...stateWith({
      ledgerAccounts: accounts,
      goals: [
        goal({ id: "linkedDone", current: 0, target: 2000, accountId: "acc-bank" }), // funded via account
        goal({ id: "stillOpen", current: 0, target: 5000, monthlyContribution: 100 }),
      ],
    }),
    overviewGoalId: "",
  };
  const snapshot = getGoalsSnapshot(state);
  assert.equal(getGoal(snapshot, "linkedDone")!.isComplete, true);
  assert.equal(snapshot.featuredGoalId, "stillOpen",
    "a goal that displays as complete must not be featured as the next milestone");
});

test("9.1/D: an explicitly chosen featured goal still wins", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [
      goal({ id: "linkedDone", current: 0, target: 2000, accountId: "acc-bank" }),
      goal({ id: "stillOpen", current: 0, target: 5000, monthlyContribution: 100 }),
    ],
    overviewGoalId: "linkedDone",
  });
  assert.equal(getGoalsSnapshot(state).featuredGoalId, "linkedDone");
});

test("9.1/E: recordedAmount is never overwritten by the linked balance", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [goal({ id: "linked", current: 42, target: 1000, accountId: "acc-bank" })],
  });
  const g = getGoal(getGoalsSnapshot(state), "linked")!;
  assert.equal(g.recordedAmount, 42, "still the raw stored value");
  assert.equal(state.goals[0].current, 42, "and the state itself is untouched");
  assert.notEqual(g.currentAmount, g.recordedAmount, "the two genuinely differ here");
});

test("9.1/F: every consumer-facing figure derives from currentAmount", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [goal({ id: "linked", current: 0, target: 4000, monthlyContribution: 500, accountId: "acc-bank" })],
  });
  const g = getGoal(getGoalsSnapshot(state), "linked")!;
  // Balance 2500 of 4000 -> 62.5%, 1500 remaining, 3 months at 500/month.
  assert.equal(g.currentAmount, 2500);
  assert.equal(g.progress, 2500 / 4000);
  assert.equal(g.remainingAmount, 1500);
  assert.equal(g.estimatedMonthsToTarget, 3);
  assert.equal(g.status, "funding");
});

test("9.1/G: empty, target-zero and broken-link states do not crash", () => {
  const cases: Array<[string, WealthState]> = [
    ["no goals", stateWith({ goals: [] })],
    ["zero target", stateWith({ goals: [goal({ id: "z", current: 100, target: 0 })] })],
    ["broken link", stateWith({ ledgerAccounts: [], goals: [goal({ id: "b", current: 5, target: 100, accountId: "nope" })] })],
    ["empty state", emptyState()],
  ];
  for (const [label, state] of cases) {
    const snapshot = getGoalsSnapshot(state);
    assert.ok(Array.isArray(snapshot.ordered), `${label}: ordered must exist`);
    assert.equal(snapshot.ordered.length, snapshot.goals.length, `${label}: ordering keeps every goal`);
    for (const g of snapshot.goals) {
      assert.ok(Number.isFinite(g.progress) && g.progress >= 0 && g.progress <= 1, `${label}: ${g.id} progress`);
      assert.ok(Number.isFinite(g.remainingAmount) && g.remainingAmount >= 0, `${label}: ${g.id} remaining`);
      assert.equal(typeof g.isComplete, "boolean", `${label}: ${g.id} isComplete`);
    }
  }
});

test("9.1: completedCount and activeCount follow the canonical completion", () => {
  const state = stateWith({
    ledgerAccounts: accounts,
    goals: [
      goal({ id: "linkedDone", current: 0, target: 1000, accountId: "acc-bank" }), // complete via account
      goal({ id: "open", current: 0, target: 1000 }),
      goal({ id: "noTarget", current: 50, target: 0 }),
    ],
  });
  const snapshot = getGoalsSnapshot(state);
  assert.equal(snapshot.completedCount, 1, "the linked goal counts as complete");
  assert.equal(snapshot.activeCount, 1, "only the open, targeted goal is active");
});
