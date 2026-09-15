/**
 * A last check on Ask answers for the one mistake WealthUp must never deliver:
 * telling someone to use their emergency fund for everyday spending.
 *
 * The principles in the system prompt are the real fix — they are what make the
 * model answer well. This exists because a model sometimes ignores its prompt,
 * and this particular answer was caught in production ("饮食资金不足的话，可以先
 * 从紧急资金挪一点出来应急"). It is deliberately narrow: one rule, checked clause by
 * clause, and everything else passes through untouched. It is not a general
 * content filter and should not grow into one.
 *
 * Being narrow means being careful with the correct answers, which mention the
 * emergency fund too — "don't use your emergency fund for food" is exactly what we
 * want said. So a clause is flagged only when it pairs the fund with taking money
 * OUT of it, and carries no negation, restriction or refill. A genuine emergency in
 * the user's own message ("my car was in an accident") switches the check off,
 * because then using the fund is the right advice.
 *
 * Two traps this is written around:
 *   - The word 不 cannot count as negation on its own: the production answer
 *     itself opens with 不足 ("not enough"), and a naive check waved it through.
 *   - "Move 20% into your emergency fund" is good advice; direction matters, so
 *     the withdrawal patterns require taking money FROM the fund.
 *
 * Pure and dependency-free, like the rest of this directory's shaping code.
 */

const FUND_EN = String.raw`(?:emergency|safety)\s+(?:fund|funds|savings|money|cash|buffer|bucket|reserve|reserves|account|net)`;
const FUND_ZH = String.raw`(?:紧急(?:资金|备用金|基金|储备|存款|金)|应急(?:资金|金|钱|基金|储备)|急用金|备用金)`;

/** Taking money out of the fund — verb and fund together, so direction is explicit. */
const WITHDRAW_PATTERNS: RegExp[] = [
  // "dip into / tap / use / draw on / withdraw from / borrow from ... your emergency fund"
  new RegExp(String.raw`\b(?:use|using|dip(?:ping)?\s+into|tap(?:ping)?(?:\s+into)?|draw(?:ing)?\s+(?:on|from|down)|withdraw(?:ing)?(?:\s+from)?|borrow(?:ing)?\s+from|rely(?:ing)?\s+on|lean(?:ing)?\s+on|fall(?:ing)?\s+back\s+on)\s+(?:\w+\s+){0,4}?${FUND_EN}`, "i"),
  // "take / pull / move / transfer (some money) from / out of your emergency fund"
  new RegExp(String.raw`\b(?:take|taking|pull|pulling|move|moving|transfer|transferring|shift|shifting|get|getting)\s+(?:\w+\s+){0,4}?(?:from|out\s+of)\s+(?:\w+\s+){0,3}?${FUND_EN}`, "i"),
  // "your emergency fund can cover / pay for the groceries"
  new RegExp(String.raw`${FUND_EN}\s+(?:\w+\s+){0,3}?(?:to\s+cover|to\s+pay|cover|covers|pay\s+for|pays\s+for|can\s+cover|could\s+cover|for\s+(?:food|groceries|meals|rent|bills|shopping|travel|the\s+shortfall|the\s+gap))\b`, "i"),
  // 从/用/动用/挪用/拿/借/调用/支取 ... 紧急资金
  new RegExp(String.raw`(?:从|用|动用|挪用|拿|借|调用|支取|提取|先用|暂用)[^，。！？；\n]{0,6}?${FUND_ZH}`),
  // 紧急资金(里/中) ... 挪/拿/借/取/抽/调/垫/补/支付
  new RegExp(String.raw`${FUND_ZH}[^，。！？；\n]{0,6}?(?:挪|拿|借|取|抽|调|垫|支付|补贴|补足|应付|顶上|填补)`),
];

/**
 * Negation or restriction. Chinese negations are listed as words, never the bare
 * 不, so 不足 / 不够 / 不少 in the advice itself do not read as "don't".
 */
const NEGATION_PATTERNS: RegExp[] = [
  /\b(?:not|never|don't|dont|do not|doesn't|does not|shouldn't|should not|mustn't|must not|can't|cannot|won't|avoid|avoiding|instead of|rather than|only|except|unless|reserved for|meant for|keep it for|intact|untouched|protect|preserve|leave it alone|isn't|is not|aren't)\b/i,
  /不要|不建议|不应|不该|不能|不可|不宜|不用|不必|不会|不是|不属于|不对|不妥|不合适|不去|不动|不碰|不挪|不拿|不借|别|切勿|千万|勿|避免|禁止|而不是|而非|只用于|只能|只可|只在|仅用于|仅限|仅在|除非|留给|专门|保留|保住|守住|留着/,
];

