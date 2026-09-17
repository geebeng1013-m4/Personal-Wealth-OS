import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  __reloadAssistantStore,
  __resetAssistantStore,
  appendAskMessage,
  askMessages,
  beginRecord,
  clearHistory,
  recordEntries,
  setAssistantOwner,
  updateRecord,
} from "../src/components/assistant/assistantStore";
import {
  flushAssistantSync,
  startAssistantSync,
  stopAssistantSync,
  syncAssistantHistoryNow,
  type AssistantCloud,
} from "../src/components/assistant/assistantSync";
import {
  emptyHistory,
  mergeHistory,
  parseHistory,
  sameHistory,
  storableHistory,
  type AssistantHistory,
} from "../src/components/assistant/historyMerge";
import type { AssistantMessage, RecordEntry } from "../src/components/assistant/assistantTypes";

const ask = (id: string, at: number, content = id): AssistantMessage => ({ id, at, role: "user", content });
const rec = (id: string, at: number, status: RecordEntry["status"] = "filled"): RecordEntry => ({ id, at, said: id, status });
const history = (patch: Partial<AssistantHistory>): AssistantHistory => ({ ...emptyHistory(), ...patch });

// --- merging two copies -----------------------------------------------------

test("history merge: both devices' entries end up in one list, oldest first", () => {
  const merged = mergeHistory(
    history({ ask: [ask("a", 1), ask("c", 3)] }),
    history({ ask: [ask("b", 2), ask("a", 1)] }),
  );
  assert.deepEqual(merged.ask.map((m) => m.id), ["a", "b", "c"], "no duplicate, in time order");
});

test("history merge: a clear on either device drops what came before it, everywhere", () => {
  const merged = mergeHistory(
    history({ ask: [ask("old", 1), ask("new", 5)], records: [rec("r-old", 1)] }),
    history({ askClearedAt: 3, ask: [] }),
  );
  assert.deepEqual(merged.ask.map((m) => m.id), ["new"], "written after the clear, so kept");
  assert.equal(merged.askClearedAt, 3);
  assert.deepEqual(merged.records.map((r) => r.id), ["r-old"], "clearing Ask leaves the Record log alone");
});

test("history merge: a finished outcome beats a copy that only expired on reload", () => {
  const merged = mergeHistory(
    history({ records: [rec("r1", 1, "expired")] }),
    history({ records: [{ ...rec("r1", 1, "filled"), summary: "Food 12.50" }] }),
  );
  assert.equal(merged.records[0].status, "filled");
  assert.equal(merged.records[0].summary, "Food 12.50");
});

test("history merge: this device's in-flight entry keeps its offered draft", () => {
  const draft = { kind: "ledger", type: "expense", amount: 1, categoryId: "c", categoryLabel: "C", date: "2026-09-17", note: "", unresolved: [], dropped: [] } as const;
  const mine = history({ records: [{ ...rec("r1", 1, "draft"), draft }] });
  const merged = mergeHistory(mine, history({ records: [rec("r1", 1, "expired")] }));
  assert.equal(merged.records[0].status, "draft");
  assert.ok(merged.records[0].draft, "the form offer is still there to apply");
});

test("history merge: the caps still hold after two full copies meet", () => {
  const mine = history({ ask: Array.from({ length: 40 }, (_, i) => ask(`m${i}`, i * 2)) });
  const cloud = history({ ask: Array.from({ length: 40 }, (_, i) => ask(`c${i}`, i * 2 + 1)) });
  const merged = mergeHistory(mine, cloud);
  assert.equal(merged.ask.length, 40);
  assert.equal(merged.ask[39].id, "c39", "the newest are the ones kept");
});

test("history merge: what is stored carries no draft and nothing undefined", () => {
  const draft = { kind: "ledger" } as unknown as RecordEntry["draft"];
  const stored = storableHistory(history({ records: [{ ...rec("r1", 1, "draft"), draft, summary: undefined }] }));
  assert.equal("draft" in stored.records[0], false);
  assert.equal("summary" in stored.records[0], false, "Firestore rejects undefined fields");
});

test("history merge: a malformed cloud document is read as far as it is valid", () => {
  assert.equal(parseHistory(null), null);
  assert.equal(parseHistory("nope"), null);
  const parsed = parseHistory({ ask: [ask("a", 1), { role: "hacker" }], records: "x", askClearedAt: -4 });
  assert.deepEqual(parsed?.ask.map((m) => m.id), ["a"]);
  assert.deepEqual(parsed?.records, []);
  assert.equal(parsed?.askClearedAt, 0);
});

test("history merge: identical copies need no write", () => {
  const h = history({ ask: [ask("a", 1)], records: [rec("r", 2)] });
  assert.equal(sameHistory(h, mergeHistory(h, h)), true);
  assert.equal(sameHistory(h, history({ ask: [ask("a", 1)], records: [rec("r", 2, "discarded")] })), false);
});

// --- syncing with the account's cloud copy ----------------------------------

