# WealthUp 项目迁移记忆 + 开发计划（供设备切换 / 上下文恢复使用）

> 说明：此文件是「便携记忆载体」。复制到新设备即可最大限度恢复 WealthUp
> (`personal-wealth-os`) 的开发上下文、架构认知与待办计划。
> 格式仿照 `CURSOR_CONTEXT.md`（Healthy 项目那份）。

---

## 0. 一句话架构

**纯前端单页应用 + Serverless 行情代理 + Firebase 做认证与云同步。没有自建后端、没有数据库服务器。**

```
浏览器 (Vite 构建的 TS/DOM SPA, PWA)
  │
  ├── 本地状态：localStorage（按 uid 隔离）+ 版本迁移 migrateState (v19)
  │
  ├── 认证 & 云同步：Firebase Auth (Google 登录) + Firestore
  │        文档路径 users/{uid}/wealth/state   ——  一个用户 = 一份 JSON 文档
  │        Firestore 开 persistentLocalCache（IndexedDB），离线写入自动补传
  │
  └── 行情数据：/api/*  →  Vercel Serverless Functions（唯一的"后端"）
           api/quote.ts   → Yahoo Finance chart（价格）
           api/market.ts  → Yahoo quoteSummary（ETF 持仓/行业）+ TradingView scanner（基本面）+ Yahoo chart（历史）
           浏览器不能直连上游（无 CORS），匿名 CORS 代理已全部失效，所以必须走 serverless
```

托管：**Vercel**（`wealthup.cc`）。Firebase **只提供 Auth + Firestore，不做 hosting**。
Firestore 安全规则通过 Firebase CLI 单独部署，Vercel 部署不携带。

---

## 1. 项目总览（高阶）

- **项目名 / 目标**：WealthUp（仓库名 Personal Wealth OS）——面向学生/年轻投资者的个人财富操作系统。
  记账、投资组合跟踪、目标、预算桶、财务规则引擎、Advisor 建议、TVM/复利计算器。
- **当前阶段**：功能基本完整，已上线 `wealthup.cc`。正在做稳健性打磨
  （离线写入、云/本地冲突、快照存储预算、行情代理防滥用）。
- **产品定位**：单用户、隐私优先、可离线。数据主权在用户手里（导入/导出 JSON、版本快照）。
  WealthUp 不只是记录钱在哪——现状由 Dashboard/Ledger/Portfolio 呈现；该怎么办由 Advisor/Rules
  给出建议，并附带 FACT→RULE→IMPACT→ACTION 的理由链；有没有做到由 Review 核对。不做通用 AI 投顾
  或股票聊天——所有建议都是基于用户自己配置的规则的确定性判断，不是市场预测。
- **真实使用者**：项目作者本人在用，数据是真实 Moomoo 组合（VOO + QQQM，约 22 笔交易）。
  → **验证财务计算必须用真实账户形态，不能只用 demo fixture**（demo 的零值掩盖过双重计数 bug）。

---

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 构建 | Vite 5，`type: module`，Node **24.x**（`engines` 锁定，Vercel & CI 同版本） |
| 语言 | 原生 TypeScript，`strict: true`，target ES2022，ES Modules |
| UI | **原生 DOM + 模板字符串 + 手动事件绑定**（`ui.ts` + `src/pages/*.ts`），无框架。
       React 只用于两个孤立挂件：投资增长计算器 (`src/calculator/`) 和 Recharts 图表 |
| 样式 | 原生 CSS（`theme.css` / `components.css` / `shell.css` / `legacy-tail.css`）+ Tailwind（仅计算器子应用）|
| 图表 | Recharts；WebGL 光效 `ogl`（`sideRays.ts`）|
| 图标 | `lucide-react`（少量） |
| 认证 / 云 | `firebase` ^12（Auth + Firestore，`persistentLocalCache` + `persistentMultipleTabManager`）|
| 行情后端 | Vercel Serverless（`@vercel/node`），`api/quote.ts`、`api/market.ts` |
| 测试 | 自建 runner `_test.mjs`（esbuild 打包 `tests/*.test.ts` 后 import 执行），
        `tests/testHarness.ts` 提供断言/flush，Firebase 用 stub 替换。约 **657 个用例 / 41 个测试文件** |
