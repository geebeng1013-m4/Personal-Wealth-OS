# WealthUp — PLAN

> 当前目标：**把 V1 做到核心逻辑正确、真正可用。** V1 完成后才考虑
> `COMMERCIALIZATION_PLAN.md` 里的大型功能（App 化、付费、AI 视频）。
> 每完成一个 Task 更新这里的状态，并同步 `PROGRESS.md`。

状态标记：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成

> **2026-09-09：V1 全部完成。** V1-1 / V1-2+V1-3 / V1-4 / V1-5 均已合并，
> `main` typecheck / 769 测试 / build 全绿，云同步多设备手验通过。

> **2026-09-09（当天晚些）：方向调整。** App 打包 + 付费订阅因预算不足**暂停**
> （Capacitor 脚手架 #19 + 原生 Android 工程 #20 留在库里）。改为先打磨产品本身，
> 第一轮是**手机比例**。产品定位收窄：面向东南亚年轻人、ETF/DCA、先做马来西亚一个市场，
> 不做「翻译即全球」。

---

## 手机比例打磨（M 系列）

目标：手机页面「看起来不乱、用起来直接知道 use for 什么」。约束：全部改动在
`@media (max-width: 720px)`，不碰页面逻辑；每步 STOP 汇报。

### M-1 — 整体缩小 + 单标题 + 安全区  `[x]`  （PR #21，merged）
- **问题**：整个设计系统是按桌面仪表盘定的尺寸——标题、金额、卡片留白、段间距在手机上都大一号；
  每页还渲染两个标题（shell topbar + 页面自己的 `wu-page-header`），首屏 ~120px 全是重复。
- **做法**：设计 token 化，所以在手机断点上把字号 / 间距 token 在 `:root` 上调小，一处缩全局
  （标题 24→19px，金额 24→18px，卡片留白 20→14px）；`.topbar` 手机隐藏、`wu-page-header__eyebrow`
  隐藏；四边统一 ~20px 留白 + OS 安全区（刘海 / home 条 / 圆角）。溢出兜底：grid/flex/stack 子项
  `min-width:0`、表单控件 `max-width:100%`、`.wu-card{overflow-x:clip}`、`.wu-grid--4`→2×2、
  并排 `.wu-metric` 改竖排、Market tab 条改单行横滚。
- 验证：CDP 390px 真机模拟，12 页无横向溢出。typecheck / 769 测试 / build 全绿。

### M-2 — 页面标题口语化  `[x]`  （PR #22，merged）
- **问题**：副标题是给桌面仪表盘写的——长、抽象（"canonical snapshot"、"deterministic checks"），
  手机上折到三行。侧栏名和页面标题也对不上（"Wealth Overview" vs "Overview"）。
- **做法**：4 个标题对齐侧栏名（Overview / Goals / Budget / Settings）；9 条副标题重写成一行
  大白话（"What you're saving for, and how close you are." 等）。Dashboard 动态副标题、Review 不动。
- 验证：typecheck / 769 测试 / build 全绿，无测试断言旧文案。

### M-3 — 标题上到汉堡那一行（1A）  `[-]`  （试做后撤销）
- 试过把页面标题和汉堡按钮放同一行，省掉顶部 ~90px 空白。你看了觉得不要，
  `git checkout` 回退，PR #23 关掉。顶部空白保持原样（1C）。

### M-4 — 底部 Tab 栏 +「More」整页  `[x]`  （PR #24，merged）
- **问题**：手机上每次换页都要开抽屉，没有拇指级导航。
- **过程**：先试 5 个内容 Tab（其余页面显得二等）→ 再试 4 Tab + More 开抽屉（还是有滑出面板）
  → 最终 **4 Tab（Home / Ledger / Portfolio / Budget）+ More 整页**。More 是一个真页面
  （Moomoo Discover 那种）：无 Tab 的页面按侧栏分组列成可点的行，底下是账号行 + Data & tools。
  手机上**抽屉彻底不用**；桌面常驻侧栏不动。
- **要点**：账号 / 工具按钮加 `data-tool` 钩子，侧栏（`#id`）和 More 页（`data-tool`）都能绑；
  `activePageFromNav` 改读 `location.hash`（More 页没有 `.nav-item.active`）。
- 验证：CDP 390px —— Tab 栏、More active 态、行跳转、工具按钮、无重复 id、无横向溢出。

### M-5 — 卡片间距收紧（4A）  `[x]`  （PR #24，随 M-4 一起）
- 手机上 `.wu-grid` gap、`.wu-stack--lg` / `--xl` 16→12px；`.wu-page-header` 下边距 16→12px。
  卡片内边距 M-1 已经缩过。

### M-6 — Market 图表右尺寸（原 5A）  `[x]`  （PR #24，随 M-4 一起）
- 原本担心的横向溢出**不存在**（TradingView widget 本来就 autosize）。真问题是图表 520px
  占了三分之二屏，还顶着 TV 自带的拥挤工具条。手机上：图表 520→340px（高度移到 class，
  media query 才够得着）+ 隐藏 widget 顶部工具条 / 日期条 / 符号搜索（app 自己的周期按钮已覆盖）。

**M 系列收尾。**

---

## 零散打磨（M 系列之后）

### P-1 — 手机头部留白  `[x]`  （PR #25，merged）
- 手机 `.main` 顶部 padding 22→40px（+安全区），标题不再贴状态栏。桌面不动。

### P-2 — 交易表单选券商  `[x]`  （PR #26，merged）
- 之前每笔手动交易写死 `platform: "moomoo"`。表单加 Platform 下拉（这个账户交易里
  用过的券商 + 「+ Custom」自由输入，跟 Ticker 一样的做法），预选上次用的。
  券商列表从 `state.trades` 直接推导 —— 没有新增存储字段、无迁移。自定义 CSV（无 Platform 列）
  的 "moomoo" 回落也改成上次用过的券商；真正的 Moomoo 导出仍是 "moomoo"。

### 待办 / 观察
- 桌面版仍有两个「Overview」标题（外壳 topbar + 页面 `wu-page-header`）。M-1 只在手机隐藏了
  topbar，桌面没动，还留着 ~120px 重复。要不要桌面也隐藏 —— 待你定。

### P-3 — 定位文案更新  `[x]`  （文档改动，直接进 main）
- **背景**：对比竞品（Wealth Up Vietnam / Wealthup India / Brisa / MyPenny 等）发现，WealthUp
  的 Dashboard/Advisor/Rules/Review 已经是「理解→决定→行动→复盘」的完整链路，但 README.md /
  WEALTHUP_CONTEXT.md 的定位文字只停在「记账工具」描述，没把这条链路讲出来。
- **查证**：Wealthup India / Brisa / Wealth Up Vietnam（wealthup.io）三个真实存在；「Wealth OS
  Australia」「Monitrax」查无实据，「Wealth Up iOS FIRE tracker」App Store 找不到同名 App ——
  原分析部分竞品细节可能是编的或记错的，不作为产品决策依据。唯一站得住脚、且和现有 Advisor
  架构（FACT→RULE→IMPACT→ACTION）方向一致的是 Brisa 的 "gives you context, not just numbers"。
- **做法**：README.md 开头定位段落 + WEALTHUP_CONTEXT.md 第 39 行附近，加一句话把现有页面按
  「现状（Dashboard/Ledger/Portfolio）→决定（Advisor/Rules）→复盘（Review）」说清楚，同时
  明确「不做通用 AI 投顾/股票聊天」。不改任何代码逻辑。
