import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  REPLACEMENT_EN,
  REPLACEMENT_ZH,
  breaksEmergencyFundRule,
  clauses,
  describesRealEmergency,
  guardHelpReply,
} from "../functions/src/answerGuard";
import { SYSTEM_PROMPT } from "../functions/src/deepseekRequest";

const ASK_ZH = "饮食的钱不够了，怎么办？";
const ASK_EN = "My food budget ran out this month, what should I do?";

// --- the answer that reached a user in production ------------------------

test("answer guard: catches the exact answer that reached a user in production", () => {
  // It opens with 不足 — a guard that treated the bare 不 as negation let it through.
  const reply = "饮食资金不足的话，可以先从紧急资金挪一点出来应急。";
  assert.equal(breaksEmergencyFundRule(reply, ASK_ZH), true);
});

// --- advice to take everyday money out of the fund: caught ---------------

test("answer guard: catches Chinese advice to draw on the fund", () => {
  for (const reply of [
    "你可以动用紧急备用金来补足这个月的伙食费。",
    "暂时用应急资金垫一下饭钱。",
    "从紧急资金里拿一点补饭钱。",
    "建议先借用一部分急用金，发薪后再调整。",
    "这个月的伙食费，紧急资金可以先垫上。",
  ]) {
    assert.equal(breaksEmergencyFundRule(reply, ASK_ZH), true, reply);
  }
});

test("answer guard: catches English advice to draw on the fund", () => {
  for (const reply of [
    "You could dip into your emergency fund to cover groceries this month.",
    "Consider using some of your emergency savings for food until payday.",
    "Take a little money from your emergency fund to cover the shortfall.",
    "Your emergency fund can cover the extra food costs this month.",
    "Just draw on your safety buffer until your next paycheck.",
  ]) {
    assert.equal(breaksEmergencyFundRule(reply, ASK_EN), true, reply);
  }
});

test("answer guard: a promise to refill later does not excuse the withdrawal", () => {
  assert.equal(breaksEmergencyFundRule("从紧急资金里拿一点补饭钱，但下个月记得补回去。", ASK_ZH), true);
  assert.equal(breaksEmergencyFundRule("Borrow from your emergency fund, but refill it next month.", ASK_EN), true);
});

test("answer guard: one bad sentence inside a longer answer is enough", () => {
  const reply = [
    "先看看记账，找出这个月哪几笔外食花得多。",
    "如果实在不够，可以先从紧急资金挪一点出来。",
    "以上并非投资建议。",
  ].join("\n");
  assert.equal(breaksEmergencyFundRule(reply, ASK_ZH), true);
});

// --- correct answers that mention the fund: passed through ----------------
// The guard is only acceptable if it leaves the answers we want alone.

test("answer guard: leaves the replacement answers themselves alone", () => {
  assert.equal(breaksEmergencyFundRule(REPLACEMENT_ZH, ASK_ZH), false);
  assert.equal(breaksEmergencyFundRule(REPLACEMENT_EN, ASK_EN), false);
});

test("answer guard: leaves Chinese answers that protect the fund alone", () => {
  for (const reply of [
    "紧急资金只用于车祸、失业、意外等真正的紧急情况。",
    "不建议动用紧急资金来补饭钱。",
    "别从紧急资金里挪钱，先在饮食这一类里压回来。",
    "紧急资金不属于日常开销的来源，饭钱不够要从预算里调整。",
    "你的紧急资金已经存满了，可以开始投资。",
    "每个月把 20% 存入紧急资金，存满之前先不投资。",
    "饮食的钱不够的话，先看记账里哪几笔花多了。",
    "紧急资金用掉之后，要先补回来再恢复投资。",
  ]) {
    assert.equal(breaksEmergencyFundRule(reply, ASK_ZH), false, reply);
  }
});

