# WealthUp — PROGRESS

> 打开项目先看这里：我们现在在哪、最近做了什么、当前在做什么、下一步。
> 每完成一个 Task 更新。任务清单和优先级在 `PLAN.md`。

---

## 我们现在在哪

- **阶段**：V1 完成（2026-09-09）。核心正确性的洞都补上了。之后：**产品打磨** —— 手机比例这轮
  已收尾（M-1..M-6，见下）。App / 订阅方向因预算暂停（见下），先把产品本身做好。
- **`main`**：`c5cb80f`。PR #34（Dashboard 具体化 headline + TVM What-if）待 merge，见下。
- **工作方式**：见 `CLAUDE.md`（每次会话自动加载）。文档 bookkeeping 直接进 main，代码走 PR。

## 电脑版液态玻璃（DG 系列，计划中）

四个方向都做（吸顶玻璃栏、玻璃面板和弹窗、分段选择器滑动镜片、悬浮侧栏），光线改成绿色 + 铜色。拆成 DG-1..DG-5，详见 `PLAN.md`。
- **DG-1 完成（2026-09-16）**：光线改成绿色 + 铜色，去掉灰色滤镜，强度按主题分开设置。桌面看得出，手机几乎看不到（被顶栏盖住），待真机决定。
- **DG-2 完成（2026-09-16）**：电脑版去掉重复的大标题；往下滚时顶部出现玻璃栏显示页面名称。PR 待合并。
- **DG-3 完成（2026-09-16）**：Ask 面板和 Version History 弹窗换成厚玻璃，弹窗遮罩调淡。PR 待合并。
- **DG-4 完成（2026-09-16）**：所有分段选择器（Ledger、Rules、Ask/Record）加上会滑动的玻璃镜片，没改页面模板。PR 叠在 #49 上。
- **当前**：DG-5（悬浮玻璃侧栏），改动最大，要先确认做不做。

## 侧栏滚动条（S-1，已合并）

电脑版左侧栏的滚动条改成 iOS 式：平时隐藏，滚动时出现，停下后淡出，可以拖动；首次打开闪现一次；上下边缘渐隐。
PR #46，2026-09-15 合并进 `main`（`adfe313`）。详见 `PLAN.md` S 系列。

## 液态玻璃按钮（G 系列，G-1..G-3 已合并）

按钮和浮层改成 iOS 26 液态玻璃风格。详见 `PLAN.md` G 系列。

- **最近完成（2026-09-15）**：G-0 讨论和 Preview。分层方案、主按钮颜色、L2 不加模糊、顶栏做成玻璃、保留光线、四个参数都已定。
  项目代码没有改动。Preview：https://claude.ai/artifact/DWFjJPJ2Nof42eZSZTtZZB
- **G-1 完成（2026-09-15）**：手机顶栏改成玻璃，Tab 栏改成悬浮玻璃胶囊并加了滑动镜片，Ask 按钮改成绿色玻璃。
  测试、build 通过，截图检查过。还需要在真 iPhone 上检查。
- **G-2 完成（2026-09-15）**：primary、secondary、danger 三种按钮改成轻玻璃（胶囊形、高光边、按下鼓起），不加背景模糊，
  也没有改页面模板。测试、build 通过，截图检查过。
- **G-3 完成（2026-09-15）**：ghost 和 icon 按钮改成胶囊圆角。
- **已合并（2026-09-15）**：PR #45 合并进 `main`（`ce2294b`），#44 那个分支上的 Overview 目标卡片 commit 也一起进了 `main`。
- **下一步**：真 iPhone 检查；决定 G-4 Chrome 折射做不做。

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

## 零散打磨（M 系列之后）

| PR | 内容 | 状态 |
| --- | --- | --- |
| #25 | 手机头部留白（`.main` 顶部 22→40px，桌面不动） | merged |
| #26 | 交易表单选券商：Platform 下拉 +「+ Custom」，预选上次用的；不再写死 "moomoo" | merged |
| — | P-3：定位文案更新（README.md / WEALTHUP_CONTEXT.md，讲清楚「现状→决定→复盘」链路） | merged（文档，直接进 main） |
| #34 | P-4：Dashboard headline 具体化（`drivingFactor()`）+ TVM「What If I Spend This?」（一次性/每月、机会成本、一句话总结） | 待 merge |

**观察（待你定）**：桌面版仍有两个「Overview」标题（外壳 topbar + 页面 header）—— M-1 只在手机隐藏了 topbar。