- **FUTURE IDEAS（本轮不做，已记录等你决定）**：
  - 周报/自动叙事摘要 —— 把现有 Financial Health 的 5 个 factor 包装成自动推送的周度/月度摘要
    （🟢/🟡 + 一句话），不需要新数据源。
  - What-if 绑定真实数据 —— 扩展 TVM，让场景模拟读取真实 Emergency Fund / Goals 状态
    （"如果我花 RM3000，Goal 会延后多久"），复用现有引擎。
  - Wealth Vault —— 全新功能，上传财务文件自动提取数字。**暂停（2026-09-11）**：需要
    AI/OCR，是持续的 API 调用费用，现在负担不起，等预算允许再看（见 P-4 末尾）。

### P-4 — Dashboard 状态摘要 + TVM What-if  `[x]`  （PR #34，待 merge）
- **背景**：P-3 之后挑了两个"零新成本、复用现有引擎"的候选往下做，Wealth Vault 留着不动。
- **讨论中的两个修正**：
  1. "零 AI 是差异化"这个说法不准确——重查 Brisa 原话，它本身就是用 AI 做的；真正被印证的是
     "给理由不只给数字"，跟用不用 AI 是两件事。这条不再当作护城河。
  2. Dashboard 定位收紧：只放"一眼看懂财务状况"，不是什么功能都往里塞——明显的新功能（哪怕小）
     该开自己的地方，不该为了省一个导航项硬塞进 Dashboard。
- **A. Dashboard 状态摘要** —— 原计划是新增一句话摘要卡片，写完后对着真实代码检查发现 Dashboard
  已经有 Wealth Health 卡片（列出全部 5 个 factor）和 Expenses 卡片（月度对比），新加卡片会跟
  已有内容重复。改成**修正已有的那句笼统文案**：`financialHealthSummary.ts` 加 `drivingFactor()`，
  在 `overview.ts` 里把页头 headline 和 Wealth Health 卡片里的"One or more areas need action now."
  换成具体的（"Safety buffer: 62% funded." 这种）；status 由 Advisor 紧急建议升级、而非某个
  factor 本身超标时，老实保留笼统文案（真正原因已经在 Priority Action 卡片讲清楚）。
- **B. TVM What-if** —— 新增 `src/whatIf.ts`，TVM 页面加第三张卡「What If I Spend This?」，
  跟主求解器和通胀工具并排、互不影响：
  - 一次性支出：延后未来供款能力（金额 ÷ 现有月供速度）。
  - 每月重复支出：永久降低月供速度——复用 `monthsToEmergencyTarget` / `buildGoalSnapshot`，
    只换掉速度参数重算，不重新发明公式。
  - 机会成本：接回主求解器自己设的 Rate/Periods/Compounding/Timing，算"这笔钱拿去投资会变多少"。
  - 一句话总结，合成上面几项。
- 验证：typecheck / 808 测试全绿；CDP 真实浏览器验证（Dashboard 具体文案、TVM 三张卡独立、
  切换 one-time/monthly 数字正确更新、零运行时报错）。
- **Wealth Vault：暂停（2026-09-11）**——需要 AI/OCR 才能做到"上传文件自动提取数字"，
  是持续的 API 调用费用，现在负担不起。只记录，不再当作"待讨论"，等预算允许再重新评估。
  技术方向（重启时参考）：CSV 导入已有的"不可信输入 → 校验 → 用户确认"模式可以直接套用，
  不必因为这个再破一次"Advisor 零 AI"的架构原则——AI 只负责读数字，不负责给判断。

下一步产品打磨项由你定。

---

## AI 助手（A 系列）

目标：右下角悬浮助手。**Ask** 问 WealthUp 怎么用、数字怎么来的；**Record** 用一句话描述一笔账或交易，
助手把对应表单预填好，**保存永远由你自己按**。模型 `ling-3.0-flash-fin:free`（OpenRouter，免费档，
不产生 API 费用）。

**边界**：这个助手和 Advisor 是两件事。Advisor 仍然是纯规则、零 AI，本系列没有碰它。助手不写任何数据，
只预填表单；Ask 回答里带「非投资建议」。

### A-1 — 服务器代理（Cloud Function）  `[x]`  （PR #35）
- **问题**：浏览器不能直接调 OpenRouter，key 会暴露。
- **做法**：`functions/`（Firebase Cloud Functions 2nd gen，us-central1）。模型写死在服务器端，客户端改不了；
  客户端送来的 `system` 消息直接拒绝；跨域白名单（站点在 Vercel、函数在 Firebase，每次都是跨域）；
  按 IP 限流（移植自 `api/_rateLimit.ts`）。key 存在 Firebase Secret Manager，不进仓库。
- 验证：已部署到生产并用真实请求验过（预检 204、非白名单 403、改模型被忽略、坏输入干净 400）。

### A-2 — 悬浮组件外壳  `[x]`
- `src/components/assistant/`。挂在 `#pageMount` 外面，切页面不消失；状态是模块级变量（跟 Ledger 筛选、
  TVM 输入同一个做法），不进 `WealthState`。手机上抬高避开底部 Tab 栏。

### A-3 — Ask 问答  `[x]`
- 聊天气泡、连续对话、失败提示（限流 / 服务器错 / 断网 / 空回复各有一句人话）。
- 新对话时有建议问题，开始聊之后不再显示。

### A-4 + A-5 — Record：记账 + 持仓交易  `[x]`
- 模型按提示词输出一个 JSON 动作，浏览器端宽松解析（去掉代码块、取第一个完整对象）再逐字段校验。
- 预填走页面自己的路径：Ledger 复用已有的 `ledgerEntryDraft`；Portfolio 表单没有草稿状态，
  排队到 `bindPortfolio` 里一次性写进 DOM。
- **Record 是日志不是对话**（你看过觉得跟 Ask 太像，改的）：每条一张卡片——原话、解析结果、状态
  （Ready / Filled in / Discarded / Not recognised / Failed / Not used），最新在上、按天分组。
  每次请求不带历史。建议问题固定在输入框上方，一行横向滑动。
- **草稿不跨刷新**：刷新后没处理的草稿变 Not used，按钮消失，避免同一笔记两次。

### A-6 — 隐私：发出去的是什么  `[x]`
- Ask：默认只发今天的日期。「Share my figures」打开才附带数字摘要（整数令吉、百分比）。
  **开关每次打开页面都回到关闭**（你测出来原本会被记住，改的）。
- Ask 历史界面上保留，但**只把这次访问的对话发给模型**，中间一条「New conversation」分隔线
  （不然开关关了，旧回答里的数字还会被重新发出去）。
- Record：只发类别 / 账户 / 股票 / 券商的**名字**，从不发金额——填表需要名字，这个开关打开也不发数字。

### 实测抓到的两个问题（接真实模型才暴露）
1. **模型编造汇率**：「bought 500 usd of VOO at 520.50, fee 3 myr」→ 自己猜 4.40 汇率填 `amountMyr: 2200`，
   又用 500÷520.50 算出 `units`。猜出来的令吉数字会变成持仓成本基础。
   **修法**：`figureAppearsIn()`——你没说过的数字一律不填，卡片上说明留空了哪个。记账金额对不上直接拒绝整张草稿。
2. **reasoning 模型吃光输出预算**：思考和正文共用 `max_tokens`，交易那条返回空字符串。Record 上限提到 2400，
   Ask 1200；提示词里禁止换算货币、禁止自己算数量。

