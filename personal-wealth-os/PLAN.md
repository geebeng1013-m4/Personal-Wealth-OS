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

## 打开 app 先看到 Logo（S 系列，学 Meta）  `[x]`（2026-09-19，PR #93 已合并上线，`main` = `971cc19`）

用户选择维持「等网络最多 3 秒」（C），但要像 Meta 一样，等待时先看到 Logo 而不是空白。目标是全球用户，iPhone 和 Android 都要检查。
限制：Service Worker 等网络的那段时间网页还没到，只能靠手机系统的启动画面填补（Android 按 manifest 自动生成；iPhone 需要 `apple-touch-startup-image`，现在一张都没有）。

### S-1 — 网页开场画面换成 Logo  `[x]`（2026-09-19，分支 `launch-logo`，未合并）
- `index.html` 的灰色方块 / 灰色 app 轮廓，换成深色背景正中的 WealthUp Logo（直接写进 HTML，不另外下载）；app 好了就淡出，不刻意多停。
- 验证：无头 Edge 深 / 浅色、手机 / 电脑尺寸截图；网页一到就是 Logo。
- 定案（2026-09-19）：不放名字。Android 12+ 系统启动画面只能是背景色 + 圆形图标，放不了名字；为了三个画面完全一样，统一成 #141310 + 正中白色 W。
- 已做：`public/brand/launch-mark.png`（从 maskable 图标去掉底色的透明 W，7 KB，直接内嵌进 index.html）；`#launch` 全屏覆盖，W 120px 呼吸（只缩放），`#app` 一有内容就 0.22 秒淡出后移除，不刻意多停；减少动画时不呼吸不淡出。原本的灰色方块 / app 轮廓和 `boot-signed-in` 删除。
- 实测（本机正式版预览，慢网 + 4 倍慢 CPU）：手机深 / 浅、电脑都是 W → 淡出 → 登录页；demo app、新用户问卷、登录页三条路开场画面都会退场、不挡点击、无报错。截图：https://claude.ai/artifact/QokisbrA54w7YtwYpmzqFg

### S-2 — iPhone 启动图片  `[x]`（2026-09-19，分支 `launch-logo`）
- 脚本生成各种 iPhone 尺寸的「深色背景 + 正中 Logo」启动图，加上 `apple-touch-startup-image` 设定。
- 实机：请用户在 iPhone 上确认；不确定 iOS 是否只在「加到主屏幕」时读取，可能要删掉图标重新加。
- 已做：`scripts/generate-launch-images.py` 生成 31 张（iPhone 13 种直向 + iPad 9 种直向和横向，共 868 KB，每台只下载自己那张）并把设定写进 index.html 的 LAUNCH-IMAGES 区块；也重新产生 `launch-mark.png`（内容不变）。
- 实测：31 张尺寸、背景色、W 宽度（120 点）和位置全部正确；跟网页开场画面逐像素比对，差异只在边缘（< 0.2%），位置最多差 1 个像素，交接不会跳。

### S-2b — Android 启动画面检查  `[x]`（2026-09-19，不用改）
- 用浏览器检查工具读线上 manifest（名字、背景色、图标大小、可安装性错误），确认 Android 能自动生成「图标 + 名字」启动画面；不符合就补。没有 Android 实机，需要朋友帮看。
- 结果：线上 manifest 名字、standalone、192/512 图标（含 maskable）、background_color #141310 都符合；maskable 底色也是 #141310，画出来就是一个 W，跟 iPhone / 网页一样。无头浏览器不支持 Chrome 的可安装性检查，改为逐项对照条件。真机待朋友确认。

### S-3 — PR → 用户检查 → 用户说可以才合并  `[x]`（PR #93，用户检查后合并；线上开场画面会退场、31 张启动图可下载、无报错）
- 待实机确认：iPhone（可能要删掉主屏幕图标重新加）、Android（请朋友看）。

### S-4 — 底部名字：Android 以外都显示  `[x]`（2026-09-19，PR #94 已合并上线）
- 用户澄清：只有 Android 不放名字（系统做不到），iPhone、iPad、电脑都要底部 WealthUp。
- 名字做成图片 `public/brand/launch-name.png`（`scripts/render-launch-name.mjs` 用无头 Edge + app 的 Inter 画，3 倍、72% 白），网页开场画面和 iPhone 启动图用同一张；名字底部离屏幕底部 9%。
- 网页开场画面在 Android（看浏览器身份）藏起名字，所以 Android 从系统画面到网页画面都只有 W。
- `generate-launch-images.py` 现在也负责把 W、名字内嵌进 index.html，并写入名字宽度。
- 实测：iPhone 身份有名字、Android 身份没有；网页 vs 启动图名字位置差 ≤ 1 像素，整体差异 < 0.4%。

### S-5 — W 进 Overview 时不再闪  `[x]`（2026-09-19，PR #94 已合并上线，`main` = `23b4379`）
- 原因 1：已登录的人每次打开，app 先用手机里的数据画一次，云端数据回来后（即使是同一次保存）整个画面再重画一次。修正：`cloudLoadNeedsRender()`，同一次保存（updatedAt 相同）就不重画；别的设备改过才重画。3 个测试。
- 原因 2：W 在字体还没载好时就淡出，淡出途中文字换字体。修正：先等两帧让浏览器开始载字体，再等 `document.fonts.ready`，最多 0.8 秒。
- 实测（demo 正式版）：字体载好后 W 才淡出（快网多等 0.07 秒、慢网 0.18 秒）。原因 1 需要真实账号，请用户在手机确认。

## 插队：手机主屏幕打开时要等很久才有画面  `[x]`（2026-09-19，PR #92 已合并上线，线上 sw.js = v19）

问题：从手机主屏幕打开 app，有时画面空白很久，关掉再开才正常。
原因：Service Worker 打开页面时「先问网络要最新版」，而且没有时间上限。网络「有但不回答」（信号弱、Wi-Fi 刚连上）时，画面一直空白直到请求放弃。
做法：`public/sw.js` 等网络最多 3 秒（`NAVIGATION_TIMEOUT_MS`），超过就先用手机里存的版本打开，网络晚到的回答照样存起来给下次用；第一次打开（没有缓存）照旧等网络。缓存版本 v18 → v19。
实测（本机正式版预览 + 无头 Edge 接管 Service Worker）：网络 10 秒不回答时，旧版 10.1 秒才有画面，新版 3.1 秒；网络正常 0.1 秒、网络失败 0.2 秒、网络 1.5 秒才回答时仍用最新版（1.6 秒）；装着 v18 的浏览器打开一次就换成 v19。
P-5 页面按需加载：用户决定先不做。

## FUTURE IDEAS 清理（P 系列）  （2026-09-19 定；P-1..P-3 PR #90、P-4 PR #91 已合并上线）

用户说「都做了吧」。顺序由小到大、风险由低到高；每个 Task 做完停下来报告。P-1..P-3 同一个 PR，P-4、P-5、P-6a 各一个 PR。
概念 Demo：https://claude.ai/artifact/Bz1Cd6m3xnmQuRBiVeuR4J

### P-1 — 问候语显示名字  `[x]`（2026-09-19，分支 `p-cleanup`）
- `profile.name` 空时用 Google 登录名的第一个字（现在显示「there」）。只改显示，不写数据；Settings 填了名字就用他填的。
- 已做：`greetingName()`（`dashboardPage.ts`）+ `ui.ts` 传入登录名；3 个测试。5199：新账号「Good morning, Alex」，有名字的账号照旧。

### P-2 — 两个滚动条模块合并  `[x]`（2026-09-19，分支 `p-cleanup`）
- `sidebarScrollbar.ts` 和 `pageScrollbar.ts` 抽成一个 `overlayScrollbar.ts`，行为不变。
- 已做：共用的 `overlayThumb()`（位置、出现 / 淡出、拖动）+ `mountSidebarScrollbar` / `mountPageScrollbar` 两个入口，各自保留「什么算用户滚动」和闪一下的规则。两个旧文件删除。5199 重跑 F-9 检查（开页闪、导航不出现、滚轮出现、淡出、边缘出现、拖动）加侧栏同样的检查，全部一致。

### P-3 — 弹窗内部的小滚动条  `[x]`（2026-09-19，分支 `p-cleanup`）
- 助手聊天面板等内部滚动区改用 CSS 细滚动条（颜色跟主题、无箭头），只在鼠标设备。
- 已做：`theme.css` 的 `wu-base` layer（最低优先级，所有「隐藏滚动条」的规则照样赢）。Chromium 用 `::-webkit-scrollbar`：`scrollbar-width: thin` 在 Windows 仍画箭头，而且设了它就不再读 `::-webkit-scrollbar`；Firefox 用 `@supports not selector(::-webkit-scrollbar)` 的标准写法（这台机没有 Firefox，未实测）。
- 实测（自开 demo 5207，因 5199 没开）：版本历史列表深 / 浅色都是细圆角滑块、无箭头；html、侧栏仍隐藏；800 宽时分段按钮、Market 标签仍隐藏。

### P-4 — Ledger 账户 / 分类原地编辑  `[x]`（2026-09-19，PR #91 已合并上线）
- 把连续的 `prompt()` 弹窗换成那一行原地展开的小表单（Save / Cancel），跟 Goals 的编辑一样。
- 已做：`ledgerPage.ts` 记 `editingAccountId` / `editingCategoryId`，那一行画成表单（账户：图标、名字、期初余额；分类：图标、名字）。检查规则照旧（名字必填、期初 ≥ 0、长度上限、四舍五入到分），错误显示在表单里，一改输入就清掉；Esc / Cancel 关闭；同时只开一个；保存保留滚动位置。账户类型仍不可改。
- 实测（5199，独立无头 Edge）：深 / 浅桌面 + 390 手机，没有任何浏览器弹窗，存值正确，无横向溢出、无报错。
- NEW IDEAS：`money()` 把期初 1234.5 显示成「MYR 1,234.5」（少一位小数），是原本就有的格式问题。

### P-5 — 页面按需加载  （2026-09-19 用户决定先不做）
- 每个页面第一次打开时才下载，页面切换改成异步；主程序现在 501 KB（gzip 149 KB）。逐页实测。

### P-6a — app 内节奏提醒  `[x]`（2026-09-20，PR #95 已合并上线，`main` = `98a2f19`）
- **家**：现有 Review 页（Monthly check-in）最上面加「Check-ins」区块：发薪、每周、月底三种。到期的有按钮；没到的写「Opens Oct 29」「Next one on Monday」；做完打勾。月底那项接着填原本的月度 Review 表单。
- **入口（2026-09-19 选 A）**：侧栏 Review 下面的灰色小字 "Monthly check-in" 有待办时变成绿色 "2 check-ins due"；不用红点、不用数字。手机 More 上一个小绿点，More 页里 Review 同样换小字。
- **Overview 只有一行**「2 check-ins due →」，点了去 Review；没有待办不出现（遵守 Overview 只放状态）。
- **发薪日**：来自 Settings 里收入类的 recurring（`dayOfMonth`，短月份退到月底）。没有的话，记完薪水问一次「每个月 25 号左右发吗？」→ 一键存成 recurring。收入不固定（Budget 选 variable）不做发薪提醒。窗口：发薪日前 2 天到后 5 天；窗口内记了薪水就算这个月已记。两份收入各一个。
- **每周**：星期一起到期，直到这周看过。**月底**：最后 3 天到下月头 3 天。
- 新手「Your next step」卡片还在时，Check-ins 先不出现。
- 概念 Demo（v3）：https://claude.ai/artifact/Bz1Cd6m3xnmQuRBiVeuR4J 。Demo 里的日历只是模拟，网站上不放。
- 已做：`src/checkins.ts`（`buildCheckins` / `confirmWeeklyCheck` / `answerPayPrompt`）+ Schema v27 `checkins { weeklyCheckedOn, payPromptAnswered }`；Review 页最上面「Check-ins」卡片（电脑 `order: -3`）；侧栏 Review 小字 / More 页小字变绿、手机 More 小绿点；Overview 一行「N check-ins due →」。
- 用户决定（2026-09-20）：列表**只放当天要做的**，还没到时间的不列出；做完就从列表消失（刚做完那一下显示一行「✓ …」）；今天没有要做的，整张卡片不出现。
- 细节：发薪用收入类 recurring；「Record MYR X」打开预填的 Ledger；每周显示本周个人开销和本月 vs 上限；「Start review」打开表单并把月份设成要复盘的月（月初 = 上个月）；没有每月收入时记完薪水问一次「每个月 N 号左右发吗？」。
- 测试时抓到一个 bug：Ledger 新记的交易日期存成 UTC 时间戳（马来西亚 9 月 30 日 0 点 = `2026-09-29T16:00Z`），原本当成日期字串读，薪水记了也不算。改成跟 app 其他地方一样用 `new Date()` 读本地日期；补了测试。
- 实测（5199，测试浏览器假装 9 月 30 日 / 10 月 2 日）：三项到期、按钮都正确、侧栏 / More / Overview 数字同步、月初复盘上个月、新账号的「每月收入」问题；电脑深浅色 + 手机无溢出无报错。15 个新测试，1234 全绿。截图：https://claude.ai/artifact/3bQrVDwdGNQdBKdc22MT9B

### P-6b — 真正的推送通知  （以后再说，需要单独计划）
- 需要：存每个用户每台设备的推送订阅（数据库）、服务器定时任务、VAPID 密钥；iPhone 要先加到主屏幕。

## 新用户问答引导（O 系列）  `[x]`（2026-09-19 定，同日 O-1..O-4 完成，PR #89 已合并上线）

问题：新用户登录后直接看到全 0 的 Overview；F-7 清单只说「去哪里填」，不说为什么、填完有什么用。
做法：全新账号先走一段问答（开场 + 6 题 + 结果页「你的计划」），每题马上回一句「这对你意味着什么」；
之后 Overview 一次只给一个「下一步」，每步写「Because: 你说过……」，把估计变成真实数据。
概念 Demo：https://claude.ai/artifact/Rxy8M1rjE7CF2ZjVpeCRK6

**已定的决定（2026-09-19，照建议）**
1. 答案保存在 Schema v26 新字段 `onboardingAnswers`（Because 那一行要用）；老数据迁移为空。
2. 第 4 题现金同时写入 Bank 账户余额和安全垫现有金额（`emergency.current`），之后可在 Settings 改。
3. 每月分配（估算）：安全垫未满时 安全垫 50 / 目标 30 / 投资 20；满了以后 目标 60 / 投资 40。结果页写明「按你的数字估算」+ disclaimer。
4. 第 5 题只问有没有投资，不问金额；有的话下一步是「加第一笔交易」。
5. 下一步可以打开已预填的表单（数字来自用户答案），但保存由用户自己按。F-7「不替用户填」的规则就此放宽。
6. Demo 模式加 `?fresh` 参数，用空数据开始，只为测试新用户流程；不影响线上。

**写到哪里**：第 1 题 → `profile` 的主要目标 / `financialGoal`；第 2 题 → 预填「记薪水」；第 3 题 → `monthly-spending-limit` 规则 + 安全垫目标 = 3 × 开销；第 4 题 → Bank 余额 + `emergency.current`；第 6 题 → 第一个 Goal。
只给全新账号看（无 `onboardingDone`、余额全 0、无交易、无目标），老用户永远看不到。按 Start my plan 才一次写入（一个 undo 点）。

