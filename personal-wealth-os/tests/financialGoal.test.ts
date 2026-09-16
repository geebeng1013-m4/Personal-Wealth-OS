import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  CURRENT_VERSION,
  MAX_FINANCIAL_GOAL_CHARS,
  cloneDefaultState,
  emptyState,
  migrateState,
  normalizeFinancialGoal,
} from "../src/state";
import { buildAssistantContext } from "../src/components/assistant/assistantContext";

const NOW = new Date(2026, 8, 15, 12, 0, 0);

// --- the stored shape ------------------------------------------------------

test("financial goal: v21 is the schema that carries it", () => {
  assert.ok(CURRENT_VERSION >= 21, "the field shipped in v21 and must not be dropped");
});

test("financial goal: a new or empty state starts with no goal", () => {
  assert.equal(emptyState().financialGoal, "");
  assert.equal(cloneDefaultState().financialGoal, "");
});

test("financial goal: older data without the field migrates to empty, keeping everything else", () => {
  const migrated = migrateState({ version: 20, deviceId: "old", ruleNotes: "keep me" });
  assert.equal(migrated.financialGoal, "");
  assert.equal(migrated.ruleNotes, "keep me", "an additive field must not disturb existing data");
  assert.equal(migrated.version, CURRENT_VERSION);
});

test("financial goal: a stored sentence is kept, tidied onto one line", () => {
  const migrated = migrateState({ deviceId: "x", financialGoal: "  RM80,000 house deposit\n   by 35  " });
  assert.equal(migrated.financialGoal, "RM80,000 house deposit by 35");
});

test("financial goal: an over-long sentence is capped, not dropped", () => {
  const migrated = migrateState({ deviceId: "x", financialGoal: "a".repeat(500) });
  assert.equal(migrated.financialGoal.length, MAX_FINANCIAL_GOAL_CHARS);
});

test("financial goal: anything that is not text is no goal", () => {
  for (const bad of [42, null, undefined, {}, ["goal"], true]) {
    assert.equal(normalizeFinancialGoal(bad), "", JSON.stringify(bad));
  }
});

test("financial goal: migration is idempotent", () => {
  const once = migrateState({ deviceId: "x", financialGoal: "RM20,000 in ETFs by 25" });
  const twice = migrateState(once);
  assert.equal(twice.financialGoal, once.financialGoal);
});

// --- what the assistant is told ------------------------------------------

test("financial goal: sent to Ask as the user's own words when they share", () => {
  const state = migrateState({ deviceId: "x", financialGoal: "RM80,000 house deposit by 35" });
  const text = buildAssistantContext(state, NOW, { mode: "help", shareFigures: true, platforms: [] });
  assert.match(text, /The user's financial goal, in their own words: "RM80,000 house deposit by 35"\. Frame advice around it\./);
});

test("financial goal: never sent with sharing off, or in Record mode", () => {
  const state = migrateState({ deviceId: "x", financialGoal: "RM80,000 house deposit by 35" });
  const off = buildAssistantContext(state, NOW, { mode: "help", shareFigures: false, platforms: [] });
  const record = buildAssistantContext(state, NOW, { mode: "fill", shareFigures: true, platforms: [] });
  assert.ok(!off.includes("house deposit"), "sharing off");
  assert.ok(!record.includes("house deposit"), "Record mode");
});

test("financial goal: no goal means no goal line", () => {
  const state = migrateState({ deviceId: "x" });
  const text = buildAssistantContext(state, NOW, { mode: "help", shareFigures: true, platforms: [] });
  assert.ok(!text.includes("financial goal, in their own words"));
});
