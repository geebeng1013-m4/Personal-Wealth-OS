# WealthUp 商业化计划（App 化 + 付费 + AI 视频增长）

> 配套文件：架构与开发上下文见 `WEALTHUP_CONTEXT.md`，产品需求见
> `docs/product-requirements-document.html`。本文件只讲「从自用工具变成商业产品」
> 要补的东西，按阶段拆成带验收标准的任务。每完成一项就勾掉并补一句结论。

---

## 0. 目标与边界

- **目标**：把 `wealthup.cc`（现为纯前端 SPA + PWA，Firebase Auth/Firestore + Vercel
  serverless 行情代理，单用户、隐私优先）打包成上架 App，做 freemium 订阅，用 AI
  短视频获客。
- **已定方向**（2026-09 决策）：
  - App 打包：**Capacitor 壳**，复用现有 web 代码，单一代码库，上 iOS + Android。
  - 行情数据：**先维持抓取（Yahoo / TradingView）+ 加缓存和限流**，不立刻换付费数据商。
  - 目标市场：**未定** → 产品合规底线一律按最严假设做（不触投顾牌照、PDPA ∩ GDPR
    都满足），推广渠道等市场定了再说。
- **不做**：React Native / Flutter 重写（丢现有 UI 层，周期数月）。

---

## 1. 阶段总览

| 阶段 | 名称 | 阻塞谁 | 状态 |
| --- | --- | --- | --- |
| 0 | 商业化前必须补的洞 | 收费、上架 | 进行中 |
| 1 | Capacitor 打包 | 上架 | 未开始 |
| 2 | 付费 / 订阅 | 变现 | 未开始 |
| 3 | AI 视频增长引擎 | 获客 | 未开始 |
| 4 | 运维 / 成本监控 | 规模化 | 未开始 |

**建议推进顺序**：0-D（本文件）→ 0-A（行情限流，已做）→ push/PR → 0-C（免责 gate）
→ 1（Capacitor）→ 2（付费）→ 3（视频）。阶段 4 贯穿始终。

---

## 2. 阶段 0 —— 商业化前必须补的洞

单用户自用改成对外收费，责任性质变了。以下是硬门槛。

### 0-A. 行情代理限流 + 边缘缓存加固 ✅（分支 `feat/api-rate-limit`）

- **做了什么**：
  - `api/_rateLimit.ts`：按客户端 IP（`X-Forwarded-For` 首跳）滑动窗口限流，
    每路由独立预算，失败开放（限流器自身出错不阻断请求）。
  - `api/quote.ts`：40 req/min/IP → `429` + `Retry-After` + `RateLimit-*` 头；
    边缘缓存 `s-maxage` 30→60s，`stale-while-revalidate` 60→300s。
  - `api/market.ts`：30 req/min/IP → `429`。
  - `src/market.ts`：请求前对 symbol 排序，让 `VOO,QQQM` 与 `QQQM,VOO` 命中同一
    边缘缓存条目。
  - `tests/rateLimit.test.ts`：9 个用例（上限、滑窗、按 IP / 按 bucket 隔离、
    失败开放）。
- **已知局限**（写在 commit 和代码注释里）：计数器按「温实例」内存，冷启动清零、
  多实例各算各的。硬集群级限流需共享存储（`@upstash/ratelimit`），代码留了接入点，
  等有真实流量再加依赖。
- **验证**：typecheck / test（699 通过）/ build 全绿；真实 dev server 手测
  quote 40 后 429、market 30 后 429 且不受 quote 洪水影响。
- **待办**：push 分支 → 开 PR 到 `main` → CI 绿 → 合并。

### 0-B. 账号体系

- **现状**：只有 Google 登录（`firebase.ts`，popup 失败回退 redirect）。
- **要做**：
  - [ ] 邮箱 / 密码登录（Firebase Auth 自带）。
  - [ ] Sign in with Apple —— **上 App Store 且保留任何第三方登录时 Apple 强制要求**。
  - [ ] 账号页：改密码、登出所有设备、删除账号入口。
- **验收**：未登录 / 邮箱登录 / Google 登录 / Apple 登录 / 登出 / 离线 / 权限拒绝
  六态过一遍；`firestore.rules` 复核；多标签页订阅清理无泄漏。

### 0-C. 全局免责声明 gate + Advisor 语气审计

- **为什么**：Advisor / rules / TVM 会给「建议」和「预估收益」。对外收费后，任何
  「保证收益」「个性化投资承诺」的表述都是法律风险；市场未定就按最严处理。