### O-1 — 问答逻辑 + Schema v26  `[x]`（2026-09-19，分支 `o-onboarding-qa`，O-4 时一起开 PR）
- `src/onboardingQuiz.ts`：题目、答案类型、结果计算（每月剩余、安全垫月数、目标日期、分配）、`applyOnboardingAnswers(state, answers)`。
- Schema v26 + 迁移；测试：答案写对位置、跳过的题不写、老用户迁移后不触发、开销大于收入不出错。
- 已做：第 2 题写 `cashflow.allowance`（Budget 读的计划收入）；第 3 题写 `cashflow.otherFixed` 并像 Settings 保存一样同步开销上限规则，安全垫目标 = 3 × 开销，`monthlyTopUp` = 分配给安全垫的钱；只填空着的值，绝不覆盖。17 个新测试，1203 全绿。

### O-2 — 问答画面 + 新账号路由  `[x]`（2026-09-19，分支 `o-onboarding-qa`）
- `src/pages/onboardingPage.ts`：全屏 8 屏（像登录页，无侧栏），`main.ts` 对全新账号先显示；可跳过、可「我自己设置」。
- Demo `?fresh`；5199 走完一遍，深色 / 浅色 / 手机 / 桌面截图；老账号看不到。
- 已做：`main.ts` 的 `renderSignedIn` 决定显示问卷还是 app；本机没有这个账号数据时，等云端回复才可能显示问卷（换新设备的老用户不会闪到问卷）。草稿存在模块里，重画不丢；登出清掉。`?fresh` 用独立的 `demo-fresh-user` 存储，不碰原 demo 数据。
- 实测（5199 独立无头 Edge）：深色 / 浅色桌面、390 宽手机走完整流程，无报错、无横向溢出；答案正确写入 v26；「我自己设置」、全部跳过、开销大于收入、还债目标都验过。
- NEW IDEAS：新账号问候是「Good morning, there」（`profile.name` 空），可用登录名补上；换新设备的全新用户在云端回复前仍会先看到约 1 秒的空 Overview（原本就有）。

### O-3 — Overview「下一步」卡片  `[x]`（2026-09-19，分支 `o-onboarding-qa`）
- `src/onboarding.ts` 改成按顺序的下一步列表（because 文字、完成状态从数据判断）；Dashboard 卡片换样式 + 计划条 + `estimate` 标签。
- `onboardingGuide.ts` 支持预填。顺序：记薪水 → 转钱进安全垫 → 记这周开销 →（有投资）加第一笔交易；跳过的题变成对应的下一步。
- 你在 5174 确认真实账号不受影响。
- 已做：`buildNextSteps`（`src/onboarding.ts`，F-7 的 `buildOnboardingChecklist` 保留给 v25 迁移）取代 Dashboard 的清单。问卷答过的不再出现；跳过的题变成对应的步骤。
  「记薪水」用助手同一个 `applyLedgerDraft` 预填（金额、Salary、Bank、今天），「记开销」打开空白支出表单；「转钱进安全垫」在卡片上由用户按「I've moved MYR X」确认（只有用户知道银行转了没有）。
  做完一步显示一行「✓ …」直到下一步完成；「Later」本次会话移到队尾；「Hide this for good」永久关闭。金额在卡片上统一写 MYR（跟 app 一致）。
- 实测（5199 独立无头 Edge）：深色 / 浅色桌面、390 手机，三步从卡片做完，写入正确（income 4500 Salary Bank、buffer 3,850、expense 86），卡片退场、`onboardingDone` = true；Later、Hide、全部跳过账号的 5 步都验过；普通 demo 无卡片。10 个新测试，1213 全绿。

### O-4 — PR、合并、上线、文档  `[x]`（2026-09-19，PR #89 已合并，`main` = `921272c`，www.wealthup.cc 已确认上线）

FUTURE IDEAS：做完之后的节奏提醒（发薪日 / 每周 / 月底 Review）——需要通知功能，现在没有。

## 用户反馈（F 系列）  （2026-09-18，朋友试用后反馈）

分析报告：https://claude.ai/code/artifact/989dcaef-777d-4469-a7a7-9f488fb7d756

### F-1 — 移除 Quick overview（/quick）  `[x]`（2026-09-18，PR #79 已合并上线）
- 原因：内容大部分和 Overview 重复；进过 /quick 后刷新会一直回到 Quick 页（路由 bug）；主屏图标默认打开这个没有导航的页面。
- 做法：manifest `start_url` 改为 `/`；`/quick`、`/#quick` 保留为跳转（旧收藏和已装的图标不失效）；删除 Quick 模板和样式。

### F-2 — 首屏：长缓存 + 字体自托管 + Logo 缩小  `[x]`（2026-09-18，PR #80 已合并上线）
- `/assets/*` 加一年 immutable 缓存；字体改为 fontsource 打包（不再请求 Google）；登录页 Logo PNG 230 KB → 62 KB（SVG 是另一种设计，不能直接换）；Service Worker 不再预下载 608 KB 的旧 Quick Logo。
- 实测：Google 连不上时登录页 1.0 秒出现（原来超过 30 秒白屏）。正常网络首次打开时间没变，瓶颈是 1.2 MB 的 JS，留给拆包那一条。

### F-3 — 点按钮背景光效不再跳  `[x]`（2026-09-18，PR #81 已合并上线）
- 光效只建一次，每次重新渲染把同一个画布搬进新容器；WebGL 不重建，动画时间接着走。
- 实测：点 Today 筛选、切页面，始终 1 个 WebGL 上下文、同一个画布，光效持续播放。

### F-4 — 光效帧率适配  `[x]`（2026-09-18，PR #82 已合并上线）
- 光效最多 30 帧、画布 1 倍分辨率；实测掉帧就降到 20 帧 + 半分辨率，再掉就停成静态；省流量模式直接静态。界面本身照屏幕刷新率跑。
- 实测（软件渲染）：手机页面 23 → 60 帧，桌面 16 → 59 帧；截图对比光效外观不变。

### F-5 — 不闪登录页 + 骨架屏  `[x]`（2026-09-18，PR #83 已合并上线）
- 登录后在 localStorage 记 `wealthup-signed-in`，登出清掉；开机有标记就等 Firebase 确认，不先画登录页。
- `index.html` 内联骨架（上次登录过：App 轮廓；否则：Logo 方块），并在首帧前套用主题。

### F-6 — 拆包  `[x]`（2026-09-18，PR #84 已合并上线）
- Firestore 移到 `src/firestore.ts`，第一次用到时才加载（已登录者开机即后台预载，未登录者不下载）；Firebase app/auth 单独成 `firebase-core` 包，发版只改我们代码时不必重下。
- 实测：首屏前 JS 333 → 171 KB（gzip）；Slow 4G + 4 倍 CPU 降速，首屏约 2.75 → 1.81 秒。真实账号 5174 同步已手验。
- FUTURE IDEAS：各页面按需加载（需把页面切换改成异步）；背景光效 ogl 延后加载（约 40 KB gzip）。

### F-7 — 新用户「Get started」清单  `[x]`（2026-09-18，PR #85 已合并上线）
- Overview 顶部清单，每项从数据自动打勾：账户余额、第一笔收支、一个目标、安全垫目标、第一笔投资（可选）。
- 点一项就跳到对应页面，自动展开藏着的面板、滚到那个输入框、高亮并加一句提示；不替用户填任何东西。
- 必做 4 项完成或按 Hide → `onboardingDone`（Schema v25，跟云端同步），永久消失。v25 之前已有数据的账号升级时直接算完成，老用户看不到。
- 实测：5199 独立无头 Edge 五项都落到正确字段、无报错、手机无横向溢出；你在 5174 真实账号确认看不到卡片、数字不变。
- FUTURE IDEAS：Ledger 账户 Edit 目前是连续 3 个浏览器弹窗，可改成页面内表格。

### F-8 — 登录页介绍区  `[x]`（2026-09-18，PR #86 + #87 已合并上线）
- 登录卡片：标题「Your money, investments and goals, all in one place.」+ Google 按钮 + 两行放心说明（Free. Your data stays private to you. / For guidance only, not financial advice.）。
- 3 个重点（real net worth / real returns / stay on plan）：宽 1100 以上卡片在正中、重点在右；更窄就排在卡片下面，手机第一屏看得到按钮。
- 已定：英文文案；不做公开演示版；不放截图。只改 `renderLogin()` 和 `shell.css` 登录样式。
- 实测 360 到 1400 宽共 6 种尺寸：无横向溢出、无报错，放心说明每种尺寸都是两行。

### F-9 — 右侧线条  `[x]`（2026-09-18，PR #88 已合并上线）
- 原因：`color-scheme` 其实已设，那条线是 Windows 版 Edge 自带的深色滚动条（宽、有箭头、颜色不搭）；只有侧栏有自定义滚动条。
- 已定方案 B：用鼠标的设备上隐藏页面自带滚动条，`src/pageScrollbar.ts` 画一条跟侧栏一样的细滑块（`--scrollbar-thumb` 颜色）。滚动时、鼠标移到右边缘 16px 内时出现，1 秒后淡出，可拖；页面第一次超出窗口时闪一下。点导航造成的滚动不显示。触屏设备不变。
- 副作用：电脑上主内容区宽 15px（滚动条不再占位）。
- 实测：5199 独立无头 Edge 深色 / 浅色改前改后截图；clientWidth 1385 → 1400，开页闪一下、导航不出现、边缘出现、拖 200px 页面跟着滚、无报错。1186 测试全绿。
- FUTURE IDEAS：侧栏和页面滚动条代码约 80% 相同，可合并成一个模块；弹窗内部的小滚动条仍是原生的。

## 插队：「From all-time high」实时更新  `[x]`（2026-09-18，PR #76 已合并上线）

问题：Market / Advisor 抄底阶梯 / Dashboard 抄底提醒的「离历史高点多远」只在打开页面时算一次，
用缓存最多 1 小时的日线收盘价，页面开着不会更新。
- 历史最高收盘价照旧用 10 年日线（很少变，缓存 1 小时）；「现在」改用每 30 秒更新的实时股价。
- Market 每次股价更新都重画；Dashboard 抄底提醒跟着估值一起重新检查，市场回升会自动收起；Advisor 拿到实时价后重画一次。
- 实时价和最后收盘差超过 2 倍（例如便士 vs 英镑）就不用实时价。
- 验证：1130 测试全过（新增 6 个）；5201 Market 显示 −2.0%，实时 VOO 700.86–700.99 对 714.95 高点 = 1.95–1.97%。

---

## 股息和预扣税（D 系列）  （D-1..D-5 完成，PR #77 已合并上线）

VOO / QQQM 每季派息，美国先扣 30%；app 没记，回报被低估、税看不见。
计划书 Preview：https://claude.ai/artifact/QUVcjJRdTy7YszkoeKQDM1

**已定的决定**
- 记录方式 B：app 用 Yahoo 派息历史 × 除息日前持有股数算出建议，你确认 / 修改 / 忽略。
- 默认预扣税率（2026-09-18 查官方资料）：美股 30%（IRS；马来西亚不在美国协定清单）；马股 0%（single-tier）；
  马来西亚 REIT 0% 但要报个人所得税（LHDN PN 2/2026）；港股 0%；新加坡股 0%（IRAS）；爱尔兰 ETF 0%（15% 在基金内部）。
  新加坡 / 香港 REIT 未核实，默认 0% 并标「未核实」。每笔都可改成对账单数字。
- 股息到手的美金进美金换汇池，马币成本用付款日汇率。
- Ledger 不另外记收入（避免重复算净值）。
- 前提：PR #75（多市场）先合并。✅ 已合并（`91fedea`）。

### D-1 — 数据模型 + 迁移  `[x]`（2026-09-18，分支 `feat/dividends`，PR 待开）
- 新 `src/dividends.ts`；`WealthState.dividends`；Schema v24。
- 每笔：股票、除息日、付款日（默认同除息日）、货币、股数和每股（知道才填）、税前、预扣税、状态（confirmed / dismissed）。
- 到手金额不存，用「税前 − 税」算，三个数字不会对不上（跟计划书写的 net 字段不同，是故意的）。
- 同一股票同一除息日只留一笔；税大于税前、确认的股息没有金额 → 整笔丢弃，不猜。
- 还没有任何数字改变。
- 验证：1136 测试全过（新增 12 个）；用正式网站现在的代码读取再存回含股息的数据，股息完整保留，新代码再读也对。
- 前置：PR #75 已在 2026-09-18 由 Claude 按你的选择 squash 合并（`91fedea`），Vercel 部署成功，线上 bundle 已确认。
### D-2 — 回报计算（已收股息、预扣税、含股息总回报）  `[x]`（2026-09-18，分支 `feat/dividends`，PR 待开）
- `dividendIncome`：只算已确认的股息；税前 / 预扣税 / 到手，总数、每只股票、最近 12 个月。
- 马币汇率：记录上存的付款日汇率 → 最近一次换汇记录 → 没有就不换算、算进「缺汇率」笔数。**不用今天的实时汇率**（那是别天的汇率）。
- 股息记录多一个可选字段 `rateToMyr`（D-3 建议时填）。
- Snapshot 新增：股息总数、每个持仓的股息、「未实现盈亏 + 同一批持仓的股息」和它的百分比（跟旁边的未实现数字同一批持仓）。
- 验证：1144 测试全过（新增 8 个）；原有每个数字不变。
### D-3 — 派息历史和建议  `[x]`（2026-09-18，分支 `feat/dividends`，PR 待开）
- 新 `src/dividendSuggestions.ts`（纯函数）：除息日**之前**持有的股数 × 每股股息 = 税前；按市场默认税率算预扣税。
- 每笔建议附上「付款日当天或之前最后一个收盘汇率」，确认后就用真实汇率，不用今天的。
- 已确认或已忽略的不会再建议；除息日还没到的不建议；那天没持股的不建议。
- 派息金额跟着报价单位：伦敦用便士报价的基金派息也是便士，自动换成英镑（实测 ISF.L 5.28 便士）。
- 提醒「看对账单」的情况：伦敦基金（派息货币可能跟报价货币不同，VWRL.L 无法确认）、派息货币跟你买入货币不同、港股 / 新加坡股（REIT 预扣未核实）。
- `/api/market` 新增 `kind=dividends`，并允许 `=`（拿汇率历史 `USDMYR=X`）。
- 验证：1160 测试全过（新增 16 个），数字用 2026-09-18 实际抓到的派息和汇率。
- 没做到的：dev server（5201）在这轮被系统因内存不足停掉了，所以 `kind=dividends` 这条路线没有在浏览器里实跑过，只有单元测试和直接打 Yahoo 验证过。
### D-4 — Portfolio 股息卡片  `[x]`（2026-09-18，分支 `feat/dividends`，PR 待开）
- Portfolio 新卡片 Dividends：待确认清单（Confirm / Edit / Ignore）+ 已收到清单（可删除）。
- Edit 可改付款日、税前、预扣税；税大于税前不让存。
- 有记录后显示三个数字：12 个月到手、12 个月被扣的税、含股息未实现回报（旁边写不含股息的百分比）。
- 「看对账单」的提醒直接显示在那一行下面。
- 建议只存在页面里，不写进云端数据：还没回答的问题不是事实。
- 没有交易也没有股息记录时整张卡隐藏。
- 验证：1160 测试全过；typecheck 和 build 通过。
- **浏览器实测后修了一个真 bug（2026-09-18）**：Confirm / Edit / Ignore 按钮点了没反应 —— 建议是异步载入后才画出来的，
  页面载入时绑的事件监听器绑在了后来被替换掉的元素上。改成整张卡片一个委托事件处理器，重画多少次都有效。
  顺便修了桌面版按钮换行的排版。**这个 bug 测试抓不到，是打开页面才发现的。**