| PWA | `public/sw.js`（手写 Service Worker）+ `public/manifest.json` |
| 包管理 | **npm**（`personal-wealth-os/package-lock.json`）。仓库根的 `pnpm-lock.yaml` 属于别的项目，
         本目录**绝不能用 pnpm**——混用会留下半装依赖树 |

---

## 3. 常用命令（都在 `personal-wealth-os/` 目录里跑）

```sh
npm ci                # 严格按 lockfile 安装（CI/Vercel 用的就是这个）
npm run dev           # Vite dev server，devApiRoutes 插件把 /api/* 挂到本地
npm run typecheck     # tsc --noEmit + tsc -p tsconfig.api.json（api/ 单独一套 tsconfig）
npm test              # node _test.mjs —— 全部单元测试
npm run build         # 先 typecheck 再 vite build，产物在 dist/
npm run build:demo    # VITE_DEMO_MODE=true 的可评审 demo 构建（mock 用户、fixture 数据、不写真库）
npm run preview       # 预览 dist/
```

CI (`.github/workflows/ci.yml`)：push 到 `main` 或任何改动 `personal-wealth-os/**` 的 PR，
在 ubuntu + Node 24 上跑 `npm ci → typecheck → test → build`。`npm ci` 会因 lockfile 漂移直接失败。

---

## 4. 开发环境（新设备必须恢复）

- **OS**：Windows（当前开发机）；CI 是 Ubuntu——注意跨平台差异（曾有 Linux CI 因 esbuild service 子进程不退出而挂起，见 `_test.mjs` 末尾 `stop()`）。
- **Node**：24.x（用 nvm/fnm 锁版本，`node -v` 必须是 24）。
- **包管理**：npm（≥ 对应 Node 24 自带版本）。
- **Vercel CLI**（可选，部署/拉环境变量）：`npm i -g vercel`，项目已 link（`.vercel/project.json`，projectId `prj_4R5jhbimXrhddwpA67qG1bX27REq`）。
- **Firebase CLI**（部署 Firestore 规则时才需要）：`npm i -g firebase-tools`，`firebase login`。
- **环境变量**：见第 6 节。本地 `.env.local` 已 gitignore，不在仓库里——新设备需要重新拉或重建。
- **无需**：Android SDK / JDK / 模拟器（这是 Web 项目，跟 Healthy 那个 Flutter 项目完全不同）。

---

## 5. 关键文件清单（复制 / 优先了解）

### 必须存在但不在 Git 里（新设备要重新准备）
- `personal-wealth-os/.env.local` —— 本地环境变量（可留空，代码有默认 Firebase 配置兜底）
- Vercel 项目环境变量（在 Vercel 控制台，本地用 `vercel env pull` 取）

### 源码核心（`src/`）
| 文件 | 职责 |
| --- | --- |
| `main.ts` | 应用启动、认证流程、主题、路由（hash）、顶层 `setState` 协调、PWA 安装提示、demo 模式分支 |
| `models.ts` | **领域模型与所有共享类型**。`WealthState` 是持久化契约。新增持久字段必须同步：默认值 + 迁移 + 导入导出 + 云端兼容 |
| `state.ts` | `defaultState` / `emptyState` / **`migrateState`（v19）** / localStorage 持久化（按 uid）/ 快照（20 个 + 2MB 字节预算）/ 云同步决策（`cloudCopyWins` 最后写入胜）/ 导入导出 |
| `firebase.ts` | Firebase 初始化、Google 登录（popup 失败回退 redirect）、Firestore 读写（`users/{uid}/wealth/state`）、`persistentLocalCache` 离线队列 |
| `rules.ts` | 财务计算与建议规则，**纯函数**，不碰 DOM/localStorage/Firebase。`money` / `percent` / `formatPrice` 等格式化只在展示边界用 |
| `financialRules.ts` | 结构化「个人政策规则」（应急金下限、月支出上限、DCA 金额、目标配置、漂移容忍、机会金梯队、目标供款）——规划意图，**不是**记录余额 |
| `market.ts` / `marketPrices.ts` / `livePrices.ts` | 行情请求、缓存（key 含影响结果的参数）、格式化、风险指标。外部数据一律当不可信输入 |
| `ui.ts` (~1.9k 行) | 页面骨架、侧边导航分组、页面模板/绑定分发。各页面已拆到 `src/pages/*.ts`（模板 + 绑定成对） |
| `src/pages/*.ts` | 每个页面一个文件：dashboard / portfolio / market / ledger / budget / goals / advisor / review / rules / settings / moneyLeaks / tvm |
| `portfolioSummary.ts` / `goalSummary.ts` / `budgetSummary.ts` / `ledgerSummary.ts` / `financialHealthSummary.ts` / `financialSnapshot`(在 rules) | 页面用的派生快照（snapshot），把纯计算和渲染分开 |
| `advisor.ts` | Advisor 建议：FACT → RULE → IMPACT → ACTION，按需派生，不持久化 |
| `moneyLeaks.ts` | 现金流泄漏检测 |
| `csvImport.ts` / `exchangeImport.ts` | Moomoo CSV 导入、货币兑换记录导入（不可信数据，解析后必须校验+迁移） |
| `currencyExchange.ts` | MYR/USD 兑换记录——**系统里唯一的真实汇率来源**。存两边金额，汇率是推导出来的（含点差） |
| `demo.ts` / `demoData.ts` | demo 模式检测与 fixture 数据 |

