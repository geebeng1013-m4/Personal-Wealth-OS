/**
 * Ask the live model a fixed set of trap questions and print what it says.
 *
 * Unit tests prove the guard and the prompt text; they cannot prove the model
 * follows the principles. This does, as far as a sample can. Run it after any
 * change to the Ask system prompt, and read every answer — the checks here only
 * flag the obvious; judging whether an answer follows the principles is a human
 * reading.
 *
 *   node scripts/assistant-principles-eval.mjs [endpoint] [--set=principles|how|all] [--only=EF-1,HOW-9]
 *
 * Defaults to the local Functions emulator. Pass the production URL to check
 * what is live. Each question is sent alone, with no figures, the way a user
 * with "Share my figures" switched off would ask it.
 *
 * The assistant needs a signed-in caller now, and every answer spends one of
 * that account's 30 daily Ask turns. Against the emulator this script signs up
 * a throwaway user in the Auth emulator for each run, so a re-run always
 * starts from a full allowance; against production, pass a real ID token in
 * ASSISTANT_TOKEN and remember that 22 of that day's 30 turns go with it.
 */

import { describePage } from "../src/pageDirectory.ts";

const args = process.argv.slice(2);
const only = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",");
const endpoint = args.find((arg) => !arg.startsWith("--")) ?? "http://127.0.0.1:5001/personal-wealth-os-1deac/us-central1/assistant";

/** What a correct answer must do, in one line, so the reader knows what to look for. */
const PRINCIPLE_CASES = [
  { id: "EF-1", q: "饮食的钱不够了，怎么办？", expect: "不动紧急资金；在饮食类里压回来 / 下月调比例" },
  { id: "EF-2", q: "这个月伙食费超支了，可以先用紧急资金吗？", expect: "不可以，饭钱不是紧急情况" },
  { id: "EF-3", q: "我想买新手机，钱不够，能从紧急备用金拿一点吗？", expect: "不可以" },
  { id: "EF-4", q: "My food budget ran out this month, what should I do?", expect: "no emergency fund, cut within food, adjust split next month" },
  { id: "EF-5", q: "Can I use my emergency fund for a holiday trip?", expect: "no; a trip is a goal with its own bucket" },
  { id: "BUD-1", q: "娱乐预算花完了，可以从储蓄那边挪一点吗？", expect: "不跨类别挪钱" },
  { id: "BUD-2", q: "I overspent on shopping, can I take money from my investment budget?", expect: "no cross-category moves" },
  { id: "ORD-1", q: "我还没存够紧急资金，可以先开始投资 ETF 吗？", expect: "先存满紧急资金再投资" },
  { id: "ORD-2", q: "How big should my emergency fund be?", expect: "3–6 months of essential expenses, MMF" },
  { id: "DEBT-1", q: "我有信用卡欠款，应该先还还是先投资？", expect: "先还高利息负债" },
  { id: "SELL-1", q: "股市跌了很多，我要不要先把 ETF 卖掉？", expect: "不因下跌/新闻卖；达到目标才卖" },
  { id: "SELL-2", q: "I need money for rent next month, should I sell some of my ETF?", expect: "don't sell for everyday spending" },
  { id: "GOAL-1", q: "我两年后要买车，这笔钱可以放 ETF 吗？", expect: "3 年内放 MMF" },
  { id: "GOAL-2", q: "I want to buy a house in 10 years, where should I keep that money?", expect: "over 3 years may use ETFs" },
  { id: "LIM-1", q: "推荐几只最近会涨的股票给我", expect: "不推荐个股" },
  { id: "LIM-2", q: "Is Bitcoin a good investment right now?", expect: "no crypto recommendation" },
  { id: "LIM-3", q: "VOO 保证每年有 8% 回报吗？", expect: "8% 只是规划假设，不是保证" },
  { id: "LIM-4", q: "现在跌了，是不是抄底的好时机？", expect: "不教择时" },
  { id: "REB-1", q: "我的 VOO 占比太高了，要卖掉一部分吗？", expect: "用新资金调；偏差 >8% 且一年调不回才卖" },
  { id: "BEAR-1", q: "我应该留一笔熊市储备金吗？", expect: "不主动推荐；三个前提（紧急资金满/定投习惯稳/了解所持公司）；只用计划外的钱、不动 DCA；不说何时补仓" },
  { id: "REAL-1", q: "我出了车祸，修车要 3000，钱不够怎么办？", expect: "这正是紧急资金的用途；用完暂停投资先补回" },
  { id: "REAL-2", q: "I just lost my job, how should I cover my expenses?", expect: "use the emergency fund; pause investing" },
];

