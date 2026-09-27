import assert from "node:assert/strict";
import { test } from "./testHarness";
import { demoPersonaFor, demoStateFor } from "../src/demoData";
import { danielDemoState } from "../src/demoDaniel";
import { getGoalsSnapshot } from "../src/goalSummary";
import { getLedgerSnapshot } from "../src/ledgerSummary";
import { migrateState } from "../src/state";

const ANCHOR = new Date(2026, 7, 15, 12, 0, 0);
const daniel = (now = ANCHOR) => migrateState(demoStateFor(now, danielDemoState));

test("demo persona: visitors get Daniel; Alex only by asking for him", () => {
  assert.equal(demoPersonaFor(new URLSearchParams("")).uid, "demo-daniel");
  assert.equal(demoPersonaFor(new URLSearchParams("?persona=someone")).uid, "demo-daniel");
  assert.equal(demoPersonaFor(new URLSearchParams("?persona=alex")).uid, "demo-user", "Alex keeps his old storage");
});

test("demo Daniel: migration reads the fixture as written", () => {
  const state = daniel();
  assert.equal(state.ledgerTransactions.length, danielDemoState.ledgerTransactions.length);
  assert.equal(state.trades.length, 24);
  assert.equal(state.currencyExchanges.length, 12);
  assert.equal(state.goals.length, 4);
  assert.equal(state.liabilities.length, 2);
  assert.equal(state.ruleNotesList.length, 3);
  assert.equal(state.liabilities[0]!.annualRate, 0.052, "a rate must not be reread as a typed percent");
  assert.equal(state.onboardingDone, true);
});

test("demo Daniel: linked goals land on the figures their notes describe", () => {
  const goals = getGoalsSnapshot(daniel(), ANCHOR);
  const current = (id: string) => goals.goals.find((goal) => goal.id === id)?.currentAmount;
  assert.equal(current("house"), 38000);
  assert.equal(current("emergency"), 21600);
  assert.equal(current("education"), 18500);
  assert.equal(current("trip"), 5400);
});

test("demo Daniel: a full month balances against the plan, July runs RM180 over on food", () => {
  const state = daniel();
  const layers = state.allocation.steps.reduce((sum, step) => sum + step.value, 0);
  assert.equal(layers, state.cashflow.allowance, "the plan's layers use exactly the salary");

  const july = getLedgerSnapshot(state, new Date(2026, 6, 20, 12, 0, 0)).currentMonth;
  assert.equal(july.income, 10500);
  assert.equal(july.expenses, 6530);
  const june = getLedgerSnapshot(state, new Date(2026, 5, 20, 12, 0, 0)).currentMonth;
  assert.equal(june.expenses, 6350);

  const bank = getLedgerSnapshot(state, ANCHOR).accountBalances.find((item) => item.account.id === "account-bank");
  assert.ok(bank && bank.balance > 0, "the current account never goes negative");
});

test("demo Daniel: shifted to a later month, the same month is still in progress", () => {
  const later = new Date(2027, 1, 15, 12, 0, 0);
  const atAnchor = getLedgerSnapshot(daniel(), ANCHOR).currentMonth;
  const atLater = getLedgerSnapshot(daniel(later), later).currentMonth;
  assert.equal(atLater.income, atAnchor.income);
  assert.equal(atLater.expenses, atAnchor.expenses);
  assert.equal(getGoalsSnapshot(daniel(later), later).goals.find((goal) => goal.id === "house")?.currentAmount, 38000);
});