### D-5 — 股息美金进换汇池  `[x]`（2026-09-18，PR #77）
- 已确认的股息在付款日进入那个货币的池子，带着当天的马币价值；之后的买入可以花这笔钱。
- 这也解释了之前对不上的那约 USD 64：没有换汇记录的美金，有一部分可能就是股息。
- 没有汇率的股息不进池子（进了会拉低池子里所有美金的成本），但仍然算在股息收入里。
- 已忽略的建议和马币股息不碰任何池子。
- 验证：1167 测试全过（新增 7 个）；没有股息记录时池子行为完全不变。

**FUTURE IDEAS**：手动新增一笔股息（现在只能从建议确认）；读 Moomoo 对账单的股息；股息再投资提醒；马来西亚 REIT 报税提醒。

---

## 多市场 Portfolio（MM 系列）  （2026-09-17 定）

Portfolio 原本只能记美股（USD 写死在字段名里），马股、港股、新加坡股记不进去。
计划书 + 界面 Preview：https://claude.ai/artifact/3VdKmxL65HUdJkwGquyiNQ

**已定的决定**
- V1 市场：美股 · 马股（`.KL`）· 港股（`.HK`）· 新加坡股（`.SI`）· 伦敦 ETF（`.L`）。A 股、日股、台股、澳股、韩股放 FUTURE IDEAS。
- 市场和货币分开存（VWRA.L 是 USD，VWRL.L 是 GBP）；货币用三位国际代码，不写死。
- 手续费选 B：金额 + 它的货币（交易货币或 MYR），照对账单填，不自动算；一笔交易一条手续费。
- 只记股数；马股界面显示「= N 手」。
- **兼容旧版（Task 1 时发现）**：正式网站的旧版读换汇记录只认 MYR/USD 旧字段、其他丢掉。
  所以旧字段保留，美金交易和 MYR↔USD 换汇以旧字段为准，新字段每次读取重新算。

### MM-1 — 数据模型加市场和货币 + 迁移  `[x]`（2026-09-17，分支 `feat/multi-market-t1`，PR 待开）
- 新 `src/tradeCurrency.ts`：市场表、后缀认市场、`normalizeTradeMarket`、换汇 from/to。
- Trade 加 market / currency / amount / price / fee / feeCurrency；CurrencyExchange 加 from/to。Schema v23。
- 计算一行没改。验证：新旧两版代码算同一份 demo 数据，Portfolio snapshot 逐字节相同；1069 测试全过。
- 你决定不用真实数据验证，改用 demo（5201 端口，跑这个分支）。
- 跟计划书的差别：非 MYR/USD 的换汇记录挪到 MM-2 才接收（MM-2 已做）。

### MM-2 — 换汇池按货币分开  `[x]`（2026-09-17，同一分支 `feat/multi-market-t1`，PR 待开）
- 每种外币一个加权平均池：只有「MYR → 这种货币」的换汇能填它，只有用这种货币的交易会用它。美金不会付港股的钱。
- 马股（MYR）交易成本 = 金额本身，汇率 1，不进任何池。
- 手续费如果用交易货币记，按这笔交易同一个汇率换成 MYR；MYR 手续费照原样。
- 接收任何「MYR ↔ 外币」换汇记录；MYR↔USD 继续带旧字段（旧版正式网站读得到）。外币对外币（例如 HKD → USD）V1 不接收。
- 覆盖率按货币分开算（`byCurrency`）；页面上显示的美金覆盖率只看美金池，数字不变。
- Portfolio 换汇清单：方向显示真实货币（例如 MYR → HKD），「USD」栏改名「Foreign」。
- 验证：1084 测试全过（新增 15 个）；新旧代码算 demo 数据仍逐字节相同。

### MM-3 — 报价和汇率  `[x]`（2026-09-17，同一分支，PR 待开）
- 实测（2026-09-17）：Yahoo 对 `1155.KL` / `2800.HK` / `D05.SI` 直接回 MYR / HKD / SGD；伦敦看股票：
  VWRA.L 是 USD、VWRL.L 是 GBP、**ISF.L、LLOY.L 是 GBp（便士）**。报价 API 本身不用改。
- 便士（GBp / GBX，还有 ZAc、ILA）在前端换成主货币，价格和昨收都除以 100。
- 报价超过 12 只自动分批，一批失败只影响那一批。
- `fetchRatesToMyr`：各币种对 MYR 汇率，先用汇率 API，失败就用最近一次「MYR → 那种货币」的换汇记录；
  两样都没有就是未知，不用固定数字。美金继续走原来的 `fetchUsdToMyr`，美金数字不会变。
- 汇率放进 `ratesToMyr`，MM-4 才开始用。
- 验证：1094 测试全过（新增 10 个）；demo 数据新旧代码仍逐字节相同；5201 上实际调用报价 API 五个市场都拿到价格。

### MM-3b — 汇率实时更新  `[x]`（2026-09-17，你决定加做；同一分支，PR 待开）
- 原因：原本的汇率 API 一天只更新一次（查过：17 日 00:02 UTC 更新，下次 18 日 00:23），股价却每 30 秒更新。
- 现在汇率用 Yahoo 的 `USDMYR=X` / `HKDMYR=X` 等，跟股价一起每 30 秒刷新（晚市场几分钟）。
- 拿不到时：每日汇率 API → 你最近一次换汇记录 → 未知。美金拿不到实时汇率时走原本的路径。
- **会动到美股的马币市值和马币盈亏**（跟着实时汇率小幅变动），成本不变。你已同意。
- 报价 API 的代码检查放宽，接受 `=`（服务器改动，合并后部署才生效）。
- 验证：1098 测试全过；5201 实际拿到四种实时汇率。

### MM-4 — 持仓计算多币种  `[x]`（2026-09-17，同一分支，PR 待开）
- 成本按持仓自己的货币算（本币成本、平均成本、已实现盈亏）。
- 每个持仓多了：市场、货币、本币价格 / 市值 / 盈亏，以及换成 MYR 用的汇率（MYR = 1，USD 用原本的美金汇率，其他用 `ratesToMyr`）。
- 「USD」字段只放美金持仓的数字，其他货币是 0 或空，不会混在一起。
- 报价货币跟持仓货币不一样（例如港股拿到美金报价）→ 当作没有价格，不乱乘。
- 有一个持仓缺汇率 → 马币总值显示未知（不是少算），配置比例退回按成本。
- 新增 `byCurrency` 按货币小计（本币 + MYR）。
- 验证：1108 测试全过（新增 10 个，用计划书 Preview 的示例组合，总值 RM 15,605.62）；
  demo 数据原有的每个字段跟 main 逐字节相同；5201 Portfolio 正常显示。
- 页面还没改（MM-5 才改），非美股目前在页面上会显示不完整。

### MM-5 — Portfolio 持仓表  `[x]`（2026-09-17，同一分支，PR 待开）
- Holdings 卡：非美股那一行写「Hong Kong · HKD 12,610」，马股写「Malaysia · 3 lots」；美股不变。
- Position detail：股数、平均成本、价格、成本、市值用持仓自己的货币，旁边是 MYR 两栏；
  超过一种货币时按货币分组，每组一行小计（本币成本 → 本币市值 · MYR 市值 · 汇率）。
- 交易记录：Amount / Price 用交易自己的货币；MYR 金额用换汇记录重算过的数字。
- 缺某种货币汇率时，Market value 卡写「No HKD → MYR rate yet」。
- 市场名称改英文（App 是英文）。
- 验证：1108 测试全过；5201 用示例港股 / 马股 / 新加坡股 / 伦敦 ETF 截图（电脑 + 手机），真实报价和实时汇率。
- 看到但没改：新加的代码没有目标比例（Target 0%），所以 drift 很大、显示 Rebalance。这是目标设定的事，记下来。
### MM-6 — 新增交易表单（选市场、手续费货币切换）  `[x]`（2026-09-17，同一分支，PR 待开）
- 表单先选 Market；货币自动带出（London 可选 USD / GBP）；价格、金额栏写出货币。
- 代码自动补后缀（1155 → 1155.KL），港股补到 4 位（700 → 0700.HK）。
- 手续费旁边切换「交易货币 / MYR」；马股只有 MYR，不另外问马币金额，数量下面显示「= N lots」。
- 金额留空 = 价格 × 数量；马币金额留空 = 当下汇率（之后换汇记录会取代）。
- `feeMyr` 永远存马币（旧版读得到）；非美金交易的 USD 字段是 0。
- 新文件 `src/tradeEntry.ts`（纯函数，表单 → 交易）。
- 验证：1121 测试全过（新增 13 个）；5201 实际填表送出港股交易，存进去的数字和持仓行都对；电脑和手机截图在 Preview。
- 计划书原本写「新增／编辑」，但 App 现在没有编辑交易功能（只有删除），这次只改新增。编辑交易放 FUTURE IDEAS。
- 没测到：助手（Ask）预填表单那条路在浏览器里没实际跑，只有类型检查。
### MM-7 — 按市场／按货币分布（放 Portfolio，不放 Dashboard）  `[x]`（2026-09-17，同一分支，PR 待开）
- Portfolio 新卡片「Where your money is」：左边按市场、右边按货币（电脑并排，手机上下）。
- 按货币就是汇率风险：伦敦用美金计价的 ETF 算「London」市场、「USD」货币。底下一句「X% moves with exchange rates; Y% is in ringgit」。
- 比例基准跟配置比例一样：全部有马币市值时按市值，否则全部按成本（右上角写明）。
- 只有跨两个以上市场或货币才出现；只买美股的用户不会多一张卡（demo 确认隐藏）。
- 电脑版排在持仓下面、Next contribution 和 Recent activity 上面。
- 新函数 `getPortfolioExposure`（portfolioSummary.ts）。验证：1124 测试全过（新增 3 个）；5201 截图电脑 + 手机。
### MM-8 — CSV 导入认出非美股（先拿真实导出确认格式）  `[-]`（2026-09-17 暂缓）
你目前只买过美股，没有含非美股的 Moomoo 导出文件，格式没办法确认，移到 FUTURE IDEAS。
MM-1..MM-7 开 PR #75（未合并）。

**FUTURE IDEAS**：CSV 导入非美股（MM-8，等有真实导出文件）；编辑已记录的交易；新市场代码的目标比例（现在是 Target 0%，drift 很大）；更多市场；手续费自动估算（要你确认）；一笔多条不同货币手续费；股息和预扣税；IPO 申购；港股双柜台。

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
  - Wealth Vault —— 全新功能，上传财务文件自动提取数字。**暂停（2026-09-11）**：需要
    AI/OCR，是持续的 API 调用费用，现在负担不起，等预算允许再看（见 P-4 末尾）。

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
- **Wealth Vault：暂停（2026-09-11）**——需要 AI/OCR 才能做到"上传文件自动提取数字"，
  是持续的 API 调用费用，现在负担不起。只记录，不再当作"待讨论"，等预算允许再重新评估。
  技术方向（重启时参考）：CSV 导入已有的"不可信输入 → 校验 → 用户确认"模式可以直接套用，
  不必因为这个再破一次"Advisor 零 AI"的架构原则——AI 只负责读数字，不负责给判断。

下一步产品打磨项由你定。

---

## AI 助手（A 系列）

目标：右下角悬浮助手。**Ask** 问 WealthUp 怎么用、数字怎么来的；**Record** 用一句话描述一笔账或交易，
助手把对应表单预填好，**保存永远由你自己按**。模型 `ling-3.0-flash-fin:free`（OpenRouter，免费档，
不产生 API 费用）。

**边界**：这个助手和 Advisor 是两件事。Advisor 仍然是纯规则、零 AI，本系列没有碰它。助手不写任何数据，
只预填表单；Ask 回答里带「非投资建议」。

### A-1 — 服务器代理（Cloud Function）  `[x]`  （PR #35）
- **问题**：浏览器不能直接调 OpenRouter，key 会暴露。
- **做法**：`functions/`（Firebase Cloud Functions 2nd gen，us-central1）。模型写死在服务器端，客户端改不了；
  客户端送来的 `system` 消息直接拒绝；跨域白名单（站点在 Vercel、函数在 Firebase，每次都是跨域）；
  按 IP 限流（移植自 `api/_rateLimit.ts`）。key 存在 Firebase Secret Manager，不进仓库。
- 验证：已部署到生产并用真实请求验过（预检 204、非白名单 403、改模型被忽略、坏输入干净 400）。

### A-2 — 悬浮组件外壳  `[x]`
- `src/components/assistant/`。挂在 `#pageMount` 外面，切页面不消失；状态是模块级变量（跟 Ledger 筛选、
  TVM 输入同一个做法），不进 `WealthState`。手机上抬高避开底部 Tab 栏。

### A-3 — Ask 问答  `[x]`
- 聊天气泡、连续对话、失败提示（限流 / 服务器错 / 断网 / 空回复各有一句人话）。
- 新对话时有建议问题，开始聊之后不再显示。

### A-4 + A-5 — Record：记账 + 持仓交易  `[x]`
- 模型按提示词输出一个 JSON 动作，浏览器端宽松解析（去掉代码块、取第一个完整对象）再逐字段校验。
- 预填走页面自己的路径：Ledger 复用已有的 `ledgerEntryDraft`；Portfolio 表单没有草稿状态，
  排队到 `bindPortfolio` 里一次性写进 DOM。
- **Record 是日志不是对话**（你看过觉得跟 Ask 太像，改的）：每条一张卡片——原话、解析结果、状态
  （Ready / Filled in / Discarded / Not recognised / Failed / Not used），最新在上、按天分组。
  每次请求不带历史。建议问题固定在输入框上方，一行横向滑动。
- **草稿不跨刷新**：刷新后没处理的草稿变 Not used，按钮消失，避免同一笔记两次。

### A-6 — 隐私：发出去的是什么  `[x]`
- Ask：默认只发今天的日期。「Share my figures」打开才附带数字摘要（整数令吉、百分比）。
  **开关每次打开页面都回到关闭**（你测出来原本会被记住，改的）。
- Ask 历史界面上保留，但**只把这次访问的对话发给模型**，中间一条「New conversation」分隔线
  （不然开关关了，旧回答里的数字还会被重新发出去）。
- Record：只发类别 / 账户 / 股票 / 券商的**名字**，从不发金额——填表需要名字，这个开关打开也不发数字。

### 实测抓到的两个问题（接真实模型才暴露）
1. **模型编造汇率**：「bought 500 usd of VOO at 520.50, fee 3 myr」→ 自己猜 4.40 汇率填 `amountMyr: 2200`，
   又用 500÷520.50 算出 `units`。猜出来的令吉数字会变成持仓成本基础。
   **修法**：`figureAppearsIn()`——你没说过的数字一律不填，卡片上说明留空了哪个。记账金额对不上直接拒绝整张草稿。
2. **reasoning 模型吃光输出预算**：思考和正文共用 `max_tokens`，交易那条返回空字符串。Record 上限提到 2400，
   Ask 1200；提示词里禁止换算货币、禁止自己算数量。

