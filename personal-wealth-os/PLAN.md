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
  - Wealth Vault —— 全新功能，上传财务文件自动提取数字；是否为此引入 AI/OCR 待你决定
    （现在 Advisor 是零 AI、纯确定性规则架构，这会是一个架构例外）。

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
- **FUTURE IDEAS（未决定）**：Wealth Vault（AI/OCR 架构取舍还没讨论出结论）。

下一步产品打磨项由你定。

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
