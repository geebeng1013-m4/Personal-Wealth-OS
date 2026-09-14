import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  describeDraft,
  draftPage,
  extractJsonObject,
  figureAppearsIn,
  localDateKey,
  matchByName,
  parseAssistantAction,
  toDateKey,
  toPositiveNumber,
} from "../src/components/assistant/assistantActions";
import { migrateState } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 8, 13, 12, 0, 0); // 2026-09-13, local
const TODAY = "2026-09-13";
const PLATFORMS = ["Moomoo", "IBKR"];

/**
 * Source text carrying every figure these fixtures use.
 *
 * Figures are only filled in when they appear in what the user actually wrote
 * (see figureAppearsIn). Tests that are not about that guard pass this, so they
 * exercise the behaviour they are named for; the tests that ARE about the guard
 * pass their own text.
 */
const SOURCE = "12.50 3200 20 9 30 500 520.50 0.96 3 100 250";

function stateWith(): WealthState {
  return migrateState({
    deviceId: "assistant-test",
    ledgerCategories: [
      { id: "cat-food", label: "Food & Drink", icon: "🍜", type: "expense" },
      { id: "cat-transport", label: "Transport", icon: "🚌", type: "expense" },
      { id: "cat-salary", label: "Salary", icon: "💰", type: "income" },
    ],
    ledgerAccounts: [
      { id: "acc-maybank", name: "Maybank", type: "bank", openingBalance: 0 },
      { id: "acc-tng", name: "Touch n Go", type: "wallet", openingBalance: 0 },
    ],
    customTickers: ["VXUS"],
  });
}

// --- extractJsonObject: a free model does not return clean JSON ------------

test("assistant action: a bare JSON object is read", () => {
  assert.deepEqual(extractJsonObject('{"action":"none"}'), { action: "none" });
});

test("assistant action: markdown fences and surrounding prose are ignored", () => {
  const reply = 'Sure, here you go:\n```json\n{"action":"none","reason":"nothing"}\n```\nHope that helps.';
  assert.deepEqual(extractJsonObject(reply), { action: "none", reason: "nothing" });
});

test("assistant action: a brace inside a string does not end the object early", () => {
  const parsed = extractJsonObject('{"action":"none","reason":"dinner {with friends}"}');
  assert.deepEqual(parsed, { action: "none", reason: "dinner {with friends}" });
});

test("assistant action: an escaped quote does not end the string early", () => {
  const parsed = extractJsonObject('{"action":"none","reason":"he said \\"hi\\" loudly"}');
  assert.deepEqual(parsed, { action: "none", reason: 'he said "hi" loudly' });
});

test("assistant action: nested objects are kept whole", () => {
  assert.deepEqual(extractJsonObject('prefix {"a":{"b":1},"c":2} suffix'), { a: { b: 1 }, c: 2 });
});

test("assistant action: prose with no object, and malformed JSON, both yield null", () => {
  assert.equal(extractJsonObject("I am not sure what you mean."), null);
  assert.equal(extractJsonObject('{"action": }'), null);
  assert.equal(extractJsonObject('{"unterminated": "value'), null);
});

// --- toPositiveNumber: never turn a bad figure into a real one -------------

test("assistant action: plain and quoted numbers are accepted", () => {
  assert.equal(toPositiveNumber(12.5), 12.5);
  assert.equal(toPositiveNumber("12.5"), 12.5);
  assert.equal(toPositiveNumber("1,250.75"), 1250.75);
  assert.equal(toPositiveNumber("RM50"), 50);
  assert.equal(toPositiveNumber("$500"), 500);
});

test("assistant action: zero, negative and non-finite figures are rejected", () => {
  for (const bad of [0, -5, "0", "-5", Number.NaN, Number.POSITIVE_INFINITY, "", "abc", null, undefined, {}, []]) {
    assert.equal(toPositiveNumber(bad), undefined, `rejected: ${JSON.stringify(bad)}`);
  }
});

// --- toDateKey: the date window is what stops a mis-filed entry ------------

test("assistant action: a valid nearby date is kept", () => {
  assert.equal(toDateKey("2026-09-12", NOW), "2026-09-12");
});

test("assistant action: an impossible calendar date is rejected", () => {
  assert.equal(toDateKey("2026-02-31", NOW), undefined);
  assert.equal(toDateKey("2026-13-01", NOW), undefined);
});

