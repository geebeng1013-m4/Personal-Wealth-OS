# WealthUp — PROGRESS

> 打开项目先看这里：我们现在在哪、最近做了什么、当前在做什么、下一步。
> 每完成一个 Task 更新。任务清单和优先级在 `PLAN.md`。

---

## 我们现在在哪

- **阶段**：V1 完成（2026-09-09）。核心正确性的洞都补上了。之后：**产品打磨** —— 手机比例这轮
  已收尾（M-1..M-6，见下）。App / 订阅方向因预算暂停（见下），先把产品本身做好。
- **`main`**：`cc2fae5` —— typecheck / 769 测试 / build 全绿。
- **工作方式**：见 `CLAUDE.md`（每次会话自动加载）。文档 bookkeeping 直接进 main，代码走 PR。

## V1 收尾（全部合并）

| 项 | PR | 内容 |
| --- | --- | --- |
| V1-1 | #12 | `pwo-save-error` 补全局 toast —— 写入失败不再静默 |
| V1-2+V1-3 | #15 | 云同步不靠设备时钟（`onSnapshot` + `hasPendingWrites`）+ 跨设备通知/Reload。多设备手验通过 |
| V1-4 | #18 | 行情 `/api/*` 上游结构变化韧性 —— 解析抽纯函数 + 44 测试，坏结构一律「无数据」 |
| V1-5 | #14 | `WEALTHUP_CONTEXT.md` 版本号漂移订正 |

本轮更早的基建：限流(#5)、商业化计划+CONTEXT入库+README(#6)、免责声明(#7)、快照字节预算(#3)、
Portfolio 表单不被价格轮询清空(#9)、CLAUDE.md(#10)、CI 卡死修复(#8)、PLAN/PROGRESS(#11)。
顺带（不在 V1 清单）：交易表单 USD 化(#16)、Sponsored 资金来源回归(#17)。

## 手机比例打磨（M 系列，已收尾）

目标：手机页面「看起来不乱、用起来直接知道 use for 什么」。改动集中在 `@media (max-width: 720px)`
+ 一个新页面（More），不动任何页面逻辑。详见 `PLAN.md` M-1..M-6。

| PR | 内容 | 状态 |
| --- | --- | --- |
| #21 | M-1：整体缩小 ~20%（缩 token）+ 每页只留一个标题 + 四边安全区留白 | merged |
| #22 | M-2：页面标题口语化（4 个标题对齐侧栏名 + 9 条副标题重写） | merged |
| #23 | M-3（1A）：标题上到汉堡行 —— 你看了不要，撤销、关 PR | closed |
| #24 | M-4 底部 Tab 栏 +「More」整页（Moomoo Discover 式）· M-5 卡片间距收紧 · M-6 Market 图表右尺寸 | merged |
| #20 | 原生 Android 工程（`npx cap add android`） | merged（App 方向暂停，工程留着） |

手机导航现在是：底部 4 Tab（Home / Ledger / Portfolio / Budget）+ More 整页；抽屉只剩桌面侧栏用。
12 页 + More 全部 CDP 390px 验过：无横向溢出。**这轮收尾。**

## App / 订阅方向（暂停）

- 因预算不足，`COMMERCIALIZATION_PLAN.md` 阶段 1（Capacitor 打包上架）+ 付费订阅**暂停**，
  由你决定何时重启。Capacitor 脚手架（#19）+ 原生 Android 工程（#20）+ `docs/app-packaging.md`
  操作手册都留在库里，随时可继续。
- 重启时的下一步：有 Android Studio 的机器按手册 §2 跑 `cap:sync` → Android Studio 运行；
  Firebase 登录在 WebView 里要改原生流程（手册 §2a）。

## 下一步

- 手机比例这轮已收尾。之后的产品打磨项由你定。

## FUTURE IDEAS / 待清

- `WEALTHUP_CONTEXT.md` 第 9 节 P0-P4 待办清单整体过一遍 —— 本轮做掉的多项（限流、字节预算、
  免责、CI 卡死、Portfolio 表单、云同步、行情韧性）还挂在那当 TODO，该标记或删除。