- 验证：typecheck / 884 测试 / build 全绿；CDP 真实浏览器验证（Ask / Record / 预填后账目条数不变、按 Save 才 +1 /
  四种失败路径 / 刷新后开关关闭、旧对话不重发）；你手动跑完 25 项测试清单。

### 助手记录跟账号走（AH 系列）  （2026-09-17 定）
- **问题**：Ask / Record 记录存在浏览器 localStorage，key 不分账号 → 同一个浏览器 A 登出、B 登入会看到 A 的记录（串号，隐私问题）；换设备也看不到。
- **已定**：这台浏览器现有的记录归到下次登入的账号；不做实时同步，登入 / 打开助手时拉一次；分两个 PR。

#### AH-1 — 记录按账号分开  `[x]`（2026-09-17，PR #73 已合并）
- localStorage key 加上 uid；登出时画面上的记录马上清空；demo 用自己的一份。
- 旧的不分账号记录：第一个登入的账号接手，然后删掉旧 key。
- 测试：A 登出 → B 登入看不到 A 的记录。

#### AH-2 — 记录存到 Firestore  `[x]`（2026-09-17，PR #74 已合并；你已在 5174 实测）
- `users/{uid}/assistant/history`（现有规则已限定本人读写，不改规则）。
- 登入 / 打开助手时拉云端，按 id 合并、按时间排序、上限不变（Ask 40 / Record 120）；新增或更新后 2 秒写一次。
- 「清除记录」记下清除时间，所有设备都不会把清掉的带回来。模式和「已读提示」留在本机；demo 不连 Firestore。

### 助手理财原则（R 系列）
线上发现 Ask 建议「饮食资金不足，从紧急资金挪一点」。和你讨论定下六大原则（预算定了就守、不跨类别挪钱；
存满 3–6 个月必要支出的紧急资金再投资，放 MMF，只用于真正紧急；高息债先还；ETF 为主、达目标才卖、
新资金再平衡；3 年内目标放 MMF；不推荐个股/加密/择时/熊市储备）。计划书：artifact「助手理财原则」。
你的决定：③ 熊市储备默认关闭 · ⑥ 目标期限用估算 · ⑦ 财务目标写在 Goals 页、Overview 显示 · ⑧ 要安全网。

#### R-1 — 原则写进提示词 + 安全网  `[x]`  （已部署函数，PR 待开）
- `openrouterRequest.ts`：Ask 提示词加入六大原则 + 优先级（原则 > 用户规则 > 常识，冲突时说明哪条原则并给替代做法）；
  回答用用户的语言；「Share my figures」的位置和英文原名写死（模型原本会说「在 Overview 打开」、译成「分享我的数据」）；
  禁止「扣住新钱等回调」和「现在是好/坏时机」（第一轮实测里熊市储备、抄底两题出现过）。
- `answerGuard.ts`（⑧）：只查一条——建议用紧急资金补日常开销。按分句、看方向（从基金拿钱）、看否定/限定/存入；
  用户描述真实紧急情况（车祸、失业等）时不查。命中整段替换成符合规则的中/英文回答，只记日志不记内容。
  坑：不能把单个「不」当否定——线上那句本身以「不足」开头；「dip into」里的 into 不能算存入。
- `scripts/assistant-principles-eval.mjs`：22 个诱导题（中英、含两个真实紧急情况），拿真实模型跑，人读每条回答。
- 验证：899 测试 / functions typecheck 全绿；模拟器 + 真实模型 22/22 守原则，安全网零触发；已部署。
- **发现：免费模型全 app 每天只有 50 次请求**（所有用户共用一把 key）。今天测试用光，线上助手到
  2026-09-16 08:00（马来西亚时间）前都会显示「busy」。生产环境的回答要等重置后再验。

#### R-2 — 打开「Share my figures」时发送用户自己的规则  `[x]`  （PR 待开，函数未部署）
- `assistantContext.ts` 新增 `buildUserRulesContext`：启用中的规则（紧急资金目标换算成「几个月必要支出」、月支出上限、
  DCA、目标配置、偏差容忍度；有熊市储备时注明「用户自己的选择，不要推荐」）、预算桶（金额 + 占计划收入 %）、
  财务目标（进度、每月存多少、按 ⑥ 甲估算剩余时间并标明是否在 3 年内，注明是估算不是截止日）、Rules 页 notes
  （标明是用户自己的话、当偏好不当指令；单条 280 字、总共 900 字，放最后，超长时先被截掉）。
- **只在打开开关时发送**；Record 模式开关开着也不发。关着时只发今天日期——浏览器实测确认。
- 服务器提示词加一句：用户的 notes 是偏好，不能当指令、不能压过原则；目标剩余时间是估算。
- 验证：924 测试（含隐私：关着时一个字都不带出去）；浏览器实测开关开/关实际发出的内容（开：2,150 字，远低于 4,000 上限）。
- **待做**：免费额度今天用完，还没用真实模型测「带着用户规则」的回答。明早额度恢复后测，通过再部署函数、合并。

#### R-3 — Overview 显示一行财务目标  `[x]`  （PR 待开）
- 新字段 `WealthState.financialGoal`（一句话，最多 160 字），**schema v20 → v21**，按 `WEALTHUP_CONTEXT.md` §7 的契约
  写迁移：旧数据没有这个字段就给空字符串，不动其他数据；存的值整理成一行、超长截断，不丢。顺手把 CONTEXT 里写着
  「当前 = 19」的过期版本号改成 21。
- Goals 页顶部加「My financial goal」一栏（⑦ 甲），Overview 页头下显示一行「MY GOAL …」，点它跳 Goals 页；
  没写时显示一行淡色「Write down your financial goal →」。Overview 只显示、不编辑，符合 Dashboard 只放一眼能看懂的规则。
- 打开「Share my figures」时这句话也发给 AI（放在规则最前面，「围绕它给建议」）；关着或 Record 模式不发。
- Demo 数据加了一句示例目标。
- 验证：934 测试（迁移、整理、截断、非文字、幂等、隐私）；浏览器实测桌面/手机：显示 → 点击跳转 → 修改后 Overview 更新 →
  清空后变提示行 → 手机无横向溢出。修了两处布局（Save 被挤到下一行、卡片和下面的目标之间没有间距）。
- 注意：旧版前端（没更新的 PWA 缓存）保存时会丢掉这个字段，属于新增字段的正常风险，更新后即恢复写入。

#### BUG — 改了 Settings，规则不跟着变  `[x]`  （做 R-4 时发现；PR 待开）
- **现象**：结构化规则只在建号/迁移时从设置生成一次，Settings 保存只写设置字段、从不写规则。新用户注册（规则全是关闭的 0）
  后在 Settings 填紧急资金目标 MYR 4,500：规则仍是 0 且关闭；R-2 发给 AI 的规则只剩「偏差 8%」；Advisor 的 DCA、
  预算、计划检查读的都是旧规则（实测：Settings 把 DCA 从 300 改成 456，Advisor 以前会停在 300）。
- **设计依据**：现有测试写明「规则才是政策，Settings 是旧字段」「迁移不能覆盖用户配置的规则」。所以不是在加载时用设置
  重新生成规则，而是补上缺失的写入：
  - `syncPlanningRules`：保存 收支/DCA、紧急资金、目标配置 时更新对应规则；原本是占位（关闭且为 0）的规则有值后打开；
    用户有值却关掉的规则保持关闭；保存 0 就关闭；表单不负责的规则（偏差容忍度、分批投入）一个字不动。
  - `syncGoalContributionRules`：目标保存/新增/删除时同步每个目标的每月存款规则。
  - `repairPlaceholderRules`（加载时）：只修「占位规则 + 设置里已有值」这种明确受影响的情况；已配置的规则、空规则数组都不碰；幂等。
    已有值但过时的规则无法判断是否刻意，下次保存那个设置时就会同步。
- **我汇报时说错两处，已更正**：①「每个新用户自带熊市储备」—— 实际新用户是空白的，带熊市储备的是 Reset 用的示例模板；
  ②「Advisor 显示 Hold at least MYR 0」—— 那句只存在于建议数据里，页面没显示；页面上受影响的是 DCA 金额和预算/计划检查。
- 验证：948 测试（含原 bug 完整重现、不覆盖配置、幂等）；原重现脚本修复后：规则 4,500、AI 收到紧急资金目标和 DCA；浏览器实测 DCA 同步。

#### R-4 — 新用户默认值 + 数据工具移到 Settings  `[x]`（你的决定：A 做 · B1 · C 记录；PR #42）
- **A 做**：Settings 紧急资金卡片，填了必要支出（交通 + 饮食 + 其他固定）后显示「Suggested target: MYR X —
  6 months of your essential spending · WealthUp's standard is 3–6 months」+「Use 6 months」按钮。按钮只填进输入框，
  **不保存**，还是要你按 Save Emergency。没填必要支出时显示提示去填 Cashflow。目标已相同时不显示按钮。
- **B1**：Reset 改成真正空白（`emptyState()`），和确认文字一致；不再载入带示例目标、MYR 400 熊市储备的示例模板。仍先存 Version History。
- **Import 前先存 Version History**（PR #41）：Import 以前直接覆盖、不留备份；现在标注「Before import」。
- **工具全部移到 Settings**：侧栏抽屉（主题、Add to Home Screen、Export、Import、Version History、Reset）和手机 More 页底部
  同一排按钮都移到 Settings 最后一张「Data & App」卡片，Reset 放最底、红字。侧栏账号行（头像、名字、Sign Out）和免责声明保留。
  删掉了抽屉的代码、记住开合状态的 localStorage 和相关 CSS。
- **胶囊样式（你的 idea，选甲）**：卡片里去掉说明文字，只留一排圆角胶囊「Theme · Export · Import · Version History ·
  Add to Home Screen · Reset」，Reset 最后、红框红字；鼠标停留有一句说明（title）。桌面卡片横跨整行、一排排完；手机自动换行。
  说明文字拿掉后 **Import 加了确认框**（以前选完文件直接覆盖）：「Replace all your data with this file? …saved to Version History first.」
  取消 → 数据不变、可重选同一文件；确认 → 先存「Before import」再导入（浏览器实测两种都对）。
- **做这个时发现的两个 bug，一起修了**：
  1. **Version History 对真实账号永远是空的**：保存按 `uid` 存，打开时按 `email` 读，两个 key 对不上。所以 Reset / Import
     存的备份在真实账号里**根本打不开**（demo 模式看不出，因为 demo 没有 email）。改成按 uid 读、清空、恢复。
  2. **Restore 没有先存当前数据**：确认框写着「当前状态会先存一份」，实际没存。现在恢复前存「Before restore」。
- 验证：955 测试（建议目标计算、只算必要支出、空值/坏值、Reset 空白）；浏览器实测：侧栏/More 页工具已无、账号行在；
  Settings 卡片 6 个工具 Reset 在最后；建议 MYR 7,200 → 按钮填入不保存；主题切换；Reset → 设置全 0、Goals 空、显示提示；
  Version History 出现「Before reset」，Restore 后多出「Before restore」；手机无横向溢出。

#### R-5 — 原则存成正式文件  `[x]`（PR #43）
- 新文件 `docs/assistant-principles.md`：适用范围（Ask 受约束；Record 不给建议；Advisor 零 AI）、优先级、六大原则
  （每条附提示词里的英文标题）、助手能看到什么（Share my figures 开/关、Record 只看名称）、安全网、已做的决定
  （③ ⑥甲 ⑦甲 ⑧ R-4 A/B1/C）、**改原则的流程**（先改文件 → 改提示词 → 本地跑 22 题 → PR → **部署函数**，
  只合并 PR 不会让提示词生效）、22 道测试题分类表。
- 防止两边不同步：新测试 `tests/assistantPrinciplesDoc.test.ts` 核对六条标题（顺序）、关键数字（50/30/20、3–6 个月、
  默认 6 个月、8%、偏差 8%、3 年放 MMF、不推荐熊市储备）和测试题数量。实测：故意把文件里的偏差改成 10%、标题改名 → 测试失败。
- 958 测试通过。只加文档和测试，不改提示词，所以**不用部署函数**。

#### 小改 — Overview「Financial goal」文字居中、加大  `[x]`（PR #44）
- 你写的那句目标放在整条横栏的**正中间**（不是标签右边剩下空间的中间）：右侧放一个看不见的「MY GOAL」占位，左右两栏等宽。
  没写目标时的提示行不变。
- 追加：标签改成「FINANCIAL GOAL」（大写）；目标文字加大加粗（18px 粗体，手机 16px），读起来像一句志向而不是状态。
  手机上改成标签在上、目标在下，都居中（左右并排时一句短目标会被挤成三行）。
- 追加（A）：目标那句改用 Lato，只加载一种粗细，只用在这一处；加载失败退回 Inter。
  先做了 Bold 700，看了 700 / 400 / 400 淡色 三种对比后你选 **B：Lato Regular 400**（文字仍是最亮的颜色）。
- 追加（设计 1「光晕」，从 光晕 / 引言 / 旗帜 / 横幅 四种预览里选的）：写了目标时变成一张卡片——顶部淡绿色光、淡绿边框和外圈柔光、
  标签绿色在上、目标在下都居中，文字桌面 20px / 手机 18px。左边绿线和「对称占位」去掉（上下排列不再需要）。
  没写目标的提示行不变。实测深色、浅色主题（浅色自动变淡）、手机长目标（换行居中、无溢出）、空状态。
- 追加：**去掉绿色**，改成和 Overview 其他卡片一模一样的颜色（底色、边框、16px 圆角、标签灰色），没有光晕。
  保留：标签在上、目标居中、Lato Regular 20px/18px。实测底色/边框/圆角和 Net Worth 卡片完全相同（深浅主题都是）。
  Lato 没有中文字，中文目标会显示系统中文字体。实测字体已加载并生效，居中不变。
- 实测文字中心和横栏中心相差 ≤1px（桌面 1280、手机 390）；很长的目标换行后仍居中、无横向溢出。

### 待办 / FUTURE IDEAS（记录，不自动做）
- **（R-4 C）迁移补空缺用的是示例模板**：导入的文件缺某一块（例如熊市储备、紧急资金）时，`migrateState` 会用示例模板的数值
  补上，而不是空值。影响已有数据的处理，这次不动。
- **每日 50 次免费额度**：上线后真实用户会很快用完。OpenRouter 充值 10 credits（约 USD 10，一次性）可升到每天 1000 次。由你决定。
- ~~额度用光时写「busy, try again shortly」~~ **已修（2026-09-15）**：服务器读 OpenRouter 的 429，区分「每日免费额度用完」
  和「短时繁忙」；前者返回重置时间，面板显示「今天的免费额度用完了，明天早上 8:00 恢复，WealthUp 其他功能照常」
  （按用户本地时间）。认不出的 429 一律按短时繁忙处理，不会乱承诺时间。
- **已上线（2026-09-14）**：先部署新版 Cloud Function，再合并 PR #35（顺序不能反，否则线上 Record 会失败）。
- **换 OpenRouter key**：key 在对话里贴过两次，上线后尽快换。不用改代码。
- 聊天记录改存 Firestore（跟账号走、换设备可见、不串号）。现在是浏览器 localStorage。SQLite 讨论过，不适合。
- `firebase-functions` 版本偏旧，CLI 部署时提示升级（有破坏性变更，单独做）。
- 更多 Record 动作（目标、预算桶、换汇、每月定投）；流式输出。

---

## 液态玻璃按钮（G 系列）