- 验证：typecheck / 884 测试 / build 全绿；CDP 真实浏览器验证（Ask / Record / 预填后账目条数不变、按 Save 才 +1 /
  四种失败路径 / 刷新后开关关闭、旧对话不重发）；你手动跑完 25 项测试清单。

### 助手理财原则（R 系列）
线上发现 Ask 建议「饮食资金不足，从紧急资金挪一点」。和你讨论定下六大原则（预算定了就守、不跨类别挪钱；
存满 3–6 个月必要支出的紧急资金再投资，放 MMF，只用于真正紧急；高息债先还；ETF 为主、达目标才卖、
新资金再平衡；3 年内目标放 MMF；不推荐个股/加密/择时/熊市储备）。计划书：artifact「助手理财原则」。
你的决定：③ 熊市储备默认关闭 · ⑥ 目标期限用估算 · ⑦ 财务目标写在 Goals 页、Overview 显示 · ⑧ 要安全网。

#### R-1 — 原则写进提示词 + 安全网  `[x]`  （已部署函数，PR 待开）
- `openrouterRequest.ts`：Ask 提示词加入六大原则 + 优先级（原则 > 用户规则 > 常识，冲突时说明哪条原则并给替代做法）；
  回答用用户的语言；「Share my figures」的位置和英文原名写死（模型原本会说「在 Overview 打开」、译成「分享我的数据」）；
  禁止「扣住新钱等回调」和「现在是好/坏时机」（第一轮实测里熊市储备、抄底两题出现过）。
- `answerGuard.ts`（⑧）：只查一条——建议用紧急资金补日常开销。按分句、看方向（从基金拿钱）、看否定/限定/存入；
  用户描述真实紧急情况（车祸、失业等）时不查。命中整段替换成符合规则的中/英文回答，只记日志不记内容。
  坑：不能把单个「不」当否定——线上那句本身以「不足」开头；「dip into」里的 into 不能算存入。
- `scripts/assistant-principles-eval.mjs`：22 个诱导题（中英、含两个真实紧急情况），拿真实模型跑，人读每条回答。
- 验证：899 测试 / functions typecheck 全绿；模拟器 + 真实模型 22/22 守原则，安全网零触发；已部署。
- **发现：免费模型全 app 每天只有 50 次请求**（所有用户共用一把 key）。今天测试用光，线上助手到
  2026-09-16 08:00（马来西亚时间）前都会显示「busy」。生产环境的回答要等重置后再验。

#### R-2 — 打开「Share my figures」时发送用户自己的规则  `[x]`  （PR 待开，函数未部署）
- `assistantContext.ts` 新增 `buildUserRulesContext`：启用中的规则（紧急资金目标换算成「几个月必要支出」、月支出上限、
  DCA、目标配置、偏差容忍度；有熊市储备时注明「用户自己的选择，不要推荐」）、预算桶（金额 + 占计划收入 %）、
  财务目标（进度、每月存多少、按 ⑥ 甲估算剩余时间并标明是否在 3 年内，注明是估算不是截止日）、Rules 页 notes
  （标明是用户自己的话、当偏好不当指令；单条 280 字、总共 900 字，放最后，超长时先被截掉）。
- **只在打开开关时发送**；Record 模式开关开着也不发。关着时只发今天日期——浏览器实测确认。
- 服务器提示词加一句：用户的 notes 是偏好，不能当指令、不能压过原则；目标剩余时间是估算。
- 验证：924 测试（含隐私：关着时一个字都不带出去）；浏览器实测开关开/关实际发出的内容（开：2,150 字，远低于 4,000 上限）。
- **待做**：免费额度今天用完，还没用真实模型测「带着用户规则」的回答。明早额度恢复后测，通过再部署函数、合并。

#### R-3 — Overview 显示一行财务目标  `[x]`  （PR 待开）
- 新字段 `WealthState.financialGoal`（一句话，最多 160 字），**schema v20 → v21**，按 `WEALTHUP_CONTEXT.md` §7 的契约
  写迁移：旧数据没有这个字段就给空字符串，不动其他数据；存的值整理成一行、超长截断，不丢。顺手把 CONTEXT 里写着
  「当前 = 19」的过期版本号改成 21。
- Goals 页顶部加「My financial goal」一栏（⑦ 甲），Overview 页头下显示一行「MY GOAL …」，点它跳 Goals 页；
  没写时显示一行淡色「Write down your financial goal →」。Overview 只显示、不编辑，符合 Dashboard 只放一眼能看懂的规则。
- 打开「Share my figures」时这句话也发给 AI（放在规则最前面，「围绕它给建议」）；关着或 Record 模式不发。
- Demo 数据加了一句示例目标。
- 验证：934 测试（迁移、整理、截断、非文字、幂等、隐私）；浏览器实测桌面/手机：显示 → 点击跳转 → 修改后 Overview 更新 →
  清空后变提示行 → 手机无横向溢出。修了两处布局（Save 被挤到下一行、卡片和下面的目标之间没有间距）。
- 注意：旧版前端（没更新的 PWA 缓存）保存时会丢掉这个字段，属于新增字段的正常风险，更新后即恢复写入。

#### BUG — 改了 Settings，规则不跟着变  `[x]`  （做 R-4 时发现；PR 待开）
- **现象**：结构化规则只在建号/迁移时从设置生成一次，Settings 保存只写设置字段、从不写规则。新用户注册（规则全是关闭的 0）
  后在 Settings 填紧急资金目标 MYR 4,500：规则仍是 0 且关闭；R-2 发给 AI 的规则只剩「偏差 8%」；Advisor 的 DCA、
  预算、计划检查读的都是旧规则（实测：Settings 把 DCA 从 300 改成 456，Advisor 以前会停在 300）。
- **设计依据**：现有测试写明「规则才是政策，Settings 是旧字段」「迁移不能覆盖用户配置的规则」。所以不是在加载时用设置
  重新生成规则，而是补上缺失的写入：
  - `syncPlanningRules`：保存 收支/DCA、紧急资金、目标配置 时更新对应规则；原本是占位（关闭且为 0）的规则有值后打开；
    用户有值却关掉的规则保持关闭；保存 0 就关闭；表单不负责的规则（偏差容忍度、分批投入）一个字不动。
  - `syncGoalContributionRules`：目标保存/新增/删除时同步每个目标的每月存款规则。
  - `repairPlaceholderRules`（加载时）：只修「占位规则 + 设置里已有值」这种明确受影响的情况；已配置的规则、空规则数组都不碰；幂等。
    已有值但过时的规则无法判断是否刻意，下次保存那个设置时就会同步。
- **我汇报时说错两处，已更正**：①「每个新用户自带熊市储备」—— 实际新用户是空白的，带熊市储备的是 Reset 用的示例模板；
  ②「Advisor 显示 Hold at least MYR 0」—— 那句只存在于建议数据里，页面没显示；页面上受影响的是 DCA 金额和预算/计划检查。
- 验证：948 测试（含原 bug 完整重现、不覆盖配置、幂等）；原重现脚本修复后：规则 4,500、AI 收到紧急资金目标和 DCA；浏览器实测 DCA 同步。

#### R-4 — 新用户默认值 + 数据工具移到 Settings  `[x]`（你的决定：A 做 · B1 · C 记录；PR #42）
- **A 做**：Settings 紧急资金卡片，填了必要支出（交通 + 饮食 + 其他固定）后显示「Suggested target: MYR X —
  6 months of your essential spending · WealthUp's standard is 3–6 months」+「Use 6 months」按钮。按钮只填进输入框，
  **不保存**，还是要你按 Save Emergency。没填必要支出时显示提示去填 Cashflow。目标已相同时不显示按钮。
