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

test("goals v30: Saved counts a done goal's target even after its money is used", () => {
  // The laptop was bought: MAE wallet is 0, the goal is marked done.
  const snapshot = getGoalsSnapshot(stateWith([spentLaptop, buffer, bearish]));
  assert.equal(snapshot.doneCount, 1);
  assert.equal(snapshot.totalTarget, 8900, "every goal's target, done or not");
  assert.equal(snapshot.totalFunded, 8900, "all three reached: Saved 8,900, 100%");
  assert.equal(snapshot.totalMonthlyContribution, 0);
  assert.equal(snapshot.completedCount, 3);
  assert.equal(snapshot.activeCount, 0);
});

test("goals v30: Saved is done targets plus what open goals hold", () => {
  // What the user pressed on 2026-09-22: Buffer and Bearish done, laptop still saving.
  const mae28: LedgerAccount[] = [accounts[0], { ...accounts[1], openingBalance: 28 }];
  const doneBuffer = { ...buffer, spentAt: "2026-09-22", spentAmount: 4000 };
  const doneBearish = { ...bearish, spentAt: "2026-09-22", spentAmount: 400 };
  const snapshot = getGoalsSnapshot(stateWith([laptop, doneBuffer, doneBearish], { ledgerAccounts: mae28 }));
  assert.equal(snapshot.totalFunded, 28 + 4000 + 400, "Saved 4,428, 50% — not 28, 1%");
  assert.equal(snapshot.totalTarget, 8900);
  assert.equal(getGoal(snapshot, "buffer")!.heldAmount, 4556.93);
  assert.equal(getGoal(snapshot, "buffer")!.currentAmount, 4000, "the row stays at its target");
});

test("goals v30: a done goal still takes its share of a shared account", () => {
  const state = stateWith([
    { ...goal({ id: "first", target: 4000, accountId: "acc-buffer" }), spentAt: "2026-09-22", spentAmount: 4000 },
    goal({ id: "second", target: 1000, accountId: "acc-buffer" }),
  ]);
  // 4,556.93: the done goal takes 4,000, the second gets the 556.93 left.
  assert.equal(Math.round(getGoalsSnapshot(state).totalFunded * 100), 455693);
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

test("goals: Saved never passes All targets, and an overfunded goal adds nothing extra", () => {
  // Saved and the percent are one figure, so the tiles cannot disagree.
  const doneBuffer = { ...buffer, spentAt: "2026-09-22", spentAmount: 4000 };
  for (const goals of [[laptop, buffer, bearish], [laptop, doneBuffer, bearish], [spentLaptop, doneBuffer, bearish]]) {
    const snapshot = getGoalsSnapshot(stateWith(goals));
    assert.ok(snapshot.totalFunded <= snapshot.totalTarget, "Saved never passes All targets");
  }
  // A goal over its target counts only up to it: the 156.93 extra is not Saved.
  const snapshot = getGoalsSnapshot(stateWith([buffer, bearish]));
  assert.equal(snapshot.totalFunded, 4400);
});