目标：按钮和浮层改成 iOS 26 的 **Liquid Glass（液态玻璃）** 风格。Preview（不改代码，只用来定方向和参数）：
https://claude.ai/artifact/DWFjJPJ2Nof42eZSZTtZZB

- **Problem**：现在的按钮是扁平实色，浮层（Tab 栏、顶栏）是 94% 实色，跟你每天用的 iPhone 风格不统一。
- **Why**：纯视觉打磨，不影响正确性。按 `CLAUDE.md` §10，一次只做一小步，每步截图确认。
- **Current System**：
  - 所有按钮统一走 `.wu-btn`（`src/components.css`），全站约 170 处：`sm` 69、`ghost` 32、`secondary` 25、`primary` 20、`icon` 13、`danger` 7。
  - 手机顶栏 `.mobile-brandbar` 和底部 `.tabbar` 在 `src/shell.css` 的 `@media (max-width: 720px)` 里。
  - Ask 按钮是 `.assistant-fab`（`src/components/assistant/assistant.css`）。
  - Dashboard 顶部有 WebGL 光线（`side-rays`）。
- **Proposed Solution**：分三层，不一刀切。
  - **L1 浮层 = 完整玻璃**：模糊、提饱和、高光边、按下鼓起发亮。电脑 Chrome 额外加真折射。
  - **L2 按钮 = 轻玻璃**：只有胶囊形、高光边、按下动画，不加背景模糊。
  - **L3 文字按钮 = 只改圆角**。
- **Architecture**：
  - `theme.css` 加 `--glass-*` token，深色、浅色各一套。
  - `components.css` 加共用的玻璃材质，并改 `.wu-btn` 的几个变体。
  - `shell.css` 改 Tab 栏和顶栏，`assistant.css` 改 Ask 按钮。
  - 新增一个小模块 `src/liquidGlass.ts`，负责按下时的光点跟手，以及 Chrome 的折射。
  - 不碰任何页面逻辑。

### 已定的决定（2026-09-15，Preview 里确认）
| 项 | 结论 |
| --- | --- |
| 范围 | L1：底部 Tab 栏（改成悬浮胶囊）+ 手机顶栏（**做成玻璃**）+ Ask 按钮<br>L2：`primary` / `secondary` / `danger`<br>L3：`ghost` 和表格里的图标按钮，只改胶囊圆角 |
| 主按钮 | 绿色着色玻璃，白字，跟 iOS `glassProminent` 一样 |
| L2 背景模糊 | **不加**。按钮后面都是纯色卡片，加了看不出来，只会更吃性能 |
| 顶部光线 | **保留** |
| 平台 | 以 iPhone Safari 的模糊版为主设计；折射只是电脑 Chrome 上的额外效果 |
| 无障碍 | 系统「减少透明度」时退回实心；「减少动态效果」时关掉动画 |

参数：
```
--glass-blur: 10px;
--glass-refraction: 55;   /* 只在 Chrome */
--glass-tint: 0.78;
--glass-highlight: 0.70;
```

### G-0 — 讨论方向 + Preview 定参数  `[x]`
- 讨论 iOS 液态玻璃的原则：玻璃只放在浮层上，不叠玻璃；定下分层方案。
- 做了独立的 Preview：并排对比现在和玻璃，可以切换主题，在电脑上模拟 iPhone Safari，用滑块调参数。项目代码没有改动。
- 在 Preview 里确认了上面的决定和参数。

### G-1 — 玻璃 token + 材质 + L1 浮层  `[x]`（2026-09-15，PR #45，merged）
- 在 `theme.css` 加 `--glass-*` token；在 `components.css` 加共用材质：高光边、按下鼓起、光点跟手，以及「减少透明度」和「减少动态效果」的退路。
- 手机顶栏改成玻璃；底部 Tab 栏改成悬浮胶囊，加上滑动的选中镜片；Ask 按钮改成绿色玻璃。
- 这一步只用「模糊 + 高光」，所有浏览器效果一致；折射放到 G-4。
- 要检查：`.main` 底部留白仍然能让最后一张卡片露出来；Ask 按钮不压到悬浮 Tab 栏；Tab 栏避开 iPhone 的 Home 指示条。
- **完成标准**：typecheck、测试、build 全部通过；手机 390 宽 × 深色/浅色截图，桌面 1280 宽截图。
- **结果**：
  - 958/958 测试通过，build 通过。
  - demo 模式截图检查了：手机深色、手机浅色、Ledger 滚到底、打开 Ask 面板、桌面深色。
  - 实测正常：选中镜片滑到新 Tab 后和按钮中心对齐；按下 Ask 按钮会放大到 1.12 倍，松手恢复；控制台没有报错。
  - 最后一张卡片不会被 Tab 栏盖住；Ask 面板打开后在 Tab 栏上方。
- **跟 Preview 不同的一处**：Ask 按钮的绿色改成直接用 `--glass-tint`（0.78）。Preview 里是 0.78 × 0.82，在浅色主题下太淡，白色图标看不清。
- **改动的文件**：`theme.css`、`components.css`、`shell.css`、`assistant.css`、`assistantWidget.ts`、`ui.ts`、`main.ts`，新增 `src/liquidGlass.ts`。
- **没验证到的**：
  - 真 iPhone Safari 上还没看过。
  - 安全区（刘海屏和 Home 指示条的留白）在 Edge 模拟里全是 0，只能在真机上确认。
  - 「减少透明度」开关 Edge 模拟不了。

### G-2 — L2 按钮：primary / secondary / danger  `[x]`（2026-09-15，PR #45，merged）
- 只改 `.wu-btn` 的这三个变体，全站约 52 处会自动跟着变，不改任何页面模板。
- 检查绿色玻璃上白字的对比度，深色和浅色主题都要达到 AA。
- **完成标准**：逐页截图，重点看 Ledger、Portfolio、Settings 这些按钮多的页面。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 截图检查了 Ledger（深色、浅色）、Settings（深色、浅色）、手机 Portfolio（深色）、手机 Goals（浅色）。
  - 三种按钮都是胶囊形，带高光边；按下会鼓起，还有跟手的光点；禁用的按钮不响应按下。
  - 只改了 `components.css`、`theme.css` 和 `liquidGlass.ts` 里「哪些按钮能按下」的选择器，没有改任何页面模板。
- **对比度**：
  - 绿色玻璃上的白字，深色主题约 5.7:1，浅色约 4.6:1，都达到 AA。
  - hover 在深色主题变亮、在浅色主题变暗，避免浅色下白字变淡。
- **一处保留原意**：Settings 的 Reset 原来特意加了一圈红色边框，改成玻璃版的红色描边。

### G-3 — L3 文字按钮：胶囊圆角  `[x]`（2026-09-15，跟 G-1、G-2 同一个 commit，PR #45，merged）
- `ghost` 和 `icon` 按钮的圆角改成胶囊形，其他不变。改动很小，也可以跟 G-2 合并成一个 PR，由你决定。
- **结果**：
  - 只改了 `components.css` 里两条规则，测试和 build 通过。
  - 全站每个 `.wu-btn` 都带变体，没有漏掉的按钮。
  - 截图确认 Dashboard 的「Open portfolio →」在 hover 时是胶囊形。Portfolio 表格里的删除图标只确认了圆角是 999px，截图没拍到。

### G-4 — Chrome 真折射  `[-]`（2026-09-15 决定不做，移到 FUTURE IDEAS）
- 注意：底部 Tab 栏和顶栏只在手机宽度出现，而你用手机时是 Safari，看不到折射。**所以在电脑 Chrome 上，折射实际只会出现在 Ask 按钮上**。
- 做完 G-1..G-3 之后，再决定这一步值不值得做。
- **决定（2026-09-15）：不做。** 电脑宽度下只有 Ask 按钮会用到，要多写约 120 行代码，Chrome 也要多一份性能负担，不划算。以后电脑版如果有更多浮在内容上的玻璃元素，再重新考虑。

---

## 侧栏滚动条（S 系列）

目标：电脑版左侧栏的滚动条，改成 iOS 的做法：平时隐藏，滚动时出现。Preview（三种做法并排对比）：
https://claude.ai/artifact/BqULCH7RnCChqE2RdzDwPR

- **Problem**：`.sidebar-scroll-area` 没有设置滚动条样式。Windows 上的 Chrome 会显示系统默认的灰色滚动条，跟液态玻璃风格不搭。
- **Why**：纯视觉打磨。你主要用电脑 Chrome，而问题只在 Windows 上明显。
- **Current System**：
  - 左侧栏是 `.sidebar`（`shell.css`，sticky，270px 宽），导航列表放在 `.sidebar-scroll-area` 里，高度不够时可以滚动。
  - 每次切换页面都会重新渲染整个外壳。`ui.ts` 会记住侧栏滚动到的位置（`sidebarScrollPositions`），渲染后恢复；首次打开时会把当前页面的导航项滚进可见范围（`keepActiveNavigationVisible`）。
  - 手机上，同一个侧栏会变成抽屉。
- **Proposed Solution（你选的：D · 自己画，2026-09-15）**：
  - 隐藏浏览器自带的滚动条，自己画一条浮在内容上的细条（约 5px，圆角，半透明，颜色跟主题走）。
  - 平时看不到；滚动时出现，停下约 1 秒后慢慢淡出；出现时可以按住拖动。
  - 页面第一次打开时，如果侧栏内容比屏幕长，细条闪现一次。
  - 侧栏上下边缘渐隐，提示还有内容；滚到顶或滚到底时，对应那一边的渐隐消失。
  - 滚动本身完全用浏览器原生的：滚轮、触控板、键盘、手指滑动都不变。
- **Architecture**：
  - `shell.css`：隐藏原生滚动条、细条样式、边缘渐隐。
  - `ui.ts`：模板里给滚动区包一层容器，放细条元素。
  - 新增一个小模块（例如 `src/sidebarScrollbar.ts`）：根据滚动位置计算细条的位置和长度，处理出现、淡出和拖动；在 `renderApp` 渲染后接上。
  - 不碰任何页面逻辑。

### S-1 — iOS 式侧栏滚动条  `[x]`（2026-09-15，PR #46，merged）
- 做上面的 Proposed Solution。
- **两个要特别处理的坑**：
  1. **切换页面不能闪**：每次切换页面都会重新渲染侧栏。「打开时闪一下」只能在整个 App 第一次加载时出现一次，否则每点一次导航都会闪。
  2. **恢复滚动位置不能触发显示**：渲染后 `ui.ts` 会用代码恢复侧栏的滚动位置，这个动作也会触发滚动事件。要把它和用户真的在滚动区分开，否则每次切换页面细条都会出现。
- **无障碍**：细条对读屏软件隐藏，滚动仍然走原生方式；「减少动态效果」时不做淡入淡出。
- **完成标准**：
  - typecheck、测试、build 全部通过。
  - 桌面 1280 宽截图：深色、浅色，以及侧栏滚到中间、滚到底两种状态。
  - 实测：细条位置跟滚动一致；拖动细条能滚动；切换页面时细条不出现；控制台没有报错。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 在桌面 1280×700 的 demo 模式里实测：
    - 用滚轮滚动时细条出现，位置跟滚动一致。
    - 点导航切换页面时，细条不出现，滚动位置保留。
    - 拖动细条能滚动（220 → 344）。
    - 滚到底时，底部渐隐消失。
    - App 首次加载时细条闪现一次（第 868ms 出现，1803ms 隐藏）。
  - 深色、浅色截图都检查过：细条在侧栏右侧的留白里，不会盖住导航项。
- **实现时多处理的一点**：App 启动时会连续渲染外壳，所以「已经闪过」要等真正闪过之后才记下，否则第一次准备的闪现被清掉以后就再也不会闪。
- **改动的文件**：`shell.css`、`theme.css`（新增 `--scrollbar-thumb` token）、`ui.ts`，新增 `src/sidebarScrollbar.ts`。

---

## 电脑版液态玻璃（DG 系列）

目标：把液态玻璃带到电脑版，放在「下面有内容经过」的地方。Preview（四个方向，每个都能切换现在和改后）：
https://claude.ai/artifact/CwUnAFNNqpuozceC6bYTSY

- **Problem**：G 系列的玻璃主要在手机上（Tab 栏、顶栏）。电脑宽度下只剩 Ask 按钮是玻璃，电脑版几乎看不到新风格。
- **Why**：你主要用电脑 Chrome。纯视觉打磨，不影响核心逻辑。
- **Current System**：
  - 电脑版页面顶部有一个大标题区 `.topbar`，和每页自己的标题重复，Dashboard 上「Overview」出现两次。手机版已经把它隐藏了。
  - Ask 面板（`assistant.css`）和 Version History 弹窗（`ui.ts` 的 `renderVersionHistoryModal`）是实色背景。
  - 分段选择器 `wu-segmented`（Ledger 交易类型、Ledger 时间范围、Rules）和 Ask 面板的 Ask/Record 切换，选中项是直接跳过去的。
  - 侧栏贴着窗口左边，是一整条实色。
  - 光线 `side-rays`：代码里配的是黄色（`#EAB308`）和蓝色（`#96c8ff`），但 `shell.css` 给它加了 `grayscale(1)` 和 `opacity: 0.09`，所以实际上是很淡的灰光。手机和电脑共用这一个组件。
- **Architecture**：全部复用 G-1 的玻璃材质和 `--glass-*` token；Ask 面板和弹窗要新增一种更厚的玻璃；滑动镜片沿用 Tab 栏的做法（`liquidGlass.ts`）。

### 已定的决定（2026-09-15）
- 四个方向**都做**。
- 光线改成手机 Preview 里的**绿色 + 铜色**，并且要真的看得出颜色：去掉灰色滤镜，调高不透明度。手机和电脑一起改。
- G-4 真折射不做（见上）。

### DG-1 — 光线改成绿色 + 铜色  `[x]`（2026-09-16，PR #47，merged）
- `ui.ts` 里 `mountSideRays` 的两个颜色改成品牌绿和铜色；`shell.css` 里去掉 `grayscale(1)`，把 `opacity: 0.09` 调高。强度对照 Preview，深色和浅色都要检查。
- 光线底部渐隐到背景色的那层（`.side-rays::after`）保留，所以不会影响下面卡片的文字。
- **完成标准**：手机 390 宽和桌面 1280 宽，深色、浅色各截一张；光线不影响文字可读性。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错；手机和桌面、深色和浅色都截图检查过。
  - 颜色：`rayColor1` 铜色 `#c79b57`，`rayColor2` 绿色 `#57a78f`（blend 0.75 偏向 rayColor2，所以以绿色为主）。
  - 去掉了 `grayscale(1)`。强度用 `theme.css` 里的 token 控制：深色 `--rays-opacity: 0.65`，浅色 `0.5`。
  - 光线照得更远：`intensity` 从 2 调到 2.6，`falloff` 从 1.6 调到 1.1。
  - 浅色主题用 `mix-blend-mode: multiply`：浅色背景上「加亮」看不出来，改成把颜色叠深。
  - 底部淡出从「渐变到背景色的覆盖层」改成 mask。旧写法在 multiply 下会显出一条横线。
- **没解决的**：桌面上能看出绿色光束；手机上几乎看不到，光源在右上角，被玻璃顶栏盖住了。要不要给手机单独加强，看真机再决定。
- **跟 Preview 的差别**：Preview 里的光线是用 CSS 画的条纹，比较锐利；真实 App 是 WebGL 动态光，更柔和。