- **B1**：Reset 改成真正空白（`emptyState()`），和确认文字一致；不再载入带示例目标、MYR 400 熊市储备的示例模板。仍先存 Version History。
- **Import 前先存 Version History**（PR #41）：Import 以前直接覆盖、不留备份；现在标注「Before import」。
- **工具全部移到 Settings**：侧栏抽屉（主题、Add to Home Screen、Export、Import、Version History、Reset）和手机 More 页底部
  同一排按钮都移到 Settings 最后一张「Data & App」卡片，Reset 放最底、红字。侧栏账号行（头像、名字、Sign Out）和免责声明保留。
  删掉了抽屉的代码、记住开合状态的 localStorage 和相关 CSS。
- **胶囊样式（你的 idea，选甲）**：卡片里去掉说明文字，只留一排圆角胶囊「Theme · Export · Import · Version History ·
  Add to Home Screen · Reset」，Reset 最后、红框红字；鼠标停留有一句说明（title）。桌面卡片横跨整行、一排排完；手机自动换行。
  说明文字拿掉后 **Import 加了确认框**（以前选完文件直接覆盖）：「Replace all your data with this file? …saved to Version History first.」
  取消 → 数据不变、可重选同一文件；确认 → 先存「Before import」再导入（浏览器实测两种都对）。
- **做这个时发现的两个 bug，一起修了**：
  1. **Version History 对真实账号永远是空的**：保存按 `uid` 存，打开时按 `email` 读，两个 key 对不上。所以 Reset / Import
     存的备份在真实账号里**根本打不开**（demo 模式看不出，因为 demo 没有 email）。改成按 uid 读、清空、恢复。
  2. **Restore 没有先存当前数据**：确认框写着「当前状态会先存一份」，实际没存。现在恢复前存「Before restore」。
- 验证：955 测试（建议目标计算、只算必要支出、空值/坏值、Reset 空白）；浏览器实测：侧栏/More 页工具已无、账号行在；
  Settings 卡片 6 个工具 Reset 在最后；建议 MYR 7,200 → 按钮填入不保存；主题切换；Reset → 设置全 0、Goals 空、显示提示；
  Version History 出现「Before reset」，Restore 后多出「Before restore」；手机无横向溢出。

#### R-5 — 原则存成正式文件  `[x]`（PR #43）
- 新文件 `docs/assistant-principles.md`：适用范围（Ask 受约束；Record 不给建议；Advisor 零 AI）、优先级、六大原则
  （每条附提示词里的英文标题）、助手能看到什么（Share my figures 开/关、Record 只看名称）、安全网、已做的决定
  （③ ⑥甲 ⑦甲 ⑧ R-4 A/B1/C）、**改原则的流程**（先改文件 → 改提示词 → 本地跑 22 题 → PR → **部署函数**，
  只合并 PR 不会让提示词生效）、22 道测试题分类表。
- 防止两边不同步：新测试 `tests/assistantPrinciplesDoc.test.ts` 核对六条标题（顺序）、关键数字（50/30/20、3–6 个月、
  默认 6 个月、8%、偏差 8%、3 年放 MMF、不推荐熊市储备）和测试题数量。实测：故意把文件里的偏差改成 10%、标题改名 → 测试失败。
- 958 测试通过。只加文档和测试，不改提示词，所以**不用部署函数**。

#### 小改 — Overview「Financial goal」文字居中、加大  `[x]`（PR #44）
- 你写的那句目标放在整条横栏的**正中间**（不是标签右边剩下空间的中间）：右侧放一个看不见的「MY GOAL」占位，左右两栏等宽。
  没写目标时的提示行不变。
- 追加：标签改成「FINANCIAL GOAL」（大写）；目标文字加大加粗（18px 粗体，手机 16px），读起来像一句志向而不是状态。
  手机上改成标签在上、目标在下，都居中（左右并排时一句短目标会被挤成三行）。
- 追加（A）：目标那句改用 Lato，只加载一种粗细，只用在这一处；加载失败退回 Inter。
  先做了 Bold 700，看了 700 / 400 / 400 淡色 三种对比后你选 **B：Lato Regular 400**（文字仍是最亮的颜色）。
- 追加（设计 1「光晕」，从 光晕 / 引言 / 旗帜 / 横幅 四种预览里选的）：写了目标时变成一张卡片——顶部淡绿色光、淡绿边框和外圈柔光、
  标签绿色在上、目标在下都居中，文字桌面 20px / 手机 18px。左边绿线和「对称占位」去掉（上下排列不再需要）。
  没写目标的提示行不变。实测深色、浅色主题（浅色自动变淡）、手机长目标（换行居中、无溢出）、空状态。
- 追加：**去掉绿色**，改成和 Overview 其他卡片一模一样的颜色（底色、边框、16px 圆角、标签灰色），没有光晕。
  保留：标签在上、目标居中、Lato Regular 20px/18px。实测底色/边框/圆角和 Net Worth 卡片完全相同（深浅主题都是）。
  Lato 没有中文字，中文目标会显示系统中文字体。实测字体已加载并生效，居中不变。
- 实测文字中心和横栏中心相差 ≤1px（桌面 1280、手机 390）；很长的目标换行后仍居中、无横向溢出。

### 待办 / FUTURE IDEAS（记录，不自动做）
- **（R-4 C）迁移补空缺用的是示例模板**：导入的文件缺某一块（例如熊市储备、紧急资金）时，`migrateState` 会用示例模板的数值
  补上，而不是空值。影响已有数据的处理，这次不动。
- **每日 50 次免费额度**：上线后真实用户会很快用完。OpenRouter 充值 10 credits（约 USD 10，一次性）可升到每天 1000 次。由你决定。
- ~~额度用光时写「busy, try again shortly」~~ **已修（2026-09-15）**：服务器读 OpenRouter 的 429，区分「每日免费额度用完」
  和「短时繁忙」；前者返回重置时间，面板显示「今天的免费额度用完了，明天早上 8:00 恢复，WealthUp 其他功能照常」
  （按用户本地时间）。认不出的 429 一律按短时繁忙处理，不会乱承诺时间。
- **已上线（2026-09-14）**：先部署新版 Cloud Function，再合并 PR #35（顺序不能反，否则线上 Record 会失败）。
- **换 OpenRouter key**：key 在对话里贴过两次，上线后尽快换。不用改代码。
- 聊天记录改存 Firestore（跟账号走、换设备可见、不串号）。现在是浏览器 localStorage。SQLite 讨论过，不适合。
- `firebase-functions` 版本偏旧，CLI 部署时提示升级（有破坏性变更，单独做）。
- 更多 Record 动作（目标、预算桶、换汇、每月定投）；流式输出。

---

## 液态玻璃按钮（G 系列）

目标：按钮和浮层改成 iOS 26 的 **Liquid Glass（液态玻璃）** 风格。Preview（不改代码，只用来定方向和参数）：
https://claude.ai/artifact/DWFjJPJ2Nof42eZSZTtZZB