test("answer guard: leaves English answers that protect or build the fund alone", () => {
  for (const reply of [
    "Don't use your emergency fund for food.",
    "Use the emergency fund only for real emergencies.",
    "Keep your emergency fund intact and cut back on eating out this month.",
    "It will take about 15 months to fill your emergency fund.",
    "Once the emergency fund is full, move the 20% into ETFs.",
    "Put 20% of your income into your emergency fund each month.",
    "Your emergency fund is 60% funded.",
    "The emergency fund is not for everyday spending like groceries.",
  ]) {
    assert.equal(breaksEmergencyFundRule(reply, ASK_EN), false, reply);
  }
});

// --- a real emergency: using the fund is the right answer ----------------

test("answer guard: a real emergency in the question switches the check off", () => {
  assert.equal(describesRealEmergency("我出了车祸，修车的钱不够"), true);
  assert.equal(describesRealEmergency("I was laid off last week, how do I pay rent?"), true);
  assert.equal(describesRealEmergency(ASK_ZH), false, "food money is not an emergency");

  assert.equal(breaksEmergencyFundRule("这种情况可以动用紧急资金。", "我出了车祸，修车的钱不够"), false);
  assert.equal(breaksEmergencyFundRule("This is what your emergency fund is for — use your emergency fund to cover rent.", "I was laid off last week, how do I pay rent?"), false);
});

// --- what the user receives ------------------------------------------------

test("answer guard: a breaking answer is replaced in the user's language", () => {
  const zh = guardHelpReply("可以先从紧急资金挪一点出来。", ASK_ZH);
  assert.equal(zh.replaced, true);
  assert.equal(zh.reply, REPLACEMENT_ZH);

  const en = guardHelpReply("Dip into your emergency fund for groceries.", ASK_EN);
  assert.equal(en.replaced, true);
  assert.equal(en.reply, REPLACEMENT_EN);
});

test("answer guard: a good answer comes back unchanged", () => {
  const reply = "紧急资金只用于真正的紧急情况。先看记账里哪几笔外食花多了，这个月在饮食里压回来。（非投资建议）";
  const result = guardHelpReply(reply, ASK_ZH);
  assert.equal(result.replaced, false);
  assert.equal(result.reply, reply);
});

test("answer guard: the replacements follow the principles they stand in for", () => {
  for (const text of [REPLACEMENT_ZH, REPLACEMENT_EN]) {
    assert.ok(/紧急|emergency/i.test(text), "names the emergency fund rule");
    assert.ok(/类别|同一类|category/i.test(text), "names the no-cross-category budget rule");
    assert.ok(/投资建议|financial advice/i.test(text), "carries the disclaimer");
  }
});

test("answer guard: clauses split on sentence ends and on 'but'", () => {
  assert.deepEqual(clauses("先看记账。然后压回来！"), ["先看记账。", "然后压回来！"]);
  assert.equal(clauses("从紧急资金拿一点，但下个月补回。").length, 2);
  assert.equal(clauses("Borrow from it, but refill later.").length, 2);
});

// --- the principles are actually in the prompt ---------------------------

test("assistant prompt: carries all six WealthUp principles and their order of priority", () => {
  for (const needle of [
    "WEALTHUP PRINCIPLES",
    "Priority: WealthUp principles, then the user's own rules, then general knowledge",
    "NEVER covered by taking money from another",
    "ONLY for real emergencies",
    "3 to 6 months of ESSENTIAL expenses",
    "money market fund",
    "high-interest debt",
    "Sell only when a financial goal is",
    "drift is above 8%",
    "3 years away",
    "Never recommend individual stocks",
    "Do not",
    "bear-market reserve",
    "not financial advice",
  ]) {
    assert.ok(SYSTEM_PROMPT.includes(needle), `prompt is missing: ${needle}`);
  }
});

test("assistant prompt: tells the model to answer in the user's language", () => {
  assert.ok(SYSTEM_PROMPT.includes("same language the user writes in"));
});