### DG-2 — 吸顶玻璃栏 + 去掉重复大标题  `[x]`（2026-09-16，PR #48，merged）
- 电脑版隐藏 `.topbar`，跟手机版一样只保留每页自己的标题。
- 往下滚、页面标题离开视线后，顶部出现一条细玻璃栏显示页面名称；滚回顶部时消失。用 IntersectionObserver 判断，不在每次滚动时计算。
- 只在电脑宽度生效。手机版已经有玻璃顶栏，不叠第二条。
- **完成标准**：Dashboard、Ledger、Portfolio 滚动截图；玻璃栏不盖住侧栏；控制台没有报错。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 实测：
    - 页面在顶部时，玻璃栏隐藏，也没有重复的大标题。
    - 往下滚、页面标题离开视线后，玻璃栏出现（从 270px 到右边缘，高 56px），卡片从下面经过时被模糊。
    - 滚回顶部时，玻璃栏消失。
    - 切换页面时页面回到顶部，玻璃栏立即隐藏，不会闪。
    - 手机上玻璃栏不显示。
  - 截图检查了深色 Dashboard、深色 Ledger、浅色 Portfolio。
- **跟计划不同的两处**：
  1. **用 `position: fixed`，不用 sticky**：`.main` 设置了 `overflow: hidden`，sticky 会粘在 `.main` 上而不是屏幕顶部。
  2. **不用 IntersectionObserver，改成滚动时检查（每帧最多一次）**：页面会整页重新渲染，换掉标题元素，IntersectionObserver 盯着的旧元素就失效了。
- **改动的文件**：`ui.ts`（`.topbar` 换成 `.titlebar`）、`shell.css`（删掉 `.topbar` 样式，新增 `.titlebar`），新增 `src/titleBar.ts`。

### DG-3 — Ask 面板和弹窗改成玻璃  `[x]`（2026-09-16，PR #49，merged）
- 新增更厚的玻璃 token（比如 `--glass-sheet`）：模糊更强、底色更实，保证文字清楚。
- 这一步只做 Ask 面板和 Version History 弹窗；弹窗后面的遮罩调淡。App 里其他弹窗先列出来，由你决定要不要一起改。
- **完成标准**：面板里文字的对比度达到 AA；深色和浅色截图检查。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 新增厚玻璃 `.wu-glass--sheet`：模糊 24px，底色深色 `rgb(24 24 28 / 0.72)`、浅色 `rgb(255 255 255 / 0.7)`，比 Preview 里的 0.62 更实，因为真实页面比 Preview 更花。
  - Ask 面板：面板本身换成厚玻璃；输入框换成半透明的「凹槽」色 `--glass-well`。
  - Version History 弹窗：卡片换成厚玻璃；遮罩从 `--surface-overlay` 换成更淡的 `--surface-overlay-glass`，并去掉遮罩原来的 4px 模糊，避免跟玻璃重复模糊。
  - 系统开了「减少透明度」时，厚玻璃退回实色。
  - 截图检查了 Ledger 页打开 Ask 面板、Settings 页打开弹窗，深色和浅色都看过：文字清楚，面板后面隐约能看到页面。
- **没有改的其他弹窗（等你决定）**：
  - iPhone「安装到主屏幕」说明（`main.ts` 的 `showIOSInstructions`），还是实色卡片加深色遮罩。
  - 删除、导入前的确认框是浏览器自带的 `confirm()`，样式改不了。
- **改动的文件**：`theme.css`、`components.css`、`assistant.css`、`assistantWidget.ts`、`ui.ts`。

### DG-4 — 分段选择器加滑动镜片  `[x]`（2026-09-16，PR #50，merged）
- `wu-segmented` 和 Ask/Record 切换，改成玻璃镜片滑到选中项。
- **坑**：Ledger 点选项后会重新渲染页面，镜片没办法自己滑。要像 Tab 栏一样记住上一个选中项，再从那里滑过来。每个选择器分开记。
- **完成标准**：三个真实的选择器都要实测镜片位置和滑动；键盘操作仍然可用。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 实测了 Ledger 交易类型、Ledger 时间范围、Rules 分类、Ask/Record 切换：
    - 镜片和选中项完全重合（误差不超过 1px）。
    - 点击后页面重新渲染时，镜片会从上一个选项滑过去（截到了滑动中途的位置）。
  - 截图检查了深色和浅色。
- **做法**：`liquidGlass.ts` 用一个 MutationObserver（每帧最多检查一次）找到页面上所有的 `.wu-segmented` 和 `.assistant-tabs`，自动加上镜片，并按「aria-label + 选项的 data 属性」记住上一次选中哪一项。**没有改任何页面模板**，以后新增的分段选择器会自动带上镜片。
- **顺带的外观变化**：`.wu-segmented` 从圆角矩形改成胶囊形，跟 Preview 和 Ask/Record 切换一致。
- **键盘**：选项还是原来的按钮，Tab 和回车照常能用；选中项获得焦点时，焦点框照常显示（样式规则里用了 `:not(:focus-visible)`）。这一点只检查了样式规则，没有实际用键盘测试。
- **改动的文件**：`liquidGlass.ts`、`components.css`、`assistant.css`、`theme.css`（新增 `--glass-lens-raised`）。

### DG-5 — 侧栏变成悬浮玻璃面板  `[x]`（2026-09-16，PR #51，merged）
- 侧栏四周留空、圆角，浮在页面上。要让光线延伸到侧栏后面，玻璃才看得出效果，所以要调整页面布局和光线的位置。
- **会互相影响的地方**：S-1 的滚动条（细条放在侧栏的留白里）、DG-2 的吸顶栏（左边从哪里开始）、页面内容区的宽度。
- 做完 DG-1 到 DG-4 看过效果以后，再确认要不要做。
- **决定（2026-09-16）：做。**
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 只在电脑宽度（≥721px）生效，全部改动放在 `shell.css` 的一个 `@media (min-width: 721px)` 块里：
    - 侧栏 `position: fixed`，四周留 12px，宽 256px，圆角 24px，用 DG-3 的厚玻璃（`--glass-sheet`、24px 模糊）。
    - 页面改成单列、全宽；内容区用左边距避开侧栏。内容的左边缘在 1280 宽时是 318px，改之前约 321px，基本不变。
    - 侧栏后面加了一层固定的柔光（`.main::after`，绿色从左上、铜色从左下），强度用 token `--sidebar-glow` 控制（深色 0.28、浅色 0.2）。这样不管页面滚到哪里，玻璃后面都有东西可以透。
    - DG-2 的吸顶栏也跟着改成悬浮：离顶部和右边 12px，左边对齐侧栏右侧，高 48px，圆角 16px，带高光边。
    - 侧栏底部的用户区原本有实色背景（用来盖住旧侧栏），在玻璃上会显得像一块方形色块，改成透明。
  - 实测：
    - 1280 和 900 宽都没有横向溢出。
    - 侧栏位置 12→268px；S-1 的滚动条细条在侧栏里面（256–261px）。
    - 点导航能正常切换页面，吸顶栏照常出现和消失。
    - 手机 390 宽保持原样：侧栏还是隐藏的抽屉，没有玻璃也没有圆角；底部 Tab 栏照常显示。
  - 截图检查了深色 Dashboard（顶部和滚动后）、浅色 Ledger、900 宽，以及侧栏底部。
- **改动的文件**：`shell.css`、`theme.css`（新增 `--sidebar-glow`）、`titleBar.ts`（吸顶栏出现的判断线从 56px 改成 60px，对应悬浮后的位置）。

### DG-6 — 手机上的顶部光线加强  `[x]`（2026-09-16，PR #52，merged）
- **Problem**：DG-1 以后，桌面能看出绿色和铜色的光；手机上几乎看不到。光线区域只有 360px 高，光源在右上角，正好被玻璃顶栏盖住。
- **做法**：只在手机宽度（≤720px）调整：提高 `--rays-opacity`，并把光线区域调高或往下移，让光从顶栏下面露出来。不改桌面。
- **完成标准**：手机 390 宽，深色、浅色截图；光线看得出来，但不影响 Dashboard 第一张卡片的文字。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - 手机上的光线区域从 360px 加高到 560px，光能照到顶栏下面。
  - 只调不透明度不够：深色主题的光本身太暗，不透明度加到 0.975 还是看不见。所以手机上把 WebGL 的 `intensity` 从 2.6 调到 4。
  - 强度倍数按主题分开设：`--rays-boost-phone` 深色 1.5、浅色 1.1。浅色用 1.5 太重。
  - 截图：深色下右上角有清楚的绿色光束，延伸到第一张卡片；浅色下是柔和的绿光。卡片是实色背景，文字不受影响。
- **限制**：手机和电脑的 `intensity` 是在光线挂载时按屏幕宽度决定的。在电脑上把窗口拖过 720px 时不会马上变，要等页面下一次渲染（切换页面或保存数据）。
- **改动的文件**：`ui.ts`、`shell.css`、`theme.css`。桌面版没有变化。

### DG-7 — iPhone「安装到主屏幕」说明弹窗改成玻璃  `[x]`（2026-09-16，PR #53，merged）
- **Problem**：DG-3 只改了 Ask 面板和 Version History 弹窗。`main.ts` 里的 `showIOSInstructions` 还是实色卡片加深色遮罩。
- **做法**：跟 Version History 一样，卡片加上 `wu-glass wu-glass--sheet`，遮罩换成 `--surface-overlay-glass`。
- **完成标准**：在手机 390 宽下打开这个弹窗，深色、浅色截图，文字清楚。
- **结果**：
  - 958/958 测试通过，build 通过，控制台没有报错。
  - `main.ts` 里的卡片加上 `wu-glass wu-glass--sheet`，遮罩改成 `--surface-overlay-glass`，跟 Version History 弹窗一致。
  - 这个弹窗只在 iPhone 上出现。测试时把浏览器伪装成 iPhone Safari，调用 `__pwoInstall()` 打开。
  - 深色（Dashboard 上）和浅色（Settings 上）都截图检查过：卡片是厚玻璃，文字清楚，后面的页面隐约可见。
- **DG 系列到这里全部完成。**

---

## 全站整理：干净整齐（T 系列）

目标：把每个页面整理成跟液态玻璃 Preview 手机截图一样干净、整齐、清楚。Preview（Dashboard 前后对比 + 全站检查结果）：
https://claude.ai/artifact/L4w2Sgyeucw9ibNutwv4xN
其他 11 个页面的整齐版（每页并排：真实截图 · 整齐版 · 改了什么）：
https://claude.ai/artifact/LYCovFF3EQ2krqLKfsKLZE
电脑版整齐版（12 个页面，窗口里切换「现在 / 整齐版」）：
https://claude.ai/artifact/FBx3QM1pbR9Nrf2HGQ2G9a

- **Problem**：你看了 Preview 里的手机截图，觉得那个很整齐，真实 App 反而显得乱。2026-09-16 用 demo 数据在手机宽度下逐页检查，结果：
  - Portfolio 页面长 4,965px，有 90 个徽章。
  - Dashboard 有 16 个标题，11 行备注一换行就对不齐。
  - Settings 有 32 个输入框、6 个 Save 按钮。
  - Ledger 有 29 个标题、71 个按钮。
  - 详细数字见 Preview。
- **Why**：页面乱会让人看不出重点，跟 WealthUp「一眼看清状态」的目标相反。
- **所有页面共同的原因**：
  1. 同一张「检查卡」出现在 Ledger、Advisor、Review、Rules 顶部。
  2. 一个数字占一整张卡（Ledger 连续 5 张、Money Leaks 连续 4 张）。
  3. 表单一直全部展开。
  4. 长列表全部摊开。
  5. 数字字体、彩色竖条、徽章、标签和标题重复，各页面写法都不统一。
- **Proposed Solution：一套规则，全站都用**
  1. 一张卡的结构固定：小标签 → 一个主数字或状态 → 最多一行说明 → 可选一个小图。
  2. 数字用 Inter 半粗体，并让每位数字宽度一致方便对齐；「MYR」缩小变淡；等宽字体只用在小标签上。
  3. 一页只有一个标题，卡片之间不再加区块标题和副标题。
  4. 同一个数字只出现一次。
  5. 状态只用小 chip 和横向比例条；去掉左侧彩色竖条、带符号的徽章、环形图。
  6. 列表每行只放「名称 · 短值」；长解释放到详情。
  7. 表单收进按钮；长列表只显示最近几条，再加「查看全部」。
- **玻璃**：只用「模糊 + 高光边」，所有浏览器效果一致（真实 App 本来就是这样）；另外可以加一个「边缘厚度」效果。
- **Architecture**：先在 `components.css` 做好共用的整齐组件（摘要卡、数字写法、chip、列表行、收起的表单），再逐页替换模板。每页一个 Task，每个 Task 先做 Preview，你看过后说「执行」才改代码。

### 需要你确认的决定
- **Dashboard 移走的内容**：Financial Health 明细、Money Leaks 细节、Monthly Position、CFO briefing、目标下拉选择器，改成最下面「看更多」的入口，链接到本来就有的 Advisor、Money Leaks、Ledger、Goals 页面。
- **重复的检查卡**：只留在 Dashboard 的 Priority 和 Money Leaks 页，其他页面拿掉。
- **财务目标那一行保留 Lato 字体**：那是你之前自己选的，整齐版不改它。

> 上面这份是 2026-09-16 的初版清单，已被下面「整齐版（T 系列）」取代并全部完成，保留作记录。
### T-2 — 重复的检查卡只留一处（Ledger / Advisor / Review / Rules）  `[ ]`
### T-3 — Ledger：摘要卡合并、「+ 记一笔」收起表单、筛选收起  `[ ]`
### T-4 — Portfolio：摘要卡 + 持仓、表单收起、记录只显示最近 5 条  `[ ]`
### T-5 — Settings：改成 iOS 式分组列表，点进去再编辑  `[ ]`
### T-6 — Money Leaks：摘要卡合并，列表 + 点开看详情  `[ ]`
### T-7 — Advisor：建议合成一个列表，去掉竖条，免责声明移到页底  `[ ]`
### T-8 — Review：历史改成「月份 · 分数」短行  `[ ]`
### T-9 — Goals + Budget：去掉重复的标签，统一数字写法（改动小）  `[ ]`
### T-10 — Rules + TVM + Market：统一卡片和数字写法（Market 要用真实行情数据再检查）  `[ ]`

---

## 整齐版（T 系列）

目标：页面本身排得整齐、好读。液态玻璃（G / S / DG）解决的是「看起来现代」，这一轮解决「看起来乱」。
Preview（另一个会话做的，项目代码没有改动）：
- 整齐版 Dashboard（6 个原因 + 6 条规则 + 12 页检查表）：https://claude.ai/artifact/L4w2Sgyeucw9ibNutwv4xN
- 整齐版全站（手机版其他 11 页）：https://claude.ai/artifact/LYCovFF3EQ2krqLKfsKLZE
- 整齐版电脑版 v2：https://claude.ai/artifact/FBx3QM1pbR9Nrf2HGQ2G9a

- **Problem**：页面很长、卡片结构各不相同、同一个数字出现两次、装饰种类太多。实测：Portfolio 4,965px、Settings 3,468px（32 个输入框）、Dashboard 3,718px。
- **Why**：纯前端排版和信息取舍，不改任何计算逻辑。
- **Current System**：每个页面模板各写各的（`src/pages/*.ts`），卡片结构不统一。
- **Proposed Solution**：手机版 6 条规则 + 电脑版 4 条规则（见 Preview），先在 Dashboard 落地，再逐页推广。

