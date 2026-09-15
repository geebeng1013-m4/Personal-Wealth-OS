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
- **做这个时发现的两个 bug，一起修了**：
  1. **Version History 对真实账号永远是空的**：保存按 `uid` 存，打开时按 `email` 读，两个 key 对不上。所以 Reset / Import
     存的备份在真实账号里**根本打不开**（demo 模式看不出，因为 demo 没有 email）。改成按 uid 读、清空、恢复。
  2. **Restore 没有先存当前数据**：确认框写着「当前状态会先存一份」，实际没存。现在恢复前存「Before restore」。
- 验证：955 测试（建议目标计算、只算必要支出、空值/坏值、Reset 空白）；浏览器实测：侧栏/More 页工具已无、账号行在；
  Settings 卡片 6 个工具 Reset 在最后；建议 MYR 7,200 → 按钮填入不保存；主题切换；Reset → 设置全 0、Goals 空、显示提示；
  Version History 出现「Before reset」，Restore 后多出「Before restore」；手机无横向溢出。

#### R-5  `[ ]`
- R-4 新用户默认：紧急资金 6 个月、熊市储备关闭 · R-5 原则存成 `docs/` 正式文件

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

- `COMMERCIALIZATION_PLAN.md` 全部内容（Capacitor 打包、付费订阅、AI 视频增长）。
- 阶段 0 里偏商业化的项：Apple / 邮箱登录、账号删除流程、数据导出复核。
- `WEALTHUP_CONTEXT.md` 第 9 节（P0-P4 待办清单）整体过一遍 —— 里面多条其实本轮已做
  （限流、字节预算、免责声明、CI 卡死、Portfolio 表单），标记或删除。
- 清掉手机上已废弃的导航 chrome：`.hamburger` 按钮 + `#sidebarToggle` + 滑出
  `.sidebar` 抽屉的 markup/CSS。手机导航现已全部走底部 tab bar + "More" 整页
  （见 `ui.ts` 注释 124-127），抽屉只剩桌面侧边栏在用；手机相关的抽屉代码是死代码。
