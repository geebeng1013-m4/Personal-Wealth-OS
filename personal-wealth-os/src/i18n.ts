import { ZH_CN } from "./locales/zhCN";
import { ZH_CN_COMPLETE } from "./locales/zhCNComplete";
import { ZH_CN_TEMPLATES } from "./locales/zhCNTemplates";

export type Language = "en" | "zh-CN";
const LANGUAGE_KEY = "pwo-language";
let protectedValuesProvider: () => readonly string[] = () => [];

/** The renderer supplies user copy without coupling formatters to persisted state. */
export function setProtectedValuesProvider(provider: () => readonly string[]): void {
  protectedValuesProvider = provider;
}

export function translateSystemText(value: string): string {
  return translateUiText(value, getLanguage(), protectedValuesProvider());
}

const chinese: Readonly<Record<string, string>> = {
  ...ZH_CN,
  ...ZH_CN_COMPLETE,
  "Wealth": "财富", "Money": "资金", "Intelligence": "分析", "Tools": "工具", "System": "系统",
  "Overview": "总览", "Home": "首页", "Portfolio": "投资组合", "Goals": "目标", "Market": "市场",
  "Ledger": "账本", "Budget": "预算", "Money Leaks": "支出漏洞", "Advisor": "规划助手",
  "Review": "月度复盘", "Rules": "规则", "TVM Calculator": "货币时间价值", "Investment Growth": "投资增长",
  "Me": "我的", "Settings": "设置", "More": "更多",
  "Financial command centre": "财务概况与下一步", "Investments & activity": "投资持仓与交易",
  "Progress & targets": "目标与进度", "Research when needed": "按需查看市场资料",
  "Income & expenses": "收入与支出", "Fund allocation": "资金分配", "Detected cash-flow drag": "发现现金流中的额外支出",
  "Guidance & scenarios": "规划建议与情境分析", "Monthly check-in": "每月回顾", "Decision framework": "决策框架",
  "Time value of money": "现值与未来价值", "Contribution projections": "定期投入估算", "About you": "个人资料与计划",
  "Configuration": "偏好设置", "Everything else WealthUp does.": "探索 WealthUp 的其他功能。",
  "Back to More": "返回更多", "Primary": "主导航", "Primary navigation": "主导航", "Open navigation": "打开导航",
  "check-ins due": "项待完成的检查", "Wealth Mandate": "财富计划", "Wealth Mandate: open Me": "财富计划：打开我的页面",
  "For guidance only — not financial advice.": "仅供规划参考，不构成投资建议。",
  "Privacy, your data and how the app looks.": "管理隐私、数据和界面偏好。",
  "Mask amounts on screen": "隐藏屏幕上的金额", "Confirm before exporting": "导出前确认",
  "Privacy": "隐私", "Data": "数据", "Theme": "主题", "Light": "浅色", "Dark": "深色",
  "Export data": "导出数据", "Import data": "导入数据", "Version history": "版本历史", "Add to Home Screen": "添加到主屏幕",
  "Language": "语言", "This browser only. Some pages are still in English.": "应用于此浏览器；部分页面暂时保留英文。",
  "Applies to this browser.": "应用于此浏览器。",
  "Could not save the language preference. Check this browser's storage settings and try again.": "无法保存语言偏好，请检查浏览器的存储设置后重试。",
  "Danger zone": "谨慎操作", "Reset all data": "重置所有数据",
  "Reset clears every record on this device and in the cloud. A copy is saved to Version History first.": "重置会清空此设备和云端的全部记录。操作前会先保存一份副本到版本历史。",
  "Export a file containing your financial data? Store it securely.": "要导出包含财务数据的文件吗？请妥善保管。",
  "Replace all your data with this file? Your current data will be saved to Version History first.": "要用此文件替换全部数据吗？当前数据会先保存到版本历史。",
  "Reset to a blank Personal Wealth OS? Your current data will be saved to Version History first, and can be restored from there.": "要重置为空白账户吗？当前数据会先保存到版本历史，之后可以从那里恢复。",
};

