import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "./testHarness";
import { SYSTEM_PROMPT } from "../functions/src/deepseekRequest";

/**
 * The how-to guide tells people which control to use. A control that has been
 * renamed or removed turns the guide into confident nonsense, and nothing else
 * in the test suite would notice — the app compiles and runs perfectly well
 * with a button the assistant still calls by its old name.
 *
 * So each control the guide names is looked for in the source that renders it.
 * These tests are meant to FAIL when the UI moves on without the guide.
 *
 * Only the words the guide actually puts in a user's hands are pinned. Pinning
 * every noun would make the guide impossible to reword.
 */

/** Read a source file, relative to the project root the tests run from. */
const source = (path: string): string => readFileSync(path, "utf8");

/** The guide, on its own — the page list above it has its own tests. */
function guide(): string {
  const start = SYSTEM_PROMPT.indexOf("HOW THINGS ARE DONE");
  const end = SYSTEM_PROMPT.indexOf("HOW TO ANSWER");
  assert.ok(start >= 0 && end > start, "the prompt carries a how-to guide before the answering rules");
  return SYSTEM_PROMPT.slice(start, end);
}

test("how-to: the guide refuses to invent steps it does not have", () => {
  const text = guide();
  assert.match(text, /NEVER invent a/, "the rule against inventing is stated");
  assert.match(text, /not sure of the/, "and what to say instead");
  assert.match(text, /Saving is always the user's own action/);
});

test("how-to: the Ledger controls it names exist on the Ledger page", () => {
  const ledger = source("src/pages/ledgerPage.ts");
  for (const control of ["Category Manager", "Account Manager", "Expense", "Income"]) {
    assert.ok(guide().includes(control), `the guide names ${control}`);
    assert.ok(ledger.includes(control), `Ledger page still has "${control}"`);
  }
});

test("how-to: the trade types it lists are the trade types the app offers", () => {
  const portfolio = source("src/pages/portfolioPage.ts");
  for (const control of ["DCA", "Dip Buy", "Manual Buy", "Sell", "Import CSV"]) {
    assert.ok(guide().includes(control), `the guide names ${control}`);
    assert.ok(portfolio.includes(control), `Portfolio page still has "${control}"`);
  }
});

test("how-to: the dividend suggestion buttons are the three that exist", () => {
  const portfolio = source("src/pages/portfolioPage.ts");
  for (const control of ["Confirm", "Edit", "Ignore"]) {
    assert.ok(guide().includes(control), `the guide names ${control}`);
    assert.ok(portfolio.includes(`>${control}<`), `Portfolio page still renders a "${control}" button`);
  }
  // The point of the flow, not just its buttons: a suggestion is not a record.
  assert.match(guide(), /NOTHING is recorded until they confirm/);
});

test("how-to: Goals and Review name controls those pages still render", () => {
  assert.ok(source("src/pages/goalsPage.ts").includes("Mark as done"));
  assert.ok(guide().includes("Mark as done"));
  assert.ok(source("src/pages/goalsPage.ts").includes("My financial goal"));
  assert.ok(guide().includes("My financial goal"));

  const review = source("src/pages/reviewPage.ts");
  assert.ok(review.includes("Complete review") && guide().includes("Complete review"));
  assert.ok(review.includes("History") && guide().includes("History"));
});

test("how-to: the Settings actions it describes are the ones on that page", () => {
  const settings = source("src/pages/settingsPage.ts");
  for (const control of ["Export data", "Import data", "Version history", "Reset all data"]) {
    assert.ok(guide().includes(control), `the guide names ${control}`);
    assert.ok(settings.includes(control), `Settings page still has "${control}"`);
  }
});

test("how-to: what it says Money Leaks detects is what Money Leaks detects", () => {
  // The model got this one wrong from the page subtitle alone: it named two of
  // the eight and embellished one of those.
  const categories = source("src/moneyLeaks.ts");
  const line = /export type MoneyLeakCategory =([^;]+);/.exec(categories)?.[1] ?? "";
  const kinds = [...line.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    kinds.sort(),
    ["budget", "debt", "duplicate", "fee", "goal", "increase", "subscription", "unusual"],
    "the detector's categories changed — the guide's list has to change with them",
  );
  const text = guide();
  for (const words of ["subscriptions", "fees", "duplicate charges", "month-over-month", "unusually large", "drifting above plan", "goals and debts"]) {
    assert.ok(text.includes(words), `the guide mentions ${words}`);
  }
  assert.match(text, /only OBSERVES, it never advises/);
});

test("how-to: Record is described as this panel's tab, not a tab on a page", () => {
  // The mistake G2 caught the model making, now stated the other way round.
  assert.match(guide(), /Record tab at the top of THIS assistant panel/);
  assert.match(guide(), /not a tab on any page/);
});

test("how-to: the emergency fund figures are placed on Me, where they are", () => {
  assert.ok(source("src/pages/mePage.ts").includes("Emergency fund"));
  assert.match(guide(), /are on the Me page/);
});

test("how-to: a transfer is a transfer, and the app really has that type", () => {
  // Reported live on 2026-09-24: asked where to record the emergency fund, the
  // assistant said to log an Expense in the Ledger. That counts the money as
  // spent AND leaves the emergency figure untouched — wrong twice over.
  assert.ok(source("src/models.ts").includes('"transfer"'), "the ledger still has a transfer type");
  assert.ok(source("src/pages/ledgerPage.ts").includes(">Transfer<"), "and the page still offers it");
  const text = guide();
  assert.match(text, /type Transfer/);
  assert.match(text, /It is NEVER an Expense/);
});

test("how-to: topping up the emergency fund goes through the card that exists", () => {
  // The step and its button live in onboarding.ts; the dashboard renders them.
  const steps = source("src/onboarding.ts");
  assert.ok(steps.includes("into your safety buffer"), "the step still says what it says");
  assert.ok(steps.includes("I've moved"), "and its button is still called that");
  assert.ok(source("src/pages/mePage.ts").includes("Current emergency MYR"), "the figure is still on Me");
  const text = guide();
  assert.match(text, /Current emergency MYR/);
  assert.match(text, /I've moved RM X/);
  assert.match(text, /WealthUp never moves money/);
});