### 已定的决定（2026-09-16）
- **表单收起来**：Ledger、Portfolio、Review 的输入表单改成点按钮才出现（手机上从底部弹出）。你确认「值得」。
- **长列表只显示最近 5 条** + 「查看全部」。你确认「可以」。
- **顺序**：Dashboard → Ledger → Portfolio → Settings → 其余页面 → Market 最后（demo 里图表是空的，要真实行情数据才看得准）。
- **不改计算逻辑**，只改页面模板和样式。

### ⚠️ 跟液态玻璃不同的风险
液态玻璃只改 CSS，页面结构没动。这一轮要动页面模板，而现有 958 个测试测的是算钱的逻辑，**不测页面长什么样**，所以测试全绿不代表页面没坏。每个 Task 都要在 demo 模式里实际打开页面，把该页的功能逐个点一遍再截图。

### T-1 — Dashboard 整理 + 共用件  `[x]`（2026-09-16，PR #54 已合并）
- **共用件**（后面每一页都会用）：统一的卡片结构（小标签 → 主数字 → 一行说明 → 可选小图）、数字写法（Inter 半粗体 + 等宽数字对齐，「MYR」缩小变淡）、状态 chip（绿 / 铜 / 红）、横向比例条。
- **Dashboard 本身**：13 张卡 → 7 张；整页只留一个标题（去掉 Financial Snapshot / Details / Wealth Details 等 6 个区块标题）；同一个数字只出现一次；去掉左竖条、符号徽章、环形图；放不下的细节改成页底「看更多」入口，链到已有的 Advisor、Money Leaks、Ledger。
- **完成标准**：typecheck、测试、build 通过；demo 模式下手机 390 和桌面 1280、深色和浅色各截图；页面上每个按钮和链接都点一遍确认能用；页面长度记录改前改后。
- **结果（demo 数据，手机 390 宽）**：
  | | 改前 | 改后 |
  | --- | --- | --- |
  | 页面长度 | 3,718px | 1,551px |
  | 卡片 | 13 | 7 |
  | 标题 | 16 | 1 |
- **7 张卡**：Net worth / This month / Priority / Health / Where it sits / Next goal / More detail。
- **共用件**（`components.css`，后面每页都会用）：`.wu-tc__top`（标签行）、`.wu-chip`（状态）、`.wu-money`（大数字，MYR 缩小变淡）、`.wu-split` + `.wu-legend`（比例条）、`.wu-three`（三栏数字）、`.wu-facts`（等高事实行）、`.wu-navlist`（页底入口）。
- **实测（demo 模式）**：958/958 测试通过，build 通过，控制台没有报错。
  - 5 个链接（Advisor、Money Leaks、Ledger、Portfolio、Goals）都点过，能正确跳转。
  - 「Mark as done」有效：按钮消失，出现「You marked this done」。
  - 目标选择器有效：切换后刷新仍保留。
  - 实时价格更新的元素（净值、市值、手续费、未实现盈亏、说明行）都改成了新结构并同步更新。
  - 手机、桌面、深色、浅色都截图检查过，没有横向溢出。
- **搬走的内容**（没有删，只是移到各自页面，用页底「More detail」进去）：Financial Health 明细、Money Leaks 详情、Monthly Position、Personal CFO briefing。
- **⚠️ 跟 Preview 不同的一处**：Preview 建议去掉「Featured goal」下拉选择器。**我保留了它**，因为它是全 App 唯一能选「Dashboard 显示哪个目标」的地方，去掉等于删功能。要搬到 Goals 页的话，放在 T-6 一起做。
- **你的两点反馈已经改（2026-09-16）**：
  1. **手机全站太挤**：`theme.css` 手机的间距 token 调宽（`--space-5` 14→16、`--space-6` 16→20、`--space-8` 20→28）。这一项对所有页面生效，不只是 Dashboard。
  2. **电脑版按你的截图重排**：顶部一排 4 个数字磁贴（净资产 / 本月 / 已投入 / 下一个目标），下面 优先行动 + 健康 两栏等高，页底一行入口链接。手机上还是一列。
  - 桌面 1280 宽整页只有 825px 高，一屏看得完；手机 1,568px。
  - 目标选择器改小，放进「Next goal」磁贴的标签行。

### T-2 — Ledger  `[x]`（2026-09-16，PR #55 + #57 已合并）
- 重复的「检查卡」只留在 Dashboard 和 Money Leaks；5 张单数字卡合并成一张摘要卡；记账表单和筛选收起来（按钮点开）。
- **结果（demo 数据）**：
  | | 改前 | 改后 |
  | --- | --- | --- |
  | 手机页面长度 | 3,037px | 1,359px |
  | 桌面页面长度 | — | 1,070px |
  | 标题 | 29 | 1 |
- **做了什么**：
  - 5 张单数字卡 → 一张「This period」摘要卡：时间范围选择器 + 收入/支出/净额三栏 + 按类别分色的支出比例条（取代 Category Share 环形图）。
  - 记账表单收进页头的「+ Add transaction」按钮，点开才出现；保存后自动收起；点某一行的 ✎ 会自动打开并填好。
  - 筛选收进「Filter」按钮。
  - 账户合成一张卡：总资产 + 每个账户一行，底部一行「Opening funds」。
  - 最近交易只显示 5 笔，点「See all N」展开；每行只有「备注 / 类别 · 日期 · 账户 / 金额」，去掉了 Sponsored 徽章（改成那行文字的一部分）。
  - 全年 12 个月的柱状图 → 最近 3 个月的小图。
  - 顶部重复的「Transaction check」检查卡拿掉（它留在 Dashboard 和 Money Leaks）。
  - History、Category Manager、Account Manager 三个面板保留在页底，默认收起。
- **实测（demo 模式）**：958/958 测试通过，build 通过，控制台没有报错。真的记了一笔（−12.34）、编辑、取消、删除、筛选、展开全部，全部正常。
- **顺手改的 Dashboard 一行**（你提的）：所有持仓都取到价格时，不再显示「Market data may be delayed · last traded 9h ago」；取不到价格时的「Partial valuation / No market price」照常显示，因为那代表数字不完整。
- **你看过后的第二轮修改（2026-09-16）**：
  1. **电脑版排版照 Preview 重排**：一排 4 个数字（Income / Spent / Net / Net assets）→ 最近交易 + 按类别支出 → 账户 + 三个月趋势 → 页底三个管理面板。时间范围、Filter、+ Add transaction 都挪到标题右边。
  2. **修了一个网格 bug**：`span 3` 这类规则原本也作用到嵌套网格里，导致 4 个数字卡各占一行。改成只对外层网格的直接子元素生效。
  3. **Dashboard 的三色比例条加了图例**（你问「这个颜色对应什么」）：绿=已投入、铜=安全储备、灰=机动资金，每种都写出金额；鼠标停在色块上也会显示。
  4. 「按类别支出」卡片每行是「色块 · 类别 · 金额 · 百分比」，颜色不再需要猜。
  5. **账户改成按类型分组、横向排列**（你的建议）：Bank / E-wallet / Investment 各一组，组标题右边是该组小计，组内每行「账户 · 余额」。宽度够就并排，窄了自动换行。你有 11 个账户，竖着排太长。
- **#57 补上 #55 漏掉的三个提交**：
  1. 行对齐：列表行统一高度 `--row-h: 52px`，不同卡片里的行上下对齐。
  2. Recent 卡片撑满它那一半，底部和右侧跟旁边的卡对齐。
  3. chip 改成玻璃效果，而且标题优先占位，chip 不会挡住标题。
  - 958/958 测试通过，build 通过。

### T-3 — Portfolio  `[x]`（2026-09-16，PR #58 已合并）
- 摘要卡 + 持仓；60 多行贡献记录只显示最近 5 条；记账表单、汇率粘贴框收起来；去掉每行的徽章。
- **照这两个 Preview 的 Portfolio 部分做**：手机 https://claude.ai/artifact/LYCovFF3EQ2krqLKfsKLZE 、电脑 v2 https://claude.ai/artifact/FBx3QM1pbR9Nrf2HGQ2G9a 。
- **计划（2026-09-16，等「执行 T-3」）**：
  - 电脑：标题右边 Import CSV / + Record trade → 4 个数字卡（Market value / Invested / Unrealised / Fees）→ Holdings 整行（占比条 + 目标竖线）→ Next contribution | Recent activity（最近 5 条 + See all）→ 页底链接 Currency conversions / Position detail（点开在下面展开，内容不变）。
  - 手机：一列，顺序照手机 Preview。
  - 记账表单点开才出现、保存后收起；助手预填要先打开表单；See all 展开完整表格（含 ✕ 和 Clear all）；Allocation health 小卡拿掉，状态改用 chip。
  - 行情轮询只重画新的价格区域，不能关掉已打开的表单。
  - 不改计算，不改金额小数位。
- **决定**：Fees 卡说明行用 B「Before fees +X (+Y%)」，保留扣手续费前的收益；没有手续费或没有价格时退回「Across N contributions」。
- **结果（demo 数据）**：
  | | 改前 | 改后 |
  | --- | --- | --- |
  | 手机页面长度 | 5,001px | 1,528px |
  | 电脑页面长度 | 3,887px | 1,049px |
  | 徽章 | 90 | 0 |
  | 看得见的按钮 | 51 | 4 |
- **手机**照手机 Preview：一张 Market value 卡（Invested · fees · holdings + Before fees 一行）→ Next contribution → Holdings → 按钮行 → Recent activity → More detail。
- **实测**：962/962 测试（新增 4 个「下一笔放哪里」测试）、build 通过、控制台无报错。记一笔、See all + 删除、CSV 导入、两个面板、汇率粘贴错误提示、助手预填（自动打开表单）、行情刷新（约 90 秒一次，不清空表单）都点过。
- **影响其他页面的两处**：
  1. 补上 `.t-positive` / `.t-negative`（Ledger 早就在用但没定义），Ledger 的收入/支出现在有绿/红色。
  2. `.wu-tc__top` 预留 chip 的高度，有 chip 和没 chip 的卡数字对齐；所有卡标签行高约 7px。
- **没做到**：电脑版第 3 行两张卡底边对齐，但卡里的行没有上下对齐（左边先有一句话）。

### T-4 — Settings  `[x]`（2026-09-17，PR #59 已合并）
- 7 个常驻表单改成 iOS 式分组列表：每项显示当前值，点进去再编辑。
- **结果（demo 数据）**：手机 3,505px → 1,424px，电脑 1,862px → 1,040px，看得见的输入框 32 → 3。1026/1026 测试（合并 main 后）、build 通过。
- **修掉的现有 bug**：保存 DCA targets / Opportunity 分配不再删掉 VOO、QQQM 以外的代码（VXUS）；Stage 保存不再被改成 Student。
- **跟以前不同**：Monthly cash flow 和 Monthly DCA 拆成两行，各自保存、各自同步规则；Version History 快照只在原本就存的保存（Recurring、Liabilities、隐私）才存。
- **照 Preview 的 Settings 部分做**（同上两个链接）。
- **计划（2026-09-16，等「执行 T-4」）**：
  - 手机：Profile / Money in & out / Plan / Privacy / Data 五组列表，最后单独一行红色 Reset。
  - 电脑：两张一行、一样高：Profile | Plan → Money in & out | Privacy → Data | Danger zone。
  - 每行「名称 · 当前值 ›」，点开编辑那一项，编辑面板只有一个 Save；隐私开关直接切换即保存；Emergency 的建议目标放进它的编辑面板；Theme/Export/Import/Version history/Add to Home Screen 保留 data-tool 绑定。
  - 不改计算。
- **已定（2026-09-16）**：
  1. 编辑面板在那一行下面展开（A）。
  2. DCA targets 改成每只 ETF 一个输入框，不再丢 VXUS；你另外希望新加的股票/ETF 也一起出现在这里（提议见下，等你确认）。
  3. Stage 下拉加上当前存的值，保存不再被覆盖。
  4. Dip-buy tranches 只显示当前值，不能编辑。
- **提议（你已确认，已做）**：targets 列表 = 已有目标 ∪ 交易过的代码 ∪ 自定义代码，新代码默认 0%；编辑面板里可以「+ Add ETF」；在 Settings 加的代码也出现在 Portfolio 记账表单的下拉里；Opportunity reserve 的分配同样每只一个输入框（现在也只存 VOO/QQQM）；显示目标合计，不是 100% 时提示但不阻止保存。

### T-5 — Advisor / Review / Money Leaks / Rules  `[x]`（2026-09-17，PR #60–#63 已合并）
- 去掉重复的检查卡；建议和规则改成列表；免责声明移到页底；历史改成短行、点开看详情。
- **照两个 Preview 的对应页面做**（全站手机 + 电脑 v2）。
- **已定（2026-09-17）**：
  1. 拆成 4 个小任务，一页一个 PR，按顺序做：**T-5a Money Leaks → T-5b Advisor → T-5c Review → T-5d Rules**。
  2. Money Leaks 手机上点一行，详情在那一行下面展开；电脑照 Preview 左清单右详情。
  3. Rules 点一行在下面展开编辑，原来的编辑和隐藏功能照旧。
- **共同做法**：Advisor / Review / Rules 顶部的检查卡拿掉（只留 Dashboard Priority 和 Money Leaks 页）；免责声明、估算说明移到页底小字；不改计算；Advisor / Rules 的机会储备分配列出所有代码（T-4 之后不只 VOO / QQQM）。
- **T-5a Money Leaks** `[x]`（2026-09-17，PR #60 已合并）
  - 手机：总数卡（每月流失 · 一年多少 · 几项，chip 显示高优先级数）→ 按影响排的清单（名称 · 类型 · 金额，状态用小字）→ 点一行下面展开详情（说明 + Inspect in Ledger / Mark as done）→ 页底估算说明。
  - 电脑：4 个数字（Each month / Each year / Findings / High priority）→ 清单 | 详情两张一样高 → 页底估算说明。
  - **结果（demo 数据）**：手机 1,983px → 810px（第一项默认展开），电脑 1,201px → 887px，徽章 7 → 0。
  - **你看过后加的**：手机默认展开影响最大的那一项，展开内容精简（金额、一句说明、主要按钮、Mark as done；证据、Why it matters、Next move、Ask Advisor 收进 More detail）；两个版本每行都有「›」，标签写 tap / click to open；只有 1–2 项时清单底部一行「Only N finding(s) right now — nothing else detected.」。
- **T-5b Advisor** `[x]`（2026-09-17，PR #61 已合并）
  - **已定（2026-09-17）**：1. 清单右边的数字用每条建议的第一个证据值，没有证据就只放「›」，不新算；2. 点一级台阶在下面展开 Mark deployed / Undo；3. 免责声明文字不改，移到页底，侧栏那行照旧。
  - 手机：Priority 一张（标题 + 一行原因 + Go to … + Mark as done）→ Guidance 清单（状态点 · 标题 · 一句说明 · 关键数字 ›，点开在下面看完整说明和按钮）→ Dip-buy ladder（三级台阶：跌幅 · 离触发的条 · 金额 · 状态）→ 页底免责声明。
  - 电脑：Priority | Dip-buy ladder 两张一样高 → Guidance 清单整行 → 页底免责声明。
  - 拿掉顶部检查卡、6 条彩色竖条、储备的 VOO / QQQM 两张小卡（改成 ladder 卡里一行，列出所有代码）。
  - 不改计算；Mark as done、Go to、Mark deployed / Undo、跌幅检查都保留。
  - **结果（demo 数据）**：手机 2,524px → 1,090px，电脑 1,501px → 881px，卡片 17 → 3。
  - **你看过后改的**：指向 Advisor 本页的建议（Opportunity reserve）不再显示「Go to advisor」，改成「See the ladder」，点了滚到 ladder 卡并亮一圈；箭头电脑 →、手机 ↓。
