import assert from "node:assert/strict";
import { test } from "./testHarness";
import { ALL_PAGES, PAGE_GROUPS, PHONE_TABS, describePage } from "../src/pageDirectory";
import { checkinsDueText, getLanguage, setLanguage, t, translateUiText } from "../src/i18n";
import { userDisplayValues } from "../src/interfaceLanguage";
import { emptyState } from "../src/state";

function withPreference(check: () => void): void {
  const before = localStorage.getItem("pwo-language");
  try { check(); } finally {
    if (before === null) localStorage.removeItem("pwo-language");
    else localStorage.setItem("pwo-language", before);
  }
}

test("language: defaults to English and rejects unsupported preferences", () => withPreference(() => {
  localStorage.removeItem("pwo-language");
  assert.equal(getLanguage(), "en");
  assert.equal(t("Settings"), "Settings");
  assert.equal(setLanguage("fr"), false);
  localStorage.setItem("pwo-language", "unexpected");
  assert.equal(getLanguage(), "en");
}));

test("language: Chinese preference survives repeated reads and switching back", () => withPreference(() => {
  assert.equal(setLanguage("zh-CN"), true);
  assert.equal(getLanguage(), "zh-CN");
  assert.equal(localStorage.getItem("pwo-language"), "zh-CN");
  assert.equal(t("Settings"), "设置");
  assert.equal(t("Ledger"), "账本");
  assert.equal(setLanguage("en"), true);
  assert.equal(t("Settings"), "Settings");
}));

test("language: every navigation label, group and subtitle has a Chinese translation", () => {
  for (const [, label, subtitle] of ALL_PAGES) {
    assert.notEqual(t(label, "zh-CN"), label, label);
    assert.notEqual(t(subtitle, "zh-CN"), subtitle, subtitle);
  }
  for (const [group] of PAGE_GROUPS) assert.notEqual(t(group, "zh-CN"), group);
  for (const [, label] of PHONE_TABS) assert.notEqual(t(label, "zh-CN"), label);
});

test("language: unknown content stays intact, including route descriptions used by the assistant", () => withPreference(() => {
  const description = describePage("ledger");
  setLanguage("zh-CN");
  assert.equal(describePage("ledger"), description);
  for (const value of ["VOO", "QQQM", "My bank", "Coffee | lunch", "ledger", "constructor"]) assert.equal(t(value), value);
}));

test("language: due check-ins translate with the live count", () => withPreference(() => {
  setLanguage("en");
  assert.equal(checkinsDueText(1), "1 check-in due");
  assert.equal(checkinsDueText(2), "2 check-ins due");
  setLanguage("zh-CN");
  assert.equal(checkinsDueText(2), "2 项待完成的检查");
}));

test("language: unavailable storage reads as English and reports write failure", () => {
  const originalGet = localStorage.getItem;
  const originalSet = localStorage.setItem;
  try {
    localStorage.getItem = () => { throw new Error("blocked"); };
    localStorage.setItem = () => { throw new Error("blocked"); };
    assert.equal(getLanguage(), "en");
    assert.equal(setLanguage("zh-CN"), false);
  } finally {
    localStorage.getItem = originalGet;
    localStorage.setItem = originalSet;
  }
});

test("language: setting the preference does not modify financial storage", () => withPreference(() => {
  const key = "personal-wealth-os-state-language-check";
  const original = localStorage.getItem(key);
  try {
    localStorage.setItem(key, '{"balance":123.45}');
    setLanguage("zh-CN");
    assert.equal(localStorage.getItem(key), '{"balance":123.45}');
  } finally {
    if (original === null) localStorage.removeItem(key);
    else localStorage.setItem(key, original);
  }
}));

test("language: all main pages translate headings, actions and form copy", () => {
  for (const text of ["Start here today", "Net worth", "Income", "Expense", "Save & add another", "Market value", "Unrealised", "Monthly review", "Dip-buy ladder", "Edit dip-buy ladder", "Monthly DCA", "Add a goal", "Trigger drawdown (%)", "What regular investing could grow to."]) {
    assert.notEqual(translateUiText(text, "zh-CN"), text, text);
    assert.equal(translateUiText(text, "en"), text);
  }
});

