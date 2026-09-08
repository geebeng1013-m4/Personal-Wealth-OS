# WealthUp — PROGRESS

> 打开项目先看这里：我们现在在哪、最近做了什么、当前在做什么、下一步。
> 每完成一个 Task 更新。任务清单和优先级在 `PLAN.md`。

---

## 我们现在在哪

- **阶段**：V1 收尾。功能基本完整、已上线 `wealthup.cc`，在补正确性和稳健性的洞。
- **`main`**：`3c2e55d`（含本轮全部已合并 PR）。
- **工作方式**：见 `CLAUDE.md`（每次会话自动加载）。

## 最近完成（2026-09-08，本轮）

- 行情代理按 IP 限流 + 缓存加固（PR #5）
- 加了 `COMMERCIALIZATION_PLAN.md`、把 `WEALTHUP_CONTEXT.md` 纳入 git、加了 `README.md`（PR #6）
- Advisor / 侧边栏常驻「非投资建议」声明（PR #7）
- 快照存储按字节预算 + 写入永不抛异常（PR #3）
- **Portfolio 表单不再被价格轮询清空**（PR #9）—— 用户报的 bug，已修并验证
- 加了 `CLAUDE.md`（工作系统，每次会话自动加载）（PR #10）
- 恢复快照测试 + `_test.mjs` 强制退出修 CI 卡死（PR #8，CI 绿，**待你在 GitHub 合并**）
- 建立 `PLAN.md` + `PROGRESS.md`（本文件）

## 当前正在做

- **Task 1（进行中）**：起草 `PLAN.md` + `PROGRESS.md`，交你审。
- 下一步 **Task 2**：你编辑 `PLAN.md`，删掉不属于 V1 的、调整优先级 —— 这一步定下 V1 范围。

## 下一步

1. 合并 PR #8（GitHub 上点）。
2. 你审 `PLAN.md`，定 V1 范围（Task 2）。
3. 动第一个 V1 修复（`PLAN.md` 里排最前的，目前是 V1-1 `pwo-save-error` 监听器）。

## 待决定

- V1-3：跨设备实时刷新要不要进 V1（见 `PLAN.md`）。
