import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  __reloadAssistantStore,
  __resetAssistantStore,
  appendAskMessage,
  askMessages,
  askMessagesThisVisit,
  beginRecord,
  clearHistory,
  findRecordDraft,
  isFromThisVisit,
  assistantOwner,
  beginSending,
  isSending,
  setAssistantOwner,
  recordEntries,
  setAssistantMode,
  assistantMode,
  setShareFigures,
  shareFigures,
  noticeDismissed,
  updateRecord,
} from "../src/components/assistant/assistantStore";
import type { LedgerDraft } from "../src/components/assistant/assistantTypes";

function draft(): LedgerDraft {
  return {
    kind: "ledger",
    type: "expense",
    amount: 12.5,
    categoryId: "cat-food",
    categoryLabel: "Food",
    date: "2026-09-14",
    note: "coffee",
    unresolved: [],
    dropped: [],
  };
}

// --- the two histories are separate ---------------------------------------

test("assistant store: Ask and Record keep separate histories", () => {
  __resetAssistantStore();
  appendAskMessage({ role: "user", content: "how is net worth worked out?" });
  beginRecord("spent 12.50 on coffee");

  assert.equal(askMessages().length, 1);
  assert.equal(recordEntries().length, 1);
  assert.equal(askMessages()[0].content, "how is net worth worked out?");
  assert.equal(recordEntries()[0].said, "spent 12.50 on coffee");
});

test("assistant store: clearing one mode leaves the other alone", () => {
  __resetAssistantStore();
  appendAskMessage({ role: "user", content: "a question" });
  beginRecord("a record");

  clearHistory("help");
  assert.equal(askMessages().length, 0, "Ask cleared");
  assert.equal(recordEntries().length, 1, "Record kept — it was not what the button was beside");

  clearHistory("fill");
  assert.equal(recordEntries().length, 0);
});

// --- record lifecycle -----------------------------------------------------

test("assistant store: a record opens as pending and takes its outcome", () => {
  __resetAssistantStore();
  const entry = beginRecord("spent 12.50 on coffee");
  assert.equal(entry.status, "pending");

  updateRecord(entry.id, { status: "draft", draft: draft(), summary: "Expense · MYR 12.50", target: "ledger" });
  const stored = recordEntries()[0];
  assert.equal(stored.status, "draft");
  assert.equal(stored.summary, "Expense · MYR 12.50");
  assert.equal(stored.target, "ledger");
  assert.ok(findRecordDraft(entry.id), "the draft is retrievable while it is live");
});

test("assistant store: filling in drops the draft so it cannot be applied twice", () => {
  __resetAssistantStore();
  const entry = beginRecord("spent 12.50 on coffee");
  updateRecord(entry.id, { status: "draft", draft: draft(), summary: "Expense · MYR 12.50", target: "ledger" });

  updateRecord(entry.id, { status: "filled", draft: undefined });
  assert.equal(recordEntries()[0].status, "filled");
  assert.equal(findRecordDraft(entry.id), undefined, "no second application");
  assert.equal(recordEntries()[0].summary, "Expense · MYR 12.50", "but the history still says what it was");
});

test("assistant store: discarding also drops the draft and keeps the entry", () => {
  __resetAssistantStore();
  const entry = beginRecord("bought 500 usd of VOO");
  updateRecord(entry.id, { status: "draft", draft: draft(), summary: "Manual Buy · VOO", target: "portfolio" });

  updateRecord(entry.id, { status: "discarded", draft: undefined });
  assert.equal(recordEntries()[0].status, "discarded");
  assert.equal(findRecordDraft(entry.id), undefined);
  assert.equal(recordEntries().length, 1, "it stays in the log");
});

test("assistant store: updating an unknown id changes nothing", () => {
  __resetAssistantStore();
  beginRecord("something");
  updateRecord("no-such-id", { status: "filled" });
  assert.equal(recordEntries()[0].status, "pending");
});

// --- what survives a reload ----------------------------------------------
//
// A live draft must never come back clickable. An offer to fill in a form is
// about right now; finding yesterday's still actionable is how the same
// expense gets entered twice.

test("assistant store: a live draft does not survive a reload", () => {
  __resetAssistantStore();
  const entry = beginRecord("spent 12.50 on coffee");
  updateRecord(entry.id, { status: "draft", draft: draft(), summary: "Expense · MYR 12.50", target: "ledger" });

  __reloadAssistantStore();

  const after = recordEntries()[0];
  assert.equal(after.status, "expired", "history, not an offer");
  assert.equal(findRecordDraft(entry.id), undefined, "and nothing left to apply");
  assert.equal(after.said, "spent 12.50 on coffee", "what was asked is still findable");
  assert.equal(after.summary, "Expense · MYR 12.50", "and what it was read as");
});