function fakeCloud(): AssistantCloud & { docs: Map<string, AssistantHistory>; saves: number; fail: boolean } {
  const cloud = {
    docs: new Map<string, AssistantHistory>(),
    saves: 0,
    fail: false,
    async load(uid: string): Promise<unknown> {
      if (cloud.fail) throw new Error("offline");
      const doc = cloud.docs.get(uid);
      return doc ? JSON.parse(JSON.stringify(doc)) : null;
    },
    async save(uid: string, h: AssistantHistory): Promise<void> {
      if (cloud.fail) throw new Error("offline");
      cloud.saves++;
      cloud.docs.set(uid, JSON.parse(JSON.stringify(h)));
    },
  };
  return cloud;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function freshDevice(uid: string): void {
  // A second device is this store with nothing in its own storage for `uid`.
  for (const key of ["wealthup-assistant-ask", "wealthup-assistant-records", "wealthup-assistant-cleared"]) {
    localStorage.removeItem(`${key}:${uid}`);
  }
  setAssistantOwner(null);
  setAssistantOwner(uid);
}

test("assistant sync: history written on one device is there on the next", async () => {
  const cloud = fakeCloud();
  __resetAssistantStore("sync-a");
  await startAssistantSync("sync-a", cloud, { delayMs: 0 });
  appendAskMessage({ role: "user", content: "asked on the laptop" });
  beginRecord("lunch 12 on the laptop");
  await wait(5);
  await flushAssistantSync();
  stopAssistantSync();

  freshDevice("sync-a");
  assert.equal(askMessages().length, 0, "the phone has nothing of its own");
  await startAssistantSync("sync-a", cloud, { delayMs: 0 });
  assert.deepEqual(askMessages().map((m) => m.content), ["asked on the laptop"]);
  assert.deepEqual(recordEntries().map((r) => r.said), ["lunch 12 on the laptop"]);
  stopAssistantSync();
});

test("assistant sync: two devices' additions both survive", async () => {
  const cloud = fakeCloud();
  cloud.docs.set("sync-b", history({ ask: [ask("from-phone", 1, "phone question")] }));
  __resetAssistantStore("sync-b");
  appendAskMessage({ role: "user", content: "laptop question" });
  await startAssistantSync("sync-b", cloud, { delayMs: 0 });
  assert.deepEqual(askMessages().map((m) => m.content), ["phone question", "laptop question"]);
  assert.deepEqual(cloud.docs.get("sync-b")?.ask.map((m) => m.content), ["phone question", "laptop question"], "and the cloud has both");
  stopAssistantSync();
});

test("assistant sync: a clear reaches the other devices instead of coming back", async () => {
  const cloud = fakeCloud();
  __resetAssistantStore("sync-c");
  await startAssistantSync("sync-c", cloud, { delayMs: 0 });
  appendAskMessage({ role: "user", content: "to be cleared" });
  await flushAssistantSync();
  await wait(5);
  // The phone still holds the old copy locally when the laptop clears.
  const phoneCopy = JSON.parse(JSON.stringify(cloud.docs.get("sync-c")));
  clearHistory("help");
  await wait(5);
  await flushAssistantSync();
  stopAssistantSync();

  freshDevice("sync-c");
  localStorage.setItem("wealthup-assistant-ask:sync-c", JSON.stringify(phoneCopy.ask));
  __reloadAssistantStore();
  assert.equal(askMessages().length, 1, "the phone's stale copy");
  await startAssistantSync("sync-c", cloud, { delayMs: 0 });
  assert.equal(askMessages().length, 0, "the clear wins on the phone");
  assert.equal(cloud.docs.get("sync-c")?.ask.length, 0, "and nothing was pushed back up");
  stopAssistantSync();
});

test("assistant sync: an unchanged history is not written again", async () => {
  const cloud = fakeCloud();
  __resetAssistantStore("sync-d");
  appendAskMessage({ role: "user", content: "once" });
  await startAssistantSync("sync-d", cloud, { delayMs: 0 });
  const after = cloud.saves;
  await syncAssistantHistoryNow();
  await syncAssistantHistoryNow();
  assert.equal(cloud.saves, after, "opening the panel reads, but writes nothing new");
  stopAssistantSync();
});

test("assistant sync: an outcome folded in later reaches the cloud", async () => {
  const cloud = fakeCloud();
  __resetAssistantStore("sync-e");
  await startAssistantSync("sync-e", cloud, { delayMs: 0 });
  const entry = beginRecord("coffee 9");
  updateRecord(entry.id, { status: "filled", summary: "Food 9" });
  await wait(5);
  await flushAssistantSync();
  assert.equal(cloud.docs.get("sync-e")?.records[0].status, "filled");
  stopAssistantSync();
});

test("assistant sync: offline keeps everything on the device and never throws", async () => {
  const cloud = fakeCloud();
  cloud.fail = true;
  __resetAssistantStore("sync-f");
  const warn = console.warn;
  console.warn = () => {};
  try {
    await startAssistantSync("sync-f", cloud, { delayMs: 0 });
    appendAskMessage({ role: "user", content: "no signal" });
    await wait(5);
    await flushAssistantSync();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(askMessages().map((m) => m.content), ["no signal"]);
  cloud.fail = false;
  await syncAssistantHistoryNow();
  assert.deepEqual(cloud.docs.get("sync-f")?.ask.map((m) => m.content), ["no signal"], "sent once the cloud is back");
  stopAssistantSync();
});

test("assistant sync: a cloud read that lands after sign-out touches nothing", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const cloud: AssistantCloud = {
    async load() { await gate; return history({ ask: [ask("x", 1, "someone else's")] }); },
    async save() { throw new Error("must not write"); },
  };
  __resetAssistantStore("sync-g");
  const running = startAssistantSync("sync-g", cloud, { delayMs: 0 });
  stopAssistantSync();
  setAssistantOwner(null);
  setAssistantOwner("sync-h");
  release();
  await running;
  assert.equal(askMessages().length, 0, "the next account's history is untouched");
});
