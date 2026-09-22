import assert from "node:assert/strict";
import { test } from "./testHarness";
import { getGoal, getGoalsSnapshot } from "../src/goalSummary";
import { detectMoneyLeakFindings } from "../src/moneyLeaks";
import { syncGoalContributionRules } from "../src/financialRules";
import { CURRENT_VERSION, migrateState } from "../src/state";
import type { Goal, LedgerAccount, WealthState } from "../src/models";

function goal(overrides: Partial<Goal> & Pick<Goal, "id">): Goal {
  return {
    name: overrides.id, label: overrides.id, current: 0, target: 0,
    monthlyContribution: 0, note: "", ...overrides,
  };
}

// The user's layout after buying the laptop: MAE wallet emptied by the purchase.
const accounts: LedgerAccount[] = [
  { id: "acc-buffer", name: "Buffer", type: "bank", openingBalance: 4556.93 },
  { id: "acc-mae", name: "MAE wallet", type: "wallet", openingBalance: 0 },
];

function stateWith(goals: Goal[], extra: Partial<WealthState> = {}): WealthState {
  return migrateState({ deviceId: "device-spent", ledgerAccounts: accounts, goals, ...extra });
}

const laptop = goal({ id: "laptop", target: 4500, monthlyContribution: 20, accountId: "acc-mae" });
const spentLaptop = { ...laptop, spentAt: "2026-09-22", spentAmount: 4500 };
const buffer = goal({ id: "buffer", target: 4000, accountId: "acc-buffer" });
const bearish = goal({ id: "bearish", target: 400, accountId: "acc-buffer" });

test("goals v30: the schema is v30", () => {
  assert.ok(CURRENT_VERSION >= 30);
});

test("goals v30: without the mark, an emptied account sends a reached goal back to 0", () => {
  const g = getGoal(getGoalsSnapshot(stateWith([laptop])), "laptop")!;
  assert.equal(g.currentAmount, 0);
  assert.equal(g.isComplete, false);
});

test("goals v30: a spent goal stays complete at its spent amount after the account empties", () => {
  const g = getGoal(getGoalsSnapshot(stateWith([spentLaptop])), "laptop")!;
  assert.equal(g.isSpent, true);
  assert.equal(g.spentAt, "2026-09-22");
  assert.equal(g.currentAmount, 4500);
  assert.equal(g.progress, 1);
  assert.equal(g.isComplete, true);
  assert.equal(g.status, "complete");
  assert.equal(g.monthlyContribution, 0, "a spent goal takes nothing each month");
});

test("goals v30: totals leave a spent goal out, but Done still counts it", () => {
  const snapshot = getGoalsSnapshot(stateWith([spentLaptop, buffer, bearish]));
  assert.equal(snapshot.savingCount, 2);
  assert.equal(snapshot.totalTarget, 4400);
  assert.equal(snapshot.totalCurrent, 4556.93, "only the money still set aside");
  assert.equal(snapshot.totalFunded, 4400);
  assert.equal(snapshot.totalMonthlyContribution, 0);
  assert.equal(snapshot.completedCount, 3);
  assert.equal(snapshot.activeCount, 0);
});

test("goals v30: the Dashboard moves off a spent goal and back when it is undone", () => {
  const open = goal({ id: "trip", target: 1000, monthlyContribution: 50 });
  const spent = getGoalsSnapshot(stateWith([spentLaptop, open], { overviewGoalId: "laptop" }));
  assert.equal(spent.featuredGoalId, "trip");
  const undone = getGoalsSnapshot(stateWith([laptop, open], { overviewGoalId: "laptop" }));
  assert.equal(undone.featuredGoalId, "laptop");
});

test("goals v30: a spent goal is not flagged as drifting or given a contribution rule", () => {
  const state = stateWith([spentLaptop]);
  assert.equal(detectMoneyLeakFindings(state).leaks.some((leak) => leak.id === "goal-laptop"), false);
  assert.equal(syncGoalContributionRules(state).some((rule) => rule.kind === "goal-contribution" && rule.goalId === "laptop"), false);
  const undone = stateWith([laptop]);
  assert.equal(syncGoalContributionRules(undone).some((rule) => rule.kind === "goal-contribution" && rule.goalId === "laptop"), true);
});

test("goals v30: a well-formed spent pair survives a reload", () => {
  const reloaded = migrateState(JSON.parse(JSON.stringify(stateWith([spentLaptop]))) as Partial<WealthState>);
  assert.equal(reloaded.goals[0].spentAt, "2026-09-22");
  assert.equal(reloaded.goals[0].spentAmount, 4500);
});

test("goals v30: a bad or half spent pair is dropped, and the goal is kept", () => {
  const bad: Array<Record<string, unknown>> = [
    { spentAt: "2026-09-22" },
    { spentAmount: 4500 },
    { spentAt: "yesterday", spentAmount: 4500 },
    { spentAt: "2026-13-01", spentAmount: 4500 },
    { spentAt: "2026-09-22", spentAmount: -1 },
    { spentAt: "2026-09-22", spentAmount: Number.NaN },
    { spentAt: "2026-09-22", spentAmount: "4500" },
  ];
  for (const fields of bad) {
    const state = stateWith([{ ...laptop, ...fields } as Goal]);
    assert.equal(state.goals.length, 1, JSON.stringify(fields));
    assert.equal(state.goals[0].label, "laptop");
    assert.equal("spentAt" in state.goals[0], false, JSON.stringify(fields));
    assert.equal("spentAmount" in state.goals[0], false, JSON.stringify(fields));
  }
});

test("goals v30: older data with no spent fields is unchanged", () => {
  const state = migrateState({ deviceId: "d", version: 29, ledgerAccounts: accounts, goals: [buffer] } as Partial<WealthState>);
  assert.equal(state.version, CURRENT_VERSION);
  assert.deepEqual(state.goals[0], buffer);
});