test("assistant store: a request still in flight comes back as expired, not pending", () => {
  __resetAssistantStore();
  beginRecord("spent 30 on groceries");
  __reloadAssistantStore();
  assert.equal(recordEntries()[0].status, "expired", "never a spinner that can never finish");
});

test("assistant store: settled outcomes survive a reload unchanged", () => {
  __resetAssistantStore();
  const filled = beginRecord("spent 12.50 on coffee");
  updateRecord(filled.id, { status: "filled", summary: "Expense · MYR 12.50", target: "ledger" });
  const bad = beginRecord("how much should I save?");
  updateRecord(bad.id, { status: "unrecognised", reason: "That is a question, not a record." });

  __reloadAssistantStore();

  const entries = recordEntries();
  assert.equal(entries[0].status, "filled");
  assert.equal(entries[0].target, "ledger");
  assert.equal(entries[1].status, "unrecognised");
  assert.equal(entries[1].reason, "That is a question, not a record.");
});

test("assistant store: an Ask transcript survives a reload", () => {
  __resetAssistantStore();
  appendAskMessage({ role: "user", content: "how is net worth worked out?" });
  appendAskMessage({ role: "assistant", content: "Assets minus liabilities." });
  __reloadAssistantStore();

  const messages = askMessages();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].content, "Assets minus liabilities.");
});

// --- what Ask sends to the model -----------------------------------------
//
// Earlier visits stay visible, but only this visit's turns may be sent. An
// answer that quoted the user's figures while sharing was on must not ride
// along with every later question after sharing has reset to off.

test("assistant store: only this visit's Ask messages are offered to the model", () => {
  __resetAssistantStore();
  appendAskMessage({ role: "user", content: "am I overspending?" });
  appendAskMessage({ role: "assistant", content: "Your spending this month is MYR 1,234." });

  __reloadAssistantStore(); // a later visit

  appendAskMessage({ role: "user", content: "what is DCA?" });

  assert.equal(askMessages().length, 3, "all three are still shown");
  const sendable = askMessagesThisVisit();
  assert.equal(sendable.length, 1, "only the new question may be sent");
  assert.equal(sendable[0].content, "what is DCA?");
  assert.ok(!sendable.some((m) => m.content.includes("1,234")), "the earlier figures are not resent");
});

test("assistant store: right after a reload nothing old is sendable", () => {
  __resetAssistantStore();
  appendAskMessage({ role: "user", content: "hello" });
  __reloadAssistantStore();
  assert.equal(askMessages().length, 1);
  assert.equal(askMessagesThisVisit().length, 0);
  assert.equal(isFromThisVisit(askMessages()[0]), false);
});

test("assistant store: messages stored before visits existed count as earlier", () => {
  __resetAssistantStore();
  localStorage.setItem("wealthup-assistant-ask:test-user", JSON.stringify([
    { id: "old-1", role: "user", content: "legacy question", at: 1 },
  ]));
  __reloadAssistantStore();
  assert.equal(askMessages().length, 1);
  assert.equal(askMessagesThisVisit().length, 0);
});

// --- caps -----------------------------------------------------------------

test("assistant store: the Record log keeps far more than the Ask transcript", () => {
  __resetAssistantStore();
  for (let i = 0; i < 200; i++) beginRecord(`record ${i}`);
  for (let i = 0; i < 200; i++) appendAskMessage({ role: "user", content: `message ${i}` });

  assert.equal(recordEntries().length, 120, "history worth browsing is kept");
  assert.equal(askMessages().length, 40, "a conversation only needs recent turns");
  assert.equal(recordEntries()[recordEntries().length - 1].said, "record 199", "newest kept");
});

// --- preferences ----------------------------------------------------------

test("assistant store: figure sharing is off by default", () => {
  __resetAssistantStore();
  assert.equal(shareFigures(), false, "off means nothing numeric about the user is sent");
});

test("assistant store: figure sharing resets to off on every page load", () => {
  // Switching it on once must not keep sending figures on later visits.
  __resetAssistantStore();
  setShareFigures(true);
  assert.equal(shareFigures(), true, "on for the rest of this visit");
  __reloadAssistantStore();
  assert.equal(shareFigures(), false, "back to off after a reload");
});

test("assistant store: a stored sharing flag from an older version is ignored", () => {
  __resetAssistantStore();
  localStorage.setItem("wealthup-assistant-prefs", JSON.stringify({ mode: "help", shareFigures: true, noticeDismissed: true }));
  __reloadAssistantStore();
  assert.equal(shareFigures(), false);
  assert.equal(noticeDismissed(), true, "the genuinely remembered preferences still load");
});

