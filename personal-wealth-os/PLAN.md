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

### M-2 — 页面标题口语化  `[~]`  （PR #22，待合并）
- **问题**：副标题是给桌面仪表盘写的——长、抽象（"canonical snapshot"、"deterministic checks"），
  手机上折到三行。侧栏名和页面标题也对不上（"Wealth Overview" vs "Overview"）。
- **做法**：4 个标题对齐侧栏名（Overview / Goals / Budget / Settings）；9 条副标题重写成一行
  大白话（"What you're saving for, and how close you are." 等）。Dashboard 动态副标题、Review 不动。
- 验证：typecheck / 769 测试 / build 全绿，无测试断言旧文案。

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
