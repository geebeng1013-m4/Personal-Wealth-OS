# WealthUp — PROGRESS

> 打开项目先看这里：我们现在在哪、最近做了什么、当前在做什么、下一步。
> 每完成一个 Task 更新。任务清单和优先级在 `PLAN.md`。

---

## 我们现在在哪

- **阶段**：**V1 完成**（2026-09-09）。核心正确性的洞都补上了。
- **`main`**：`70a6823` —— typecheck / 769 测试 / build 全绿。
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

## 当前正在做

- **阶段 1 起步（做成 App）**：Capacitor 脚手架已合并（#19）—— 依赖 + `capacitor.config.ts` + `cap:sync` 脚本 + `docs/app-packaging.md` 全套操作手册。
- 下一步在你手上：在有 Android Studio 的机器跑 `npx cap add android`，按手册走。

## 下一步

1. 你在有 Android Studio 的机器上按 `docs/app-packaging.md` §2 跑起来（`npx cap add android` → `cap:sync` → Android Studio 运行）。遇到报错发我。
2. Firebase 登录在 WebView 里要改成原生流程（手册 §2a，代码片段已给）。
3. 之后：iOS（要 Mac）、图标/深链、上架。

## FUTURE IDEAS / 待清

- `WEALTHUP_CONTEXT.md` 第 9 节 P0-P4 待办清单整体过一遍 —— 本轮做掉的多项（限流、字节预算、
  免责、CI 卡死、Portfolio 表单、云同步、行情韧性）还挂在那当 TODO，该标记或删除。
