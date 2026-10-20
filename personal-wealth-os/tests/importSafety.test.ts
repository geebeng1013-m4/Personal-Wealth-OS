import assert from "node:assert/strict";
import { test } from "./testHarness";
import { recordsFromCsv, previewCsvTrades } from "../src/csvImport";
import { csvImportBody, csvImportSelection } from "../src/components/csvImportSheet";
import { validateBackup, isImportDate } from "../src/importValidation";
import { commitImportedState, setImportStateSource } from "../src/importFlow";
import { CURRENT_VERSION, emptyState, cloneDefaultState, importStateFromFile, saveState, loadSnapshots, restoreSnapshot, STORAGE_KEY, CSV_IMPORT_SNAPSHOT_LABEL, IMPORT_SNAPSHOT_LABEL } from "../src/state";
import { translateUiText } from "../src/i18n";
import { reset, signIn, saved } from "test:firebase-stub";

const csv = "date,ticker,amount(rm),amount (usd),price/unit (usd),units,fee\n2026-10-01,VOO,400,100,100,1,0";
const file = (value: unknown): File => new File([JSON.stringify(value)], "synthetic-backup.json");

for (const value of [null, [], {}, { version: CURRENT_VERSION }, { version: CURRENT_VERSION + 1, trades: [] }, { version: 0, trades: [] }]) {
  test(`backup rejects unrelated or unsupported input: ${JSON.stringify(value)}`, async () => {
    await assert.rejects(importStateFromFile(file(value)), /Import rejected/);
  });
}

for (const value of ["100", -1, null, true, Infinity, NaN]) {
  test(`backup rejects unsafe income ${String(value)}`, () => {
    assert.throws(() => validateBackup({ version: CURRENT_VERSION, cashflow: { allowance: value } }, CURRENT_VERSION), /cashflow.allowance/);
  });
}

test("backup rejects malformed JSON, overflow numbers, null trades and invalid calendar dates", async () => {
  for (const raw of ['{', '{"version":34,"cashflow":{"allowance":1e309}}', '{"version":34,"trades":[null]}']) {
    await assert.rejects(importStateFromFile(new File([raw], "invalid.json")), /Import rejected/);
  }
  const trade = recordsFromCsv(csv)[0];
  for (const date of ["2026-02-30", "2026-13-01", "2026-10-01T25:00:00Z", "yesterday"]) {
    await assert.rejects(importStateFromFile(file({ version: CURRENT_VERSION, trades: [{ ...trade, date }] })), /date/);
  }
  assert.equal(isImportDate("2024-02-29"), true);
  assert.equal(isImportDate("2026/10/01 21:30:00"), true);
});

test("backup rejects duplicate IDs and records migration would discard", async () => {
  const trade = recordsFromCsv(csv)[0];
  await assert.rejects(importStateFromFile(file({ version: CURRENT_VERSION, trades: [trade, trade] })), /Duplicate record ID/);
  await assert.rejects(importStateFromFile(file({ version: CURRENT_VERSION, ledgerTransactions: [{ id: "bad-category", date: "2026-10-01", amount: 10, type: "expense", categoryId: "missing" }] })), /could not be restored/);
  await assert.rejects(importStateFromFile(file({ version: CURRENT_VERSION, ledgerAccounts: [{ id: "bad", name: "", type: "bank" }] })), /Expected text/);
  await assert.rejects(importStateFromFile(file({ version: CURRENT_VERSION, liabilities: [{ id: "bad", name: "debt" }] })), /number/);
});

test("backup accepts full current exports, BOM and valid legacy migration without mutating its input", async () => {
  for (const state of [emptyState(), cloneDefaultState()]) {
    const before = JSON.stringify(state);
    const imported = await importStateFromFile(new File(["\uFEFF" + before], "valid.json"));
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(imported.trades.map((trade) => trade.id), state.trades.map((trade) => trade.id));
    assert.equal(imported.version, CURRENT_VERSION);
  }
  const legacy = { version: 10, trades: recordsFromCsv(csv), transactions: { entries: [{ id: "transfer", date: "2026-10-01", type: "transfer", amount: 20, fromAccount: "Bank A", toAccount: "Bank B" }] } };
  const imported = await importStateFromFile(file(legacy));
  assert.equal(imported.trades.length, 1);
  assert.equal(imported.ledgerTransactions.length, 1);
  assert.equal(imported.ledgerTransactions[0].amount, 20);
  assert.equal(imported.version, CURRENT_VERSION);
});

