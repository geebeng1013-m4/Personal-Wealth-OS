/** System sentences, including conditional states that are absent from a blank account. */
export const ZH_CN_COMPLETE: Readonly<Record<string, string>> = Object.fromEntries(`
Safety bucket complete ✅|安全储备已达标 ✅
No emergency-fund minimum is configured.|尚未设置应急储备最低金额。
A fully funded buffer means an unexpected bill no longer forces you to sell investments.|储备充足时，突发账单便不会迫使你卖出投资。
Until the buffer is full, an unexpected bill could force you to sell investments at a bad time.|储备尚未充足时，突发账单可能迫使你在不利时机卖出投资。
Consider redirecting savings to Happy Fun and Wishlist.|可以考虑将新增储蓄分配给娱乐和心愿目标。
No target allocation configured|尚未设置目标配置
No monthly DCA amount is configured.|尚未设置每月定投金额。
Investing on a fixed schedule removes timing decisions, which is where most avoidable losses come from.|按固定时间投入，可以减少择时决定及其带来的可避免损失。
Execute this month's contribution on schedule and record it.|按计划完成本月投入，并记录交易。
Allocation drift is visible|配置出现偏离
Allocation drift is controlled|配置偏离在控制范围内
Drifting past the tolerance band means your real risk no longer matches the allocation you chose.|偏离超过容许范围，意味着实际风险已不再符合你选择的配置。
Staying inside the band keeps your actual risk aligned with the allocation you chose.|保持在容许范围内，有助于让实际风险符合你选择的配置。
Direct future buys toward the underweight ETF before changing strategy.|调整策略前，可以优先将新增投入分配给占比不足的基金。
No rebalancing needed — continue the scheduled contributions.|目前无需再平衡，继续按计划投入。
Opportunity Reserve remains separate|机会储备保持独立
No deployment ladder is configured.|尚未设置分档投入规则。
Spending the reserve on daily costs removes the only capital earmarked for buying a genuine downturn.|将机会储备用于日常开支，会减少为市场下跌时投入而预留的资金。
This currently covers the configured DCA plan.|目前足以支持已设置的定投计划。
Keep the plan as configured.|继续执行现有计划。
Reduce planned spending or lower the DCA amount so the plan is achievable.|减少计划支出或降低定投金额，使计划能够执行。
Planned surplus|计划结余
Spending is over your limit|支出已超过上限
Staying inside the limit protects the amount available for contributions.|将支出控制在上限内，可以保留用于投入的资金。
Review this month's ledger entries and cut the largest non-essential category.|检查本月账本，优先减少最大的非必要支出。
No change needed — keep recording entries so this stays accurate.|目前无需调整，继续记录交易以保持数据准确。
Recorded spending|已记录支出
The recurring schedule marks this expense as active, so it will continue unless you intervene.|这项定期支出仍在启用中，除非你取消或调整，否则会继续发生。
Confirm that you still use it. Cancel, pause, or move to a cheaper tier if the value is no longer clear.|确认自己是否仍在使用；若不再值得，可以取消、暂停或改用较便宜的方案。
Review recurring payments|检查定期付款
Fees usually provide no lasting value and can often be removed by changing payment timing, account settings, or providers.|费用通常不会带来持续价值，可以检查付款时间、账户设置或服务商，寻找减少费用的方法。
Open the matching entries, confirm the cause, then add a reminder or payment rule that prevents the next charge.|打开相关记录并确认原因，再设置提醒或付款规则，避免再次收费。
Review matching entries|检查相关记录
Identical entries can be a duplicate ledger import or an accidental merchant charge.|相同记录可能来自重复导入，也可能是商家重复扣款。
Compare the entries with your account statement. Delete only a duplicate record; dispute a duplicated bank charge with the provider.|请与账户结单核对。仅删除重复的记账记录；实际重复扣款应联系服务商处理。
Inspect transactions|检查交易
If the higher spending level continues, it reduces the monthly surplus available for goals, debt repayment, and investing.|若支出持续增加，可用于目标、还债和投资的每月结余便会减少。
Compare the two months by category, then set a specific guardrail for the category responsible for most of the increase.|按分类比较两个月的支出，并为增幅最大的分类设置明确上限。
A large outlier may be intentional, but confirming it helps catch entry mistakes, impulse purchases, or charges that need follow-up.|大额支出可能是有意安排，但核对后可以发现输入错误、冲动消费或需要跟进的收费。
Confirm the amount and purpose against the account statement, then reclassify or correct the entry if needed.|根据结单核对金额和用途，必要时更改分类或修正记录。
Inspect ledger entry|检查账本记录
A repeated category overrun reduces the surplus available for goals and investing even when individual purchases look small.|即使每笔消费不大，分类持续超支也会减少可用于目标和投资的结余。
Adjust money plan|调整资金计划
An incomplete goal with no active contribution will remain stalled until money is assigned to it.|尚未完成的目标若没有定期投入，就会停滞，直到你为它分配资金。
Add a realistic monthly contribution or revise the target to match your current priorities.|设置可执行的每月投入，或根据当前优先事项调整目标。
Update goal|更新目标
High-interest debt compounds against your net worth and can outweigh expected investment returns.|高息债务会侵蚀净资产，其利息成本可能超过预期投资回报。
Prioritise payments above the minimum while preserving the essential emergency buffer.|保留必要应急储备后，优先增加还款，超过最低还款额。
Review debt plan|检查还债计划
No structured rule governs this finding yet.|目前尚未为这项发现设置具体规则。
Every active goal should have a monthly contribution assigned.|每个进行中的目标都应分配每月投入。
A configured rule applies to this finding.|这项发现适用已有规则。
Review spending at month end and record whether DCA was executed.|月末回顾支出，并记录是否完成定投。
Use the next buy to reduce allocation drift toward your configured targets.|下一次买入时，优先减少与目标配置的偏离。
Your first layer is a percentage, so living costs shrink in a bad month. A fixed amount keeps them steady.|第一层使用百分比，低收入月份的生活费也会减少。固定金额可以让生活费更稳定。
Nothing is set to catch money left over at the end, so a good month leaves it unassigned.|尚未指定结余去向，收入较好的月份会有资金未获分配。
Two layers share the same id.|有两个分配层使用相同标识，请检查计划。
A layer has an amount below zero.|分配层的金额不能小于零。
The first layer|第一层
Every layer filled|各层均已满足
No planned amount|尚未设置计划金额
Above plan|超过计划
Used only when the market falls|仅在市场下跌时使用
Enter an amount of 0 or more.|请输入大于或等于零的金额。
Even your leanest month covered living costs.|即使收入最低的月份也足以支付生活费。
No income recorded yet this month. Record one in the Ledger and it will flow through these layers.|本月尚未记录收入。在账本中记录后，系统便会按这些分配层计算。
Shares of what is left and of all income|占剩余资金及总收入的比例
Nothing left over after the layers|各层分配后没有结余
I could not find that amount in what you told me. Say the figure and I will fill it in.|没有找到你提到的金额。请提供数字，我会帮你填写。
I could not tell which holding that was about.|无法确定你指的是哪项持仓。
I could not read a valid ticker from that.|未能识别有效的股票代码。
MYR amount|马币金额
USD amount|美元金额
I need at least an amount or a quantity to record a trade.|记录交易至少需要金额或数量。
I could not read that as something to record.|无法识别要记录的内容。
I could not tell what to record from that.|无法确定要记录什么。
That is not something I can record yet.|目前还无法记录这类内容。
That request could not be sent.|请求发送失败。
It will be available again tomorrow.|明天可以再次使用。
Ask still works, and you can record anything by hand as usual.|提问功能仍可使用，也可以照常手动记录。
Record still works, and the rest of WealthUp is unaffected.|记录功能仍可使用，其他功能不受影响。
The rest of WealthUp works as usual.|其他功能照常可用。
Choose how you pay it each month.|选择每月还款方式。
Something could not be saved.|部分内容未能保存。
Credit card|信用卡
a credit card|信用卡
Credit Card|信用卡
Buy now, pay later|先买后付
buy now, pay later|先买后付
Car loan|车贷
a car loan|车贷
a PTPTN loan|高等教育贷款
Housing loan|房贷
a housing loan|房贷
something else|其他项目
London funds may pay out in a different currency from their price — check your statement.|伦敦上市基金的派息货币可能与报价货币不同，请核对结单。
If this is a REIT, withholding here is unverified — check your statement.|若这是房地产投资信托，此处预扣税尚未核实，请以结单为准。
Action needed|需要处理
No plan set|尚未设置计划
Partially funded|部分达标
Spending exceeds income|支出超过收入
No limit set|尚未设置上限
Debt recorded against assets|已从资产中扣除记录的债务
Every tracked area is within its target range.|所有追踪项目均在目标范围内。
Most areas are fine, but some need attention.|大部分项目正常，部分项目需要留意。
One or more areas need action now.|有项目需要现在处理。
money market fund|货币市场基金
last traded moments ago|刚刚成交
Index-tracking fund|指数追踪基金
Advertising-led platform|广告业务平台
Semiconductor products|半导体产品
Product manufacturing|产品制造
Retail sales|零售业务
Operating business|经营业务
Active recurring payment|启用中的定期付款
Avoidable fees and charges|可避免的费用
entry looks|条记录疑似
entries look|条记录疑似
Possible duplicate charge|可能重复扣款
Monthly spending has increased|每月支出增加
Observed amount|发现的金额
Recent monthly average|近期每月平均
Current monthly plan|当前每月计划
Outstanding balance|未偿余额
Minimum payment|最低还款额
under RM500|低于 RM500
over RM2,500|超过 RM2,500
under RM2,500|低于 RM2,500
over RM9,000|超过 RM9,000
less than 1 month|不足一个月
Invest every month, once the safety buffer is in place.|应急储备到位后，每月定期投资。
Set a monthly contribution amount to start tracking plan execution.|设置每月投入金额后，即可追踪计划执行情况。
This month's contribution has been made.|本月投入已完成。
Part of this month's contribution is still outstanding.|本月仍有部分投入尚未完成。
No contribution has been recorded for this month yet.|本月尚未记录投入。
Your plan is on track.|计划按进度进行。
Your plan has no urgent exceptions. Stay consistent with the next scheduled contribution.|计划目前没有紧急异常，请继续按时完成下一次投入。
New layer|新分配层
Debt first|优先还债
Emergency money, for now|现阶段应急资金
Emergency money|应急资金
paid off|已还清
Pay recorded. The Budget page now shows how your plan splits it.|收入已记录，预算页面现已显示这笔收入的分配。
Balances set. Your net worth now starts from real numbers.|余额已设置，净资产现已根据实际金额计算。
Buffer topped up.|应急储备已补充。
Spending recorded. Your Overview now measures it against your plan.|支出已记录，总览现已将它与计划比较。
Goal added. Your plan now has a date to aim for.|目标已添加，计划现已有了预计完成日期。
Trade recorded. Your real return starts counting from here.|交易已记录，实际回报将从这里开始计算。
Debt written down. Your net worth now counts it.|债务已记录，净资产现已包含这笔负债。
Payment noted. The debt is smaller, and its end date closer.|还款已记录，债务减少，预计还清日期也更近了。
Savings moved onto the debt. Less interest from next month.|已记录用储蓄还债，下个月的利息会相应减少。
Nice. One cost less each month.|已完成，每月少一项开支。
Monthly amount set. The Health card now tracks it as your monthly plan.|每月金额已设置，财务健康卡片将据此追踪计划。
This device couldn't save it (its storage is full or blocked). Your entry is still here; try again.|此设备未能保存，可能是存储空间已满或被禁用。输入内容仍保留，请重试。
Add something you spent|记录一笔支出
The Overview has closed. Open it again to save.|总览已关闭，请重新打开后保存。
What your latest statement says you still owe.|填写最新结单上的未偿余额。
Enter how much is still owed, above 0.|请输入大于零的未偿金额。
Start with any amount you are comfortable leaving for years. You can change it any time.|先设置一笔你愿意长期投入的金额，之后随时可以调整。
Enter an amount above 0.|请输入大于零的金额。
How much do you want set aside for surprises? A common rule is 3 to 6 months of what you spend.|你想为意外情况预留多少？常见参考是三至六个月的生活开支。
Enter a target above 0.|请输入大于零的目标金额。
Set a target to see when|设置目标金额以查看预计完成时间
Add a monthly amount to see when|设置每月投入以查看预计完成时间
Already bought / used it|已经购买或使用
No target yet|尚未设置目标
Nothing put in each month|尚未设置每月投入
None finished yet|尚无已完成目标
This goal is no longer available to complete. Reopen the Goals page.|该目标已不可完成，请重新打开目标页面。
This goal is no longer available. Please refresh the Goals page and try again.|该目标已不可用，请刷新目标页面后重试。
Give the goal a name.|请填写目标名称。
Current, target, and monthly amounts must be zero or more.|当前金额、目标金额和每月投入均不能小于零。
shop name-what you bought|店名－购买内容
Measure|指标
FX|汇率
TVM|货币时间价值
Trades|交易
units|份额
Peak to trough, past year|过去一年高点至低点的跌幅
Fees, fund size, sectors and top holdings|费用、基金规模、行业及主要持仓
Your holdings side by side|持仓对比
Consumer cyclical|非必需消费
Basic materials|基础材料
Consumer defensive|必需消费
Communication services|通信服务
Financial services|金融服务
No live quote for this symbol|暂无该代码的实时报价
Not held|未持有
Not part of your plan|未纳入计划
No target set|尚未设置目标
Price history unavailable|历史价格暂不可用
From its highest close|相对最高收盘价
At your −|已达到设定的 −
% dip-buy step|% 分档买入触发点
Next dip-buy step at −|下一档买入触发跌幅为 −
US large-cap equity ETF|美国大盘股票基金
The 500 largest US listed companies, weighted by market value.|按市值加权追踪美国规模最大的五百家上市公司。
Core holding|核心持仓
US market risk, concentrated in the largest few names|美国市场风险，且较集中于少数大型公司
500 companies across every US sector|涵盖美国各行业的五百家公司
Quarterly dividends, reinvested by hand|季度派息，需手动再投资
The long-term base a portfolio is built around|投资组合的长期基础配置
US growth equity ETF|美国成长型股票基金
The 100 largest non-financial companies on the Nasdaq, tilted to technology.|追踪纳斯达克规模最大的一百家非金融公司，偏重科技行业。
Sector concentration — a technology drawdown hits it harder than the market|行业较集中，科技股下跌时可能比整体市场跌得更多
100 companies, heavily weighted to a handful of technology names|涵盖一百家公司，权重较集中于少数科技公司
Quarterly dividends, small relative to price|季度派息，相对价格的股息较少
Add growth on top of a broad core, in a size you can sit through|在广泛配置的核心基础上增加成长仓位，投入应控制在能承受波动的范围
Global ex-US equity ETF|美国以外全球股票基金
Developed and emerging-market equities outside the United States.|投资美国以外的发达市场和新兴市场股票。
International diversifier|国际分散配置
Market, currency and emerging-market exposure|市场、汇率及新兴市场风险
Broad developed and emerging ex-US markets|广泛覆盖美国以外的发达市场及新兴市场
Quarterly dividends, the largest of the three|季度派息，三者中相对较高
Reduce reliance on a single US equity market|降低对单一美国股票市场的依赖
P/E 14.5 · P/B 1.7 · High liquidity · Moderate-to-low growth with valuation-recovery potential|市盈率 14.5 · 市净率 1.7 · 流动性高 · 中低成长，具估值修复可能
Single US company|美国单一公司
Consumer devices, services and a global hardware ecosystem.|消费电子设备、服务及全球硬件生态系统。
Concentrated satellite|集中型卫星配置
Single issuer|单一发行人
High-conviction position|高信念仓位
Fees, yields and fund sizes are fetched live. The descriptive rows are editorial and do not change with the market.|费用、收益率和基金规模来自在线数据。说明文字为预先撰写，不随市场变动。
Live figures have not arrived yet — the descriptive rows below are editorial and do not depend on them.|在线数据尚未加载，以下说明文字为预先撰写，不依赖实时数据。
no completed recovery on record|暂无完整回升记录
days back to even|天回到原有水平
Live data from the market provider.|在线数据由行情服务提供。
Dividend data is unavailable for this symbol.|暂无该代码的股息数据。
Reference snapshot — the live dividend feed is unavailable, so these figures are indicative only and may be out of date.|参考快照：在线股息数据暂不可用，以下数字仅供参考，可能已过时。
Use a valid symbol, such as AAPL or BTC-USD.|请输入有效代码，例如 AAPL 或 BTC-USD。
is already on the list.|已在列表中。
You can save up to 30 custom symbols.|最多可以保存三十个自定义代码。
the rest of each contribution is not assigned to any ETF|每次投入仍有部分未分配给任何基金
targets add up to more than 100%|目标占比合计超过 100%
paid in full|已全额还清
rate not set|尚未设置利率
Enter a ticker such as SCHD — letters, numbers, dots or dashes.|请输入股票代码，例如 SCHD，可使用字母、数字、点号或连字符。
Keep at least one ETF in the plan.|计划中至少需要保留一只基金。
Spending increase|支出增加
Unusual spending|异常支出
Debt cost|债务成本
observed once|单次发现
Includes one-time findings|包含一次性发现
Look at these first|优先检查这些项目
No conversions recorded. Ringgit costs use the amounts or estimates saved on your trades; no exchange history is available to verify them. Dollar figures are unaffected.|尚未记录兑换。马币成本采用交易中保存的金额或估算值，目前没有兑换记录可供核实。美元金额不受影响。
Every dollar of your cost basis is backed by a recorded conversion.|全部美元成本均有已记录的兑换支持。
No payouts found for your holdings yet. They appear here as each ex-dividend date passes.|尚未找到持仓的派息记录，各次除息日期过后会在此显示。
Checking your holdings' payout history…|正在查询持仓派息记录…
Checking price history…|正在查询历史价格…
no tax withheld|未预扣税
no rate on file|尚无已记录汇率
no rate to ringgit|暂无兑马币汇率
No monthly contribution is set yet.|尚未设置每月投入。
— it's the only holding below target.|——这是唯一占比低于目标的持仓。
Hide full history|收起完整历史
Choose a valid trade date, today or earlier.|请选择今天或更早的有效交易日期。
Use valid amounts, quantity, price and fees of zero or more, with the field's permitted decimal precision.|金额、数量、价格和费用均须为有效的非负数，并符合字段允许的小数位数。
Enter the amount, or the price and quantity, so the trade has a value.|请输入金额，或同时输入价格和数量，以计算交易价值。
MYR received|收到马币
USD paid|支付美元
No conversions found. Paste the list exactly as it appears, including the MYR / USD lines above each date.|未找到兑换记录。请按原样粘贴列表，并包含每个日期上方的马币及美元行。
Back into MYR:|兑回马币：
Your ringgit cost basis will be rebuilt from these rates. Dollar figures are unaffected.|马币成本将根据这些汇率重新计算，美元金额不受影响。
The ringgit cost of any holding it funded will be recalculated from the remaining exchange records or the stored trade amounts.|相关持仓的马币成本将根据剩余兑换记录或保存的交易金额重新计算。
Ringgit costs will use the amounts saved on your trades, without exchange records to verify them. Your trades and all dollar figures are untouched. This cannot be undone.|马币成本将使用交易中保存的金额，不再有兑换记录可供核实。交易和美元金额保持原样，此操作无法撤销。
This clears the entire cost-basis history behind your portfolio — units, average cost and realised P&L will all reset. This cannot be undone.|这将清空投资组合的全部成本历史，份额、平均成本和已实现盈亏都会重置，且无法撤销。
not reviewed yet|尚未复盘
No reviews yet|尚无复盘记录
Weekly check|每周检查
Weekly check done. The next one is on Monday.|本周检查已完成，下次检查在星期一。
Got it. No payday reminder.|已了解，不设置发薪提醒。
Your home page. What you're worth, how this month went, how healthy you are overall, whether you're keeping to the plan, and the single most important thing to do next.|你的首页：查看净资产、本月收支、整体财务健康、计划执行情况，以及当前最重要的下一步。
Split your monthly money into buckets. What you planned sits beside what the ledger actually recorded, and the two are never mixed.|将每月资金分配到不同用途，并排比较计划与账本实际记录，两者分别展示。
Your decision framework: how much to invest, how much cash to hold, what allocation to keep, and what to do in a downturn. The Advisor checks your finances against exactly these.|你的决策框架：投资多少、保留多少现金、采用什么配置，以及市场下跌时如何处理。规划助手据此检查财务状况。
Guidance based on the rules above. Every recommendation shows what it noticed, why it matters, and one thing to do. It also holds your dip-buy ladder.|依据规则提供建议，逐项说明发现、影响及下一步行动，也包含分档买入计划。
A monthly check-in, pre-filled with that month's income, spending and what you actually invested — so you confirm figures rather than dig for them.|每月复盘会预填当月收入、支出及实际投资金额，方便你核对。
Give it any four of present value, payment, future value, rate and periods, and it solves for the fifth.|输入现值、每期付款、终值、利率及期数中的任意四项，即可计算第五项。
Data & tools in the sidebar holds export, import, and version history — snapshots taken as you change things, so you can roll back.|侧栏的数据与工具提供导出、导入及版本历史。修改时会保存快照，方便恢复。
No targets set|尚未设置目标
Not split yet|尚未分配
All data is stored locally in this browser. Export JSON before switching browsers or devices.|数据保存在当前浏览器中。更换浏览器或设备前，请先导出备份文件。
Title and content are required.|请填写标题和内容。
Write at least one line.|请至少填写一行。
no monthly rate set|尚未设置每月投入
already there|已经达标
Spend shape|支出方式
New monthly cost|新增每月支出
Commission paid, already inside the cost above|已支付佣金，已包含在上述成本中
No market price available yet|暂无市场价格
Transport and food come first to keep cash flow stable.|优先安排交通和餐饮，保持现金流稳定。
The Emergency Fund is complete. MYR 40 can be redirected to Growth or Freedom.|应急储备已达标，每月 MYR 40 可转入增长或自由支配用途。
Automated DCA split: 70% VOO and 30% QQQM.|定投自动分配：VOO 70%，QQQM 30%。
Travel and wishlist funding, including MYR 20 redirected from Safety.|旅行和心愿资金，包含从安全储备转入的 MYR 20。
Books, courses, tools, and investment education.|用于书籍、课程、工具和投资学习。
One-time bear-market reserve deployed only according to the rules.|一次性熊市储备，仅按照既定规则投入。
The five-month safety-buffer goal is complete at MYR 4,000.|五个月应急储备目标已达标，金额为 MYR 4,000。
Start with the suggested target and adjust it later if needed.|先采用建议目标，之后可按需要调整。
Wishlist Fund|心愿基金
Wishlist|心愿
5-Month Safety Buffer ✅|五个月应急储备 ✅
Survival Bucket|生活开支
Safety Bucket|安全储备
Growth Bucket|增长资金
Freedom Bucket|自由支配资金
Learning Bucket|学习资金
Opportunity Bucket|机会储备
Student Investor|学生投资者
Bank|银行
Wallet|钱包
Moomoo Cash|Moomoo 现金
Moomoo MMF|Moomoo 货币基金
Moomoo Invest|Moomoo 投资
MYR 20 is redirected from the Safety Bucket each month.|每月从安全储备转入 MYR 20。
For skills, courses, books, and tools.|用于技能、课程、书籍和工具。
Recovered transfer source|已恢复的转出账户
Recovered transfer destination|已恢复的转入账户
Recovered legacy account|已恢复的旧版账户
Cloud sync failed. Local copy is safe.|云端同步失败，本地副本已保留。
Before cloud data refresh|云端数据刷新前
A change from another device could not be cached locally.|来自其他设备的更改未能保存在本地。
Cloud data loaded, but could not be cached locally.|云端数据已加载，但未能保存在本地。
Could not save a version-history snapshot. Your current data is unaffected.|未能保存版本历史快照，当前数据不受影响。
Before import|导入前
Before reset|重置前
Before restore|恢复前
Auto-saved on every change · Max 20 versions|每次更改自动保存 · 最多保留二十个版本
This goal cannot be reached with these inputs. Try increasing the monthly contribution.|按当前设置无法达到目标，请尝试增加每月投入。
English|英文
Food|餐饮
Transport|交通
Shopping|购物
Bills|账单
Other|其他
Salary|薪水
Allowance|生活费
Bonus|奖金
Travel Fund|旅行基金
Learning Fund|学习基金
Happy Fun|娱乐
Keep DCA mechanical|按计划定投
Monthly DCA remains|每月定投保持
Monthly assignable surplus is|每月可分配结余为
Recorded spending this month is|本月已记录支出为
! You're safe.|，应急储备已到位。
Keep|保持
/month; estimated completion in|／月；预计达标还需
Needs two recorded months|至少需要两个月的记录
Next month|下个月
of plan|占计划
No % layers|尚无百分比分配层
Nothing set aside|尚未预留资金
Log your first investment (optional)|记录第一笔投资（可选）
No market price yet|暂无市场价格
healthy|健康
watch|留意
action|需处理
of limit|占上限
No recorded debt|尚未记录债务
there|你好
Safety still needs funding|安全储备仍需补充
Current drawdown|当前回撤
vs S&P 500|对比标普 500 指数
Dividend yield, frequency and history|股息率、派息频率及历史
Annual dividend|每年股息
High risk|高风险
Medium risk|中等风险
Low risk|低风险
high|高
medium|中等
low|低
18-22 / University Year 1|18-22 岁／大学一年级
None recorded|尚无记录
Split this month's|分配本月的
Not recorded|尚未记录
No contributions recorded yet|尚未记录投入
invested that month.|该月实际投入。
No steps set|尚未设置档位
Keep your safety buffer intact.|保持应急储备完整。
Go to goals|前往目标
Go to ledger|前往账本
Go to portfolio|前往投资组合
Go to budget|前往预算
Go to advisor|前往规划助手
Go to me|前往我的
Go to review|前往月度复盘
Go to settings|前往设置
WealthUp is a personal bookkeeping and planning tool. Its figures and guidance are estimates from your own recorded data and stated assumptions, for education and planning only. They are not financial, investment, or tax advice, not a recommendation to buy or sell anything, and not a forecast of returns. You are responsible for your own decisions.|WealthUp 是个人记账与规划工具。数字和建议根据你的记录及假设估算，仅供学习和规划参考，不构成财务、投资或税务建议，也不构成买卖推荐或回报预测。请自行作出决定。
Retire at 60|六十岁退休
Card debt up 3 months running|信用卡债务已连续三个月增加
Missed 2 monthly investments|已漏投两个月
Pause the RM300 monthly investment for 3 months|暂停每月 RM300 的投资三个月
Car repair this month|本月修车
House deposit target RM120,000 → RM90,000|购房首付目标 RM120,000 → RM90,000
Looking at a smaller unit|考虑面积较小的房屋
House deposit|购房首付
Income down this month|本月收入减少
Children's university|子女大学教育
I could not tell whether that was money in or money out.|无法确定这是收入还是支出。
I could not read an amount from that.|未能识别金额。
Skipped the setup questions|已跳过设置问题
Sign-in failed:|登录失败：
Market comparison provider returned HTTP|市场比较服务返回错误，状态码为
No comparison data for|暂无比较数据：
No fundamentals for|暂无基本面资料：
No history for|暂无历史数据：
Marked dip-buy tranche deployed|已记录分档买入投入
Undid dip-buy tranche|已撤销分档投入记录
Set monthly investment|已设置每月投资
Set safety buffer target|已设置应急储备目标
Moved money into the safety buffer|已记录补充应急储备
Paid down a debt from savings|已记录用储蓄还债
Paid down a debt|已记录还债
Mark priority action done|已标记优先行动完成
A tranche is|有一档
tranches are|档已
Set financial goal|已设置财务目标
Cleared financial goal|已清除财务目标
Changed featured Overview goal|已更改总览展示目标
Recorded goal completion|已记录目标完成
Undid goal done|已撤销目标完成记录
Add ledger transaction|已添加账本交易
Edit ledger transaction|已编辑账本交易
Clear ledger history|已清空账本历史
Delete ledger transaction|已删除账本交易
Linked account to portfolio|已关联账户与投资组合
Unlinked account from portfolio|已取消账户与投资组合的关联
Remove market symbol|已移除行情代码
Add market symbol|已添加行情代码
Add recurring transaction|已添加定期交易
Delete recurring transaction|已删除定期交易
Ignored a suggested dividend|已忽略建议股息
Recorded trade and actual currency exchange|已记录交易及实际兑换
Recorded trade|已记录交易
Recorded actual trade settlement|已记录实际交易结算
Recorded currency conversion|已记录货币兑换
Imported currency conversions|已导入兑换记录
Deleted currency conversion|已删除兑换记录
Cleared currency conversions|已清空兑换记录
Deleted trade; kept any actual exchange history|已删除交易并保留实际兑换历史
Payday question answered|已回答发薪日问题
Edit rule card|已编辑规则卡片
Delete rule card|已删除规则卡片
Restore rule card|已恢复规则卡片
Delete rule note|已删除规则备注
Delete rule notes|已删除规则备注
Add rule note|已添加规则备注
Edit rule note|已编辑规则备注
Update privacy settings|已更新隐私设置
Failed to sync to cloud:|云端同步失败：
more than|超过
On top of|加上
already recorded in|已记录于
, this|，本次
This|本次
optional|可选
drawdown|回撤
recovery|回升
holdings|持仓
fund|基金
per year|每年
per month|每月
No holdings published for|暂无已公布持仓：
. Single companies do not have any; the figures above are live.|。单一公司没有基金持仓列表，上方数字为在线数据。
Live, from the fund's latest published holdings|在线数据，来自基金最新公布持仓
Holdings as at|持仓截至
· fixed snapshot, not live|· 固定快照，非实时
Fetching published holdings…|正在获取已公布持仓…
Loading holdings for|正在加载持仓：
removed.|已移除。
Next month|下个月
Planned DCA|计划定投
Compare ledger months|按月比较账本
In|在
at|按
compounding.|复利计算。
yrs|年
Payday|发薪日
% of what's left|剩余资金的比例
% of all income|总收入的比例
unit price|单位价格
Personal loan|个人贷款
a personal loan|个人贷款
Debt|债务
Subscription software|订阅制软件
Interest and fee income|利息与费用收入
No price for|暂无价格：
Monthly charge|每月扣款
Month-over-month increase|相比上月增加
Transaction date|交易日期
Description|描述
Typical expense|常见单笔支出
Average monthly drift|每月平均偏离
Current monthly contribution|当前每月投入
12-month catch-up estimate|十二个月追赶目标估算
Amount remaining|剩余金额
no months yet|尚未储备
Mark advisor action done|已标记规划行动完成
Undo advisor action done|已撤销规划行动完成记录
— no step is in range.|——尚无档位达到触发范围。
Needs a call|需要联系
Cleared around|预计还清日期
Safety buffer target set.|应急储备目标已设置。
Enter a target.|请输入目标金额。
Hide next steps|收起下一步建议
Updated goal|已更新目标
bank accounts|银行账户
investment accounts|投资账户
Hide filter|收起筛选
Save Changes|保存更改
No income recorded yet|尚未记录收入
Add ledger category|已添加账本分类
Edit ledger category|已编辑账本分类
Delete ledger category|已删除账本分类
Add ledger account|已添加账本账户
Edit ledger account|已编辑账本账户
Delete ledger account|已删除账本账户
Real estate|房地产
At high|处于高点
No dip-buy steps waiting|暂无等待投入的档位
Growth satellite|成长卫星配置
Quarterly dividends|季度派息
Not yet described|暂无说明
Loading price history for|正在加载历史价格：
Not enough price history for|历史价格数据不足：
trading days|交易日
Held|已持有
worst|最差
No further fund detail is reported for|暂无更多基金资料：
Dividend data is unavailable for|暂无股息数据：
short-month fallback|短月份采用最后一天
Delete liability|已删除负债
Marked a money-leak action as done|已标记支出漏洞行动完成
Undid a money-leak action|已撤销支出漏洞行动
How about you?|你的情况如何？
Once there's money left over each month, we'll put a date on it.|每月有结余后，系统会估算完成日期。
Save trade & exchange|保存交易及兑换
By market value|按市值
Needs a live price|需要最新价格
Delete trade|删除交易
Recorded a dividend|已记录股息
Removed a dividend|已删除股息
Cleared contribution history|已清空投入历史
Review again|再次复盘
No notes|暂无备注
Saved monthly income|已保存每月收入
No deployment steps set.|尚未设置投入档位。
Hide list|收起列表
Rate kind|利率类型
Payment timing|付款时间
your Emergency Fund|你的应急储备
One-time spend|一次性支出
Current amount|当前金额
Investment period|投资期限
Target amount|目标金额
Client view|客户视图
Advisor view|顾问视图
PV|现值
PMT|每期付款
FV|终值
US|美国
Vanguard S&P 500 ETF|先锋标普 500 指数基金
Invesco NASDAQ 100 ETF|景顺纳斯达克 100 指数基金
Vanguard Total International Stock ETF|先锋美国以外全球股票基金
Apple Inc.|苹果公司
into|投入至
conversions recorded.|笔兑换已记录。
conversion on|兑换日期
trade|交易
records|条记录
history|历史
average|平均
new|新增
findings|项发现
categories|个分类
goal|目标
allowance|生活费
salary|薪水
bonus|奖金
assistant|助手
recorded.|已记录。
am|上午
pm|下午
WealthUp could not finish loading.|WealthUp 未能完成加载。
Reload|重新加载
PTPTN|高等教育贷款
`.trim().split("\n").map((line) => {
  const separator = line.indexOf("|");
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