test("assistant store: the chosen mode is remembered", () => {
  __resetAssistantStore();
  assert.equal(assistantMode(), "help");
  setAssistantMode("fill");
  __reloadAssistantStore();
  assert.equal(assistantMode(), "fill");
});

// --- history belongs to the signed-in account (AH-1) ------------------------

function clearAssistantKeys(): void {
  for (const key of ["wealthup-assistant-ask", "wealthup-assistant-records"]) {
    localStorage.removeItem(key);
    for (const uid of ["alice", "bob", "demo-user", "test-user"]) localStorage.removeItem(`${key}:${uid}`);
  }
}

test("assistant store: the next account on the same browser does not see the last one's history", () => {
  clearAssistantKeys();
  __resetAssistantStore("alice");
  appendAskMessage({ role: "user", content: "alice asks about her savings" });
  beginRecord("alice spent 12 on lunch");

  setAssistantOwner(null);
  assert.equal(askMessages().length, 0, "signed out: nothing on screen");
  assert.equal(recordEntries().length, 0);

  setAssistantOwner("bob");
  assert.equal(askMessages().length, 0, "bob starts empty");
  assert.equal(recordEntries().length, 0);
  appendAskMessage({ role: "user", content: "bob's own question" });

  setAssistantOwner("alice");
  assert.deepEqual(askMessages().map((m) => m.content), ["alice asks about her savings"], "alice gets hers back, not bob's");
  assert.deepEqual(recordEntries().map((r) => r.said), ["alice spent 12 on lunch"]);
});

test("assistant store: nothing is kept while nobody is signed in", () => {
  clearAssistantKeys();
  __resetAssistantStore("alice");
  setAssistantOwner(null);
  appendAskMessage({ role: "user", content: "typed while signed out" });
  setAssistantOwner("alice");
  assert.equal(askMessages().length, 0);
});

test("assistant store: history from before accounts is handed to the first account, once", () => {
  clearAssistantKeys();
  __resetAssistantStore("alice");
  setAssistantOwner(null);
  localStorage.setItem("wealthup-assistant-ask", JSON.stringify([{ id: "m1", role: "user", content: "old question", at: 1 }]));
  localStorage.setItem("wealthup-assistant-records", JSON.stringify([{ id: "r1", at: 1, said: "old record", status: "filled" }]));

  setAssistantOwner("bob");
  assert.deepEqual(askMessages().map((m) => m.content), ["old question"], "the person using this browser keeps it");
  assert.deepEqual(recordEntries().map((r) => r.said), ["old record"]);
  assert.equal(localStorage.getItem("wealthup-assistant-ask"), null, "the unowned copy is gone");
  assert.equal(localStorage.getItem("wealthup-assistant-records"), null);

  setAssistantOwner("alice");
  assert.equal(askMessages().length, 0, "a later account cannot pick it up");
});

test("assistant store: an account's own history wins over an unowned copy", () => {
  clearAssistantKeys();
  localStorage.setItem("wealthup-assistant-ask:alice", JSON.stringify([{ id: "a1", role: "user", content: "alice's", at: 2 }]));
  localStorage.setItem("wealthup-assistant-ask", JSON.stringify([{ id: "m1", role: "user", content: "unowned", at: 1 }]));
  __resetAssistantStore("test-user");
  setAssistantOwner("alice");
  assert.deepEqual(askMessages().map((m) => m.content), ["alice's"]);
  assert.equal(localStorage.getItem("wealthup-assistant-ask"), null);
});

test("assistant store: the demo account never adopts a real person's history", () => {
  clearAssistantKeys();
  __resetAssistantStore("test-user");
  setAssistantOwner(null);
  localStorage.setItem("wealthup-assistant-ask", JSON.stringify([{ id: "m1", role: "user", content: "real question", at: 1 }]));
  setAssistantOwner("demo-user", { adoptUnowned: false });
  assert.equal(askMessages().length, 0);
  assert.notEqual(localStorage.getItem("wealthup-assistant-ask"), null, "left for the real account");
  assert.equal(assistantOwner(), "demo-user");
});

test("assistant store: switching account drops sharing, the open panel and a request in flight", () => {
  clearAssistantKeys();
  __resetAssistantStore("alice");
  setShareFigures(true);
  const controller = beginSending();
  setAssistantOwner("bob");
  assert.equal(shareFigures(), false);
  assert.equal(isSending(), false);
  assert.equal(controller.signal.aborted, true, "alice's answer never lands in bob's history");
});
