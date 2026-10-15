import assert from "node:assert/strict";
import { test } from "./testHarness";
import { cloneDefaultState, emptyState } from "../src/state";
import { getLanguage, setLanguage, setProtectedValuesProvider, translateSystemText, translateUiText } from "../src/i18n";
import { userDisplayValues } from "../src/interfaceLanguage";
import { amtIn } from "../src/html";
import { dashboardTemplate } from "../src/pages/dashboardPage";
import { ledgerTemplate } from "../src/pages/ledgerPage";
import { portfolioTemplate } from "../src/pages/portfolioPage";
import { bucketsTemplate } from "../src/pages/budgetPage";
import { goalsTemplate } from "../src/pages/goalsPage";
import { meTemplate } from "../src/pages/mePage";
import { reviewTemplate } from "../src/pages/reviewPage";
import { advisorPageTemplate } from "../src/pages/advisorPage";
import { moneyLeaksTemplate } from "../src/pages/moneyLeaksPage";
import { rulesTemplate } from "../src/pages/rulesPage";
import { settingsTemplate } from "../src/pages/settingsPage";
import { tvmCalculatorTemplate } from "../src/pages/tvmPage";
import { marketTemplate } from "../src/pages/marketPage";
import type { WealthState } from "../src/models";
import { liabilityFields } from "../src/components/liabilityForm";
import { incomeRoutingHint } from "../src/components/incomeRoutingHint";

