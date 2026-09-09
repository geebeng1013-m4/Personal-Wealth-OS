# WealthUp — PROGRESS

> 打开项目先看这里：我们现在在哪、最近做了什么、当前在做什么、下一步。
> 每完成一个 Task 更新。任务清单和优先级在 `PLAN.md`。

---

## 我们现在在哪

- **阶段**：V1 收尾。功能基本完整、已上线 `wealthup.cc`，在补正确性和稳健性的洞。
- **`main`**：`fc6be65` —— 含 V1-1 / V1-5 / V1-2+V1-3(#15) / 交易表单 USD 化(#16) / sponsored 资金来源(#17)。
- **工作方式**：见 `CLAUDE.md`（每次会话自动加载）。文档 bookkeeping 直接进 main，代码走 PR。

## 最近完成（2026-09-08，本轮）

- 行情代理按 IP 限流 + 缓存加固（PR #5）
- 加了 `COMMERCIALIZATION_PLAN.md`、把 `WEALTHUP_CONTEXT.md` 纳入 git、加了 `README.md`（PR #6）
- Advisor / 侧边栏常驻「非投资建议」声明（PR #7）
- 快照存储按字节预算 + 写入永不抛异常（PR #3）
- **Portfolio 表单不再被价格轮询清空**（PR #9）—— 用户报的 bug，已修并验证
- 加了 `CLAUDE.md`（工作系统，每次会话自动加载）（PR #10）
- 恢复快照测试 + `_test.mjs` 强制退出修 CI 卡死（PR #8）
- 建立 `PLAN.md` + `PROGRESS.md`（PR #11）
- **V1-1 完成**：`pwo-save-error` 补全局 toast 监听 —— 写入失败不再静默（PR #12）
- **V1-5 完成**：`WEALTHUP_CONTEXT.md` 版本号漂移订正（PR #14）
- **V1-2 + V1-3 完成**：云同步不再靠设备时钟 —— 改用 `onSnapshot` 的 `hasPendingWrites`；另一台设备改了 → 通知 + Reload（PR #15，**多设备手验通过**：两浏览器 profile 同账号，B 加一笔 → A 收通知 → Reload → 一致）

## 当前正在做

- 无进行中的 Task。云同步多设备手验已过。V1 只剩 V1-4。

## 下一步

1. V1 只剩 **V1-4**（行情 `/api/*` 上游结构变化韧性）。


## 待决定

- （无）