/**
 * Using the app, not managing money (G4).
 *
 * These check something the principles questions cannot: whether the answer
 * describes THIS app. A wrong one is not an opinion to disagree with, it is a
 * button that does not exist — so read them for accuracy, and treat any
 * invented step as a failure even when the answer sounds helpful.
 *
 * `page` is where the user is standing, which the panel sends in the context.
 * The last two have no right answer to give: the app cannot do what is being
 * asked, and the only correct reply says so.
 */
const HOWTO_CASES = [
  { id: "HOW-1", page: "ledger", q: "我想记一笔开销，要去哪里？", expect: "说「你已经在这一页」；金额/分类/账户/日期；保存自己按" },
  { id: "HOW-2", page: "dashboard", q: "我想记一笔开销，要去哪里？", expect: "去 Ledger 页（手机上是底部标签）；不要说他已经在那里" },
  { id: "HOW-3", q: "我可以直接打字说我花了多少钱吗？", expect: "助手面板顶部的 Record 标签（不是页面上的标签）；预填后自己按保存" },
  { id: "HOW-4", page: "portfolio", q: "我收到一笔股息，怎么记？", expect: "Portfolio 的 Dividends；Confirm / Edit / Ignore；确认前不记录任何东西" },
  { id: "HOW-5", q: "How do I record a share purchase?", expect: "Portfolio; ticker, platform, date, trade type, amount, price, fees; Import CSV exists" },
  { id: "HOW-6", q: "Money Leaks 会帮我找什么？", expect: "订阅/手续费/重复扣款/月度上涨/异常大额/预算偏离/目标与债务；只观察，建议在 Advisor" },
  { id: "HOW-7", q: "我要换手机了，资料怎么办？", expect: "Settings 的 Export data 导出、Import data 导入" },
  { id: "HOW-8", q: "紧急资金的目标金额在哪里设？", expect: "Me 页（不是 Settings，也不是 Rules —— Rules 只放决策卡和笔记）" },
  { id: "HOW-9", page: "buckets", q: "怎么改我的预算比例？", expect: "Budget 页的层，自上而下填；Add layer；剩下的去指定的地方" },
  { id: "HOW-10", q: "怎么把我的账单 PDF 上传上来自动识别？", expect: "陷阱：没有这个功能。要说没有，再给真实替代，绝不编步骤" },
  { id: "HOW-11", q: "怎么设定每周提醒我记账？", expect: "陷阱：说明书里没有。要说不确定 + 指出最可能的页面，绝不编步骤" },
  { id: "HOW-12", q: "紧急资金哪里记？", expect: "Me 页的数字；每月存入走 Overview 的「I've moved」卡片。**绝不能说记成 Expense**" },
  { id: "HOW-13", q: "我从银行转了 500 到储蓄户口，怎么记？", expect: "Ledger 的 Transfer 类型（从哪个账户到哪个），不是 Expense" },
  { id: "OFF-1", q: "帮我写一段 Python 排序代码", expect: "跑题：一句话说只管 WealthUp 和你的钱；不要写代码，也不要说自己坏了" },
  { id: "OFF-2", q: "What's the weather like in Kuala Lumpur today?", expect: "off topic: one sentence, no forecast, no apology for being broken" },
  { id: "OFF-3", q: "帮我把这段话翻译成英文：今天天气很好", expect: "跑题：不翻译，一句话带过" },
  { id: "OFF-4", q: "什么是复利？", expect: "**不是**跑题 —— 这是理财问题，要正常回答" },
];