- **Problem**：现在的按钮是扁平实色，浮层（Tab 栏、顶栏）是 94% 实色，跟你每天用的 iPhone 风格不统一。
- **Why**：纯视觉打磨，不影响正确性。按 `CLAUDE.md` §10，一次只做一小步，每步截图确认。
- **Current System**：
  - 所有按钮统一走 `.wu-btn`（`src/components.css`），全站约 170 处：`sm` 69、`ghost` 32、`secondary` 25、`primary` 20、`icon` 13、`danger` 7。
  - 手机顶栏 `.mobile-brandbar` 和底部 `.tabbar` 在 `src/shell.css` 的 `@media (max-width: 720px)` 里。
  - Ask 按钮是 `.assistant-fab`（`src/components/assistant/assistant.css`）。
  - Dashboard 顶部有 WebGL 光线（`side-rays`）。
- **Proposed Solution**：分三层，不一刀切。
  - **L1 浮层 = 完整玻璃**：模糊、提饱和、高光边、按下鼓起发亮。电脑 Chrome 额外加真折射。
  - **L2 按钮 = 轻玻璃**：只有胶囊形、高光边、按下动画，不加背景模糊。
  - **L3 文字按钮 = 只改圆角**。
- **Architecture**：
  - `theme.css` 加 `--glass-*` token，深色、浅色各一套。
  - `components.css` 加共用的玻璃材质，并改 `.wu-btn` 的几个变体。
  - `shell.css` 改 Tab 栏和顶栏，`assistant.css` 改 Ask 按钮。
  - 新增一个小模块 `src/liquidGlass.ts`，负责按下时的光点跟手，以及 Chrome 的折射。
  - 不碰任何页面逻辑。

### 已定的决定（2026-09-15，Preview 里确认）
| 项 | 结论 |
| --- | --- |
| 范围 | L1：底部 Tab 栏（改成悬浮胶囊）+ 手机顶栏（**做成玻璃**）+ Ask 按钮<br>L2：`primary` / `secondary` / `danger`<br>L3：`ghost` 和表格里的图标按钮，只改胶囊圆角 |
| 主按钮 | 绿色着色玻璃，白字，跟 iOS `glassProminent` 一样 |
| L2 背景模糊 | **不加**。按钮后面都是纯色卡片，加了看不出来，只会更吃性能 |
| 顶部光线 | **保留** |
| 平台 | 以 iPhone Safari 的模糊版为主设计；折射只是电脑 Chrome 上的额外效果 |
| 无障碍 | 系统「减少透明度」时退回实心；「减少动态效果」时关掉动画 |

参数：
```
--glass-blur: 10px;
--glass-refraction: 55;   /* 只在 Chrome */
--glass-tint: 0.78;
--glass-highlight: 0.70;
```

### G-0 — 讨论方向 + Preview 定参数  `[x]`
- 讨论 iOS 液态玻璃的原则：玻璃只放在浮层上，不叠玻璃；定下分层方案。
- 做了独立的 Preview：并排对比现在和玻璃，可以切换主题，在电脑上模拟 iPhone Safari，用滑块调参数。项目代码没有改动。
- 在 Preview 里确认了上面的决定和参数。

### G-1 — 玻璃 token + 材质 + L1 浮层  `[x]`（2026-09-15，PR #45，merged）
- 在 `theme.css` 加 `--glass-*` token；在 `components.css` 加共用材质：高光边、按下鼓起、光点跟手，以及「减少透明度」和「减少动态效果」的退路。
- 手机顶栏改成玻璃；底部 Tab 栏改成悬浮胶囊，加上滑动的选中镜片；Ask 按钮改成绿色玻璃。
- 这一步只用「模糊 + 高光」，所有浏览器效果一致；折射放到 G-4。
- 要检查：`.main` 底部留白仍然能让最后一张卡片露出来；Ask 按钮不压到悬浮 Tab 栏；Tab 栏避开 iPhone 的 Home 指示条。
- **完成标准**：typecheck、测试、build 全部通过；手机 390 宽 × 深色/浅色截图，桌面 1280 宽截图。
- **结果**：
  - 958/958 测试通过，build 通过。
  - demo 模式截图检查了：手机深色、手机浅色、Ledger 滚到底、打开 Ask 面板、桌面深色。
  - 实测正常：选中镜片滑到新 Tab 后和按钮中心对齐；按下 Ask 按钮会放大到 1.12 倍，松手恢复；控制台没有报错。
  - 最后一张卡片不会被 Tab 栏盖住；Ask 面板打开后在 Tab 栏上方。
- **跟 Preview 不同的一处**：Ask 按钮的绿色改成直接用 `--glass-tint`（0.78）。Preview 里是 0.78 × 0.82，在浅色主题下太淡，白色图标看不清。
- **改动的文件**：`theme.css`、`components.css`、`shell.css`、`assistant.css`、`assistantWidget.ts`、`ui.ts`、`main.ts`，新增 `src/liquidGlass.ts`。
- **没验证到的**：
  - 真 iPhone Safari 上还没看过。
  - 安全区（刘海屏和 Home 指示条的留白）在 Edge 模拟里全是 0，只能在真机上确认。
  - 「减少透明度」开关 Edge 模拟不了。

### G-2 — L2 按钮：primary / secondary / danger  `[x]`（2026-09-15，PR #45，merged）
- 只改 `.wu-btn` 的这三个变体，全站约 52 处会自动跟着变，不改任何页面模板。
- 检查绿色玻璃上白字的对比度，深色和浅色主题都要达到 AA。
- **完成标准**：逐页截图，重点看 Ledger、Portfolio、Settings 这些按钮多的页面。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 截图检查了 Ledger（深色、浅色）、Settings（深色、浅色）、手机 Portfolio（深色）、手机 Goals（浅色）。
  - 三种按钮都是胶囊形，带高光边；按下会鼓起，还有跟手的光点；禁用的按钮不响应按下。
  - 只改了 `components.css`、`theme.css` 和 `liquidGlass.ts` 里「哪些按钮能按下」的选择器，没有改任何页面模板。
- **对比度**：
  - 绿色玻璃上的白字，深色主题约 5.7:1，浅色约 4.6:1，都达到 AA。
  - hover 在深色主题变亮、在浅色主题变暗，避免浅色下白字变淡。
- **一处保留原意**：Settings 的 Reset 原来特意加了一圈红色边框，改成玻璃版的红色描边。

### G-3 — L3 文字按钮：胶囊圆角  `[x]`（2026-09-15，跟 G-1、G-2 同一个 commit，PR #45，merged）
- `ghost` 和 `icon` 按钮的圆角改成胶囊形，其他不变。改动很小，也可以跟 G-2 合并成一个 PR，由你决定。
- **结果**：
  - 只改了 `components.css` 里两条规则，测试和 build 通过。
  - 全站每个 `.wu-btn` 都带变体，没有漏掉的按钮。
  - 截图确认 Dashboard 的「Open portfolio →」在 hover 时是胶囊形。Portfolio 表格里的删除图标只确认了圆角是 999px，截图没拍到。

### G-4 — Chrome 真折射  `[-]`（2026-09-15 决定不做，移到 FUTURE IDEAS）
- 注意：底部 Tab 栏和顶栏只在手机宽度出现，而你用手机时是 Safari，看不到折射。**所以在电脑 Chrome 上，折射实际只会出现在 Ask 按钮上**。
- 做完 G-1..G-3 之后，再决定这一步值不值得做。
- **决定（2026-09-15）：不做。** 电脑宽度下只有 Ask 按钮会用到，要多写约 120 行代码，Chrome 也要多一份性能负担，不划算。以后电脑版如果有更多浮在内容上的玻璃元素，再重新考虑。

---