### API（`api/` —— Vercel Serverless，单独 `tsconfig.api.json`）
- `quote.ts` —— 价格代理。只读、无密钥、不持久化。最多 12 个 symbol，30s 边缘缓存。价格必须是有限正数，否则报「不可用」而非 0。
- `market.ts` —— 基本面 / ETF 持仓 / 历史价。**不是通用代理**：`kind` 白名单 + symbol 校验 + URL 在服务端拼。Yahoo quoteSummary 需要 cookie+crumb 会话。已加同源校验（拒绝跨站调用，PR #4）。

### 配置
- `vite.config.ts` —— React 插件 + `devApiRoutes`（dev 时把 `/api/*` 挂到 Vite）
- `vercel.json` —— `npm ci` / `npm run build` / 输出 `dist` / 除 `/api/*` 外重写到 `/index.html` / `sw.js` 与 `manifest.json` 不缓存
- `firebase.json` + `.firebaserc` —— **只**为 `firebase deploy --only firestore:rules` 服务，项目 id `personal-wealth-os-1deac`
- `firestore.rules` —— 唯一的跨用户隔离屏障：`users/{userId}/**` 仅 `request.auth.uid == userId` 可读写
- `DEPLOYING.md` —— 部署细节（读它）
- `agents.md`（仓库根）—— **开发规范，动手前必读**

---

## 6. 环境变量