- **T-5c Review** `[x]`（2026-09-17，PR #62 已合并）
  - 手机：本月一张卡（收入 · 支出 · DCA 三栏，chip 显示 Reviewed / Not reviewed，「Complete review」按钮点开表单）→ 分数小柱状图（最近 9 个月，平均分 chip）→ 历史短行（月份 · 支出 · 备注开头 / 分数），最近 5 条 + See all，点一行看完整备注和删除。
  - 电脑：标题右边「Complete review」→ 4 个数字（本月收入、本月支出、DCA、平均分 + 小柱状图）→ 历史表整行（月份、收入、支出、DCA、分数、备注）。
  - 拿掉顶部检查卡；表单照旧预填（切换月份会重新带入数字），不改计算。
  - **发现的问题**：分数算出来是 0–100，页面也写「/100」，但 demo 的历史分数是 9、10（0–10 的写法），所以 demo 显示成「9/100」。
  - **结果（demo 数据）**：手机 2,447px → 756px，电脑 1,843px → 723px，常驻输入框 6 → 0。
  - **已定并完成**：分数显示 x/10（算法仍是 0–100，显示和预填除以 10；以前存的大于 10 的分数当作满分 100）；同一个月再保存会先确认再取代，不再重复；表单在原地展开，保存后收起。
- **T-5d Rules** `[x]`（2026-09-17，PR #63 已合并）
  - **结果（demo 数据）**：手机 1,903px → 895px，电脑 1,339px → 640px，卡片 10 → 2。
  - **已定（2026-09-17）**：1. 规则说明照真实数据产生（真实台阶金额、所有代码），你改过文字的规则照旧显示你的版本；2. 清单底部加「N hidden · Show」，可以恢复隐藏的规则；3. 笔记有多行时每行显示成编号项目，一段话就照原样，内容不改。
  - 手机：分段选择「Your rules / How WealthUp works」→ Your plan 清单（规则名 · 一句说明 · 关键数字 ›，点开在下面看全文 + Edit / Hide）→ 笔记卡（每条笔记一张）→「+ Add note」。
  - 电脑：标题右边「+ Add note」→ 分段选择 → 规则清单 | 笔记，两张一样高。
  - 拿掉顶部检查卡、每条规则的 emoji 和 Edit / × 按钮（收进展开里）；一直展开的笔记表单收起来。How WealthUp works 不改。
  - **发现的问题**：Bear Market Deployment 的文字写死「MYR 80 / 120 / 200」，跟真实台阶（demo 300 / 450 / 750）不一样；DCA Mandate 和 Opportunity Reserve 只写 VOO / QQQM，T-4 之后会漏掉 VXUS 等；隐藏（×）的规则没有办法再显示回来。

### T-6 — Goals / Budget / TVM  `[x]`（2026-09-17，PR #64–#66 已合并）
- 小改：去掉标签和标题重复（「JAPAN TRIP」+「Japan Trip 2027」），统一数字写法；顺便把 Dashboard 的 featured goal 选择器移到 Goals。
- **Budget 另有整齐版 Preview（2026-09-17，照新的按收入分配页面做）**：https://claude.ai/artifact/44nSoHD6iLzbSzkiCFq9LY
  - 手机：This month 卡（收入 + 状态 chip + 按层分色比例条）→ Layers 分组列表（「色块 · 名称 · 规则 / 拿到多少 · 状态 ›」，点整行展开编辑）→ Leftover goes to / + Add a layer → Your months → Set aside。
  - 电脑：4 个数字（This month / Extra caught / Swing / Set aside）→ 层表格整行 → Your months | Plan rules。
  - **你看过说「可以」**：采用我的建议——手机每层不放进度条（电脑表格保留）；规则选择改成三段选择。
- **已定（2026-09-17）**：
  1. 拆成 3 个小任务，一页一个 PR：**T-6a Budget → T-6b Goals → T-6c TVM**。
  2. featured goal：Goals 页点一个目标展开，里面有「Show on Dashboard」；正在 Dashboard 上的那个标「On Dashboard」chip；Dashboard 的下拉框拿掉，Next goal 卡照旧显示所选目标。
  3. TVM 输入：清单排版照 Preview（名称左、数值右、每行一样高），但数值格子直接可以输入，不用先点开；Nominal / Effective、End / Beginning 用小分段选择。
- **计划**：
  - **T-6a Budget** `[x]`（2026-09-17，PR #64 已合并）：照 Budget Preview 做；拿掉顶部检查卡；层的编辑、上下移、删除、加一层、剩下的钱给谁、Opportunity 编辑都保留。结果（demo）：手机 1,393px → 1,012px，电脑 1,389px → 931px，徽章 5 → 0；修了手机上编辑面板撑出卡片的问题。
  - **T-6b Goals** `[x]`（2026-09-17，PR #65 已合并；手机 1,507px → 805px，电脑 982px → 767px；财务目标点句子才编辑；+ Add goal 自动展开；Dashboard 下拉框拿掉，改在 Goals 点「Show on Dashboard」）：照全站 Preview——手机总进度卡（已存 / 目标总额、完成几个、每月存多少）+ 每个目标一行（名称 · 每月 · 进度条 · % · 金额），完成的排最后；电脑 4 个数字 + 目标表整行；「+ Add goal」收起；去掉重复的大写标签；财务目标句保留 Lato；拿掉顶部检查卡；Dashboard 的 featured goal 选择器移到 Goals。
  - **T-6c TVM** `[x]`（2026-09-17，PR #66 已合并；你看过后把「Solve」改回 PV / PMT / FV / Rate / Periods；Reset 移到标题并清空三个工具）。已定（2026-09-17）：每行右边保留小的「Solve」，点哪行解哪个；第一个分页叫「TVM」，另外两个「Inflation」「What if I spend this?」。计划：照 Preview——三个工具用分段选择器切换，一次一个；结果放大数字卡（电脑加本金 vs 利息比例条）；输入整理成清单；不改计算。

### T-6d — Investment Growth  `[x]`（2026-09-17，PR #67 已合并；手机 1,449px → 999px；默认结果跟改前一样 300,851）
- 现在是单独的 React 组件（`src/calculator/InvestmentGrowthCalculator.tsx`，用自己的 Tailwind 样式），跟其他页面的卡片、字体、颜色不是同一套。
- **Preview（2026-09-17）**：https://claude.ai/artifact/BpEiPFT9QCztsiqF2ARwSw
  - 手机：结果卡（预计金额 + interest chip + 本金 vs 利息比例条）→ 增长图卡 → 输入清单（直接打字，Monthly / Annually 分段选择）→ 页底估算说明。
  - 电脑：标题右边 Reset → 4 个数字（Projected value / You put in / Interest / Growth share）→ Inputs | Growth 图，一样高。
- **已定**：1. 图保留鼠标移上去（手机点图）看某一年的数字；2. 保留「Growth share」；3. 金额不显示两位小数。
- 不改计算（`investmentGrowth.ts`）。

### T-7 — Market  `[x]`（2026-09-17，T-7a PR #68、T-7b PR #69 已合并；整个 T 系列完成）
- demo 里图表是空的，需要真实行情数据才能判断。
- **现在（2026-09-17 读代码）**：`marketPage.ts` 1,115 行。顶部一张「Context before action」原则卡 → 代码按钮（VOO / QQQM / 自定义）+ 新增代码表单一直展开 → 7 个分页（Long-term view 图 / Your position / Risk / Income / Composition / Compare / Context）。7 个分页的数据在打开页面时就全部加载，分页只是显示或隐藏，所以改排版不影响取数据。Risk、Income、Your position 里的数字卡带 emoji。
- **Preview（全站手机 + 电脑 v2）**：代码用分段选择（新增收进「＋」）→ 4 个数字（价格 / 距离高点 / 你的持仓 / 占比 vs 目标）→ 价格图整行（时间范围在卡片右上角）→ Holdings / Risk / Income 入口；原则一句移到图下面小字。
- **Preview 没有画到的**：Composition、Compare、Context（历史跌幅）、Your position 的交易明细——计划里保留，不删。
- **T-7a 做了**：代码分段选择（＋ 收起新增）、电脑 4 个数字、价格图整行（时间范围在右上角）、手机持仓卡。
- **T-7b 做了**：7 个分页换成「More about VOO」一张列表，每行点开就地展开，所有研究内容保留；手机图表卡拉开间距。

### T-8a — 卡片行距修复  `[x]`（2026-09-17，PR #70 已合并）
- **问题**：`.wu-card` 的 `display:block` 跟 `.wu-stack` 同优先级、写在后面，所以同时带两个 class 的卡片行距全是 0（12 页，电脑 + 手机）。
- **做法**：一处 CSS 让 `.wu-card.wu-stack` 恢复 flex 列；TVM / Investment Growth 的切换按钮跟输入框同高 36px。

### T-8b — iPad 排版  `[x]`（2026-09-17，PR #71 已合并；竖屏 ≤900px 用手机版 + 底部导航，横屏按内容区宽度排；13 页 × 6 种宽度无超出）
- **问题**：只有一个 720px 断点。iPad 拿到电脑版但侧边栏占 ~300px，内容区只剩 420–800px，仍然 4 格一行、左右并排 → 数字超出、字重叠（1180/1024/820/768 都查过）。
- **做法（已定）**：排版看内容区宽度（container query）：够宽才 4 格，窄就 2×2；并排卡不够宽就上下叠。iPad 竖屏（约 900px 以下）收起侧边栏，用底部导航。

---

## 按收入分配（I 系列）  `[x]`（2026-09-17，PR #56 已合并并部署）

- **问题**：Bucket 是写死的月额，默认每个月进来的钱差不多。Freelancer / 佣金 / gig 用不了：
  收入少的月份计划执行不了，收入多的月份多出来的钱没有去处。起因是你朋友是 freelancer。
- **做法**：Bucket 换成一条**瀑布**：钱从上往下流，填满一层才轮到下一层。每层三种规则：
  `fill` 填到固定金额 / `pct` 剩下的 X% / `gross` 总收入的 X%。按**整个月累计**分配，
  不按单笔 —— gig 每周进 400，月底生活费才会是 1,500 而不是 960。
- **Preview**：先做了可拖动的预览页反复改了 7 版（开关式、可编辑、删 Buffer、收入不设上限……）才动代码。

### I-1 — 分配引擎（纯函数 + 测试）  `[x]`
`src/allocation.ts`。三种规则、百分比只量一次底数（不连乘）、溢出层、按月累计的 `added`。

### I-2 — 分配计划 + 迁移（schema v22）  `[x]`
`WealthState.allocation`。老数据自动迁移：每个 monthly bucket 变成一条「填到原金额」，顺序不变，
数字和以前一样；Opportunity（one-time）不进瀑布；结余默认给 Growth（种子数据本来就写着）。

### I-3 — Budget 读模型接上 Ledger 真实收入  `[x]`
同一套规则算两遍：计划的月份 vs 真实的月份，永远分开放。赞助的钱不算收入。

### I-4 — Budget 页显示「This month」  `[x]`
每层显示规则、拿到多少、满没满。额度 0 的层显示「Nothing set」而不是「Not reached」。

### I-5 — 分配层编辑器取代 Bucket 卡片  `[x]`（你选的方案）
两份数据会打架，所以只留一套：每层点 Edit 改名字 / 规则 / 数值 / 用途 / 顺序 / 删除，加层，选溢出层，
「Make them add to 100%」。`state.buckets` 每次保存从计划重写。AI 助手改成描述规则，不报没人设过的金额。

### I-6 — 最差 / 普通 / 最好的月份  `[x]`
用最近 6 个完整月份的真实收入。当月不算（还没过完）；没收入的月份是缺数据不是坏月份；不到 2 个月不显示。

### I-7 — 修 bug：预备金被当成可用现金  `[x]`
原来「现金」= 银行 + 钱包，把预备金也算进去了，和「不许拿预备金补生活费」矛盾（demo 多报 4,800）。
现在：Emergency Fund 目标关联了账户就精确排除（投资账户如 MMF 本来就不在现金里，不重复扣）；
没关联就保守地从银行里减掉，并在页面上写明是假设的。

### I-8 — Ledger 记收入时显示「这笔钱去哪」  `[x]`
输入金额时实时显示，接着这个月已记的收入继续算。编辑时排除自己；只算同一个月；赞助的钱不分配。

### I-9 — 上线前删掉 `AllocationPlan.baseIncome`  `[x]`
和 `cashflow.allowance` 重复。趁还没写进用户的云端数据删掉。

- **你定的决定**：现在做（DG 往后排）；Tax 不做（需要的人自己加一层 `gross`）；不许用预备金补低收入月份。
- **验证**：1,022 测试 / typecheck / build；真机 1400 / 1054 / 390px；**你用真实账户核对过**（层金额、本月收入、
  预备金关联、Ledger 提示）；线上 bundle 已确认是新版。

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

- **Ledger 记账表单的吸顶可能不生效**（做 DG-2 时发现，2026-09-16）：`.wu-ledger-entry` 设置了 `position: sticky`，但外层 `.main` 是 `overflow: hidden`，sticky 会粘在 `.main` 上，滚动时表单不会跟着。没有实测确认，也没改。修法可能是把 `.main` 改成 `overflow: clip`，但它会影响光线裁切，需要单独验证。

- **液态玻璃真折射（原 G-4）**：只有 Chromium 内核的浏览器支持，iPhone Safari 看不到。等电脑版有更多浮在内容上的玻璃元素时再考虑。G-0 Preview 里已经有可用的实现（位移贴图 + SVG 滤镜）。

- `COMMERCIALIZATION_PLAN.md` 全部内容（Capacitor 打包、付费订阅、AI 视频增长）。
- 阶段 0 里偏商业化的项：Apple / 邮箱登录、账号删除流程、数据导出复核。
- `WEALTHUP_CONTEXT.md` 第 9 节（P0-P4 待办清单）整体过一遍 —— 里面多条其实本轮已做
  （限流、字节预算、免责声明、CI 卡死、Portfolio 表单），标记或删除。
- 清掉手机上已废弃的导航 chrome：`.hamburger` 按钮 + `#sidebarToggle` + 滑出
  `.sidebar` 抽屉的 markup/CSS。手机导航现已全部走底部 tab bar + "More" 整页
  （见 `ui.ts` 注释 124-127），抽屉只剩桌面侧边栏在用；手机相关的抽屉代码是死代码。

- **收入类型开关**（I 系列留下）：`allocation.incomeType` 字段已存在，但没有界面、也没有地方读它。
  收入固不固定 app 从 Ledger 自己看得出来，真需要时再说。
- **Tax 提醒**（I 系列，决定不做）：需要预扣税的人可以自己加一层「总收入的 X%」。
- **「假设预备金在银行」这句话重复**（I-7 留下）：缺口提示和月份卡里各出现一次，手机上啰嗦。