## AI 助手（A 系列，已上线 2026-09-14）

右下角悬浮助手：**Ask** 问答 + **Record** 一句话预填记账 / 交易表单（保存永远你自己按）。
模型 `ling-3.0-flash-fin:free`（OpenRouter 免费档）。服务器在 Firebase Cloud Function，key 只在服务器端。
Advisor 不受影响，仍然零 AI。详见 `PLAN.md` A-1..A-6。

| PR | 内容 | 状态 |
| --- | --- | --- |
| #35 | A-1 服务器代理 · A-2 悬浮组件 · A-3 Ask · A-4/A-5 Record（记账 + 交易）· A-6 隐私 | merged，已上线 |

实测抓到并修掉：模型会**编造汇率**填进令吉金额（现在你没说过的数字一律不填）；reasoning 模型思考吃光
输出预算导致空回复。

## 助手理财原则（R 系列）+ 修 bug

| PR | 内容 | 状态 |
| --- | --- | --- |
| #36–#39 | R-1 原则 + 安全网 · 额度用光提示 · R-2 发送用户规则 · R-3 财务目标 | 待 merge（按顺序） |
| #40 | BUG：Settings 保存后规则不跟着变 | 待 merge |
| #41 | Import 前先存 Version History | 待 merge |
| #42 | R-4：工具移到 Settings · Reset 真空白 · 紧急资金 6 个月建议 · 修 Version History 真实账号永远空 · Restore 先备份 | 待 merge |
| #43 | R-5：原则正式文件 `docs/assistant-principles.md` + 文件与提示词同步测试 | 待 merge |
| #44 | Overview「FINANCIAL GOAL」：卡片（和其他卡片同色）：标签在上、目标居中、Lato Regular 加大 | 待 merge |

## App / 订阅方向（暂停）

- 因预算不足，`COMMERCIALIZATION_PLAN.md` 阶段 1（Capacitor 打包上架）+ 付费订阅**暂停**，
  由你决定何时重启。Capacitor 脚手架（#19）+ 原生 Android 工程（#20）+ `docs/app-packaging.md`
  操作手册都留在库里，随时可继续。
- 重启时的下一步：有 Android Studio 的机器按手册 §2 跑 `cap:sync` → Android Studio 运行；
  Firebase 登录在 WebView 里要改原生流程（手册 §2a）。

## 下一步

- **AI 助手已上线**（2026-09-14）：先部署了新版 Cloud Function，再合并 PR #35。线上函数 Ask / Record 实测正常，
  wealthup.cc 的前端包里有助手、指向生产函数、不含 key。
- **助手理财原则 R-1 已部署**（2026-09-15）：Ask 按六大原则回答 + 紧急资金安全网。模拟器 22/22 守原则。
  **免费额度今天用光**（每天 50 次、全 app 共用），线上 08:00 MYT 后恢复，恢复后再验生产回答。下一步 R-2（等你说）。
- **要你决定：OpenRouter 充值 10 credits**（每天 50 次 → 1000 次），否则上线后真实用户很快会遇到「busy」。
- **待做：换 OpenRouter key**（对话里贴过两次）。你生成新 key 放进 `functions/.secret.local`，我写进 Secret Manager
  并让函数用上，不用改代码、不用重新合并。

- PR #34 待你 review/merge。合并后：Wealth Vault 的 AI/OCR 取舍还没讨论出结论，其余产品打磨项由你定。

## FUTURE IDEAS / 待清

- **AI 助手聊天记录存 Firestore**（跟账号走、换设备可见、不串号）。现在存浏览器 localStorage，只在这台电脑这个浏览器里有。
- `functions/` 的 `firebase-functions` 版本偏旧，部署时 CLI 提示升级（有破坏性变更，单独做）。

- `WEALTHUP_CONTEXT.md` 第 9 节 P0-P4 待办清单整体过一遍 —— 本轮做掉的多项（限流、字节预算、
  免责、CI 卡死、Portfolio 表单、云同步、行情韧性）还挂在那当 TODO，该标记或删除。
- **Wealth Vault（暂停，2026-09-11）**——文件上传自动提取需要 AI/OCR，是一笔持续的 API 调用
  费用，现在负担不起。先记录着，等以后预算允许再回来看这条（跟 App/订阅暂停是同一类原因）。
  技术方向（如果重启）：CSV 导入已有的"不可信输入 → 校验 → 用户确认"模式可以直接套用。
