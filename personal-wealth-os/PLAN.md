# WealthUp — PLAN

> 当前目标：**把 V1 做到核心逻辑正确、真正可用。** V1 完成后才考虑
> `COMMERCIALIZATION_PLAN.md` 里的大型功能（App 化、付费、AI 视频）。
> 每完成一个 Task 更新这里的状态，并同步 `PROGRESS.md`。

状态标记：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成

---

## V1 待办（按优先级）

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

### V1-2 — 服务端权威时间戳  `[ ]`
- **问题**：`cloudCopyWins(localUpdatedAt, cloudUpdatedAt)` 比较的是各设备自己的
  `Date.now()`（`state.ts:623`，注释里也承认「时钟歪的设备会赢不该赢的冲突」）。
- **影响**：多设备场景下，时钟偏差 → 静默数据丢失（旧的云副本盖掉新的本地编辑，或反之）。
- **Done when**：引入 Firestore `serverTimestamp()` 作为权威 `updatedAt`；schema 变更
  → `CURRENT_VERSION` 从 19 升 20 + `migrateState` 写向后兼容迁移；补测试：旧数据迁移
  不丢字段、并发编辑服务端时间新的胜、离线补传后时间戳正确。
- 规模：中。碰持久化契约。

### V1-3 — 实时云订阅：要不要做，决定后再动  `[ ]`
- **现状**：`subscribeToFirestore`（`firebase.ts:142`，用 `onSnapshot`）已实现，
  `main.ts` 有 `cloudSyncUnsub` 的清理管道，但「另一台设备改了 → 当前页自动刷新」
  这个行为是否真的接上、是否要进 V1，未定。
- **Done when（先决策）**：你决定 V1 是否需要跨设备实时刷新。
  - 要 → 接上 `onSnapshot`，处理与「本地未保存编辑」的合并冲突，补测试。
  - 不要 → 在 PLAN 里记为「V1 不做」，关掉这条。
- 规模：不做=0；做=中偏大（合并冲突是难点）。

### V1-4 — 行情数据韧性（`/api/*` 上游结构变化）  `[ ]`
- **现状**：客户端 `marketValuation.test.ts` 已覆盖「畸形数据降级为无价，绝不为 0」。
  未覆盖：serverless 侧 Yahoo / TradingView 改字段或封 UA 时的行为；陈旧数据展示时
  是否带「最后成交时间」标识而非冒充实时。
- **Done when**：`api/market.ts` 每个 `kind`（history / holdings / fundamentals）补
  「上游返回异常结构」的测试；失败降级到陈旧数据时 UI 带时间戳。
- 规模：中。仅 `api/` + 展示边界。

### V1-5 — 文档漂移小修  `[ ]`
- `WEALTHUP_CONTEXT.md` 多处写 `version = 20`，实际 `CURRENT_VERSION = 19`。校对一遍。
- 规模：极小。

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