## 侧栏滚动条（S 系列）

目标：电脑版左侧栏的滚动条，改成 iOS 的做法：平时隐藏，滚动时出现。Preview（三种做法并排对比）：
https://claude.ai/artifact/BqULCH7RnCChqE2RdzDwPR

- **Problem**：`.sidebar-scroll-area` 没有设置滚动条样式。Windows 上的 Chrome 会显示系统默认的灰色滚动条，跟液态玻璃风格不搭。
- **Why**：纯视觉打磨。你主要用电脑 Chrome，而问题只在 Windows 上明显。
- **Current System**：
  - 左侧栏是 `.sidebar`（`shell.css`，sticky，270px 宽），导航列表放在 `.sidebar-scroll-area` 里，高度不够时可以滚动。
  - 每次切换页面都会重新渲染整个外壳。`ui.ts` 会记住侧栏滚动到的位置（`sidebarScrollPositions`），渲染后恢复；首次打开时会把当前页面的导航项滚进可见范围（`keepActiveNavigationVisible`）。
  - 手机上，同一个侧栏会变成抽屉。
- **Proposed Solution（你选的：D · 自己画，2026-09-15）**：
  - 隐藏浏览器自带的滚动条，自己画一条浮在内容上的细条（约 5px，圆角，半透明，颜色跟主题走）。
  - 平时看不到；滚动时出现，停下约 1 秒后慢慢淡出；出现时可以按住拖动。
  - 页面第一次打开时，如果侧栏内容比屏幕长，细条闪现一次。
  - 侧栏上下边缘渐隐，提示还有内容；滚到顶或滚到底时，对应那一边的渐隐消失。
  - 滚动本身完全用浏览器原生的：滚轮、触控板、键盘、手指滑动都不变。
- **Architecture**：
  - `shell.css`：隐藏原生滚动条、细条样式、边缘渐隐。
  - `ui.ts`：模板里给滚动区包一层容器，放细条元素。
  - 新增一个小模块（例如 `src/sidebarScrollbar.ts`）：根据滚动位置计算细条的位置和长度，处理出现、淡出和拖动；在 `renderApp` 渲染后接上。
  - 不碰任何页面逻辑。

### S-1 — iOS 式侧栏滚动条  `[x]`（2026-09-15，PR #46，merged）
- 做上面的 Proposed Solution。
- **两个要特别处理的坑**：
  1. **切换页面不能闪**：每次切换页面都会重新渲染侧栏。「打开时闪一下」只能在整个 App 第一次加载时出现一次，否则每点一次导航都会闪。
  2. **恢复滚动位置不能触发显示**：渲染后 `ui.ts` 会用代码恢复侧栏的滚动位置，这个动作也会触发滚动事件。要把它和用户真的在滚动区分开，否则每次切换页面细条都会出现。
- **无障碍**：细条对读屏软件隐藏，滚动仍然走原生方式；「减少动态效果」时不做淡入淡出。
- **完成标准**：
  - typecheck、测试、build 全部通过。
  - 桌面 1280 宽截图：深色、浅色，以及侧栏滚到中间、滚到底两种状态。
  - 实测：细条位置跟滚动一致；拖动细条能滚动；切换页面时细条不出现；控制台没有报错。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 在桌面 1280×700 的 demo 模式里实测：
    - 用滚轮滚动时细条出现，位置跟滚动一致。
    - 点导航切换页面时，细条不出现，滚动位置保留。
    - 拖动细条能滚动（220 → 344）。
    - 滚到底时，底部渐隐消失。
    - App 首次加载时细条闪现一次（第 868ms 出现，1803ms 隐藏）。
  - 深色、浅色截图都检查过：细条在侧栏右侧的留白里，不会盖住导航项。
- **实现时多处理的一点**：App 启动时会连续渲染外壳，所以「已经闪过」要等真正闪过之后才记下，否则第一次准备的闪现被清掉以后就再也不会闪。
- **改动的文件**：`shell.css`、`theme.css`（新增 `--scrollbar-thumb` token）、`ui.ts`，新增 `src/sidebarScrollbar.ts`。

---

## 电脑版液态玻璃（DG 系列）

目标：把液态玻璃带到电脑版，放在「下面有内容经过」的地方。Preview（四个方向，每个都能切换现在和改后）：
https://claude.ai/artifact/CwUnAFNNqpuozceC6bYTSY

- **Problem**：G 系列的玻璃主要在手机上（Tab 栏、顶栏）。电脑宽度下只剩 Ask 按钮是玻璃，电脑版几乎看不到新风格。
- **Why**：你主要用电脑 Chrome。纯视觉打磨，不影响核心逻辑。
- **Current System**：
  - 电脑版页面顶部有一个大标题区 `.topbar`，和每页自己的标题重复，Dashboard 上「Overview」出现两次。手机版已经把它隐藏了。
  - Ask 面板（`assistant.css`）和 Version History 弹窗（`ui.ts` 的 `renderVersionHistoryModal`）是实色背景。
  - 分段选择器 `wu-segmented`（Ledger 交易类型、Ledger 时间范围、Rules）和 Ask 面板的 Ask/Record 切换，选中项是直接跳过去的。
  - 侧栏贴着窗口左边，是一整条实色。
  - 光线 `side-rays`：代码里配的是黄色（`#EAB308`）和蓝色（`#96c8ff`），但 `shell.css` 给它加了 `grayscale(1)` 和 `opacity: 0.09`，所以实际上是很淡的灰光。手机和电脑共用这一个组件。
- **Architecture**：全部复用 G-1 的玻璃材质和 `--glass-*` token；Ask 面板和弹窗要新增一种更厚的玻璃；滑动镜片沿用 Tab 栏的做法（`liquidGlass.ts`）。

### 已定的决定（2026-09-15）
- 四个方向**都做**。
- 光线改成手机 Preview 里的**绿色 + 铜色**，并且要真的看得出颜色：去掉灰色滤镜，调高不透明度。手机和电脑一起改。
- G-4 真折射不做（见上）。

### DG-1 — 光线改成绿色 + 铜色  `[x]`（2026-09-16，PR #47，merged）
- `ui.ts` 里 `mountSideRays` 的两个颜色改成品牌绿和铜色；`shell.css` 里去掉 `grayscale(1)`，把 `opacity: 0.09` 调高。强度对照 Preview，深色和浅色都要检查。
- 光线底部渐隐到背景色的那层（`.side-rays::after`）保留，所以不会影响下面卡片的文字。
- **完成标准**：手机 390 宽和桌面 1280 宽，深色、浅色各截一张；光线不影响文字可读性。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错；手机和桌面、深色和浅色都截图检查过。
  - 颜色：`rayColor1` 铜色 `#c79b57`，`rayColor2` 绿色 `#57a78f`（blend 0.75 偏向 rayColor2，所以以绿色为主）。
  - 去掉了 `grayscale(1)`。强度用 `theme.css` 里的 token 控制：深色 `--rays-opacity: 0.65`，浅色 `0.5`。
  - 光线照得更远：`intensity` 从 2 调到 2.6，`falloff` 从 1.6 调到 1.1。
  - 浅色主题用 `mix-blend-mode: multiply`：浅色背景上「加亮」看不出来，改成把颜色叠深。
  - 底部淡出从「渐变到背景色的覆盖层」改成 mask。旧写法在 multiply 下会显出一条横线。
