import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  MAX_CONTEXT_CHARS,
  buildAssistantContext,
  buildFiguresContext,
  buildVocabularyContext,
} from "../src/components/assistant/assistantContext";
import { migrateState } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 8, 13, 12, 0, 0); // 2026-09-13, local
const PLATFORMS = ["Moomoo", "IBKR"];

/**
 * A state with figures distinctive enough to be found by substring: if any of
 * them appears in a context that was not supposed to carry figures, the test
 * that looks for it fails loudly rather than subtly.
 */
function stateWith(): WealthState {
  return migrateState({
    deviceId: "assistant-context-test",
    ledgerCategories: [
      { id: "cat-food", label: "Food & Drink", icon: "🍜", type: "expense" },
      { id: "cat-salary", label: "Salary", icon: "💰", type: "income" },
    ],
    ledgerAccounts: [
      { id: "acc-maybank", name: "Maybank", type: "bank", openingBalance: 87654 },
      { id: "acc-tng", name: "Touch n Go", type: "wallet", openingBalance: 0 },
    ],
    customTickers: ["VXUS"],
    dca: { monthly: 1234, targets: {} },
    ledgerTransactions: [
      { id: "t1", amount: 4321, type: "income", categoryId: "cat-salary", accountId: "acc-maybank", date: "2026-09-02" },
      { id: "t2", amount: 765, type: "expense", categoryId: "cat-food", accountId: "acc-maybank", date: "2026-09-05" },
    ],
  });
}

// --- vocabulary: names, and nothing else ----------------------------------

test("assistant context: the vocabulary lists the user's real names", () => {
  const text = buildVocabularyContext(stateWith(), NOW, PLATFORMS);
  assert.ok(text.includes("Food & Drink"), "expense category");
  assert.ok(text.includes("Salary"), "income category");
  assert.ok(text.includes("Maybank"), "account");
  assert.ok(text.includes("VXUS"), "custom ticker");
  assert.ok(text.includes("VOO") && text.includes("QQQM"), "built-in tickers");
  assert.ok(text.includes("Moomoo"), "broker");
  assert.ok(text.includes("2026-09-13"), "today, so relative dates resolve correctly");
});

test("assistant context: the vocabulary separates income from expense categories", () => {
  const text = buildVocabularyContext(stateWith(), NOW, PLATFORMS);
  const expenseLine = text.split("\n").find((line) => line.startsWith("Expense categories:")) ?? "";
  const incomeLine = text.split("\n").find((line) => line.startsWith("Income categories:")) ?? "";
  assert.ok(expenseLine.includes("Food & Drink"));
  assert.ok(!expenseLine.includes("Salary"), "Salary is income-only");
  assert.ok(incomeLine.includes("Salary"));
});

test("assistant context: the vocabulary carries NO figures", () => {
  const text = buildVocabularyContext(stateWith(), NOW, PLATFORMS);
  // Every distinctive figure in the fixture. An account name may be sent; its
  // balance may not.
  for (const figure of ["87654", "87,654", "1234", "1,234", "4321", "4,321", "765"]) {
    assert.ok(!text.includes(figure), `vocabulary must not contain ${figure}`);
  }
});

test("assistant context: an empty account or category list says so rather than breaking", () => {
  const bare = migrateState({ deviceId: "bare", ledgerCategories: [], ledgerAccounts: [] });
  const text = buildVocabularyContext(bare, NOW, []);
  assert.ok(text.includes("(none on file)"));
});

// --- figures: only on opt-in ----------------------------------------------

test("assistant context: the figures summary carries the headline numbers", () => {
  const text = buildFiguresContext(stateWith(), NOW);
  assert.ok(/Cash in accounts: MYR/.test(text));
  assert.ok(/Invested capital: MYR/.test(text));
  assert.ok(/This month/.test(text));
  assert.ok(/Emergency fund: \d+% of target/.test(text));
});

// --- the switch that decides what actually leaves the browser -------------

test("assistant context: Ask mode with sharing off sends only the date", () => {
  const text = buildAssistantContext(stateWith(), NOW, { mode: "help", shareFigures: false, platforms: PLATFORMS });
  assert.equal(text, "Today is 2026-09-13.");
});

test("assistant context: Ask mode with sharing off leaks no figure and no name", () => {
  const text = buildAssistantContext(stateWith(), NOW, { mode: "help", shareFigures: false, platforms: PLATFORMS });
  for (const secret of ["Maybank", "Food & Drink", "VXUS", "87654", "1234", "4321"]) {
    assert.ok(!text.includes(secret), `must not contain ${secret}`);
  }
});

test("assistant context: Ask mode with sharing on adds the figures", () => {
  const text = buildAssistantContext(stateWith(), NOW, { mode: "help", shareFigures: true, platforms: PLATFORMS });
  assert.ok(text.includes("Cash in accounts"));
  assert.ok(text.includes("Emergency fund"));
});

test("assistant context: Record mode sends the vocabulary and never the figures", () => {
  // The privacy notice says exactly this, so it is worth pinning: turning
  // figure sharing ON must not start sending balances in Record mode either.
  for (const shareFigures of [false, true]) {
    const text = buildAssistantContext(stateWith(), NOW, { mode: "fill", shareFigures, platforms: PLATFORMS });
    assert.ok(text.includes("Maybank"), "names are needed to fill a form");
    assert.ok(!text.includes("Cash in accounts"), `figures leaked with shareFigures=${shareFigures}`);
    assert.ok(!text.includes("87654") && !text.includes("87,654"), "no balance");
  }
});

test("assistant context: the context stays within the proxy's cap", () => {
  const many = migrateState({
    deviceId: "many",
    ledgerCategories: Array.from({ length: 200 }, (_, i) => ({
      id: `cat-${i}`, label: `Category number ${i} with a long name`, icon: "•", type: "expense" as const,
    })),
    ledgerAccounts: Array.from({ length: 100 }, (_, i) => ({
      id: `acc-${i}`, name: `Account number ${i} with a long name`, type: "bank" as const, openingBalance: 0,
    })),
    customTickers: Array.from({ length: 100 }, (_, i) => `TICKER${i}`),
  });
  const text = buildAssistantContext(many, NOW, { mode: "fill", shareFigures: false, platforms: PLATFORMS });
  assert.ok(text.length <= MAX_CONTEXT_CHARS, `context was ${text.length} chars`);
});