test("backup preserves valid dismissed dividend markers with legacy defaults", async () => {
  const imported = await importStateFromFile(file({ version: 24, trades: [], dividends: [{ id: "dismissed", ticker: "VOO", exDate: "2026-10-01", status: "dismissed" }] }));
  assert.equal(imported.dividends[0].gross, 0);
  assert.equal(imported.dividends[0].payDate, "2026-10-01");
});

test("invalid backup parsing does not write state, history or cloud", async () => {
  reset(); localStorage.clear(); signIn("import-safety");
  const key = `${STORAGE_KEY}-import-safety`;
  localStorage.setItem(key, JSON.stringify(emptyState()));
  const before = localStorage.getItem(key);
  const length = localStorage.length;
  await assert.rejects(importStateFromFile(file({ version: CURRENT_VERSION, trades: [null] })));
  assert.equal(localStorage.getItem(key), before);
  assert.equal(localStorage.length, length);
  assert.equal(saved.length, 0);
  reset(); localStorage.clear();
});

test("strict CSV rejects a bad row instead of silently partially importing", () => {
  for (const raw of ["nonsense", csv + '\n"unclosed', csv.replace("400,100", "-400,100"), csv.replace("400,100", "oops,100"), csv.replace("2026-10-01", "2026-02-30"), csv + "\n2026-10-02,,400,100,100,1,0"]) {
    assert.throws(() => recordsFromCsv(raw, "moomoo", true), /Import rejected/);
  }
  assert.equal(recordsFromCsv(csv, "moomoo", true).length, 1);
  assert.equal(recordsFromCsv("\uFEFF" + csv, "moomoo", true).length, 1);
});

test("strict Moomoo CSV keeps filled orders and rejects malformed fills", () => {
  const header = "Symbol,Side,Status,Filled@Avg Price,Order Time,Total\n";
  const row = 'VOO,Buy,Filled,1@100,"Oct 1, 2026 10:00:00 ET",0';
  assert.equal(recordsFromCsv(header + row, "moomoo", true).length, 1);
  assert.equal(recordsFromCsv(header + row.replace("Filled,", "Cancelled,"), "moomoo", true).length, 0);
  assert.throws(() => recordsFromCsv(header + row.replace("1@100", "bad"), "moomoo", true));
  assert.throws(() => recordsFromCsv(header + row.replace("VOO,", ","), "moomoo", true));
});

test("re-importing a CSV does not double holdings by default", () => {
  const original = recordsFromCsv(csv, "moomoo", true);
  const incoming = recordsFromCsv(csv, "moomoo", true);
  assert.notEqual(original[0].id, incoming[0].id);
  const preview = previewCsvTrades(original, incoming);
  assert.equal(preview.newTrades.length, 0);
  assert.equal(preview.suspectedDuplicates.length, 1);
  assert.equal(csvImportSelection(preview, false).length, 0);
  assert.equal(csvImportSelection(preview, true).length, 1);
  assert.ok(csvImportBody(preview).includes('name="includeDuplicates"'));
  assert.ok(!csvImportBody(preview).includes(" checked"));
});

test("CSV overlap detection survives corrected FX/fees and preserves separate identical fills", () => {
  const [trade] = recordsFromCsv(csv);
  const corrected = { ...trade, amountMyr: 450, feeMyr: 10, exchangeRate: 4.5, type: "Manual Buy" as const };
  const preview = previewCsvTrades([corrected], [{ ...trade, id: "second" }, { ...trade, id: "third" }, { ...trade, id: "sell", type: "Sell" }]);
  assert.equal(preview.suspectedDuplicates.length, 1);
  assert.deepEqual(preview.newTrades.map((item) => item.id), ["third", "sell"]);
  assert.equal(previewCsvTrades([], [trade, { ...trade, id: "identical-fill" }]).newTrades.length, 2);
  assert.equal(previewCsvTrades([trade], [{ ...trade, ticker: "QQQM" }]).newTrades.length, 1);
});

test("CSV preview escapes record text and translates new system messages", () => {
  const [trade] = recordsFromCsv(csv);
  const markup = csvImportBody({ newTrades: [{ ...trade, ticker: '<img src=x onerror="bad()">' }], suspectedDuplicates: [] });
  assert.ok(!markup.includes("<img"));
  assert.ok(markup.includes("&lt;img"));
  assert.equal(translateUiText("1 new trades. 2 possible duplicates.", "zh-CN"), "新增 1 笔交易，疑似重复 2 笔。");
  assert.equal(translateUiText("Import rejected at cashflow.allowance: Expected a finite non-negative number.", "zh-CN"), "导入被拒绝，字段 cashflow.生活费：应填写有效的非负数值。");
});