/** Money going into the fund — never a breach. */
const DEPOSIT_PATTERNS: RegExp[] = [
  // "into" only counts after a deposit verb — "dip into your emergency fund" is a withdrawal.
  /\b(?:put|putting|move|moving|transfer|transferring|save|saving|add|adding|direct|directing|send|sending)\s+(?:\S+\s+){0,5}?into\b/i,
  /\b(?:top\s*up|topping\s*up|refill|refilling|rebuild|rebuilding|replenish|replenishing|build\s*up|building\s*up|fill|filling|contribute|contributing|pay\s+back|paying\s+back)\b/i,
  /存入|存进|补回|补满|补足紧急|存满|存到|放进|放入|还回|填回/,
];

/** A real emergency in the user's own words. Using the fund is then correct. */
const EMERGENCY_PATTERNS: RegExp[] = [
  /\b(?:accident|crash|crashed|hospital|hospitali[sz]ed|surgery|medical|injur(?:y|ed)|illness|sick|laid\s*off|lost\s+my\s+job|job\s+loss|unemployed|fired|redundan(?:t|cy)|emergency\s+repair|flood|fire|funeral)\b/i,
  /车祸|意外|事故|住院|医院|手术|急诊|生病|受伤|失业|被裁|裁员|丢了工作|没了工作|丧事|水灾|火灾|紧急维修/,
];

const matchesAny = (patterns: RegExp[], text: string): boolean => patterns.some((pattern) => pattern.test(text));

/**
 * Split into clauses: sentence ends, line breaks, and "but" boundaries. Splitting
 * on "but" matters — "borrow from the emergency fund, but refill it next month"
 * must not have its withdrawal excused by the refill in the other half.
 */
export function clauses(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？；;])\s*|\n+|，\s*(?:但是|但|不过|可是)|,\s*(?:but|however)\b|;\s*however\b/i)
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0);
}

/** Whether one clause advises taking money out of the emergency fund. */
export function clauseBreaksEmergencyRule(clause: string): boolean {
  if (!matchesAny(WITHDRAW_PATTERNS, clause)) return false;
  if (matchesAny(NEGATION_PATTERNS, clause)) return false;
  if (matchesAny(DEPOSIT_PATTERNS, clause)) return false;
  return true;
}

/** True when the user's message describes a genuine emergency. */
export function describesRealEmergency(userText: string): boolean {
  return matchesAny(EMERGENCY_PATTERNS, userText);
}

/** Whether any clause of an answer breaks the rule, given what the user asked. */
export function breaksEmergencyFundRule(reply: string, userText: string): boolean {
  if (describesRealEmergency(userText)) return false;
  return clauses(reply).some(clauseBreaksEmergencyRule);
}

/** CJK in the user's message means they get the Chinese replacement. */
function writesChinese(text: string): boolean {
  return /[㐀-鿿]/.test(text);
}

export const REPLACEMENT_ZH = [
  "紧急资金只用于车祸、失业、意外这类真正的紧急情况，不建议拿来补日常开销。",
  "按 WealthUp 的预算原则，超支也不从其他类别挪钱：先看记账里是哪几笔花多了，这个月在同一类里压回来；如果每个月都不够，下个月重新调整预算比例。",
  "（以上并非投资建议。）",
].join("\n\n");

export const REPLACEMENT_EN = [
  "The emergency fund is only for real emergencies such as an accident, a medical emergency or losing a job, so it isn't a source for everyday spending.",
  "Under WealthUp's budget principle, an overspent category also isn't topped up from another one: check the ledger for what ran over, cut back within that same category this month, and if it keeps happening, adjust your budget split from next month.",
  "(This is not financial advice.)",
].join("\n\n");

export interface GuardResult {
  reply: string;
  /** True when the model's answer was replaced. */
  replaced: boolean;
}

/**
 * Pass the answer through, or replace it with one that follows the rule.
 *
 * The whole answer is replaced rather than the offending clause cut out: an answer
 * built around the wrong idea does not become right by deleting one line, and a
 * half-answer with a hole in it reads worse than a short correct one.
 */
export function guardHelpReply(reply: string, userText: string): GuardResult {
  if (!breaksEmergencyFundRule(reply, userText)) return { reply, replaced: false };
  return { reply: writesChinese(userText) ? REPLACEMENT_ZH : REPLACEMENT_EN, replaced: true };
}