test("assistant action: a wrong shape is rejected", () => {
  for (const bad of ["12/09/2026", "2026-9-1", "yesterday", "", 20260912, null]) {
    assert.equal(toDateKey(bad, NOW), undefined, `rejected: ${JSON.stringify(bad)}`);
  }
});

test("assistant action: a date more than a year away is rejected, not filed", () => {
  // The failure this guards: a model resolving "last Friday" against its own
  // training cut-off and quietly filing an entry under a long-past month.
  assert.equal(toDateKey("2024-03-01", NOW), undefined);
  assert.equal(toDateKey("2030-01-01", NOW), undefined);
});

test("assistant action: localDateKey uses the local day, not UTC", () => {
  assert.equal(localDateKey(NOW), TODAY);
});

// --- matchByName: one candidate or none ------------------------------------

test("assistant action: an exact name matches regardless of case and icon", () => {
  const items = [{ label: "Food & Drink" }, { label: "Transport" }];
  assert.equal(matchByName("food & drink", items, (item) => item.label)?.label, "Food & Drink");
});

test("assistant action: a single containment match is accepted", () => {
  const items = [{ label: "Food & Drink" }, { label: "Transport" }];
  assert.equal(matchByName("food", items, (item) => item.label)?.label, "Food & Drink");
});

test("assistant action: an ambiguous containment match is refused", () => {
  const items = [{ label: "Food at home" }, { label: "Food outside" }];
  assert.equal(matchByName("food", items, (item) => item.label), undefined);
});

test("assistant action: a name matching nothing is refused", () => {
  assert.equal(matchByName("crypto", [{ label: "Food" }], (item) => item.label), undefined);
});

// --- ledger drafts ---------------------------------------------------------

