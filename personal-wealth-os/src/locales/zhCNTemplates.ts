/** Numbered substitutions keep recorded values outside translated system copy. */
export const ZH_CN_TEMPLATES: ReadonlyArray<readonly [string, string]> = `
Emergency Fund reached {0}! You're safe.|应急储备已达到 {0}，安全储备已到位。
Hold at least {0} in the emergency fund.|应急储备至少保留 {0}。
Keep MYR {0}/month; estimated completion in {1} months.|每月保持投入 MYR {0}，预计 {1} 个月后达标。
Invest {0} every month regardless of market conditions.|不论市场状况，每月投入 {0}。
{0}-year-old {1}-risk investor|{0} 岁、{1}风险承受能力的投资者
{0}-risk investor|{0}风险承受能力的投资者
Your configured allocation remains within a practical tolerance band for a {0}.|当前配置对{0}而言，仍在设定的容许偏离范围内。
Keep each holding within {0} of its target weight.|每项持仓相对目标占比的偏离应保持在 {0} 以内。
Deploy the reserve only at the configured drawdown steps ({0}).|仅在达到设定跌幅档位（{0}）时投入储备。
Monthly assignable surplus is {0} after basic spending.|扣除基本开支后，每月可分配结余为 {0}。
The plan must leave at least {0} free for the monthly contribution.|计划每月至少需保留 {0} 用于定期投入。
This is {0} below the configured DCA plan, so the plan cannot hold as written.|比设定的定投计划少 {0}，目前无法按原计划执行。
Recorded spending this month is {0}.|本月已记录支出为 {0}。
Keep monthly spending at or below {0}.|每月支出应控制在 {0} 以内。
You are {0} over the limit, which comes straight out of what you can invest.|已超出上限 {0}，会直接减少可用于投资的资金。
Set a tighter {0} guardrail and review its largest recent transactions before the next budget cycle.|下个预算周期前，为 {0} 设置更严格的上限，并检查近期最大支出。
DCA {0} this month unless cashflow breaks.|若现金流允许，本月定投 {0}。
Top up Safety by {0} until Emergency Fund reaches {1}.|补充安全储备 {0}，直到应急储备达到 {1}。
Emergency Fund is complete! Consider redirecting {0} to Happy Fun and Wishlist buckets.|应急储备已达标，可以考虑将 {0} 转入娱乐和心愿用途。
Recorded for {0}.|已记录 {0}。
{0} usually comes in on the {1} ({2}).|{0} 通常在每月 {1} 日到账（{2}）。
Opens {0}, two days before payday.|将在 {0} 开放，距离发薪日两天。
Next one on Monday, {0}.|下次检查在星期一，{0}。
{0} spent this week. {1} of your {2} limit so far this month.|本周支出 {0}，本月累计 {1}，支出上限 {2}。
{0} spent this week, {1} so far this month.|本周支出 {0}，本月累计 {1}。
Planned {0}, spent {1}. See what to keep and what to change.|计划支出 {0}，实际支出 {1}。回顾哪些做法值得保留、哪些需要调整。
Spent {0}. See what to keep and what to change.|已支出 {0}。回顾哪些做法值得保留、哪些需要调整。
Month-end review · how did {0} go?|月末复盘 · {0} 的情况如何？
{0}% of what is left|剩余资金的 {0}%
Your percentages add up to {0}%, not 100%.|占比合计为 {0}%，需调整至 100%。
This assumes your {0} emergency fund sits in your bank; link the Emergency Fund goal to its account to make it exact.|这里假设 {0} 应急储备放在银行中；请将应急储备目标关联至实际账户，以便准确计算。
Cash on hand is {0}|现有现金为 {0}
Cash outside your emergency fund is {0}|应急储备以外的现金为 {0}
{0}, about {1} months of living costs. {2}|{0}，约可支付 {1} 个月的生活费。{2}
{0} short {1} — nothing below it funded|{0} 尚缺 {1}，后续分配层暂未获得资金
Every layer filled · {0} to {1}|各层均已满足 · {0} 分配至 {1}
Every layer filled · {0} left unassigned|各层均已满足 · 尚有 {0} 未分配
Received the {0} you planned.|已收到计划中的 {0}。
Received {0} more than the {1} you planned.|比原计划 {1} 多收到 {0}。
Received {0} of the {1} you planned. {2}|原计划 {1}，已收到 {0}。{2}
Nothing saved for {0} yet, so this starts from your Me page income.|尚未保存 {0} 的计划，先采用“我的”页面中的收入。
A plan for {0}. What each layer gets shows here once that month's income arrives.|这是 {0} 的计划。记录该月收入后，此处会显示各层实际分配。
{0} outside your emergency fund covers {1} {2} that lean. {3}|应急储备以外的 {0} 可应付 {1} 个同样低收入的{2}。{3}
Plan {0} this month · routed top to bottom|本月计划 {0} · 从上至下分配
{0} reached the end with no layer set to catch it.|分配后剩余 {0}，尚未指定结余去向。
Went to {0} after every layer filled|各层满足后，结余分配至 {0}
Could not match {0} — left for you to pick.|未能匹配 {0}，请手动选择。
Left {0} blank — you did not give {1}, and I will not guess {2}.|{0} 已留空：你尚未提供 {1}，系统不会猜测 {2}。
The assistant failed ({0}).|助手请求失败（{0}）。
later today at {0}|今天稍后 {0}
tomorrow at {0}|明天 {0}
It will be available again {0}.|可于 {0} 再次使用。
, cleared around {0}|，预计在 {0} 还清
{0} a year is about {1} of interest a month, so WealthUp puts this first. {2}|年利率 {0}，每月利息约为 {1}，因此系统优先安排还款。{2}
{0} a year: pay it on schedule, your safety buffer comes first. {1}|年利率 {0}：按期还款即可，优先建立应急储备。{1}
The payout is listed in {0} while you bought in {1} — check the currency on your statement.|派息以 {0} 列示，而买入使用 {1}，请核对结单上的货币。
{0}% over limit|超出上限 {0}%
last traded {0}m ago|上次成交在 {0} 分钟前
last traded {0}h ago|上次成交在 {0} 小时前
last traded {0}d ago|上次成交在 {0} 天前
{0} repeats every month and is a direct cancellation or downgrade candidate.|{0} 每月重复发生，可以检查是否需要取消或降级。
{0} expenses share the same date, amount, and description.|有 {0} 笔支出的日期、金额和描述相同。
Expenses rose by MYR {0} ({1}%) from {2} to {3}.|支出从 {2} 至 {3} 增加了 MYR {0}（{1}%）。
This MYR {0} expense is more than three times the typical ledger expense of MYR {1}.|这笔 MYR {0} 支出超过常见单笔支出 MYR {1} 的三倍。
{0} is drifting above plan|{0} 正在超出计划
Recent {0} spending averages MYR {1} against a MYR {2} monthly plan.|近期 {0} 每月平均支出 MYR {1}，每月计划为 MYR {2}。
{0} has no active contribution|{0} 尚未安排定期投入
No monthly contribution is assigned. A 12-month catch-up plan would require about MYR {0} per month.|尚未分配每月投入。若要在十二个月内追上目标，每月约需 MYR {0}。
At {0}% APR, this balance creates about MYR {1} in monthly interest drag.|按年利率 {0}% 计算，这笔余额每月约产生 MYR {1} 利息。
{0} still owed. Add its interest rate to see whether it should come first.|尚欠 {0}。填写利率后，可判断是否应优先还款。
{0} comes first. Keep {1} aside for emergencies, then put the rest toward it.|优先处理 {0}。先保留 {1} 应急，其余资金用于还款。
{0} still owed. Every spare ringgit goes to {1}, the highest rate, first.|尚欠 {0}。额外资金优先用于利率最高的 {1}。
{0}% of your {1} buffer saved.|已达到 {1} 应急储备目标的 {0}%。
About {0} of {1} months of spending saved.|目标为 {1} 个月开支，目前已存约 {0} 个月。
You said about {0} comes in each month.|你填写的每月收入约为 {0}。
Keep {0} aside for emergencies|预留 {0} 应急
Before paying the debt down: a month of spending, so a surprise bill won't go back on the card. {0} to go.|还债前先保留一个月开支，避免突发账单再次变成信用卡债务。目前尚缺 {0}。
I've set aside {0}|我已预留 {0}
Move {0} into your safety buffer|将 {0} 转入应急储备
Your buffer is {0} short of {1}.|应急储备目标为 {1}，目前尚缺 {0}。
I've moved {0}|我已转入 {0}
You estimated about {0} a month. Real entries show how close that is.|你估计每月约 {0}。记录实际交易后，即可与估算比较。
You said {0} is about {1}. Written down, your net worth counts it.|你填写 {0} 约为 {1}。记录后，净资产会包含这笔金额。
Put {0} of your savings on {1}|将储蓄中的 {0} 用于偿还 {1}
You have {0} saved, and {1} (a month of spending) is enough to keep aside while you clear debt at {2}. It saves about {3} of interest a month.|你已有 {0} 储蓄。偿还利率为 {2} 的债务期间，先保留 {1}（一个月开支）应急，每月约可节省 {3} 利息。
I've paid {0}|我已还款 {0}
Highest rate first: {0} {1}|优先还最高利率债务：{0} {1}
Pay {0} this month, on top of the minimum. It costs about {1} in interest a month.|本月在最低还款之外，额外偿还 {0}。这笔债务每月利息约为 {1}。
A {0}-month safety buffer of {1}.|建立 {0} 个月开支的应急储备，共 {1}。
Go to {0}|前往{0}
Delete the {0} layer? Money that reached it will flow to the layers below.|删除 {0} 分配层吗？原本分配给它的资金将流向下一层。
{0} is a sample row. Only Daniel Lim has full data in this demo.|{0} 是示例客户。本演示仅提供 Daniel Lim 的完整数据。
Buffer topped up: {0} of {1}.|应急储备已补充：当前 {0}，目标 {1}。
Filled in from your answer (about {0} a month). Change it to what actually came in.|已根据你的回答预填（每月约 {0}），请改为实际到账金额。
You estimated about {0} a month. One real entry shows how close that is.|你估计每月约 {0}，记录一笔实际收入后即可比较。
Filled in from your answer ({0}, about {1}). Change it to what your statement says.|已根据你的回答预填（{0}，约 {1}），请改为结单上的实际金额。
Your buffer is full, so the {0} a month that went into it is free. Start with any amount you are comfortable leaving for years.|应急储备已满，原本每月补充的 {0} 现可另作安排。先设置你能接受长期投入的金额。
Your plan has about {0} a month for investing. Start with any amount you are comfortable leaving for years.|计划每月约有 {0} 可用于投资。先设置你能接受长期投入的金额。
6 months of your {0} monthly spending is {1}: with income that moves around, a longer buffer is safer.|每月开支 {0}，六个月合计 {1}。收入波动较大时，较长的储备期会更稳妥。
3 months of your {0} monthly spending is {1}. If your income moves around, 6 months is safer.|每月开支 {0}，三个月合计 {1}。收入波动较大时，可考虑六个月储备。
Record {0} as done on {1}, using MYR {2}? This keeps the goal done, but does not add a transaction or change account balances.|将 {0} 记录为于 {1} 完成，使用金额为 MYR {2} 吗？这只记录目标完成，不会新增交易或更改账户余额。
— {0} months of your essential spending ({1}/month). WealthUp's standard is 3–6 months.|——相当于 {0} 个月基本开支（每月 {1}），参考范围为三至六个月。
{0} allocation MYR|{0} 分配金额（马币）
{0} is already in the list.|{0} 已在列表中。
We'll route every ringgit of this through your plan. {0}|系统会按计划分配这笔收入。{0}
That leaves about {0} a month, {1} of what comes in.|每月约剩 {0}，占收入的 {1}。
That's about {0} more than comes in. Common, and the first thing your plan works on.|支出比收入约多 {0}，计划会先处理这个差额。
With income that moves around, keep {0} of spending aside for surprises|收入波动较大，建议预留 {0} 的生活开支应急
A common rule of thumb: keep {0} of spending aside for surprises|常见参考：预留 {0} 的生活开支应急
You're about {0} of the way there.|目前已完成约 {0}。
, mostly in {0}|，主要放在 {0}
Right now I most want to {0}.|目前我最想要 {0}。
In the short term, I'm saving for {0} costing {1}{2}.|短期内，我正在为 {0} 储蓄，预计需要 {1}{2}。
A typical rate for {0}; change it if yours is different.|这是 {0} 的参考利率，请按实际情况更改。
Clearing it every month means no interest. Keep doing that: it won't hold up your safety buffer. {0}|每月全额还清便不产生利息。继续保持，即可同时建立应急储备。{0}
At about {0} a year, that's roughly {1} of interest a month. Paying it off first is the surest return you can get.|年利率约 {0}，每月利息约 {1}。优先还款可以减少这笔确定的利息支出。
about {0} a month, cleared around {1}.|每月约 {0}，预计 {1} 还清。
At {0} a year, paying it on schedule is fine: {1} Your safety buffer comes first. {2}{3}|年利率 {0}，可以按期还款：{1} 优先建立应急储备。{2}{3}
You're at · Stage {0} of {1}|当前阶段 · {0}／{1}
Spending is {0} above income right now. Your plan starts by closing that gap.|目前支出比收入多 {0}，计划会先缩小这个差额。
On hold at {0} (a month of spending) while the debt is paid off.|还债期间，先将应急储备保持在 {0}（一个月开支）。
Full around {0} if you add {1} a month.|若每月投入 {1}，预计在 {0} 达标。
Flag it on your Overview when a month's spending passes {0}|每月支出超过 {0} 时，在总览提示
Track your safety buffer toward {0}|追踪应急储备，目标为 {0}
Show the month {0} is cleared, as you pay it down|随着还款更新 {0} 的预计还清月份
Keep {0}'s date up to date as you save|随着储蓄更新 {0} 的预计完成日期
{0} converted but not yet invested.|已有 {0} 完成兑换但尚未投入。
{0} of your cost basis is backed by a recorded conversion. {1} The remaining {2} uses estimated rates, without recorded funding to verify it. {3}|成本中有 {0} 获已记录兑换支持。{1} 其余 {2} 使用估算汇率，尚无兑换记录可供核实。{3}
No {0} → MYR rate yet|暂无 {0} 兑马币汇率
{0} (est. sell fees {1})|{0}（预计卖出费用 {1}）
{0} moves with exchange rates {1}.|{0} 受汇率波动影响{1}。
; {0} is in ringgit|；{0} 以马币计价
· {0} without a rate to ringgit|· {0} 暂无兑马币汇率
Remove the {0} dividend with ex-date {1}? It will be suggested again if the feed still carries it.|删除除息日为 {1} 的 {0} 股息吗？若行情源仍提供该记录，系统可能再次建议添加。
Saved as monthly income. You'll get a reminder around the {0}{1}.|已保存为每月收入，将在每月 {0}{1} 日前后提醒。
{0} allowance, {1} basic spending, {2} assignable surplus.|生活费收入 {0}，基本开支 {1}，可分配结余 {2}。
{0} / {1}. Estimated annual yield: {2}.|{0}／{1}，预计年收益率：{2}。
{0} one-time reserve. {1}|一次性储备 {0}。{1}
Deploy in {0} {1} as prices fall|价格下跌时分 {0} {1}投入
At {0}, growth assets may dominate only while emergency and cashflow rules remain intact.|在 {0}，只有应急储备与现金流规则均得到满足时，才适合以成长资产为主。
Spending {0} would not meaningfully delay your Emergency Fund or current goal.|支出 {0} 不会明显延迟应急储备或当前目标。
Invested instead at the rate set in TVM, it would grow to {0}.|若改为按计算器中设定的回报率投资，预计可增长至 {0}。
Before trading costs {0}|交易费用前 {0}
Partial valuation · {0} {1} unavailable{2}|估值不完整 · {0} {1} 暂不可用{2}
{0} must be a number.|{0} 必须为数字。
{0} must be a finite number.|{0} 必须为有限数值。
{0} cannot be less than {1}.|{0} 不能小于 {1}。
{0} cannot be more than {1}.|{0} 不能大于 {1}。
{0} must be greater than zero.|{0} 必须大于零。
This would take more than {0} periods. Try a larger payment or rate.|预计需要超过 {0} 期，请尝试增加每期投入或调整回报率。
This goal would take over {0} years. Try increasing the monthly contribution.|预计需要超过 {0} 年才能达标，请尝试增加每月投入。
Emergency Fund is {0}% complete.|应急储备已完成 {0}%。
Emergency Fund is {0} complete.|应急储备已完成 {0}。
Largest drift is {0}.|最大配置偏离为 {0}。
Payday · {0} recorded|发薪日 · 已记录 {0}
Payday · record this month's {0}|发薪日 · 记录本月的 {0}
Payday · {0}|发薪日 · {0}
{0}% of all income|总收入的 {0}%
Saved for {0}.|已保存 {0} 的计划。
{0} is {1} short|{0} 尚缺 {1}
· went to {0}|· 分配至 {0}
You have used today's {0} allowance.|今天的{0}使用次数已用完。
on {0} at {1}|{0} {1}
{0} ledger {1} like a fee, penalty, or interest charge.|有 {0} 条账本记录疑似费用、罚款或利息扣款。
{0} expenses|{0} 笔支出
Unusual {0} expense|异常 {0} 支出
{0} interest drag|{0} 利息成本
Delete the {0} bucket?|删除 {0} 资金桶吗？
Putting away MYR {0} a month across {1} open {2}.|每月储蓄 MYR {0}，分配至 {1} 个进行中的目标。
{0}% of income kept|保留了收入的 {0}%
About {0} a year across {1} in {2}.|每年约 {0}，涉及 {2} 中的 {1}。
I spend about {0} {1} a month.|我每月支出约 {0} {1}。
At your pace, cleared in about {0}: {1}.|按目前进度，预计约 {0} 后还清：{1}。
You have about {0} saved. Keeping {1} and putting {2} on it now would save about {3} of interest a month.|你已有约 {0} 储蓄。保留 {1} 应急，现在用 {2} 还债，每月约可节省 {3} 利息。
And I {0} invest.|另外，我{0}投资。
{0} conversions recorded.{1}{2}|已记录 {0} 笔兑换。{1}{2}
into {0}{1}|投入至 {0}{1}
Into USD: {0} → USD {1}, average {2}|兑入美元：{0} → USD {1}，平均汇率 {2}
{0} new, {1} already recorded.|新增 {0} 笔，另有 {1} 笔已记录。
Delete the {0} conversion of {1} and {2} {3}?|删除 {0} 的兑换记录（{1} 与 {2} {3}）吗？
Delete all {0} currency {1}?|删除全部 {0} 笔货币兑换记录吗？
Delete all {0} contribution {1}?|删除全部 {0} 笔投入记录吗？
You recorded {0} on {1}. Is {2} paid around the {3}st every month?|你在 {1} 记录了 {0}。{2} 通常在每月 {3} 日前后到账吗？
You recorded {0} on {1}. Is {2} paid around the {3}nd every month?|你在 {1} 记录了 {0}。{2} 通常在每月 {3} 日前后到账吗？
You recorded {0} on {1}. Is {2} paid around the {3}rd every month?|你在 {1} 记录了 {0}。{2} 通常在每月 {3} 日前后到账吗？
You recorded {0} on {1}. Is {2} paid around the {3}th every month?|你在 {1} 记录了 {0}。{2} 通常在每月 {3} 日前后到账吗？
{0}, outside the layers|{0}，独立于分配层
trade type "{0}"|交易类型“{0}”
The debt is {0} of {1}{2}.|这笔债务为 {1} 的 {0}{2}。
It charges about {0} a year.|年利率约为 {0}。
Flat {0} works out to about {1} a year in real terms.|平息利率 {0}，折合实际年利率约 {1}。
{0}-year horizon|投资期限 {0} 年
a year across {0} findings in {1} categories.|每年，涉及 {1} 个分类的 {0} 项发现。
Last review over {0} months ago|距离上次复盘已超过 {0} 个月
proposed {0} days ago|于 {0} 天前提出
{0} months ago|{0} 个月前
{0} days ago|{0} 天前
{0} weeks ago|{0} 周前
`.trim().split("\n").map((line): readonly [string, string] => {
  const separator = line.indexOf("|");
  return [line.slice(0, separator), line.slice(separator + 1)];
});