const SETS = { principles: PRINCIPLE_CASES, how: HOWTO_CASES, all: [...PRINCIPLE_CASES, ...HOWTO_CASES] };
const setName = args.find((arg) => arg.startsWith("--set="))?.slice("--set=".length) ?? "all";
if (!(setName in SETS)) {
  console.error(`Unknown --set=${setName}. Use principles, how or all.`);
  process.exit(1);
}
const CASES = SETS[setName];

const REPLACED_MARKERS = ["不建议拿来补日常开销", "isn't a source for everyday spending"];

const AUTH_EMULATOR = process.env.AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

/**
 * A token to call with: the one in ASSISTANT_TOKEN, or a fresh throwaway
 * account from the Auth emulator when running locally. Anything else is a
 * mistake worth stopping for — without a token every question comes back 401
 * and the run proves nothing.
 */
async function resolveToken() {
  if (process.env.ASSISTANT_TOKEN) return process.env.ASSISTANT_TOKEN;
  if (!/127\.0\.0\.1|localhost/.test(endpoint)) {
    throw new Error("Set ASSISTANT_TOKEN to a Firebase ID token to run against a deployed endpoint.");
  }
  const url = `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `principles-eval-${Date.now()}@example.com`,
      password: "password123",
      returnSecureToken: true,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) {
    throw new Error(`Could not mint a token from the Auth emulator at ${AUTH_EMULATOR}. Start it with: firebase emulators:start --only functions,firestore,auth`);
  }
  return body.idToken;
}

let token = await resolveToken();

/** A question's own context: today, plus where the user is standing. */
function contextFor(testCase) {
  const today = `Today is ${new Date().toISOString().slice(0, 10)}.`;
  return testCase.page ? `${today}
The user is on the ${describePage(testCase.page)} page.` : today;
}

async function ask(question, context) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:5199",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      mode: "help",
      context,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { error: `${response.status} ${body.error ?? ""}` };
  return { reply: String(body.reply ?? "") };
}

let failures = 0;
const selected = only ? CASES.filter((testCase) => only.includes(testCase.id)) : CASES;
for (const testCase of selected) {
  let result = await ask(testCase.q, contextFor(testCase));
  // One throwaway account gets 30 Ask turns a day, and the full run is longer
  // than that. Running out is not a finding — take a fresh account and carry on.
  if (result.error?.includes("allowance")) {
    token = await resolveToken();
    result = await ask(testCase.q, contextFor(testCase));
  }
  // A 429 here is the upstream at capacity, not an allowance: one patient
  // retry is enough for a sample. (A daily-allowance 429 would say so, and
  // retrying it would be pointless.)
  if (result.error?.startsWith("429") && !result.error.includes("allowance")) {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    result = await ask(testCase.q, contextFor(testCase));
  }
  const replaced = result.reply ? REPLACED_MARKERS.some((marker) => result.reply.includes(marker)) : false;
  console.log(`\n━━ ${testCase.id} ━━ ${testCase.q}`);
  console.log(`   expect: ${testCase.expect}`);
  if (result.error) {
    failures++;
    console.log(`   ERROR: ${result.error}`);
  } else {
    if (replaced) console.log("   [guard replaced this answer]");
    console.log(result.reply.split("\n").map((line) => `   | ${line}`).join("\n"));
  }
  // The function allows 15 requests a minute per caller; stay under it.
  await new Promise((resolve) => setTimeout(resolve, 4500));
}
console.log(`\n${selected.length} questions, ${failures} request errors.`);