function withChinese(check: () => void): void {
  const language = getLanguage();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    documentElement: { getAttribute: () => "light" },
    createElement: () => ({
      textContent: "",
      get innerHTML(): string { return this.textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
    }),
  } });
  setLanguage("zh-CN");
  try { check(); } finally {
    setLanguage(language);
    setProtectedValuesProvider(() => []);
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

const pages: Record<string, (state: WealthState) => string> = {
  home: dashboardTemplate, ledger: ledgerTemplate, portfolio: portfolioTemplate,
  budget: bucketsTemplate, goals: goalsTemplate, me: meTemplate, review: reviewTemplate,
  advisor: advisorPageTemplate, leaks: moneyLeaksTemplate, rules: rulesTemplate,
  settings: settingsTemplate, tvm: tvmCalculatorTemplate, market: marketTemplate,
  liabilityForm: () => liabilityFields(),
  incomeRouting: (state) => incomeRoutingHint(state, { amount: 123.45, date: "2026-10-15", sponsored: false }),
};

// Proper names, symbols, file formats and currency codes carry their original
// meaning. Ordinary interface words must not be added to this exception list.
const identifiers = /\b(?:MYR|USD|RM|HKD|SGD|GBP|EUR|JPY|CSV|JSON|ETF|ETFs|VOO|QQQM|VXUS|NVDA|AAPL|MSFT|AMZN|GOOGL|GOOG|AVGO|MU|META|TSLA|SI|AKPK|ASB|ASNB|EPF|EIR|KL|WealthUp|Moomoo|moomoo|Google|NVIDIA|Apple|Microsoft|Amazon|Alphabet-A|Alphabet-C|Broadcom|Micron Technology|Meta Platforms|Tesla)\b/g;
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", middot: "·", times: "×", minus: "−", rarr: "→", harr: "↔" };

for (const [name, template] of Object.entries(pages)) {
  test(`Chinese interface: ${name} has no English UI words in blank and seeded pages`, () => withChinese(() => {
    for (const state of [emptyState(), cloneDefaultState()]) {
      const before = JSON.stringify(state);
      const protectedValues = userDisplayValues(state);
      setProtectedValuesProvider(() => protectedValues);
      const html = template(state);
      const remaining: string[] = [];
      for (const match of html.matchAll(/>([^<>]+)</g)) {
        const text = match[1].replace(/&([a-z]+|#39);/g, (entity, key: string) => entities[key] ?? entity);
        const localized = translateUiText(text, "zh-CN", protectedValues);
        if (/[A-Za-z]{2}/.test(localized.replace(/\b(?:RM|MYR|USD)(?=\d)/g, "").replace(identifiers, ""))) remaining.push(localized.trim());
      }
      assert.deepEqual(remaining, [], `${name}: untranslated system copy`);
      assert.equal(JSON.stringify(state), before, "rendering cannot translate stored records");
    }
  }));
}

test("Chinese interface: seeded values translate, while renamed and custom records stay literal", () => {
  const state = cloneDefaultState();
  let protectedValues = userDisplayValues(state);
  assert.ok(!protectedValues.includes("Food"));
  assert.ok(!protectedValues.includes("Travel Fund"));
  assert.equal(translateUiText("Food", "zh-CN", protectedValues), "餐饮");
  assert.equal(translateUiText("Travel Fund", "zh-CN", protectedValues), "旅行基金");
  state.ledgerCategories[0].label = "My Food";
  state.ledgerAccounts.push({ id: "custom", name: "Growth", type: "bank", openingBalance: 123.45 });
  protectedValues = userDisplayValues(state);
  assert.equal(translateUiText("My Food", "zh-CN", protectedValues), "My Food");
  assert.equal(translateUiText("Growth", "zh-CN", protectedValues), "Growth");
});

test("Chinese interface: complete advice translates before monetary spans split the sentence", () => withChinese(() => {
  const state = emptyState();
  state.ledgerAccounts[0].name = "My Savings";
  setProtectedValuesProvider(() => userDisplayValues(state));
  const html = amtIn("Hold at least MYR 4,000 in the emergency fund.");
  assert.equal(html, '应急储备至少保留 <span class="t-amt">MYR 4,000</span>。');
  assert.equal(translateSystemText("My Savings is MYR 300 short"), "My Savings 尚缺 MYR 300");
}));

test("Chinese interface: DCA settings titles translate while user names, tickers and targets stay original", () => withChinese(() => {
  const state = cloneDefaultState();
  state.profile.name = "DCA targets";
  state.customTickers = ["VXUS"];
  state.dca.targets.VXUS = 0;
  const before = JSON.stringify(state);
  const values = userDisplayValues(state);
  setProtectedValuesProvider(() => values);
  const html = meTemplate(state);
  const targetRow = html.split('data-edit="targets"')[1]?.split("</button>")[0] ?? "";
  assert.ok(targetRow.includes('class="wu-set__title">定投目标比例<small>VOO · QQQM · VXUS</small>'));
  assert.ok(targetRow.includes('class="wu-set__value">70 / 30 / 0'));
  assert.equal(translateUiText(state.profile.name, "zh-CN", values), "DCA targets");
  assert.equal(JSON.stringify(state), before);
}));

test("Chinese interface: health factor labels translate independently of identically named user content", () => withChinese(() => {
  const state = emptyState();
  const labels = ["Safety buffer", "Cash flow", "Budget", "Plan execution", "Debt load"];
  state.ruleNotesList = labels.map((label, index) => ({ id: `note-${index}`, title: label, body: label, createdAt: 0 }));
  const before = JSON.stringify(state);
  const protectedValues = userDisplayValues(state);
  setProtectedValuesProvider(() => protectedValues);
  const html = dashboardTemplate(state);
  const health = html.split('aria-labelledby="ovHealthLabel"')[1]?.split("</section>")[0] ?? "";
  assert.ok(health.includes("<span>现金流</span>"));
  for (const label of labels) {
    assert.ok(!health.includes(`<span>${label}</span>`), label);
    assert.equal(translateUiText(label, "zh-CN", protectedValues), label, "user-authored names remain original");
  }
  assert.equal(JSON.stringify(state), before);
}));

test("Chinese interface: system advice titles translate even when identical text appears in personal notes", () => withChinese(() => {
  const state = emptyState();
  const title = "Opportunity Reserve remains separate";
  state.ruleNotesList = [{ id: "personal-note", title: "My note", body: title, createdAt: 0 }];
  const values = userDisplayValues(state);
  setProtectedValuesProvider(() => values);
  assert.equal(translateUiText(title, "zh-CN", values), title, "the user's note remains original");
  const html = advisorPageTemplate(state);
  assert.ok(html.includes("机会储备保持独立"), "the system recommendation has its own translation boundary");
  assert.ok(!html.includes(title));
  assert.equal(state.ruleNotesList[0].body, title);
  const homeState = cloneDefaultState();
  homeState.ruleNotesList = state.ruleNotesList;
  setProtectedValuesProvider(() => userDisplayValues(homeState));
  assert.match(dashboardTemplate(homeState), /id="ovPriorityTitle">机会储备保持独立<\/h3>/);
}));

test("Chinese interface: dynamic errors and confirmations keep values, names and precision", () => {
  const cases = [
    ["Largest drift is 8.5%.", "最大配置偏离为 8.5%。"],
    ["You have used today's Ask allowance.", "今天的提问使用次数已用完。"],
    ["Current amount must be a finite number.", "当前金额 必须为有限数值。"],
    ["Delete the Holiday Fund bucket?", "删除 Holiday Fund 资金桶吗？"],
    ["No USD → MYR rate yet", "暂无 USD 兑马币汇率"],
  ];
  for (const [source, expected] of cases) assert.equal(translateUiText(source, "zh-CN", ["Holiday Fund"]), expected);
  const sentence = "Recent My Food spending averages MYR 123.45 against a MYR 99.99 monthly plan.";
  const result = translateUiText(sentence, "zh-CN", ["My Food"]);
  assert.equal(result, "近期 My Food 每月平均支出 MYR 123.45，每月计划为 MYR 99.99。");
});