test("assistant draft: a complete expense resolves to real ids", () => {
  const result = parseAssistantAction({ reply: '{"action":"ledger.entry","type":"expense","amount":12.5,"category":"Food & Drink","account":"Maybank","date":"2026-09-12","note":"coffee"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (!result.ok || result.draft.kind !== "ledger") return;
  assert.equal(result.draft.type, "expense");
  assert.equal(result.draft.amount, 12.5);
  assert.equal(result.draft.categoryId, "cat-food");
  assert.equal(result.draft.accountId, "acc-maybank");
  assert.equal(result.draft.date, "2026-09-12");
  assert.equal(result.draft.note, "coffee");
  assert.deepEqual(result.draft.unresolved, []);
});

test("assistant draft: an income entry only matches income categories", () => {
  // "Salary" is an income category; asking for it on an expense must not match.
  const asIncome = parseAssistantAction({ reply: '{"action":"ledger.entry","type":"income","amount":3200,"category":"Salary"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(asIncome.ok, true);
  if (asIncome.ok && asIncome.draft.kind === "ledger") {
    assert.equal(asIncome.draft.categoryId, "cat-salary");
  }

  const asExpense = parseAssistantAction({ reply: '{"action":"ledger.entry","type":"expense","amount":3200,"category":"Salary"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(asExpense.ok, true);
  if (asExpense.ok && asExpense.draft.kind === "ledger") {
    assert.equal(asExpense.draft.categoryId, undefined, "no expense category called Salary");
    assert.equal(asExpense.draft.unresolved.length, 1);
  }
});

test("assistant draft: an unmatched category is reported, never invented", () => {
  const result = parseAssistantAction({ reply: '{"action":"ledger.entry","type":"expense","amount":20,"category":"Crypto","account":"Nowhere Bank"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (!result.ok || result.draft.kind !== "ledger") return;
  assert.equal(result.draft.categoryId, undefined);
  assert.equal(result.draft.accountId, undefined);
  assert.equal(result.draft.unresolved.length, 2);
});

test("assistant draft: a missing date falls back to today", () => {
  const result = parseAssistantAction({ reply: '{"action":"ledger.entry","type":"expense","amount":9}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (result.ok && result.draft.kind === "ledger") assert.equal(result.draft.date, TODAY);
});

test("assistant draft: an out-of-window date falls back to today rather than filing wrong", () => {
  const result = parseAssistantAction({ reply: '{"action":"ledger.entry","type":"expense","amount":9,"date":"2023-01-05"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (result.ok && result.draft.kind === "ledger") assert.equal(result.draft.date, TODAY);
});

test("assistant draft: an entry with no readable amount is refused", () => {
  const result = parseAssistantAction({ reply: '{"action":"ledger.entry","type":"expense","category":"Food & Drink"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, false);
});

test("assistant draft: an entry with no direction is refused", () => {
  const result = parseAssistantAction({ reply: '{"action":"ledger.entry","amount":30}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, false);
});

// --- trade drafts ----------------------------------------------------------

test("assistant draft: a known ticker and broker fill without the custom path", () => {
  const result = parseAssistantAction({ reply: '{"action":"portfolio.trade","ticker":"voo","tradeType":"DCA","platform":"Moomoo","date":"2026-09-13","amountUsd":500,"priceUsd":520.5,"units":0.96,"feeMyr":3}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (!result.ok || result.draft.kind !== "trade") return;
  assert.equal(result.draft.ticker, "VOO");
  assert.equal(result.draft.isCustomTicker, false);
  assert.equal(result.draft.isCustomPlatform, false);
  assert.equal(result.draft.tradeType, "DCA");
  assert.equal(result.draft.amountUsd, 500);
  assert.equal(result.draft.units, 0.96);
  assert.equal(result.draft.feeMyr, 3);
  assert.equal(result.draft.amountMyr, undefined, "not supplied, so not invented");
});

test("assistant draft: a ticker on file as a custom ticker is not re-flagged custom", () => {
  const result = parseAssistantAction({ reply: '{"action":"portfolio.trade","ticker":"VXUS","amountUsd":100}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (result.ok && result.draft.kind === "trade") assert.equal(result.draft.isCustomTicker, false);
});

test("assistant draft: an unknown ticker and broker take the custom path", () => {
  const result = parseAssistantAction({ reply: '{"action":"portfolio.trade","ticker":"AAPL","platform":"Webull","amountUsd":250}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (!result.ok || result.draft.kind !== "trade") return;
  assert.equal(result.draft.isCustomTicker, true);
  assert.equal(result.draft.platform, "Webull");
  assert.equal(result.draft.isCustomPlatform, true);
});

test("assistant draft: an unrecognised trade type is reported and defaults safely", () => {
  const result = parseAssistantAction({ reply: '{"action":"portfolio.trade","ticker":"VOO","tradeType":"Rebalance","amountUsd":100}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (!result.ok || result.draft.kind !== "trade") return;
  assert.equal(result.draft.tradeType, "Manual Buy");
  assert.equal(result.draft.unresolved.length, 1);
});

test("assistant draft: a trade with no amount and no quantity is refused", () => {
  const result = parseAssistantAction({ reply: '{"action":"portfolio.trade","ticker":"VOO","tradeType":"DCA"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, false);
});

test("assistant draft: a trade with no ticker is refused", () => {
  const result = parseAssistantAction({ reply: '{"action":"portfolio.trade","amountUsd":500}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, false);
});

// --- the "nothing to record" path -----------------------------------------

test("assistant draft: action none surfaces the model's own reason", () => {
  const result = parseAssistantAction({ reply: '{"action":"none","reason":"I need an amount."}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "I need an amount.");
});

test("assistant draft: prose instead of JSON is refused, not guessed at", () => {
  const result = parseAssistantAction({ reply: "I think you spent some money on food.", sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, false);
});

test("assistant draft: an unsupported action is refused", () => {
  const result = parseAssistantAction({ reply: '{"action":"goal.create","name":"Car"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, false);
});

// --- the confirmation line -------------------------------------------------

test("assistant draft: the summary states only what the draft carries", () => {
  const result = parseAssistantAction({ reply: '{"action":"ledger.entry","type":"expense","amount":12.5,"category":"Food & Drink","date":"2026-09-12"}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const line = describeDraft(result.draft);
  assert.ok(line.includes("Expense"), line);
  assert.ok(line.includes("MYR 12.50"), line);
  assert.ok(line.includes("Food & Drink"), line);
  assert.ok(line.includes("2026-09-12"), line);
  assert.ok(!line.includes("undefined"), "no placeholder for an absent field");
  assert.equal(draftPage(result.draft), "ledger");
});

test("assistant draft: a trade summary routes to the Portfolio page", () => {
  const result = parseAssistantAction({ reply: '{"action":"portfolio.trade","ticker":"VOO","tradeType":"DCA","amountUsd":500}', sourceText: SOURCE, state: stateWith(), now: NOW, platforms: PLATFORMS });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(draftPage(result.draft), "portfolio");
  const line = describeDraft(result.draft);
  assert.ok(line.includes("VOO"), line);
  assert.ok(!line.includes("undefined"), line);
});

// --- the fabrication guard ------------------------------------------------
//
// Caught in live testing: told "bought 500 usd of VOO on moomoo today at
// 520.50, fee 3 myr", the model invented a USD/MYR rate of 4.40, filled
// amountMyr with 2200, and recorded in the notes that the rate was "estimated".
// A guessed ringgit figure becomes a holding's cost basis, which is the number
// this app exists to keep honest — so a figure the user never said is dropped.

test("assistant guard: figureAppearsIn accepts a figure the user wrote", () => {
  assert.equal(figureAppearsIn(500, "bought 500 usd of VOO"), true);
  assert.equal(figureAppearsIn(520.5, "at 520.50 per unit"), true, "two-decimal spelling");
  assert.equal(figureAppearsIn(12.5, "spent 12.50 on coffee"), true);
  assert.equal(figureAppearsIn(1250.75, "paid 1,250.75 rent"), true, "thousands separator");
  assert.equal(figureAppearsIn(50, "it was RM50"), true, "currency prefix");
  assert.equal(figureAppearsIn(3200, "salary 3200 came in"), true);
});

test("assistant guard: figureAppearsIn rejects a figure the user never wrote", () => {
  assert.equal(figureAppearsIn(2200, "bought 500 usd of VOO at 520.50, fee 3 myr"), false, "the invented conversion");
  assert.equal(figureAppearsIn(0.9606, "bought 500 usd of VOO at 520.50"), false, "the derived unit count");
});

test("assistant guard: a figure is not found inside a longer number", () => {
  assert.equal(figureAppearsIn(3, "spent 30 on food"), false, "3 is not 30");
  assert.equal(figureAppearsIn(52, "at 520.50"), false);
  assert.equal(figureAppearsIn(5, "0.5 units"), false, "not the decimal part");
});

test("assistant guard: an invented MYR conversion is dropped, not filled in", () => {
  const said = "bought 500 usd of VOO on moomoo today at 520.50, fee 3 myr";
  const result = parseAssistantAction({
    // The exact reply the live model produced.
    reply: '{"action":"portfolio.trade","ticker":"VOO","tradeType":"Manual Buy","platform":"Moomoo","date":"2026-09-13","amountMyr":2200,"amountUsd":500,"priceUsd":520.50,"units":0.9606,"feeMyr":3,"notes":"MYR amount estimated at ~4.40 USD/MYR rate."}',
    sourceText: said, state: stateWith(), now: NOW, platforms: PLATFORMS,
  });
  assert.equal(result.ok, true);
  if (!result.ok || result.draft.kind !== "trade") return;

  assert.equal(result.draft.amountMyr, undefined, "the invented conversion must not be filled in");
  assert.equal(result.draft.units, undefined, "the derived quantity must not be filled in either");
  assert.equal(result.draft.amountUsd, 500, "what the user said is kept");
  assert.equal(result.draft.priceUsd, 520.5, "what the user said is kept");
  assert.equal(result.draft.feeMyr, 3, "what the user said is kept");
  assert.ok(result.draft.dropped.includes("MYR amount"), "and the user is told");
  assert.ok(result.draft.dropped.includes("quantity"));
});

test("assistant guard: a trade left with no stated figure at all is refused", () => {
  const result = parseAssistantAction({
    reply: '{"action":"portfolio.trade","ticker":"VOO","tradeType":"DCA","amountMyr":2200,"units":0.96}',
    sourceText: "bought some VOO today", state: stateWith(), now: NOW, platforms: PLATFORMS,
  });
  assert.equal(result.ok, false, "every figure was invented, so there is nothing to fill in");
});

test("assistant guard: a ledger amount the user never said refuses the whole draft", () => {
  // Unlike a trade's optional fields, the amount IS the entry: a wrong one
  // is not a blank to fill in later, it is a wrong record.
  const result = parseAssistantAction({
    reply: '{"action":"ledger.entry","type":"expense","amount":45,"category":"Food & Drink"}',
    sourceText: "bought lunch today", state: stateWith(), now: NOW, platforms: PLATFORMS,
  });
  assert.equal(result.ok, false);
});

test("assistant guard: a stated ledger amount still fills in normally", () => {
  const result = parseAssistantAction({
    reply: '{"action":"ledger.entry","type":"expense","amount":12.5,"category":"Food & Drink","date":"2026-09-13"}',
    sourceText: "spent 12.50 on coffee", state: stateWith(), now: NOW, platforms: PLATFORMS,
  });
  assert.equal(result.ok, true);
  if (result.ok && result.draft.kind === "ledger") {
    assert.equal(result.draft.amount, 12.5);
    assert.deepEqual(result.draft.dropped, []);
  }
});