test("language: display translation preserves numbers, currencies and tickers", () => {
  const original = "VOO 1,234.56 MYR · 12.25% drift";
  const translated = translateUiText(original, "zh-CN");
  assert.match(translated, /VOO 1,234\.56 MYR/);
  assert.match(translated, /12\.25%/);
  assert.match(translated, /偏离/);
  assert.deepEqual(translated.match(/[\d,.]+/g), original.match(/[\d,.]+/g));
});

test("language: dynamic dates, step counts and market distances translate", () => {
  assert.equal(translateUiText("It's been 14 days since your last visit.", "zh-CN"), "距离上次使用已过 14 天。");
  assert.equal(translateUiText("Step 2", "zh-CN"), "档位 2");
  assert.equal(translateUiText("6.0% away", "zh-CN"), "距离触发还差 6.0%");
});

test("language: account names and user text never become dictionary entries", () => {
  for (const value of ["Budget", "Income", "Save", "My Emergency Fund", "<img src=x onerror=alert(1)>"]) {
    assert.equal(translateUiText(value, "zh-CN", [value]), value);
  }
  assert.equal(translateUiText("Account: Emergency Fund", "zh-CN", ["Emergency Fund"]), "账户: Emergency Fund");
});

test("language: user names embedded in display sentences remain in their original language", () => {
  assert.equal(translateUiText("Good evening, Budget", "zh-CN", ["Budget"]), "晚上好，Budget");
  assert.equal(translateUiText("Income 123.45 — My Save account", "zh-CN", ["My Save account"]), "收入 123.45 — My Save account");
});

test("language: user protection includes each line of multiline notes and does not mutate state", () => {
  const state = emptyState();
  state.profile.name = "Budget";
  state.ruleNotesList = [{ id: "note", title: "My rule", body: "Save\nIncome", createdAt: 0 }];
  const before = JSON.stringify(state);
  const values = userDisplayValues(state);
  assert.ok(values.includes("Budget"));
  assert.ok(values.includes("Save"));
  assert.ok(values.includes("Income"));
  assert.equal(JSON.stringify(state), before);
});

test("language: whitespace is preserved around translated multiline UI copy", () => {
  assert.equal(translateUiText("\n  Record income and spending,\n  see where the money goes.\n", "zh-CN"), "\n  记录收入与支出，看清资金去向。\n");
});

test("language: unknown external content has an unchanged fallback", () => {
  assert.equal(translateUiText("Vanguard Group Incorporated", "zh-CN"), "Vanguard Group Incorporated");
  assert.equal(translateUiText("1155.KL", "zh-CN"), "1155.KL");
  assert.equal(translateUiText("MYR 4.5m", "zh-CN"), "MYR 4.5m");
});

test("language: dynamic dip-buy validation stays fully readable in Chinese", () => {
  assert.equal(translateUiText("Step 2: enter a positive MYR amount with up to two decimals.", "zh-CN"), "档位 2：请输入大于零的 MYR 金额，最多两位小数。");
});

test("language: quote ages translate inside joined valuation notes", () => {
  const cases = [
    ["· last traded 13h ago", "· 上次成交在 13 小时前"],
    ["2 holdings · last traded 13h ago", "2 项持仓 · 上次成交在 13 小时前"],
    ["· last traded 45m ago", "· 上次成交在 45 分钟前"],
    ["· last traded 3d ago", "· 上次成交在 3 天前"],
    ["· last traded moments ago", "· 刚刚成交"],
  ];
  for (const [source, expected] of cases) {
    assert.equal(translateUiText(source, "zh-CN"), expected);
    assert.equal(translateUiText(source, "en"), source);
  }
  const personalNote = "last traded 13h ago";
  assert.equal(translateUiText(personalNote, "zh-CN", [personalNote]), personalNote);
});