- **要做**：
  - [ ] 一个全局 `<DisclaimerGate>` / 首屏一次性确认 + 每个建议卡片脚注「仅供参考，
        非投资建议」。
  - [ ] 审计 `advisor.ts` / `rules.ts` / `financialRules.ts` / `moneyLeaks.ts` /
        `tvm.ts` 的所有面向用户文案：估算收益、历史表现、规则输出一律用「估计 /
        历史 / 假设」措辞，禁止「将会 / 保证 / 应该买」。
  - [ ] ToS、隐私政策、风险披露三份文档（先占位，市场定了再请人过）。
  - [ ] 页脚常驻免责链接。
- **验收**：全站文案 grep 无「保证收益 / guaranteed return / you should buy」；
  新用户首次进入必须看到免责确认；明暗主题都验。

### 0-D. 写本计划进 repo ✅（分支 `docs/commercialization-plan`）

- 就是这份文件。

### 0-E. 服务端权威时间戳（数据安全，`WEALTHUP_CONTEXT.md` P1 已列）

- **现状**：`cloudCopyWins` 信设备 `Date.now()`，时钟歪的付费用户多设备会赢不该赢
  的冲突。
- **要做**：引入 Firestore `serverTimestamp()` 作权威 `updatedAt` → schema 变更 →
  `state.ts` version 21 + `migrateState` 向后兼容迁移。
- **验收**：旧数据迁到 v21 不丢字段；两设备并发编辑，服务端时间新的胜；离线写入
  补传后时间戳正确。

### 0-F. 数据合规基线

- [ ] 账号删除：一键删除 `users/{uid}` 整棵 Firestore 子树 + Auth 用户（一个
      callable function 或客户端事务）。
- [ ] 数据导出：已有 JSON 导出（`state.ts`），确认覆盖全部持久字段即可。
- [ ] Firestore 备份 / 误删恢复策略（至少开每日导出到 GCS）。
- **验收**：删除后重新登录是干净新用户态；导出的 JSON 能重新导入还原。

---

## 3. 阶段 1 —— Capacitor 打包

目标：一个能上 App Store / Google Play 的原生壳，复用 `dist/`。

### 1-A. 脚手架

- [ ] `npm i @capacitor/core @capacitor/cli @capacitor/app`
- [ ] `npx cap init WealthUp cc.wealthup.app --web-dir dist`
- [ ] `capacitor.config.ts`：**打包本地资源**（不指向远程 URL，过审友好）；
      `server.androidScheme = "https"`。
- [ ] `npx cap add android` / `npx cap add ios`（iOS 需 Mac + Xcode）。
- [ ] `package.json` 加脚本：`cap:sync`（= `npm run build && npx cap sync`）。
- **验收**：`npx cap sync` 无错；Android Studio 能起模拟器，加载出 dashboard，
  demo 数据正确。

### 1-B. 原生集成坑

- [ ] **Firebase Auth**：Capacitor WebView 里 `signInWithPopup` 不工作 →
      换 `@capacitor-firebase/authentication` 原生流程，或 redirect + 自定义
      scheme 回跳。
- [ ] safe-area（刘海 / 底部条）：CSS `env(safe-area-inset-*)`，`shell.css` 补。
- [ ] 状态栏颜色 / 明暗、启动图（`@capacitor/splash-screen`）、应用图标。
- [ ] Android 返回键（`@capacitor/app` `backButton`）：根路由退出，其余返回上一页。
- [ ] 深链：`wealthup.cc/*` → App（iOS Universal Links / Android App Links），
      需要 `.well-known/apple-app-site-association` 和 `assetlinks.json` 放到
      Vercel。
- **验收**：真机装包，Google 登录成功、云同步生效、深链能唤起、无横向溢出。

### 1-C. 卖点级原生能力

- [ ] 生物锁（`capacitor-native-biometric`）：打开 App 需 Face ID / 指纹 —— 金融
      App 的信任卖点，也可作 Pro 功能。
- [ ] 推送（`@capacitor/push-notifications` + FCM，已在 Firebase 生态）：预算超支 /
      定投提醒 / 组合大波动。
- [ ] 分享（`@capacitor/share`）：分享净值快照图（配合阶段 3 素材）。
- **验收**：生物锁可开关且失败有兜底；推送在前台 / 后台 / 杀进程三态都到达。

### 1-D. 发布流水线

- [ ] CI 加一个手动触发的 job：`build → cap sync → 产 Android AAB / iOS archive`
      工件。
- [ ] Apple Developer（$99/年）、Google Play（$25 一次性）账号。
- [ ] 商店素材：截图、隐私标签（App Privacy / Data safety 表单）、年龄分级。
- **验收**：内测轨道（TestFlight / Play Internal Testing）能装到真机。