- **没解决的**：桌面上能看出绿色光束；手机上几乎看不到，光源在右上角，被玻璃顶栏盖住了。要不要给手机单独加强，看真机再决定。
- **跟 Preview 的差别**：Preview 里的光线是用 CSS 画的条纹，比较锐利；真实 App 是 WebGL 动态光，更柔和。

### DG-2 — 吸顶玻璃栏 + 去掉重复大标题  `[x]`（2026-09-16，PR #48，merged）
- 电脑版隐藏 `.topbar`，跟手机版一样只保留每页自己的标题。
- 往下滚、页面标题离开视线后，顶部出现一条细玻璃栏显示页面名称；滚回顶部时消失。用 IntersectionObserver 判断，不在每次滚动时计算。
- 只在电脑宽度生效。手机版已经有玻璃顶栏，不叠第二条。
- **完成标准**：Dashboard、Ledger、Portfolio 滚动截图；玻璃栏不盖住侧栏；控制台没有报错。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 实测：
    - 页面在顶部时，玻璃栏隐藏，也没有重复的大标题。
    - 往下滚、页面标题离开视线后，玻璃栏出现（从 270px 到右边缘，高 56px），卡片从下面经过时被模糊。
    - 滚回顶部时，玻璃栏消失。
    - 切换页面时页面回到顶部，玻璃栏立即隐藏，不会闪。
    - 手机上玻璃栏不显示。
  - 截图检查了深色 Dashboard、深色 Ledger、浅色 Portfolio。
- **跟计划不同的两处**：
  1. **用 `position: fixed`，不用 sticky**：`.main` 设置了 `overflow: hidden`，sticky 会粘在 `.main` 上而不是屏幕顶部。
  2. **不用 IntersectionObserver，改成滚动时检查（每帧最多一次）**：页面会整页重新渲染，换掉标题元素，IntersectionObserver 盯着的旧元素就失效了。
- **改动的文件**：`ui.ts`（`.topbar` 换成 `.titlebar`）、`shell.css`（删掉 `.topbar` 样式，新增 `.titlebar`），新增 `src/titleBar.ts`。

### DG-3 — Ask 面板和弹窗改成玻璃  `[x]`（2026-09-16，PR #49，merged）
- 新增更厚的玻璃 token（比如 `--glass-sheet`）：模糊更强、底色更实，保证文字清楚。
- 这一步只做 Ask 面板和 Version History 弹窗；弹窗后面的遮罩调淡。App 里其他弹窗先列出来，由你决定要不要一起改。
- **完成标准**：面板里文字的对比度达到 AA；深色和浅色截图检查。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 新增厚玻璃 `.wu-glass--sheet`：模糊 24px，底色深色 `rgb(24 24 28 / 0.72)`、浅色 `rgb(255 255 255 / 0.7)`，比 Preview 里的 0.62 更实，因为真实页面比 Preview 更花。
  - Ask 面板：面板本身换成厚玻璃；输入框换成半透明的「凹槽」色 `--glass-well`。
  - Version History 弹窗：卡片换成厚玻璃；遮罩从 `--surface-overlay` 换成更淡的 `--surface-overlay-glass`，并去掉遮罩原来的 4px 模糊，避免跟玻璃重复模糊。
  - 系统开了「减少透明度」时，厚玻璃退回实色。
  - 截图检查了 Ledger 页打开 Ask 面板、Settings 页打开弹窗，深色和浅色都看过：文字清楚，面板后面隐约能看到页面。
- **没有改的其他弹窗（等你决定）**：
  - iPhone「安装到主屏幕」说明（`main.ts` 的 `showIOSInstructions`），还是实色卡片加深色遮罩。
  - 删除、导入前的确认框是浏览器自带的 `confirm()`，样式改不了。
- **改动的文件**：`theme.css`、`components.css`、`assistant.css`、`assistantWidget.ts`、`ui.ts`。

### DG-4 — 分段选择器加滑动镜片  `[x]`（2026-09-16，PR #50，merged）
- `wu-segmented` 和 Ask/Record 切换，改成玻璃镜片滑到选中项。
- **坑**：Ledger 点选项后会重新渲染页面，镜片没办法自己滑。要像 Tab 栏一样记住上一个选中项，再从那里滑过来。每个选择器分开记。
- **完成标准**：三个真实的选择器都要实测镜片位置和滑动；键盘操作仍然可用。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 实测了 Ledger 交易类型、Ledger 时间范围、Rules 分类、Ask/Record 切换：
    - 镜片和选中项完全重合（误差不超过 1px）。
    - 点击后页面重新渲染时，镜片会从上一个选项滑过去（截到了滑动中途的位置）。
  - 截图检查了深色和浅色。
- **做法**：`liquidGlass.ts` 用一个 MutationObserver（每帧最多检查一次）找到页面上所有的 `.wu-segmented` 和 `.assistant-tabs`，自动加上镜片，并按「aria-label + 选项的 data 属性」记住上一次选中哪一项。**没有改任何页面模板**，以后新增的分段选择器会自动带上镜片。
- **顺带的外观变化**：`.wu-segmented` 从圆角矩形改成胶囊形，跟 Preview 和 Ask/Record 切换一致。
- **键盘**：选项还是原来的按钮，Tab 和回车照常能用；选中项获得焦点时，焦点框照常显示（样式规则里用了 `:not(:focus-visible)`）。这一点只检查了样式规则，没有实际用键盘测试。
- **改动的文件**：`liquidGlass.ts`、`components.css`、`assistant.css`、`theme.css`（新增 `--glass-lens-raised`）。

### DG-5 — 侧栏变成悬浮玻璃面板  `[x]`（2026-09-16，PR 待合并）
- 侧栏四周留空、圆角，浮在页面上。要让光线延伸到侧栏后面，玻璃才看得出效果，所以要调整页面布局和光线的位置。
- **会互相影响的地方**：S-1 的滚动条（细条放在侧栏的留白里）、DG-2 的吸顶栏（左边从哪里开始）、页面内容区的宽度。
- 做完 DG-1 到 DG-4 看过效果以后，再确认要不要做。
- **决定（2026-09-16）：做。**
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 只在电脑宽度（≥721px）生效，全部改动放在 `shell.css` 的一个 `@media (min-width: 721px)` 块里：
    - 侧栏 `position: fixed`，四周留 12px，宽 256px，圆角 24px，用 DG-3 的厚玻璃（`--glass-sheet`、24px 模糊）。
    - 页面改成单列、全宽；内容区用左边距避开侧栏。内容的左边缘在 1280 宽时是 318px，改之前约 321px，基本不变。
    - 侧栏后面加了一层固定的柔光（`.main::after`，绿色从左上、铜色从左下），强度用 token `--sidebar-glow` 控制（深色 0.28、浅色 0.2）。这样不管页面滚到哪里，玻璃后面都有东西可以透。
    - DG-2 的吸顶栏也跟着改成悬浮：离顶部和右边 12px，左边对齐侧栏右侧，高 48px，圆角 16px，带高光边。
    - 侧栏底部的用户区原本有实色背景（用来盖住旧侧栏），在玻璃上会显得像一块方形色块，改成透明。
  - 实测：
    - 1280 和 900 宽都没有横向溢出。
    - 侧栏位置 12→268px；S-1 的滚动条细条在侧栏里面（256–261px）。
    - 点导航能正常切换页面，吸顶栏照常出现和消失。
    - 手机 390 宽保持原样：侧栏还是隐藏的抽屉，没有玻璃也没有圆角；底部 Tab 栏照常显示。
  - 截图检查了深色 Dashboard（顶部和滚动后）、浅色 Ledger、900 宽，以及侧栏底部。