/** A device preference, deliberately outside financial state and cloud sync. */
export function getLanguage(): Language {
  try { return localStorage.getItem(LANGUAGE_KEY) === "zh-CN" ? "zh-CN" : "en"; }
  catch { return "en"; }
}

export function displayLocale(): string {
  return getLanguage() === "zh-CN" ? "zh-CN" : "en-MY";
}

export function setLanguage(value: string): boolean {
  if (value !== "en" && value !== "zh-CN") return false;
  try { localStorage.setItem(LANGUAGE_KEY, value); return true; }
  catch { return false; }
}

/** Exact keys only: never translates user notes, tickers, account names or route IDs. */
export function t(english: string, language = getLanguage()): string {
  return language === "zh-CN" && Object.hasOwn(chinese, english) ? chinese[english] : english;
}

export function checkinsDueText(count: number): string {
  return getLanguage() === "zh-CN" ? `${count} ${t("check-ins due")}` : `${count} check-in${count === 1 ? "" : "s"} due`;
}

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phrases = Object.keys(chinese).filter((key) => key !== chinese[key]).sort((a, b) => b.length - a.length);
const phrasePattern = new RegExp(`(?<![A-Za-z])(?:${phrases.map(escapePattern).join("|")})(?![A-Za-z])`, "g");

const sentencePatterns = ZH_CN_TEMPLATES.map(([source, translated]) => {
  const slots: number[] = [];
  const parts = source.split(/\{(\d+)\}/g).map((part, index) => {
    if (index % 2) { slots.push(Number(part)); return "(.*?)"; }
    return escapePattern(part).replace(/\s+/g, "\\s*");
  });
  return { pattern: new RegExp(`^${parts.join("")}$`), translated, slots, specificity: source.replace(/\{\d+\}/g, "").length };
}).sort((a, b) => b.specificity - a.specificity);