---

## 4. 阶段 2 —— 付费 / 订阅

### 2-A. 定价与功能分层（初稿，按市场调）

| 层 | 价格 | 内容 |
| --- | --- | --- |
| Free | 0 | 手动记账、1 个组合、TVM 计算器、基础预算桶 |
| Pro | ~RM15 / $4 每月（年付打折） | 实时行情、云同步、无限快照、Advisor、CSV 导入、多组合、生物锁、推送 |

### 2-B. 计费接入

- [ ] 网页端：Stripe Checkout + Customer Portal。
- [ ] iOS / Android：数字商品**强制走 IAP**（Apple/Google 抽 15-30%）→ 用
      **RevenueCat** 统一三端订阅状态。
- [ ] entitlement 存 `users/{uid}/billing`，前端按它 gate 功能。
- [ ] **服务端校验**：加 Vercel function 验 Stripe / RevenueCat webhook 写
      entitlement；`firestore.rules` 禁止用户改自己的 `billing` 字段。
- **验收**：买 / 退 / 过期 / 跨端 四场景 entitlement 正确；前端功能锁随之开关；
  伪造前端 entitlement 不生效（服务端为准）。

### 2-C. 落地页 / 转化

- [ ] `wealthup.cc` 加 pricing 页、功能对比表、App Store 徽章、demo 入口
      （`build:demo` 已有）。
- [ ] 邮件 waitlist / newsletter（配合视频 CTA）。
- **验收**：Lighthouse 移动端 ≥ 90；徽章深链到正确商店条目。

---

## 5. 阶段 3 —— AI 视频增长引擎

### 3-A. 渠道

TikTok / Douyin、YouTube Shorts、Instagram Reels，小红书走图文。

### 3-B. 形式（SaaS 最转化）

**真实录屏 + AI 配音 + 字幕**。不做纯 AI avatar 空口讲，要让人看到产品在动。

- 录屏：App 真实操作（demo 模式，数据干净）。
- 配音：ElevenLabs / 火山引擎 TTS。
- 字幕 + 节奏：剪映 / CapCut（AI 功能）、OpusClip（长视频切条）、Vizard。
- B-roll / 转场：Kling / Runway / Pika 少量点缀。
- 口播人设（可选）：HeyGen / Synthesia。

### 3-C. 选题（用作者真实故事，见 memory）

1. 「券商手续费吃掉我 2% 年化收益」→ WealthUp 计费前 / 后收益对比。
2. 「第一次算清自己的真实净值」→ 净值不双重计数。
3. 「DCA 定投多久能到目标」→ TVM 计算器。
4. 「为什么我总觉得没钱」→ Money Leaks 现金流泄漏。
5. 「Moomoo CSV 一键导入」→ csvImport。

### 3-D. 结构与节奏

3 秒钩子（反常识数字 / 痛点）→ 演示 → CTA（wealthup.cc / 应用商店）。
起步每周 3-5 条，A/B 测钩子。视频简介放深链。

- **验收**：前 10 条发布；每条有明确钩子 + CTA；落地页能追踪来源。

---

## 6. 阶段 4 —— 运维 / 成本监控（贯穿）

- [ ] Firestore 升 Blaze 计划，设预算告警（免费额度会因多用户爆）。
- [ ] Vercel Functions 调用量 / 错误率监控；行情代理上游失败率看板。
- [ ] 抓取韧性（`WEALTHUP_CONTEXT.md` P2）：Yahoo / TradingView 改字段或封 UA 时，
      展示陈旧数据带时间戳，不冒充实时；每个 `kind` 补「上游结构异常」测试。
- [ ] `firestore.rules` 改动后必须 `firebase deploy --only firestore:rules`
      （Vercel 不带）—— 写进发布 checklist。
- [ ] 新域名 / App 回跳域名加进 Firebase Auth 授权域名。
- [ ] 若抓取被封成为常态 → 阶段性切付费数据商（Twelve Data / Polygon /
      financialmodelingprep），这是明确的成本线，届时更新阶段 0 决策。

---

## 7. 决策记录

| 日期 | 决策 | 理由 |
| --- | --- | --- |
| 2026-09-08 | App 走 Capacitor 壳 | 复用现有无框架 web 代码，单代码库，成本最低 |
| 2026-09-08 | 行情先维持抓取 + 限流缓存 | 零成本起步；换付费数据商是后续成本决策 |
| 2026-09-08 | 目标市场未定 → 合规按最严交集 | 避免上线后因牌照 / 隐私法返工 |

---

（结束）