- **改动的文件**：`shell.css`、`theme.css`（新增 `--sidebar-glow`）、`titleBar.ts`（吸顶栏出现的判断线从 56px 改成 60px，对应悬浮后的位置）。

---

## V1 待办（全部完成）

### V1-1 — `pwo-save-error` 事件补一个监听器  `[x]`  （PR #12，merged）
- **问题**：`src/state.ts` 有 4 处 `dispatchEvent(new CustomEvent("pwo-save-error", ...))`
  （本地存储失败、云同步失败、云数据无法本地缓存、快照写入失败），但 `src/` 里
  **0 个监听器** —— 用户永远看不到这些提示。
- **影响**：静默失败。存储配额满 / 隐私模式下写入失败时，用户以为数据存了。
- **做法**：`src/components/toast.ts` —— `initSaveErrorToasts()`，`main.ts` 启动时调一次。
  右下角堆叠提示条，`role="alert"` + 容器 `aria-live="polite"`（不抢焦点），6.5s 自动消失、
  可点 × 关、上限 3 条、CSS 淡入淡出、reduced-motion 安全、消息缺失有兜底文案。
  样式全用现有主题变量，明暗都验。不动 `state.ts`。
- 验证：真实 app 跑过 —— 单条渲染 / 连发 6 留 3 / 空 detail 兜底 / × 关 / 自动消失 /
  patch `localStorage.setItem` 抛错走真实链路 / 浅色主题。typecheck + test 699 + build 全绿。

### V1-2 + V1-3（合并）— 云同步不再被设备时钟决定，改用 onSnapshot  `[x]`  （PR #15，多设备手验待做）
- **决定（2026-09-08）**：走方案 C —— 把 V1-2（时钟偏差）和 V1-3（实时订阅）合并做。
  设计 spike 结论：A（dirty-flag）和 B（serverTimestamp）都得靠 `hasPendingWrites` 补
  离线洞，等于半个 C；分两次做要碰两遍持久化层、迁移两遍 schema。
- **问题**：`cloudCopyWins` 比较两个设备各自的 `Date.now()`；时钟歪的设备会盖掉别人的新编辑。
- **做法**：`onSnapshot(ref, {includeMetadataChanges:true})`。`metadata.hasPendingWrites`
  是「本地有没有没被服务器确认的写」的权威信号 —— 决策完全不碰挂钟，离线也对。
  服务器确认（pending 清空且非 fromCache）时记同步点。
- **子步骤**（逐步做，每步 STOP 汇报）：
  - C-1 schema + 迁移：`WealthState` 加 `lastSyncedAt`，`CURRENT_VERSION` 19→20，`migrateState` 兜底。
  - C-2 `firebase.ts`：`subscribeToFirestore` 传 `includeMetadataChanges`，回调带 `{state, fromCache, hasPendingWrites}`。
  - C-3 `main.ts`：登录时订阅、登出/切换时退订（`cloudSyncUnsub` 管道已在）。
  - C-4 冲突/合并规则：远端快照到达时如何应用；用户正在编辑时不静默覆盖。
  - C-5 `loadStateFromCloud` 初次加载路径改用 `lastSyncedAt` 做无偏决策。
  - C-6 测试：迁移 v19→v20；时钟偏差；离线改动→上线；两设备并发；快照 metadata。
  - C-7 手验：5173 真实模式，两个浏览器 profile 当两台设备。
  - C-8 PR。
- 规模：中偏大。碰持久化契约。

### V1-4 — 行情数据韧性（`/api/*` 上游结构变化）  `[x]`  （PR #18）
- 把 Yahoo / TradingView 响应解析抽成纯函数（`parseYahooQuote` / `readTopHoldings` /
  `parseTradingViewFundamentals`）+ 44 个测试：各种坏结构一律「无数据」，绝不编造数字。
- `history` 原样转发前加 `isYahooChartBody` 校验；`response.json()` 加保护。
- 陈旧数据诚实性 —— 查过，之前已做好（`livePrices.ts` 不覆盖好价/不伪造；
  `valuationFormat.ts` 显示成交时间 + 「may be delayed」），本次未动。

### V1-5 — 文档漂移小修  `[x]`  （PR #14）
- `WEALTHUP_CONTEXT.md` 4 处写 `version = 20`（实际 `CURRENT_VERSION = 19`）+ 下一次 bump 写成 21 → 全改对。
- 顺带把 P1「迁移测试覆盖」待办标完成（`architecture.test.ts` 已有表格驱动测试）。
- **仍待清**：`WEALTHUP_CONTEXT.md` P1/P2 里还有已做的待办没标（如第 198 行 `/api/*` 限流 = PR #5 已做）。见 FUTURE IDEAS。

---

## 已完成（本轮，2026-09-08）

| PR | 内容 | 状态 |
| --- | --- | --- |
| #5 | 行情代理按 IP 限流 + 边缘缓存加固 | merged |
| #6 | `COMMERCIALIZATION_PLAN.md` + 把 `WEALTHUP_CONTEXT.md` 纳入 git + `README.md` | merged |
| #7 | Advisor 页 / 侧边栏常驻「非投资建议」声明 + 语气审计 | merged |
| #3 | 快照存储按字节预算（2MB）而非仅数量 + 写入永不抛异常 | merged |
| #9 | 价格轮询不再重画整页 → 不再清空半填的 Portfolio 表单 | merged |
| #10 | `CLAUDE.md`（工作系统，每次会话自动加载） | merged |
| #8 | 恢复快照字节预算的 8 个测试 + `_test.mjs` 强制退出（修 CI 卡死） | merged |
| #11 | 建立 `PLAN.md` + `PROGRESS.md` | merged |
| #12 | **V1-1**：`pwo-save-error` 补全局 toast 监听 | merged |

---

## FUTURE IDEAS（V1 之后 / 待决定，不自动做）

- **Ledger 记账表单的吸顶可能不生效**（做 DG-2 时发现，2026-09-16）：`.wu-ledger-entry` 设置了 `position: sticky`，但外层 `.main` 是 `overflow: hidden`，sticky 会粘在 `.main` 上，滚动时表单不会跟着。没有实测确认，也没改。修法可能是把 `.main` 改成 `overflow: clip`，但它会影响光线裁切，需要单独验证。

- **液态玻璃真折射（原 G-4）**：只有 Chromium 内核的浏览器支持，iPhone Safari 看不到。等电脑版有更多浮在内容上的玻璃元素时再考虑。G-0 Preview 里已经有可用的实现（位移贴图 + SVG 滤镜）。

- `COMMERCIALIZATION_PLAN.md` 全部内容（Capacitor 打包、付费订阅、AI 视频增长）。
- 阶段 0 里偏商业化的项：Apple / 邮箱登录、账号删除流程、数据导出复核。
- `WEALTHUP_CONTEXT.md` 第 9 节（P0-P4 待办清单）整体过一遍 —— 里面多条其实本轮已做
  （限流、字节预算、免责声明、CI 卡死、Portfolio 表单），标记或删除。
- 清掉手机上已废弃的导航 chrome：`.hamburger` 按钮 + `#sidebarToggle` + 滑出
  `.sidebar` 抽屉的 markup/CSS。手机导航现已全部走底部 tab bar + "More" 整页
  （见 `ui.ts` 注释 124-127），抽屉只剩桌面侧边栏在用；手机相关的抽屉代码是死代码。