test("an import preview cannot overwrite data that changed while it was open", () => {
  const base = emptyState(); let current = base; let writes = 0;
  setImportStateSource(() => current);
  try {
    current = { ...base, financialGoal: "changed" };
    assert.throws(() => commitImportedState(base, base, IMPORT_SNAPSHOT_LABEL, () => { writes++; }), /data changed/);
    assert.equal(writes, 0);
    current = base;
    assert.throws(() => commitImportedState(base, base, IMPORT_SNAPSHOT_LABEL, () => false), /not saved/);
    commitImportedState(base, base, IMPORT_SNAPSHOT_LABEL, () => { writes++; return true; });
    assert.equal(writes, 1);
  } finally { setImportStateSource(); }
});

for (const label of [IMPORT_SNAPSHOT_LABEL, CSV_IMPORT_SNAPSHOT_LABEL]) {
  test(`${label}: snapshot failure blocks local and cloud writes`, () => {
    reset(); localStorage.clear(); signIn("import-safety");
    const key = `${STORAGE_KEY}-import-safety`;
    const base = emptyState();
    localStorage.setItem(key, JSON.stringify(base));
    const before = localStorage.getItem(key);
    const setItem = localStorage.setItem;
    const consoleError = console.error;
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true } });
    console.error = () => {};
    localStorage.setItem = (storageKey, value) => {
      if (storageKey.includes("snapshots")) throw new Error("Synthetic quota failure");
      setItem.call(localStorage, storageKey, value);
    };
    try {
      const next = { ...base, trades: recordsFromCsv(csv) };
      assert.equal(saveState(next, "import-safety", label), null);
      assert.equal(localStorage.getItem(key), before);
      assert.equal(saved.length, 0);
    } finally {
      localStorage.setItem = setItem; console.error = consoleError;
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      reset(); localStorage.clear();
    }
  });
}

test("CSV import snapshots are restorable and a first import also has a restore point", () => {
  reset(); localStorage.clear();
  const uid = "import-safety";
  const base = emptyState();
  saveState(base, uid);
  const next = { ...base, trades: recordsFromCsv(csv) };
  assert.ok(saveState(next, uid, CSV_IMPORT_SNAPSHOT_LABEL));
  const [snapshot] = loadSnapshots(uid);
  assert.equal(snapshot.label, CSV_IMPORT_SNAPSHOT_LABEL);
  assert.deepEqual(restoreSnapshot(snapshot.id, uid)?.trades, []);
  localStorage.clear();
  assert.ok(saveState(next, uid, IMPORT_SNAPSHOT_LABEL));
  assert.equal(loadSnapshots(uid).length, 1);
  assert.deepEqual(loadSnapshots(uid)[0].state.trades, []);
  reset(); localStorage.clear();
});

test("import state-write failure preserves the original state and its restore point", () => {
  reset(); localStorage.clear(); signIn("import-safety");
  const key = `${STORAGE_KEY}-import-safety`;
  const base = emptyState();
  localStorage.setItem(key, JSON.stringify(base));
  const before = localStorage.getItem(key);
  const setItem = localStorage.setItem;
  const consoleError = console.error;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true } });
  console.error = () => {};
  localStorage.setItem = (storageKey, value) => {
    if (storageKey === key) throw new Error("Synthetic state quota failure");
    setItem.call(localStorage, storageKey, value);
  };
  try {
    assert.equal(saveState({ ...base, trades: recordsFromCsv(csv) }, "import-safety", CSV_IMPORT_SNAPSHOT_LABEL), null);
    assert.equal(localStorage.getItem(key), before);
    assert.equal(saved.length, 0);
    assert.deepEqual(loadSnapshots("import-safety")[0].state.trades, []);
  } finally {
    localStorage.setItem = setItem; console.error = consoleError;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    reset(); localStorage.clear();
  }
});

test("an unreadable previous state blocks import instead of overwriting the only copy", () => {
  reset(); localStorage.clear(); signIn("import-safety");
  const key = `${STORAGE_KEY}-import-safety`;
  localStorage.setItem(key, "{unreadable");
  assert.equal(saveState(emptyState(), "import-safety", IMPORT_SNAPSHOT_LABEL), null);
  assert.equal(localStorage.getItem(key), "{unreadable");
  assert.equal(saved.length, 0);
  reset(); localStorage.clear();
});