Firebase Web 配置**不是密钥**（会发到每个浏览器，靠 Firestore 规则 + 授权域名兜底）。
用 env var 只是为了 dev/preview/prod 指向不同 Firebase 项目；不设则回退到共享的
`personal-wealth-os-1deac`（`firebase.ts` 里有硬编码默认值）。

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_DEMO_MODE=          # 只在 build:demo 时 true，生产绝不能设
```

---

## 7. 数据模型与持久化契约（改动前必看）

- `WealthState.version` **当前 = 19**（`state.ts` 的 `CURRENT_VERSION`）。
- **新增 / 删除 / 重命名字段或改语义 → 必须提升 version 并在 `migrateState` 写向后兼容迁移。**
- 迁移必须保留旧数据：缺字段用明确默认值；**单个无效字段不得导致整份状态重置**。
- 状态更新走不可变语义：构造新对象/数组交给顶层 `setState`，不在渲染中原地改。
- 金额 / 比例 / 数量 / 日期一律校验，拒绝 `NaN` / `Infinity` / 负数；空输入显式处理。
- **MYR 与 USD 不得混算**；汇率换算必须显式，保留原始交易金额。
- 存储键：`personal-wealth-os-state-{uid}`（登录）/ `personal-wealth-os-state`（未登录，只读不写）。
  快照：`personal-wealth-os-snapshots-{uid}`，上限 20 个 **且** 序列化后 ≤ 2 MB（`trimToByteBudget`，丢最旧的）。
- 云文档：`users/{uid}/wealth/state`，`setDoc(..., { merge: true })`，附 `_syncedAt`。
- 云 / 本地冲突：`cloudCopyWins(localUpdatedAt, cloudUpdatedAt)` —— `updatedAt` 比较，最后写入胜；
  本地更新 → 保留本地并上推（`local-kept-newer`）。时钟偏差是已知未解问题。

---

## 8. 已完成的重要修复（回溯用）

| 提交 | 内容 |
| --- | --- |
| `d3afcc5` | 阻止较旧的云副本覆盖较新的本地编辑 |
| `dd171b9` | Reset 按钮改为可恢复，不再直接清空 origin |
| `e4437e9` | 离线时的写入排队而非丢失（Firestore `persistentLocalCache`） |
| `46561f8` (PR #2) | 行情价格 tick 不再每次重建 shell 和 WebGL |
| `7ad578a` (PR #4) | 拒绝对行情代理的跨站调用（同源守卫） |
| `fe6f2e0` + `f38bf4d` | 快照存储按**字节大小**（2 MB）而非仅数量限制，且永不抛异常 |
| `797b4ed` | 关闭 esbuild service 子进程，让测试进程能退出（Linux CI 挂起根因） |
| 财务侧调查（memory 里）| Moomoo 手续费（每单最低费）吃掉约 2pp 收益，FX 只影响约 0.1pp；WealthUp 现同时显示「计费后」和「计费前」收益 |

---

## 9. 开发计划 / 待办（按优先级）

### P0 —— 先把当前分支收尾
- [ ] **`fix/snapshot-storage-budget` (PR #3) 合并**：`main` 已经因 PR #4 领先 2 个提交，
      本分支需要 rebase / merge `main`，跑 `typecheck + test + build`，确认 CI 绿，然后合并。
- [ ] 分支历史里有一串临时诊断提交（`b1640a6` 探针、`9f4edb7` 隔离实验等）已被后续提交回退——
      合并时用 squash 或确认净 diff 只剩 `fe6f2e0` + `f38bf4d` 的实质改动。

### P1 —— 稳健性 / 数据安全
- [ ] **服务端时间戳**：`cloudCopyWins` 现在信任设备 `Date.now()`，时钟歪的设备会赢不该赢的冲突。
      引入 Firestore `serverTimestamp()` 作为权威 `updatedAt`（这是 schema 变更 → version 20 + 迁移）。
- [ ] **多标签页 / 实时订阅**：`subscribeToFirestore` 已实现但 `main.ts` 里 `cloudSyncUnsub` 目前没接
      `onSnapshot`。决定是否要「另一台设备改了，当前页自动刷新」，如要则接上并处理与本地未保存编辑的合并。
- [x] **迁移测试覆盖**：已有 —— `tests/architecture.test.ts` 的 "arch: every earlier persisted state
      migrates to the current version"（表格驱动，覆盖 v3 → v19）。
- [ ] **配额 / 滥用**：Firestore 免费额度、行情代理被刷。给 `/api/*` 加简单速率限制或缓存命中率监控。

### P2 —— 行情数据韧性
- [ ] Yahoo / TradingView 上游随时可能改字段或封 UA。给每个 `kind` 补「上游异常结构」的测试，
      失败时展示陈旧数据要带时间戳标识，不能冒充实时。
- [ ] `api/market.ts` 的 `yahooSession`（cookie+crumb）是 serverless 实例内的模块级变量，
      冷启动就没了——可接受，但记录一下这是「尽力而为」缓存。
- [ ] 快速切换 ticker 的竞态：确认旧请求结果不会覆盖新选中页面（`main.ts` 的 `authRequestId` 模式可复用）。

### P3 —— 产品 / 体验
- [ ] `ui.ts` 还有 ~1.9k 行，继续按页面往 `src/pages/*` 拆（模板 + 绑定成对，见 `run-wealthup` skill 的提示）。
- [ ] PWA：改静态资源 / 入口 / 缓存策略时同步升 `public/sw.js` 缓存版本并清旧缓存。
- [ ] 可访问性：新交互控件要覆盖默认/悬停/聚焦/禁用/加载/空/错误 7 态；图标按钮要 `aria-label`；明暗主题都验。
- [ ] Advisor 语气克制：估算收益 / 历史表现 / 规则输出不得表述为「保证结果」或个性化投资承诺。

### P4 —— 运维
- [ ] `firestore.rules` 改动后**必须**手动 `firebase deploy --only firestore:rules`（Vercel 不带）。写个 checklist 或 CI 步骤提醒。
- [ ] `wealthup.cc` 必须在 Firebase Auth → Settings → Authorized domains 里（漏了 Google 登录直接失败）。
- [ ] 监控：Vercel Functions 日志、Firebase 用量告警。

---

## 10. 常见问题与排查

**A. `/api/quote` 本地 404 / 组合永远无价**
- dev 下 `vite.config.ts` 的 `devApiRoutes` 插件负责挂载；确认用 `npm run dev` 起的（不是别的静态服务）。
- 生产下确认是 **Vercel** 部署，不是 Firebase Hosting——Firebase Hosting 会把 `/api/quote` 重写成 `/index.html` 返回 HTML。

**B. Google 登录失败 / 弹窗被拦**
- `signInWithGoogle` popup 失败会自动回退 `signInWithRedirect`，结果由 `handleRedirectResult` 处理。
- 新域名要加进 Firebase Auth 授权域名列表。

**C. `npm test` 在 Linux/CI 挂起不退出**
- 根因是 esbuild 的 service 子进程。`_test.mjs` 末尾必须有 `await stop()`。CI step 也加了超时兜底。

**D. `npm ci` 失败说 lockfile 漂移**
- 本目录只能用 npm。如果之前不小心用 pnpm 装过，删 `node_modules` 重新 `npm ci`。
- 除非任务明确涉及依赖，不要更新 `package-lock.json`。

**E. 云数据把本地新编辑冲掉了**
- 检查 `cloudCopyWins` / `loadStateFromCloud` 的 `local-kept-newer` 分支。设备时钟偏差是已知缺口（见 P1）。

**F. 快照存储报 `QuotaExceededError`**
- `saveSnapshot` 已 try/catch 降级为「不存新快照」，`trimToByteBudget` 会先丢最旧的。不应再抛。

**G. 财务数字对不上真实券商**
- **用真实账户形态复算，不要用 demo**。真实组合：Moomoo 上 VOO + QQQM 两只，约 22 笔，ledger 里
  `Moomoo Invest` 账户镜像该组合（必须打 `holdsTrackedPortfolio` 标记，否则净值双重计数）。
- 真实汇率只在 `currencyExchanges` 记录里，不要用「两个总额相除」反推汇率（手续费藏在里面）。

---

## 11. 迁移到新设备的步骤

1. `git clone https://github.com/geebeng1013-m4/Personal-Wealth-OS.git`
2. 装 Node 24（nvm/fnm），确认 `node -v` = 24.x
3. `cd personal-wealth-os && npm ci`
4. （可选）`npm i -g vercel && vercel link`，然后 `vercel env pull .env.local`
   —— 或者直接跳过，代码有默认 Firebase 配置兜底
5. `npm run typecheck && npm test && npm run build` —— 三个都绿说明环境 OK
6. `npm run dev` 打开本地，用 Google 账号登录验证云同步
7. （改 Firestore 规则时才需要）`npm i -g firebase-tools && firebase login`
8. 把本文件留在 `personal-wealth-os/` 下随时查阅

---

## 12. 验证要求（来自 `agents.md`，交付前对照）

- 每次改动至少 `npm run typecheck`；改构建/PWA/入口/依赖/跨模块契约再 `npm run build`。
- 改**状态**：验新用户默认态、旧数据迁移、刷新后持久化、导入导出、快照恢复、登录/退出用户隔离。
- 改**市场数据**：验成功 / 超时 / 无数据 / 格式异常 / 快速切 ticker / 缓存过期。
- 改**Firebase**：验未登录 / 登录 / 退出 / 离线 / 权限拒绝 / 订阅清理，并复核 `firestore.rules`。
- 改**UI**：桌面 + 移动尺寸手动过一遍导航/表单/空态/错误态/主题切换/无横向溢出。
- 复杂财务规则 / 迁移 / 解析优先补可重复测试；补不了就在交付说明里列未覆盖风险。

---

## 13. 沟通偏好

- 直给方案，少解释，多步骤，工程思维。
- 财务计算结论（"没有双重计数" / "数字不变"）在下之前，用**真实账户数据**复算，不用 demo。
- 不把估算/历史表现说成保证收益。
- 提交信息说清楚「为什么」，PR 描述列改动文件 / 行为变化 / 验证命令 / 剩余风险。

---

（结束）