/** Translate display fragments around amounts; placeholders and user copy stay intact. */
export function translateUiText(value: string, language = getLanguage(), protectedValues: readonly string[] = []): string {
  if (language !== "zh-CN" || !/[A-Za-z]/.test(value)) return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (protectedValues.some((text) => text.trim() === normalized)) return value;
  const protectedParts: string[] = [];
  let text = value;
  for (const part of protectedValues) {
    if (!part || part.length < 3 || !text.includes(part)) continue;
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapePattern(part)}(?![A-Za-z0-9])`, "g");
    text = text.replace(pattern, (match) => {
      protectedParts.push(match);
      return `\uE000${protectedParts.length - 1}\uE001`;
    });
  }
  const trim = text.replace(/\s+/g, " ").trim();
  if (Object.hasOwn(chinese, trim)) text = `${text.match(/^\s*/)?.[0] ?? ""}${chinese[trim]}${text.match(/\s*$/)?.[0] ?? ""}`;
  else {
    const sentence = sentencePatterns.find(({ pattern }) => pattern.test(trim));
    if (sentence) {
      const matches = sentence.pattern.exec(trim)!;
      const translated = sentence.translated.replace(/\{(\d+)\}/g, (_match, index: string) => {
        const position = sentence.slots.indexOf(Number(index));
        return position < 0 ? "" : translateUiText(matches[position + 1], language);
      });
      text = `${text.match(/^\s*/)?.[0] ?? ""}${translated}${text.match(/\s*$/)?.[0] ?? ""}`;
    } else text = translateVariableCopy(text).replace(phrasePattern, (key) => chinese[key]);
  }
  return text.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => protectedParts[Number(index)]);
}

function translateVariableCopy(text: string): string {
  return text
    .replace(/\blast traded moments ago\b/g, "刚刚成交")
    .replace(/\blast traded (\d+)m ago\b/g, "上次成交在 $1 分钟前")
    .replace(/\blast traded (\d+)h ago\b/g, "上次成交在 $1 小时前")
    .replace(/\blast traded (\d+)d ago\b/g, "上次成交在 $1 天前")
    .replace(/It's been (\d+) days since your last visit\./g, "距离上次使用已过 $1 天。")
    .replace(/Good (morning|afternoon|evening), /g, (_match, time: string) => `${t(`Good ${time}`, "zh-CN")}，`)
    .replace(/(\d+) check-ins? due/g, "$1 项待完成的检查")
    .replace(/Step (\d+): enter a drawdown greater than 0 and at most 100%, with up to two decimals\./g, "档位 $1：跌幅需大于 0 且不超过 100%，最多两位小数。")
    .replace(/Step (\d+): enter a positive MYR amount with up to two decimals\./g, "档位 $1：请输入大于零的 MYR 金额，最多两位小数。")
    .replace(/Step (\d+)/g, "档位 $1")
    .replace(/Year (\d+)/g, "第 $1 年")
    .replace(/Month (\d+)/g, "第 $1 个月")
    .replace(/Across (\d+)/g, "共 $1")
    .replace(/Into (\d+) open goals/g, "分配至 $1 个进行中的目标")
    .replace(/is reserved for (.+) deployment rules\./g, "按 $1 档位规则预留。")
    .replace(/Deploy in (\d+) steps as prices fall/g, "价格下跌时分 $1 档投入")
    .replace(/(\d+(?:\.\d+)?)% moves with exchange rates\./g, "$1% 的持仓受汇率变动影响。")
    .replace(/(\d+) open goals/g, "$1 个进行中的目标")
    .replace(/(\d+)d ago/g, "$1 天前")
    .replace(/(\d+) of (\d+)/g, "$1／$2")
    .replace(/(\d+(?:\.\d+)?)% away/g, "距离触发还差 $1%")
    .replace(/(\d+) holdings?/g, "$1 项持仓")
    .replace(/(\d+) payouts? recorded/g, "已记录 $1 次派息")
    .replace(/(\d+) trades?/g, "$1 笔交易")
    .replace(/(\d+) transactions?/g, "$1 笔交易")
    .replace(/(\d+) records?/g, "$1 条记录")
    .replace(/(\d+) goals?/g, "$1 个目标")
    .replace(/(\d+) months?/g, "$1 个月")
    .replace(/(\d+) years?/g, "$1 年")
    .replace(/(\d+) days?/g, "$1 天")
    .replace(/(\d+) notes?/g, "$1 条备注")
    .replace(/(\d+) to watch/g, "$1 项需留意")
    .replace(/Largest drift/g, "最大偏离")
    .replace(/Reserve split:/g, "储备分配：")
    .replace(/left of/g, "剩余／总额")
    .replace(/below their highs\./g, "低于历史高点。")
    .replace(/Checking (.+) against their all-time highs…/g, "正在比较 $1 与历史高点…")
    .replace(/Replace the (.+) review\?/g, "替换 $1 的复盘记录吗？")
    .replace(/Clear all (\d+) ledger transactions, including records outside the current filters\? Account balances and totals will be recalculated\. A snapshot will be saved to Version History first\./g, "清空全部 $1 笔账本交易，包括当前筛选范围外的记录吗？账户余额和合计将重新计算，并先保存快照到版本历史。")
    .replace(/Last (\d+)/g, "最近 $1")
    .replace(/All steps \(/g, "全部步骤（")
    .replace(/\bReserve: /g, "储备：")
    .replace(/Amounts are for each whole step\. Deployed steps stay locked\./g, "金额为每一整档的投入，已投入档位保持锁定。")
    .replace(/Deployed — locked/g, "已投入 · 锁定")
    .replace(/Save as/g, "保存为")
    .replace(/Income /g, "收入 ")
    .replace(/spent /g, "支出 ")
    .replace(/Target /g, "目标 ")
    .replace(/Opening /g, "期初 ")
    .replace(/Current /g, "当前 ")
    .replace(/Annual rate/g, "年利率")
    .replace(/before fees/g, "费用前")
    .replace(/with dividends/g, "含股息")
    .replace(/If sold today/g, "若今天卖出")
    .replace(/Est\. sell fees/g, "预计卖出费用")
    .replace(/After fees/g, "费用后")
    .replace(/Savings rate/g, "储蓄率")
    .replace(/\bmo\b/g, "月");
}
