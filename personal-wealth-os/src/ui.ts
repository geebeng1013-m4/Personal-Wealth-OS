import type { AdvisorRecommendation, WealthState } from "./models";
import { createId, cloneDefaultState, exportState, importStateFromFile, loadSnapshots, restoreSnapshot, clearSnapshots, type Snapshot } from "./state";
import {
  emergencyRatio,
  money,
  monthsToEmergencyTarget,
  percent,
  trancheStatus,
} from "./rules";
import { getAdvisorSnapshot, nextActions } from "./advisor";
import { isRecommendationCompleted, markRecommendationDone } from "./actionRecords";
import { investmentAssetShare } from "./ledger";
import { getPortfolioSnapshot } from "./portfolioSummary";
import { livePriceInputs, refreshLivePrices, priceRefreshCleanup, PRICE_POLL_INTERVAL_MS } from "./livePrices";
import { getGoalsSnapshot } from "./goalSummary";
import { getBudgetSnapshot } from "./budgetSummary";
import { bindTvmCalculator, tvmCalculatorTemplate } from "./pages/tvmPage";
import { escapeHtml, getTheme } from "./html";
import { leakInsightStrip } from "./components/leakInsightStrip";
import { moneyOrUnknown, pnlText, pnlTone, joinNotes, valuationNote, usdPnlNote, feeRowHtml } from "./pages/valuationFormat";
import { mountSideRays } from "./sideRays";
import { forecastRecurring, nextRecurringOccurrence } from "./financialHealth";
// Money Leaks detect WHAT happened; the Advisor supplies the guidance shown
// alongside each finding. Both arrive pre-merged via this compatibility shape.
import { detectMoneyLeaks, type MoneyLeak } from "./advisor";
import { buildOverviewModel } from "./overview";

import type { Navigate, Setter } from "./pages/pageTypes";
import { bindReview, reviewTemplate } from "./pages/reviewPage";
import { bindRules, rulesTemplate } from "./pages/rulesPage";
import { bindSettings, settingsTemplate } from "./pages/settingsPage";
import { bindGoals, goalsTemplate } from "./pages/goalsPage";
import { bindBuckets, bucketsTemplate } from "./pages/budgetPage";
import { bindLedger, ledgerTemplate } from "./pages/ledgerPage";
import { bindPortfolio, portfolioTemplate } from "./pages/portfolioPage";
import { bindMarket, marketTemplate } from "./pages/marketPage";

const sideRaysCleanup = new WeakMap<HTMLElement, () => void>();
const calculatorCleanup = new WeakMap<HTMLElement, () => void>();
const sidebarScrollPositions = new WeakMap<HTMLElement, number>();

type Page = readonly [id: string, english: string, subtitle: string];
type PageGroup = readonly [title: string, pages: readonly Page[]];

const pageGroups = [
  ["Wealth", [
    ["dashboard", "Overview", "Financial command centre"],
    ["portfolio", "Portfolio", "Investments & activity"],
    ["goals", "Goals", "Progress & targets"],
    ["market", "Market", "Research when needed"],
  ]],
  ["Money", [
    ["ledger", "Ledger", "Income & expenses"],
    ["buckets", "Budget", "Fund allocation"],
    ["money-leaks", "Money Leaks", "Detected cash-flow drag"],
  ]],
  ["Intelligence", [
    ["advisor", "Advisor", "Guidance & scenarios"],
    ["review", "Review", "Monthly check-in"],
    ["rules", "Rules", "Decision framework"],
  ]],
  ["Tools", [
    ["tvm", "TVM Calculator", "Time value of money"],
    ["calculator", "Investment Growth", "Contribution projections"],
  ]],
  ["System", [
    ["settings", "Settings", "Configuration"],
  ]],
] as const satisfies readonly PageGroup[];

const pages: Page[] = pageGroups.flatMap<Page>(([, groupPages]) => [...groupPages]);

function navTemplate(activePage: string): string {
  let pageIndex = 0;
  return pageGroups
    .map(([groupTitle, groupPages]) => {
      const items = groupPages.map(([id, english, chinese]) => {
        const index = pageIndex++;
        return `<button class="nav-item ${id === activePage ? "active" : ""}" data-page="${id}" type="button" style="--nav-index:${index}"${id === activePage ? ' aria-current="page"' : ""}><i class="nav-node" aria-hidden="true"></i><span class="nav-label"><strong>${english}</strong><small>${chinese}</small></span></button>`;
      }).join("");
      return `<div class="nav-group"><div class="nav-group-title">${groupTitle}</div><div class="nav-group-items">${items}</div></div>`;
    })
    .join("");
}

// Map ticker to TradingView symbol format (EXCHANGE:SYMBOL)
function shellTemplate(activePage: string, state: WealthState, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }): string {
  const themeIcon = getTheme() === "dark" ? "☀️" : "🌙";
  const active = pages.find(([id]) => id === activePage);
  const toolsOpen = sidebarToolsOpen();
  const userBadge = user ? `<div class="user-badge"><img src="${escapeHtml(user.photoURL || "")}" alt="" class="user-avatar" referrerpolicy="no-referrer"><span class="user-name">${escapeHtml(user.displayName || user.email || "User")}</span><button class="secondary-button logout-btn" type="button">Sign Out</button></div>` : "";
  return `
    <button class="hamburger" id="sidebarToggle" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-scroll-area">
        <div class="brand">
          <span class="brand-mark"><img src="/brand/wealth-mark.png" alt=""></span>
          <span class="brand-copy">
            <h1>WealthUp</h1>
            <p>Personal Wealth OS</p>
          </span>
        </div>
        <nav class="nav line-sidebar" aria-label="Primary navigation">
          ${navTemplate(activePage)}
        </nav>
        <div class="profile-card">
          <span class="eyebrow">Wealth Mandate</span>
          <strong>${escapeHtml(state.profile.riskTolerance)} risk · ${state.profile.investmentHorizonYears}+ years</strong>
          <small>${escapeHtml(state.profile.stage)} · MYR base currency</small>
        </div>
      </div>
      <div class="sidebar-actions">
        ${userBadge}
        <!-- Everything below the account row is occasional: installing the app,
             exporting, restoring a version, resetting. Collapsed by default so
             the sidebar ends on the one row that is always relevant, and the
             Reset button is not sitting under the user's thumb. -->
        <details class="sidebar-tools" id="sidebarTools"${toolsOpen ? " open" : ""}>
          <summary><span>Data &amp; tools</span><span class="sidebar-tools__chevron" aria-hidden="true">›</span></summary>
          <div class="sidebar-tools__content">
            <button class="secondary-button install-btn" id="installPwa" type="button">Add to Home Screen</button>
            <div class="sidebar-actions-row">
              <button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle color theme" title="Toggle theme">${themeIcon}</button>
              <button class="secondary-button" id="exportJson" type="button">Export</button>
              <label class="file-button">Import<input id="importJson" type="file" accept="application/json"></label>
            </div>
            <div class="sidebar-actions-row">
              <button class="secondary-button" id="versionHistory" type="button">Version History</button>
              <button class="danger-button" id="resetData" type="button">Reset</button>
            </div>
          </div>
        </details>
      </div>
    </aside>
    <main id="main-content" class="main">
      <div class="side-rays" aria-hidden="true">
        <div class="side-rays-container" id="sideRays"></div>
      </div>
      <header class="topbar">
        <div>
          <span class="eyebrow">Personal CFO Operating System</span>
          <h2>${active?.[1] ?? "Overview"}<span>${active?.[2] ?? "Dashboard"}</span></h2>
        </div>
      </header>
      <section id="pageMount"></section>
    </main>
  `;
}

function dashboardTemplate(state: WealthState): string {
  // The Dashboard's single read model. Every canonical figure below is read
  // from it — this template formats and renders, it does not calculate.
  const overview = buildOverviewModel(state, new Date(), livePriceInputs());
  const snapshot = overview.snapshot;
  const portfolio = overview.portfolio;
  const budget = overview.budget;
  const tracked = overview.trackedWealth;
  const expenseChange = overview.cashFlow.expenseChange;
  const emergency = overview.emergencyRatio;
  const nextGoal = overview.goals.featured;
  const nextGoalCurrent = nextGoal?.currentAmount ?? 0;
  const nextGoalRatio = nextGoal?.progress ?? 0;
  const planOnTrack = budget.planCoversDca;
  const surplus = budget.plannedSurplus;
  const opportunity = tracked.reserve;
  const investedShare = tracked.investedShare;
  const safetyShare = tracked.safetyShare;
  const reserveShare = tracked.reserveShare;

  // Findings and recurring forecasts are read straight from their own canonical
  // sources; the Dashboard only renders them.
  const leakSummary = detectMoneyLeaks(state);
  const actions = nextActions(state);
  const assetShare = investmentAssetShare(state.ledgerTransactions, state.ledgerAccounts);
  const emergencyMonths = monthsToEmergencyTarget(state);
  const forecast = forecastRecurring(state.recurringTransactions);
  const nextRecurring = nextRecurringOccurrence(state.recurringTransactions);

  // UI interaction state: the goal picker's options list.
  const overviewGoalOptions = state.goals
    .map((goal) => `<option value="${escapeHtml(goal.id)}"${goal.id === nextGoal?.id ? " selected" : ""}>${escapeHtml(goal.name)}</option>`)
    .join("");

  return `
    <a href="#main-content" class="skip-link">Skip to main content</a>

    <!-- ============ HEADER ============ -->
    <header class="ov-header">
      <p class="ov-header__greeting">Good ${getGreeting()}, ${escapeHtml(overview.greetingName)}</p>
      <h2 class="ov-header__title">Wealth Overview</h2>
      <p class="ov-header__summary">${escapeHtml(overview.headline)}</p>
    </header>

    <!-- ============ SECTION 1 — FINANCIAL SNAPSHOT ============ -->
    <section class="ov-section" aria-labelledby="ovSnapshotTitle">
      <div class="ov-section__head">
        <h3 class="ov-section__title" id="ovSnapshotTitle">Financial Snapshot</h3>
        <p class="ov-section__subtitle">Recorded position and this month's cash flow</p>
      </div>
      <div class="ov-metrics">
        <div class="ov-metric ov-metric--primary">
          <span class="ov-metric__label">Net Worth</span>
          <strong class="ov-metric__value" id="ovNetWorth">${money(overview.netWorth)}</strong>
          <span class="ov-metric__note" id="ovNetWorthNote">${money(overview.totalAssets)} assets − ${money(overview.totalLiabilities)} liabilities</span>
        </div>
        <div class="ov-metric">
          <span class="ov-metric__label">Income</span>
          <strong class="ov-metric__value ov-metric__value--positive">${money(overview.cashFlow.income)}</strong>
          <span class="ov-metric__note">Recorded this month</span>
        </div>
        <div class="ov-metric">
          <span class="ov-metric__label">Expenses</span>
          <strong class="ov-metric__value">${money(overview.cashFlow.expenses)}</strong>
          <span class="ov-metric__note">${overview.cashFlow.expenseChange !== null
            ? `${overview.cashFlow.expenseChange <= 0 ? "↓" : "↑"} ${percent(Math.abs(overview.cashFlow.expenseChange), 0)} vs last month`
            : "Recorded this month"}</span>
        </div>
        <div class="ov-metric">
          <span class="ov-metric__label">Surplus</span>
          <strong class="ov-metric__value ov-metric__value--${overview.cashFlow.surplus >= 0 ? "positive" : "negative"}">${overview.cashFlow.surplus >= 0 ? "+" : "−"}${money(Math.abs(overview.cashFlow.surplus))}</strong>
          <span class="ov-metric__note">Income minus expenses</span>
        </div>
      </div>
    </section>

    <!-- ============ SECTION 2 & 3 — WEALTH HEALTH + PLAN STATUS ============ -->
    <div class="ov-pair">
      <section class="ov-card ov-card--status ov-card--${overview.wealthHealth.status}" aria-labelledby="ovHealthTitle">
        <div class="ov-section__head">
          <h3 class="ov-section__title" id="ovHealthTitle">Wealth Health</h3>
          <p class="ov-section__subtitle">Overall financial condition</p>
        </div>
        <p class="ov-status-badge ov-status-badge--${overview.wealthHealth.status}">
          <span class="ov-status-badge__mark" aria-hidden="true">${overview.wealthHealth.status === "healthy" ? "✓" : overview.wealthHealth.status === "watch" ? "!" : "▲"}</span>
          ${escapeHtml(overview.wealthHealth.label)}
        </p>
        <p class="ov-card__lead">${escapeHtml(overview.wealthHealth.summary)}</p>
        <ul class="ov-factors">
          ${overview.wealthHealth.factors.map((factor) => `
            <li class="ov-factor">
              <span class="ov-factor__dot ov-factor__dot--${factor.status}" aria-hidden="true"></span>
              <span class="ov-factor__label">${escapeHtml(factor.label)}</span>
              <span class="ov-factor__detail">${escapeHtml(factor.detail)}</span>
              <span class="visually-hidden">Status: ${escapeHtml(factor.status)}</span>
            </li>
          `).join("")}
        </ul>
      </section>

      <section class="ov-card" aria-labelledby="ovPlanTitle">
        <div class="ov-section__head">
          <h3 class="ov-section__title" id="ovPlanTitle">Plan Status</h3>
          <p class="ov-section__subtitle">Monthly contribution plan</p>
        </div>
        <p class="ov-status-badge ov-status-badge--${overview.planStatus.onTrack ? "healthy" : "watch"}">
          <span class="ov-status-badge__mark" aria-hidden="true">${overview.planStatus.onTrack ? "✓" : "!"}</span>
          ${escapeHtml(overview.planStatus.label)}
        </p>
        <div class="ov-plan__figures">
          <div><span class="ov-metric__label">Planned</span><strong class="ov-plan__amount">${money(overview.planStatus.plannedAmount)}</strong></div>
          <div><span class="ov-metric__label">Contributed</span><strong class="ov-plan__amount">${money(overview.planStatus.actualAmount)}</strong></div>
        </div>
        ${overview.planStatus.progress !== null ? `
          <div class="ov-progress" role="progressbar"
               aria-valuenow="${Math.round(overview.planStatus.progress * 100)}" aria-valuemin="0" aria-valuemax="100"
               aria-label="Monthly contribution progress">
            <div class="ov-progress__fill" style="width:${Math.round(overview.planStatus.progress * 100)}%;"></div>
          </div>
          <p class="ov-card__note">${Math.round(overview.planStatus.progress * 100)}% of this month's plan · ${escapeHtml(overview.planStatus.detail)}</p>
        ` : `<p class="ov-card__note">${escapeHtml(overview.planStatus.detail)}</p>`}
        <button class="v2-btn v2-btn--ghost v2-btn--sm dashboard-nav" data-page="portfolio" type="button">Open portfolio →</button>
      </section>
    </div>

    <!-- ============ SECTION 4 — PRIORITY ACTION ============ -->
    ${overview.priorityAction ? `
      <section class="ov-priority ov-priority--${overview.priorityAction.severity}" aria-labelledby="ovPriorityTitle">
        <p class="ov-priority__eyebrow">
          <!-- A watch carries no glyph. The eyebrow is already coloured by
               severity, and an exclamation mark made a standing reminder read
               as an alarm. The span is omitted rather than left empty: the
               eyebrow is an inline-flex with a gap, so an empty child would
               hold open a space where the mark used to be. -->
          ${overview.priorityAction.severity === "watch" ? "" : `<span class="ov-priority__mark" aria-hidden="true">${overview.priorityAction.severity === "action" ? "▲" : "✓"}</span>`}
          Priority ${escapeHtml(overview.priorityAction.severity === "positive" ? "status" : overview.priorityAction.severity)}
        </p>
        <h3 class="ov-priority__title" id="ovPriorityTitle">${escapeHtml(overview.priorityAction.title)}</h3>
        <div class="ov-priority__body">
          <p class="ov-priority__row"><span class="ov-priority__key">Why</span><span>${escapeHtml(overview.priorityAction.explanation)}</span></p>
          <p class="ov-priority__row"><span class="ov-priority__key">Do</span><span>${escapeHtml(overview.priorityAction.actionLabel)}</span></p>
          ${isRecommendationCompleted(state, overview.priorityAction.recommendationId)
            ? '<p class="ov-priority__row"><span class="ov-priority__key">Status</span><span class="ov-priority__done"><span aria-hidden="true">✓</span> You marked this done</span></p>'
            : ""}
        </div>
        <!-- Why / Do / Act in one place. Without the action here the user had
             to find this same recommendation among six cards on the Advisor
             page just to record it. Same ActionRecord mechanism, and the
             priority itself is still chosen purely by the Advisor. -->
        <div class="ov-priority__actions">
          <button class="v2-btn v2-btn--primary dashboard-nav" data-page="${escapeHtml(overview.priorityAction.destination)}" type="button">
            Go to ${escapeHtml(overview.priorityAction.destination.replace(/-/g, " "))}
          </button>
          ${isRecommendationCompleted(state, overview.priorityAction.recommendationId)
            ? ""
            : `<button class="v2-btn v2-btn--ghost dashboard-mark-done" type="button" data-recommendation-id="${escapeHtml(overview.priorityAction.recommendationId)}">Mark as done</button>`}
        </div>
      </section>
    ` : `
      <section class="ov-priority ov-priority--positive" aria-labelledby="ovPriorityTitle">
        <p class="ov-priority__eyebrow"><span class="ov-priority__mark" aria-hidden="true">✓</span> Priority status</p>
        <h3 class="ov-priority__title" id="ovPriorityTitle">Nothing needs your attention</h3>
        <div class="ov-priority__body"><p class="ov-priority__row"><span class="ov-priority__key">Why</span><span>No exceptions were detected against your configured rules.</span></p></div>
      </section>
    `}

    <!-- ============ SECONDARY — DETAILS ============ -->
    <div class="ov-secondary">
      <div class="ov-secondary__head">
        <h3 class="ov-secondary__title">Details</h3>
        <p class="ov-section__subtitle">Supporting breakdowns behind the summary above</p>
      </div>

    <!-- ---------- A. WEALTH DETAILS ---------- -->
    <section class="ov-group" aria-labelledby="ovGroupWealth">
      <div class="ov-group__head">
        <h4 class="ov-group__title" id="ovGroupWealth">Wealth Details</h4>
        <p class="ov-group__desc">Where your tracked capital sits</p>
      </div>
      <div class="ov-group__grid">
        <section class="ov-detail-card" aria-label="Tracked wealth allocation">
          <h5 class="ov-detail-card__title">Tracked Wealth Base</h5>
          <div class="v2-allocation">
            <div class="v2-allocation__ring" style="background:conic-gradient(var(--color-accent) 0% ${Math.round(investedShare * 100)}%, var(--color-blue) ${Math.round(investedShare * 100)}% ${Math.round((investedShare + safetyShare) * 100)}%, var(--color-gold) ${Math.round((investedShare + safetyShare) * 100)}% 100%);" aria-label="Wealth allocation ring showing ${percent(investedShare + safetyShare + reserveShare)} allocated">
              <div class="v2-allocation__center">
                <strong>${percent(investedShare + safetyShare + reserveShare)}</strong>
                <small>Allocated</small>
              </div>
            </div>
            <div class="v2-allocation__legend">
              <div class="v2-allocation__legend-item"><span class="v2-allocation__legend-dot" style="background:var(--color-accent);"></span>Investments <strong>${money(portfolio.totalInvestedMyr)}</strong></div>
              <div class="v2-allocation__legend-item"><span class="v2-allocation__legend-dot" style="background:var(--color-blue);"></span>Safety <strong>${money(state.emergency.current)}</strong></div>
              <div class="v2-allocation__legend-item"><span class="v2-allocation__legend-dot" style="background:var(--color-gold);"></span>Reserve <strong>${money(opportunity)}</strong></div>
            </div>
          </div>
          <!-- What the investments are worth now, versus what went in. Every
               figure is read from the canonical PortfolioSnapshot; nothing here
               is calculated. Unknown stays "--". -->
          <dl class="ov-detail-list ov-valuation" data-valuation-status="${portfolio.valuationStatus}">
            <div class="ov-detail-row">
              <dt>Market value</dt>
              <dd id="ovMarketValue">${moneyOrUnknown(portfolio.totalInvestmentValueMyr)} <span class="ov-detail-row__note">${escapeHtml(valuationNote(portfolio))}</span></dd>
            </div>
            <div class="ov-detail-row">
              <dt>Invested</dt>
              <dd>${money(portfolio.totalInvestedMyr)} <span class="ov-detail-row__note">Capital contributed, at cost</span></dd>
            </div>
            <div class="ov-detail-row" id="ovFeeRow"${portfolio.feesInCostBasisMyr > 0.005 ? "" : " hidden"}>
              <dt>Trading costs</dt>
              <dd id="ovFeeDrag">${feeRowHtml(portfolio)}</dd>
            </div>
            <div class="ov-detail-row">
              <dt>Unrealised P&amp;L</dt>
              <dd id="ovUnrealised" class="${pnlTone(portfolio.unrealizedPnlMyr)}">${pnlText(portfolio.unrealizedPnlMyr, portfolio.unrealizedPnlPercentMyr)} <span class="ov-detail-row__note">${escapeHtml(joinNotes(usdPnlNote(portfolio), portfolio.realizedPnlMyr !== 0 ? `Realised to date ${money(portfolio.realizedPnlMyr)}` : "Excludes realised gains"))}</span></dd>
            </div>
          </dl>
        </section>

        <!-- Same data as before, demoted to compact rows: the headline status
             for these is already carried by Wealth Health and Plan Status. -->
        <section class="ov-detail-card" aria-label="Financial health breakdown">
          <h5 class="ov-detail-card__title">Financial Health</h5>
          <dl class="ov-detail-list">
            <div class="ov-detail-row">
              <dt>Safety reserve</dt>
              <!-- "0mo to target" is noise once the buffer is funded, and
                   meaningless when no target is set. Only show a countdown
                   when there is actually something left to fund. -->
              <dd>${percent(emergency)} <span class="ov-detail-row__note">${state.emergency.target > 0
                ? `${money(state.emergency.current)} of ${money(state.emergency.target)}${Number.isFinite(emergencyMonths) && emergencyMonths > 0 ? ` · ${emergencyMonths}mo to target` : emergency >= 1 ? " · fully funded" : ""}`
                : "No emergency-fund target set"}</span></dd>
            </div>
            <div class="ov-detail-row">
              <dt>Recurring forecast</dt>
              <dd>${money(forecast.surplus)} <span class="ov-detail-row__note">${money(forecast.income)} in · ${money(forecast.expense)} out${nextRecurring ? ` · Next ${nextRecurring.date.toLocaleDateString("en-MY", { day: "numeric", month: "short" })}` : ""}</span></dd>
            </div>
            <div class="ov-detail-row">
              <dt>DCA mandate</dt>
              <dd>${money(budget.plannedDcaAmount)} <span class="ov-detail-row__note">${portfolio.tradeCount} contributions recorded</span></dd>
            </div>
            <div class="ov-detail-row">
              <!-- Deliberately labelled as an ACCOUNT BALANCE. This is the
                   ledger balance sitting in investment accounts, which is a
                   different fact from contributed capital (cost basis) and
                   from market value — all three appear on this page. -->
              <dt>Investment accounts</dt>
              <dd>${assetShare.ratio === null ? "N/A" : percent(assetShare.ratio)} <span class="ov-detail-row__note">${assetShare.ratio === null ? `No account balances recorded` : `${money(assetShare.investmentAssets)} of ${money(assetShare.totalAssets)} account balances`}</span></dd>
            </div>
          </dl>
          <!-- Health says what is weak; the Advisor is where the response
               lives. Without this the card was a dead end. -->
          <button class="v2-btn v2-btn--ghost v2-btn--sm dashboard-nav" data-page="advisor" type="button">See what to do →</button>
        </section>
      </div>
    </section>

    <!-- ---------- B. ACTIVITY & FINDINGS ---------- -->
    <section class="ov-group" aria-labelledby="ovGroupActivity">
      <div class="ov-group__head">
        <h4 class="ov-group__title" id="ovGroupActivity">Activity &amp; Findings</h4>
        <p class="ov-group__desc">Detected cash-flow drag and this month's position</p>
      </div>
      <div class="ov-group__grid">
        <section class="ov-detail-card" aria-labelledby="overviewLeakTitle">
          <div class="ov-detail-card__head">
            <h5 class="ov-detail-card__title" id="overviewLeakTitle">Money Leaks</h5>
            <span class="status-pill ${leakSummary.highCount > 0 ? "status-bad" : "status-warn"}">${leakSummary.leaks.length} detected</span>
          </div>
          <p class="ov-detail-card__lead">${money(leakSummary.monthlyImpact)}<span class="ov-detail-row__note">/mo across ${leakSummary.categoryCount} ${leakSummary.categoryCount === 1 ? "category" : "categories"}</span></p>
          <dl class="ov-detail-list">
            <div class="ov-detail-row">
              <dt>Highest impact</dt>
              <dd>${escapeHtml(leakSummary.topLeak?.title ?? "No material leak detected")} <span class="ov-detail-row__note">${escapeHtml(leakSummary.topLeak?.recommendation ?? "Keep transactions and recurring payments current to improve coverage.")}</span></dd>
            </div>
          </dl>
          <button class="v2-btn v2-btn--ghost v2-btn--sm dashboard-nav" data-page="money-leaks" type="button">Review findings →</button>
        </section>

        <!-- Spending and surplus already headline the Financial Snapshot, so
             they appear here only as supporting context. -->
        <section class="ov-detail-card" aria-label="Monthly financial position">
          <h5 class="ov-detail-card__title">Monthly Position</h5>
          <dl class="ov-detail-list">
            <div class="ov-detail-row">
              <dt>Recorded spending</dt>
              <dd>${money(snapshot.currentMonthExpenses)} <span class="ov-detail-row__note">${expenseChange !== null ? `${expenseChange <= 0 ? "↓" : "↑"} ${percent(Math.abs(expenseChange), 0)} month over month` : "A second month unlocks trend comparison"}</span></dd>
            </div>
            <div class="ov-detail-row">
              <dt>Assignable surplus (planned)</dt>
              <dd>${money(surplus)} <span class="ov-detail-row__note">${planOnTrack ? "Current DCA mandate is covered" : `DCA funding gap: ${money(budget.plannedDcaAmount - surplus)}`}</span></dd>
            </div>
            <div class="ov-detail-row">
              <dt>Opportunity liquidity</dt>
              <dd>${money(opportunity)} <span class="ov-detail-row__note">${state.opportunity.used > 0 ? `${money(state.opportunity.used)} deployed under your rules` : "Held for predefined deployment conditions"}</span></dd>
            </div>
          </dl>
          <button class="v2-btn v2-btn--ghost v2-btn--sm dashboard-nav" data-page="ledger" type="button">Open activity →</button>
        </section>
      </div>
    </section>

    <!-- ---------- C. GUIDANCE ---------- -->
    <section class="ov-group" aria-labelledby="ovGroupGuidance">
      <div class="ov-group__head">
        <h4 class="ov-group__title" id="ovGroupGuidance">Guidance</h4>
        <p class="ov-group__desc">Full briefing behind the priority action above</p>
      </div>
      <section class="ov-detail-card" aria-label="Financial coaching insight">
        <!-- Titled by what it is, not by the headline — that is already the
             Priority Action above. The briefing body still appears in full. -->
        <h5 class="ov-detail-card__title">Personal CFO briefing</h5>
        <p class="ov-detail-card__body">${escapeHtml(overview.briefing)}</p>
        <ul class="ov-detail-notes">
          ${actions.slice(0, 3).map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
        </ul>
        <button class="v2-btn v2-btn--ghost v2-btn--sm dashboard-nav" data-page="advisor" type="button">View full guidance →</button>
      </section>
    </section>

    <!-- ---------- D. GOALS ---------- -->
    <section class="ov-group" aria-labelledby="ovGroupGoals">
      <div class="ov-group__head">
        <h4 class="ov-group__title" id="ovGroupGoals">Goals</h4>
        <p class="ov-group__desc">Progress toward your funded milestones</p>
      </div>
    <section class="ov-detail-card" aria-label="Wealth journey progress">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3);margin-bottom:var(--space-4);">
        <div>
          <h5 class="ov-detail-card__title">${nextGoal ? escapeHtml(nextGoal.name) : "Define your next milestone"}</h5>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-3);">
          ${state.goals.length > 0 ? `<label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-caption);color:var(--color-text-tertiary);">Featured goal<select class="v2-input" id="overviewGoalSelect" aria-label="Choose the goal shown in Wealth Journey" style="min-height:28px;font-size:var(--text-caption);">${overviewGoalOptions}</select></label>` : ""}
          <button class="v2-btn v2-btn--ghost v2-btn--sm dashboard-nav" data-page="goals" type="button">All goals →</button>
        </div>
      </div>
      ${nextGoal ? `
        <div style="display:flex;align-items:center;gap:var(--space-8);flex-wrap:wrap;">
          <div style="position:relative;width:140px;height:140px;flex-shrink:0;">
            <svg viewBox="0 0 140 140" style="width:100%;height:100%;transform:rotate(-90deg);">
              <circle cx="70" cy="70" r="60" fill="none" stroke="var(--color-border)" stroke-width="8" />
              <circle cx="70" cy="70" r="60" fill="none" stroke="var(--color-accent)" stroke-width="8" stroke-linecap="round"
                stroke-dasharray="${Math.round(2 * Math.PI * 60)}" stroke-dashoffset="${Math.round(2 * Math.PI * 60 * (1 - nextGoalRatio))}" />
            </svg>
            <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center;">
              <div><strong style="font-size:20px;font-weight:700;color:var(--color-text-primary);display:block;">${percent(nextGoalRatio)}</strong><small style="font-size:var(--text-micro);color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.08em;">funded</small></div>
            </div>
          </div>
          <div style="flex:1;min-width:200px;">
            <strong style="font-size:var(--text-financial-lg);font-weight:700;color:var(--color-text-primary);display:block;margin-bottom:var(--space-2);">${money(nextGoalCurrent)}</strong>
            <p style="font-size:var(--text-body);color:var(--color-text-secondary);line-height:var(--leading-relaxed);margin:0 0 var(--space-4);">toward ${money(nextGoal.targetAmount)}. ${nextGoal.estimatedMonthsToTarget !== null ? `At ${money(nextGoal.monthlyContribution)} monthly, the current plan has approximately ${nextGoal.estimatedMonthsToTarget} months remaining.` : "Add a monthly contribution to establish a projected timeline."}</p>
            <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-caption);color:var(--color-text-tertiary);">
              <span class="v2-status v2-status--info">Today</span>
              <span style="color:var(--color-border-strong);">→</span>
              <span class="v2-status v2-status--warning">Next milestone</span>
              <span style="color:var(--color-border-strong);">→</span>
              <span class="v2-status v2-status--positive">Target</span>
            </div>
          </div>
        </div>
      ` : '<p style="font-size:var(--text-body);color:var(--color-text-tertiary);text-align:center;padding:var(--space-6) 0;">Create a goal to turn long-term wealth building into a visible, measurable journey.</p>'}
    </section>
    </section><!-- /.ov-group (Goals) -->
    </div><!-- /.ov-secondary -->
  `;
}

const leakCategoryLabels: Record<MoneyLeak["category"], string> = {
  subscription: "Subscription",
  fee: "Fee",
  duplicate: "Duplicate",
  increase: "Spending increase",
  unusual: "Unusual spending",
  budget: "Budget drift",
  goal: "Goal drift",
  debt: "Debt cost",
};
let selectedMoneyLeakId = "";

// --- Live market prices (transient) ----------------------------------------
//

function leakImpactLabel(leak: MoneyLeak): string {
  return leak.impactBasis === "one-time" ? "observed once" : "per month";
}

/**
 * The canonical Advisor recommendation for one Money Leak finding.
 *
 * Findings say WHAT happened; the Advisor owns WHY it matters and WHAT to do.
 * Both are read from AdvisorSnapshot.leakRecommendations — the UI never writes
 * advisory copy of its own, and never re-derives one from the finding.
 */
function leakAdvice(
  recommendations: AdvisorRecommendation[],
  leakId: string,
): AdvisorRecommendation | undefined {
  return recommendations.find((recommendation) => recommendation.id === `advisor:leak:${leakId}`);
}

/**
 * Execution state for one leak recommendation.
 *
 * Completing an action records only that the user did what was suggested. The
 * finding itself is untouched: the leak may well still be there, so this must
 * never be presented as the problem being solved.
 */
function leakActionBlock(state: WealthState, recommendation: AdvisorRecommendation | undefined): string {
  if (!recommendation) return "";
  const done = isRecommendationCompleted(state, recommendation.id);
  if (done) {
    return `<div class="leak-action-state"><span class="leak-action-done">✓ Action completed</span>
      <span class="leak-action-note">Recorded on your side. The finding stays listed until the next scan no longer detects it.</span></div>`;
  }
  return `<div class="leak-action-state"><button class="v2-btn v2-btn--primary v2-btn--sm leak-mark-done"
    data-recommendation-id="${escapeHtml(recommendation.id)}"
    data-action-label="${escapeHtml(recommendation.action)}">Mark as done</button></div>`;
}

function moneyLeaksTemplate(state: WealthState): string {
  const summary = detectMoneyLeaks(state);
  // Canonical advice for every finding, already ranked by the Advisor.
  const leakRecommendations = getAdvisorSnapshot(state).leakRecommendations;
  const selected = summary.leaks.find((leak) => leak.id === selectedMoneyLeakId) ?? summary.topLeak;
  if (selected) selectedMoneyLeakId = selected.id;
  const leakRows = summary.leaks.length > 0
    ? summary.leaks.map((leak) => `
      <button class="leak-row ${leak.id === selected?.id ? "is-selected" : ""}" data-leak-id="${escapeHtml(leak.id)}" aria-pressed="${leak.id === selected?.id ? "true" : "false"}">
        <span class="leak-row-main">
          <span class="leak-row-heading"><strong>${escapeHtml(leak.title)}</strong><span class="leak-severity leak-${leak.severity}">${leak.severity} priority</span></span>
          <span>${escapeHtml(leak.summary)}</span>
          <span class="leak-row-meta">${leakCategoryLabels[leak.category]} · ${Math.round(leak.confidence * 100)}% confidence</span>
        </span>
        <span class="leak-row-impact"><strong>${money(leak.monthlyImpact)}</strong><span>${leakImpactLabel(leak)}</span><span>${leak.impactBasis === "one-time" ? "Not annualised" : `${money(leak.annualImpact)} annual`}</span></span>
      </button>`).join("")
    : `<div class="empty-state"><strong>No material leaks detected</strong><span>Keep recurring payments and transaction details current so the scan can stay useful.</span></div>`;
  const selectedAdvice = selected ? leakAdvice(leakRecommendations, selected.id) : undefined;
  const detail = selected ? `
    <div class="leak-detail-content" data-leak-detail="${escapeHtml(selected.id)}">
      <div class="leak-detail-head">
        <div><span class="eyebrow">${leakCategoryLabels[selected.category]}</span><h2>${escapeHtml(selected.title)}</h2></div>
        <span class="leak-severity leak-${selected.severity}">${selected.severity} priority</span>
      </div>
      <div class="leak-detail-impact"><strong>${money(selected.annualImpact)}</strong><span>${selected.impactBasis === "one-time" ? "observed one-time impact" : "estimated annual impact"}</span></div>
      <section><h3>What was observed</h3><p>${escapeHtml(selected.summary)}</p></section>
      <dl class="leak-evidence">${selected.evidence.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}</dl>
      ${selectedAdvice ? `<section><h3>Why it matters</h3><p>${escapeHtml(selectedAdvice.impact)}</p></section>
      <section class="leak-recommendation"><h3>Recommended next move</h3><p>${escapeHtml(selectedAdvice.action)}</p></section>`
      : `<section class="leak-recommendation"><h3>Recommended next move</h3><p class="empty-state">No recommendation applies to this finding yet. The observation above is the full picture.</p></section>`}
      ${leakActionBlock(state, selectedAdvice)}
      <div class="leak-detail-actions"><button class="primary-button leak-primary-action" data-action="${selected.primaryAction}" data-leak-id="${escapeHtml(selected.id)}">${escapeHtml(selected.actionLabel)}</button><button class="secondary-button dashboard-nav" data-page="advisor" data-advisor-prompt="How should I address ${escapeHtml(selected.title)}?">Ask Advisor</button></div>
    </div>` : `<div class="empty-state"><strong>No money leaks detected</strong><span>Your recent spending is within the current leak-detection rules.</span></div>`;
  return `
    <section class="page-shell money-leaks-page">
      <header class="page-header compact-page-header">
        <div><span class="eyebrow">Cash Flow</span><h1>Money Leaks</h1><p>Deterministic checks across recurring payments, transactions, budgets, goals, and debt.</p></div>
        <div class="page-header-actions"><button class="secondary-button dashboard-nav" data-page="ledger">Open transactions</button><button class="primary-button dashboard-nav" data-page="buckets">Review budget</button></div>
      </header>
      <section class="leak-summary-strip" aria-label="Money leak summary">
        <div><span>Potential monthly drag</span><strong>${money(summary.monthlyImpact)}</strong></div>
        <div><span>Potential annual impact</span><strong>${money(summary.annualImpact)}</strong></div>
        <div><span>Findings</span><strong>${summary.leaks.length}</strong></div>
        <div><span>High priority</span><strong>${summary.highCount}</strong></div>
      </section>
      <div class="money-leaks-workspace">
        <section class="card leak-list-panel" aria-label="Detected money leaks">
          <div class="section-head"><div><span class="eyebrow">Detected issues</span><h2 class="card-title">Prioritised by annual impact</h2></div><span class="card-sub">Select a row for evidence and actions</span></div>
          <div class="leak-list">${leakRows}</div>
        </section>
        <aside class="card leak-detail-panel" aria-live="polite">${detail}</aside>
      </div>
      <p class="money-leaks-disclaimer">Estimates are planning aids based on available records. Confirm merchant charges, account statements, and goal assumptions before changing or disputing payments.</p>
    </section>`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/**
 * Whether the sidebar's tools drawer is open.
 *
 * Kept in localStorage rather than in a module variable, because the point of
 * remembering it is to survive a reload — a module variable only lasts until
 * the tab is closed, which is exactly when the preference stops being useful.
 * Every access is guarded: private windows and blocked site data make the
 * accessor itself throw, and a sidebar that cannot render is a worse outcome
 * than a drawer that forgets.
 */
const SIDEBAR_TOOLS_KEY = "wealthup-sidebar-tools-open";

function sidebarToolsOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_TOOLS_KEY) === "true";
  } catch {
    return false;
  }
}

function setSidebarToolsOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_TOOLS_KEY, String(open));
  } catch { /* the drawer still works, it just will not be remembered */ }
}

/**
 * Minimal ActionRecord control for the priority recommendation.
 * Records whether the user acted; it never affects ranking.
 */
function advisorPriorityActionControl(state: WealthState): string {
  const priority = getAdvisorSnapshot(state).priority;
  if (!priority) return "";
  const done = isRecommendationCompleted(state, priority.id);
  return `
    <div class="advisor-action-record${done ? " advisor-action-record--done" : ""}">
      <div class="advisor-action-record__copy">
        <span class="eyebrow">Priority action</span>
        <strong>${escapeHtml(priority.action)}</strong>
      </div>
      ${done
        ? '<span class="advisor-action-record__done"><span aria-hidden="true">✓</span> Completed</span>'
        : `<button class="primary-button advisor-mark-done" type="button" data-recommendation-id="${escapeHtml(priority.id)}" data-action-label="${escapeHtml(priority.action)}">Mark as done</button>`}
    </div>`;
}

/**
 * One Advisor recommendation with its execution state.
 *
 * Wording, severity and order all come from the recommendation itself — this
 * only adds the control for recording that the user acted on it. Completing a
 * recommendation never removes it: the Advisor is a derived read model, so the
 * card stays until the underlying facts change.
 */
function advisorRecommendationCard(state: WealthState, recommendation: AdvisorRecommendation): string {
  const done = isRecommendationCompleted(state, recommendation.id);
  // Same body composition advisorMessages() has always produced.
  const body = `${recommendation.fact} ${recommendation.action}`.trim();
  return `<div class="advice ${recommendation.severity}${done ? " advice--done" : ""}" data-recommendation-id="${escapeHtml(recommendation.id)}">
      <strong>${escapeHtml(recommendation.title)}</strong>
      <span>${escapeHtml(body)}</span>
      <div class="advice-action">${done
        ? '<span class="advice-action__done"><span aria-hidden="true">✓</span> Action completed</span>'
        : `<button class="v2-btn v2-btn--ghost v2-btn--sm advisor-mark-done" type="button" data-recommendation-id="${escapeHtml(recommendation.id)}" data-action-label="${escapeHtml(recommendation.action)}">Mark as done</button>`}
        ${recommendation.destination
          // The recommendation already names where the work happens. Surfacing
          // it means the card tells the user what to do AND how to get there.
          ? `<button class="v2-btn v2-btn--ghost v2-btn--sm dashboard-nav" type="button" data-page="${escapeHtml(recommendation.destination)}">Go to ${escapeHtml(recommendation.destination.replace(/-/g, " "))} →</button>`
          : ""}</div>
    </div>`;
}

function advisorPageTemplate(state: WealthState): string {
  const trancheRows = state.opportunity.tranches.map((tranche) => {
    return '<tr>' +
      '<td>-' + tranche.drawdown + '%</td>' +
      '<td>' + percent(tranche.percent) + '</td>' +
      '<td>' + money(tranche.amount) + '</td>' +
      '<td>' + money(tranche.amount / 2) + ' / ' + money(tranche.amount / 2) + '</td>' +
      '<td class="tranche-status">—</td>' +
      '</tr>';
  }).join("");

  return `
    ${leakInsightStrip(state, ["debt", "goal", "budget", "fee", "subscription", "duplicate"], "Priority guidance")}
    <div class="terminal-grid">
      <article class="card panel advisor-panel">
        <div class="panel-head"><div><span class="eyebrow">Advisor Engine</span><h3>Financial Planning Guidance</h3></div><span style="color:var(--muted);font-size:12px;">Rules-based</span></div>
        ${advisorPriorityActionControl(state)}
        <!-- Rendered straight from AdvisorSnapshot.recommendations: the same
             cards as before, in the same canonical order, now each carrying its
             own execution state. The UI does not rank or re-word anything. -->
        <div class="advice-list">${getAdvisorSnapshot(state).recommendations
          .map((recommendation) => advisorRecommendationCard(state, recommendation)).join("")}</div>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Scenario Check</span><h3>Dip-Buy Trigger</h3></div><span style="color:var(--muted);font-size:12px;">Bear Market Plan</span></div>
        <div class="scenario-summary-grid">
          <div class="scenario-summary-cell">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">🎯 Opportunity Reserve</div>
            <div style="font-size:16px;font-weight:700;color:var(--green);">${money(state.opportunity.total)}</div>
            <div style="font-size:11px;color:var(--ink-3);">Used: ${money(state.opportunity.used)} · Remaining: ${money(state.opportunity.total - state.opportunity.used)}</div>
          </div>
          <div class="scenario-summary-cell">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📊 VOO Allocation</div>
            <div style="font-size:16px;font-weight:700;">${money(state.opportunity.allocation.VOO)}</div>
          </div>
          <div class="scenario-summary-cell">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📊 QQQM Allocation</div>
            <div style="font-size:16px;font-weight:700;">${money(state.opportunity.allocation.QQQM)}</div>
          </div>
        </div>
        <form id="drawdownForm" class="scenario-form">
          <label>Market Drawdown %<input id="drawdownInput" type="number" min="0" max="80" step="1" value="0"></label>
          <button class="primary-button" type="submit">Check Rule</button>
        </form>
        <div id="drawdownResult" class="scenario-result">Enter the market drawdown from its peak to check whether reserve deployment is triggered.</div>
        <div class="table-wrap compact-table financial-table">
          <table><thead><tr><th>Trigger</th><th>Reserve %</th><th>Amount</th><th>VOO / QQQM</th><th>Status</th></tr></thead><tbody>${trancheRows}</tbody></table>
        </div>
      </article>
    </div>
  `;
}

export function quickViewTemplate(state: WealthState): string {
  const portfolio = getPortfolioSnapshot(state);
  const emergency = emergencyRatio(state);
  // PLANNED surplus (allowance minus basic spending), not the recorded
  // income-minus-expenses surplus the Dashboard shows. The label says so:
  // the two are different facts and routinely differ.
  const surplus = getBudgetSnapshot(state).plannedSurplus;
  const investedMyr = portfolio.totalInvestedMyr;
  // Progress uses the canonical currentAmount, so Quick View, the Goals page
  // and the Dashboard can never disagree about how funded a goal is.
  const targetRows = getGoalsSnapshot(state).ordered.map((g) => {
    const pct = Math.round(g.progress * 100);
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);">' +
      '<span style="font-size:13px;color:var(--ink-2);">' + escapeHtml(g.label) + '</span>' +
      '<span style="font-size:13px;font-weight:600;color:' + (pct >= 80 ? 'var(--green)' : 'var(--ink)') + ';">' + pct + '%</span>' +
    '</div>';
  }).join('');

  return `
    <div style="max-width:400px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:20px;">
        <img class="brand-logo brand-logo-dialog" src="/brand/wealthup-logo.png" alt="WEALTHUP Personal Wealth OS">
        <p style="font-size:12px;color:var(--ink-3);margin:4px 0 0;">Quick Overview</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        <div style="background:var(--surface);border-radius:12px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">INVESTED</div>
          <div style="font-size:20px;font-weight:700;color:var(--green);">${money(investedMyr)}</div>
        </div>
        <div style="background:var(--surface);border-radius:12px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">EMERGENCY</div>
          <div style="font-size:20px;font-weight:700;color:${emergency >= 0.8 ? 'var(--green)' : 'var(--ink)'};">${percent(emergency)}</div>
        </div>
        <div style="background:var(--surface);border-radius:12px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">PLANNED SURPLUS</div>
          <div style="font-size:20px;font-weight:700;">${money(surplus)}</div>
        </div>
        <div style="background:var(--surface);border-radius:12px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">DCA / MONTH</div>
          <div style="font-size:20px;font-weight:700;">${money(state.dca.monthly)}</div>
        </div>
      </div>

      ${state.goals.length > 0 ? '<div style="background:var(--surface);border-radius:12px;padding:14px;margin-bottom:16px;"><div style="font-size:11px;color:var(--ink-3);margin-bottom:8px;">GOALS</div>' + targetRows + '</div>' : ''}

      <button class="primary-button" id="openFullApp" type="button" style="width:100%;padding:14px;font-size:14px;">Open Full App</button>
    </div>
  `;
}

export function renderApp(root: HTMLElement, state: WealthState, setState: Setter, activePage = "dashboard", navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
  document.body.classList.toggle("mask-financial-amounts", state.privacy.maskAmounts);
  const currentSidebarScrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  if (currentSidebarScrollArea) {
    sidebarScrollPositions.set(root, currentSidebarScrollArea.scrollTop);
  }
  const preservedSidebarScrollTop = sidebarScrollPositions.get(root);
  document.body.classList.remove("sidebar-menu-open");
  calculatorCleanup.get(root)?.();
  calculatorCleanup.delete(root);
  sideRaysCleanup.get(root)?.();
  sideRaysCleanup.delete(root);
  priceRefreshCleanup.get(root)?.();
  priceRefreshCleanup.delete(root);

  // Quick view — no sidebar, just condensed data
  if (activePage === "quick") {
    root.className = "app-shell";
    root.innerHTML = '<main class="main quick-view-main">' + quickViewTemplate(state) + '</main>';
    root.querySelector("#openFullApp")?.addEventListener("click", () => {
      renderApp(root, state, setState, "dashboard", navigate, user, onLogout);
    });
    return;
  }

  root.className = "app-shell";
  root.innerHTML = shellTemplate(activePage, state, user);
  const sidebarScrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  if (sidebarScrollArea) {
    if (preservedSidebarScrollTop !== undefined) {
      sidebarScrollArea.scrollTop = preservedSidebarScrollTop;
    } else {
      keepActiveNavigationVisible(root);
    }
  }
  const sideRays = root.querySelector<HTMLElement>("#sideRays");
  if (sideRays) {
    const cleanup = mountSideRays(sideRays, {
      speed: 2.5,
      rayColor1: "#EAB308",
      rayColor2: "#96c8ff",
      intensity: 2,
      spread: 2,
      origin: "top-right",
      tilt: 0,
      saturation: 1.5,
      blend: 0.75,
      falloff: 1.6,
      opacity: 1,
    });
    sideRaysCleanup.set(root, cleanup);
  }
  const mount = root.querySelector<HTMLElement>("#pageMount");
  if (!mount) return;

  const templates: Record<string, string> = {
    dashboard: dashboardTemplate(state),
    portfolio: portfolioTemplate(state),
    market: marketTemplate(state),
    ledger: ledgerTemplate(state),
    buckets: bucketsTemplate(state),
    goals: goalsTemplate(state),
    tvm: tvmCalculatorTemplate(),
    calculator: '<div id="investmentGrowthCalculator"></div>',
    advisor: advisorPageTemplate(state),
    rules: rulesTemplate(state),
    review: reviewTemplate(state),
    settings: settingsTemplate(state),
    "money-leaks": moneyLeaksTemplate(state),
  };
  mount.innerHTML = templates[activePage] ?? templates.dashboard;

  bindCommon(root, state, setState, navigate, user, onLogout);
  bindPage(root, state, setState, activePage, navigate);
}

function keepActiveNavigationVisible(root: HTMLElement): void {
  const scrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  const activeItem = scrollArea?.querySelector<HTMLElement>(".nav-item.active");
  if (!scrollArea || !activeItem) return;

  const areaRect = scrollArea.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();
  if (itemRect.top < areaRect.top) {
    scrollArea.scrollTop -= areaRect.top - itemRect.top;
  } else if (itemRect.bottom > areaRect.bottom) {
    scrollArea.scrollTop += itemRect.bottom - areaRect.bottom;
  }
}

function bindCommon(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
  const doNavigate = navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate, user));

  root.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const scrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
      if (scrollArea) sidebarScrollPositions.set(root, scrollArea.scrollTop);
      closeSidebar(root);
      doNavigate(button.dataset.page ?? "dashboard");
    });
  });

  // Remember whether the tools drawer is open across reloads.
  root.querySelector<HTMLDetailsElement>("#sidebarTools")?.addEventListener("toggle", (event) => {
    setSidebarToolsOpen((event.currentTarget as HTMLDetailsElement).open);
  });

  root.querySelector<HTMLButtonElement>("#themeToggle")?.addEventListener("click", () => {
    const w = window as unknown as Record<string, Record<string, () => void>>;
    w.__pwo?.toggleTheme();
    renderApp(root, state, setState, activePageFromNav(root) ?? "dashboard", navigate, user);
  });

  root.querySelector<HTMLButtonElement>(".logout-btn")?.addEventListener("click", () => {
    onLogout?.();
  });

  // Install PWA button — hide if already standalone
  const installBtn = root.querySelector<HTMLButtonElement>("#installPwa");
  if (installBtn && (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true)) {
    installBtn.style.display = "none";
  }
  installBtn?.addEventListener("click", () => {
    (window as unknown as Record<string, () => Promise<void>>).__pwoInstall?.();
  });

  bindSidebar(root);

  root.querySelector<HTMLButtonElement>("#exportJson")?.addEventListener("click", () => {
    if (state.privacy.requireExportConfirmation && !confirm("Export a file containing your financial data? Store it securely.")) return;
    exportState(state);
  });
  root.querySelector<HTMLInputElement>("#importJson")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const imported = await importStateFromFile(file);
    setState(imported);
    doNavigate("dashboard");
  });

  root.querySelector<HTMLButtonElement>("#versionHistory")?.addEventListener("click", () => {
    const snapshots = loadSnapshots(user?.email ?? undefined);
    renderVersionHistoryModal(root, setState, snapshots, navigate, user, onLogout);
  });

  root.querySelector<HTMLButtonElement>("#resetData")?.addEventListener("click", () => {
    if (!confirm("Reset local Personal Wealth OS data?")) return;
    const next = cloneDefaultState();
    localStorage.clear();
    setState(next);
    doNavigate("dashboard");
  });
}

function closeSidebar(root: HTMLElement): void {
  root.querySelector<HTMLElement>("#sidebar")?.classList.remove("open");
  root.querySelector<HTMLElement>("#sidebarOverlay")?.classList.remove("visible");
  root.querySelector<HTMLButtonElement>("#sidebarToggle")?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("sidebar-menu-open");
}

function bindSidebar(root: HTMLElement): void {
  const sidebar = root.querySelector<HTMLElement>("#sidebar");
  const overlay = root.querySelector<HTMLElement>("#sidebarOverlay");
  const toggle = root.querySelector<HTMLButtonElement>("#sidebarToggle");
  if (!sidebar || !overlay || !toggle) return;

  const openSidebar = (): void => {
    sidebar.classList.add("open");
    overlay.classList.add("visible");
    toggle.setAttribute("aria-expanded", "true");
    if (window.matchMedia("(max-width: 720px)").matches) {
      document.body.classList.add("sidebar-menu-open");
    }
  };

  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar(root);
    else openSidebar();
  });
  overlay.addEventListener("click", () => closeSidebar(root));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !sidebar.classList.contains("open")) return;
    closeSidebar(root);
    toggle.focus();
  });
}

function renderVersionHistoryModal(root: HTMLElement, setState: Setter, snapshots: Snapshot[], navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
  // Remove existing modal if any
  root.querySelector("#versionHistoryModal")?.remove();

  const uid = user?.email ?? undefined;

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleString("en-MY", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true
    });
  }

  const listHtml = snapshots.length === 0
    ? '<div style="text-align:center;padding:40px 20px;color:var(--ink-3);"><div style="font-size:32px;margin-bottom:8px;">📋</div><p>No version history yet.</p><small>Changes are automatically saved when you modify data.</small></div>'
    : snapshots.map((snap, i) =>
      '<div class="history-item" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);' + (i === 0 ? 'background:var(--surface);' : '') + '">' +
        '<div style="flex:1;">' +
          '<div style="font-size:13px;font-weight:600;">' + escapeHtml(snap.label) + '</div>' +
          '<div style="font-size:11px;color:var(--ink-3);">' + formatTime(snap.timestamp) + '</div>' +
        '</div>' +
        '<button class="secondary-button restore-snap" data-id="' + snap.id + '" style="font-size:11px;padding:4px 12px;white-space:nowrap;">Restore</button>' +
      '</div>'
    ).join("");

  const modal = document.createElement("div");
  modal.id = "versionHistoryModal";
  modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);";
  modal.innerHTML =
    '<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:16px;width:90%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line);">' +
        '<div>' +
          '<div style="font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:0.5px;">Version History</div>' +
          '<div style="font-size:16px;font-weight:700;">📋 Version History</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          (snapshots.length > 0 ? '<button class="danger-button" id="clearAllSnapshots" style="font-size:11px;padding:4px 10px;">Clear All</button>' : '') +
          '<button class="secondary-button" id="closeHistoryModal" style="font-size:18px;padding:2px 8px;line-height:1;">✕</button>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;">' + listHtml + '</div>' +
      '<div style="padding:10px 20px;border-top:1px solid var(--line);font-size:11px;color:var(--ink-3);text-align:center;">' +
        'Auto-saved on every change · Max 20 versions' +
      '</div>' +
    '</div>';

  root.appendChild(modal);

  // Close
  modal.querySelector("#closeHistoryModal")?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  // Clear all
  modal.querySelector("#clearAllSnapshots")?.addEventListener("click", () => {
    if (!confirm("Clear all version history? This cannot be undone.")) return;
    clearSnapshots(uid);
    modal.remove();
  });

  // Restore
  modal.querySelectorAll<HTMLButtonElement>(".restore-snap").forEach((btn) => {
    btn.addEventListener("click", () => {
      const snapId = btn.dataset.id;
      if (!snapId) return;
      if (!confirm("Restore this version? Your current state will be saved as a snapshot first.")) return;
      const restored = restoreSnapshot(snapId, uid);
      if (!restored) { alert("Snapshot not found."); return; }
      setState(restored);
      modal.remove();
      renderApp(root, restored, setState, activePageFromNav(root) ?? "dashboard", navigate, user, onLogout);
    });
  });
}

function activePageFromNav(root: HTMLElement): string | undefined {
  const active = root.querySelector<HTMLButtonElement>(".nav-item.active");
  return active?.dataset?.page;
}

function bindPage(root: HTMLElement, state: WealthState, setState: Setter, activePage: string, navigate?: Navigate): void {
  root.querySelectorAll<HTMLButtonElement>(".dashboard-nav").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.leakId) selectedMoneyLeakId = button.dataset.leakId;
      navigate?.(button.dataset.page ?? "dashboard");
    });
  });

  if (activePage === "dashboard") {
    // Record the priority action straight from the Dashboard. The id is
    // validated against the live Advisor snapshot, so a stale button can never
    // write a record for advice that is no longer current.
    root.querySelector<HTMLButtonElement>(".dashboard-mark-done")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const recommendationId = button.dataset.recommendationId;
      if (!recommendationId) return;
      const priority = getAdvisorSnapshot(state).priority;
      if (!priority || priority.id !== recommendationId) return;
      const next: WealthState = {
        ...state,
        actionRecords: markRecommendationDone(state.actionRecords, {
          id: createId("action"),
          recommendationId,
          action: priority.action,
        }),
      };
      setState(next, "Mark priority action done");
      if (navigate) navigate("dashboard");
      else renderApp(root, next, setState, "dashboard");
    });

    // Quotes arrive after the first paint, and go stale after PRICE_STALE_AFTER_MS
    // if the tab stays open. When a (re)fetch lands, patch only the two
    // valuation rows from the canonical snapshot — re-rendering the whole page
    // would discard the user's scroll position and any open control.
    const patchDashboardValuation = (): void => {
      const updated = buildOverviewModel(state, new Date(), livePriceInputs());
      const { portfolio } = updated;
      // Net Worth folds in the portfolio's value (live price, or cost basis
      // when none is available). Once a live price lands it must be repainted
      // alongside Market Value — otherwise the two figures on the same page
      // would silently disagree about which portfolio value is current.
      const netWorthEl = root.querySelector<HTMLElement>("#ovNetWorth");
      const netWorthNoteEl = root.querySelector<HTMLElement>("#ovNetWorthNote");
      if (netWorthEl) netWorthEl.textContent = money(updated.netWorth);
      if (netWorthNoteEl) netWorthNoteEl.textContent = `${money(updated.totalAssets)} assets − ${money(updated.totalLiabilities)} liabilities`;
      const valueEl = root.querySelector<HTMLElement>("#ovMarketValue");
      const pnlEl = root.querySelector<HTMLElement>("#ovUnrealised");
      if (valueEl) {
        valueEl.innerHTML = `${moneyOrUnknown(portfolio.totalInvestmentValueMyr)} <span class="ov-detail-row__note">${escapeHtml(valuationNote(portfolio))}</span>`;
      }
      if (pnlEl) {
        pnlEl.className = pnlTone(portfolio.unrealizedPnlMyr);
        pnlEl.innerHTML = `${pnlText(portfolio.unrealizedPnlMyr, portfolio.unrealizedPnlPercentMyr)} <span class="ov-detail-row__note">${escapeHtml(joinNotes(usdPnlNote(portfolio), portfolio.realizedPnlMyr !== 0 ? `Realised to date ${money(portfolio.realizedPnlMyr)}` : "Excludes realised gains"))}</span>`;
      }
      // The fee-free return moves with the price, so it is repainted with the
      // rest. The fee itself does not, but the two live on one line.
      const feeEl = root.querySelector<HTMLElement>("#ovFeeDrag");
      const feeRow = root.querySelector<HTMLElement>("#ovFeeRow");
      if (feeEl) feeEl.innerHTML = feeRowHtml(portfolio);
      if (feeRow) feeRow.hidden = portfolio.feesInCostBasisMyr <= 0.005;
      root.querySelector<HTMLElement>(".ov-valuation")?.setAttribute("data-valuation-status", portfolio.valuationStatus);
    };
    refreshLivePrices(state, patchDashboardValuation);
    // Keep asking while this Dashboard stays on screen, so a tab left open
    // does not freeze on the price it happened to load first.
    const dashboardPriceTimer = setInterval(() => refreshLivePrices(state, patchDashboardValuation), PRICE_POLL_INTERVAL_MS);
    // Browsers throttle timers in background tabs, so coming back to a tab
    // that has been hidden for hours would otherwise show a very old price
    // until the next tick. Ask again the moment it becomes visible.
    const onDashboardVisible = (): void => {
      if (document.visibilityState === "visible") refreshLivePrices(state, patchDashboardValuation);
    };
    document.addEventListener("visibilitychange", onDashboardVisible);
    priceRefreshCleanup.set(root, () => {
      clearInterval(dashboardPriceTimer);
      document.removeEventListener("visibilitychange", onDashboardVisible);
    });

    root.querySelector<HTMLSelectElement>("#overviewGoalSelect")?.addEventListener("change", (event) => {
      const overviewGoalId = (event.currentTarget as HTMLSelectElement).value;
      if (!state.goals.some((goal) => goal.id === overviewGoalId)) return;
      const next = { ...state, overviewGoalId };
      setState(next, "Changed featured Overview goal");
      if (navigate) navigate("dashboard");
      else renderApp(root, next, setState, "dashboard");
    });
  }
  if (activePage === "money-leaks") bindMoneyLeaks(root, state, setState, navigate);
  if (activePage === "tvm") bindTvmCalculator(root);
  if (activePage === "calculator") {
    const mount = root.querySelector<HTMLElement>("#investmentGrowthCalculator");
    if (mount) {
      let cancelled = false;
      calculatorCleanup.set(root, () => {
        cancelled = true;
      });
      import("./calculator/mountCalculator")
        .then(({ mountCalculator }) => {
          if (cancelled || !mount.isConnected) return;
          const unmount = mountCalculator(mount);
          calculatorCleanup.set(root, () => {
            cancelled = true;
            unmount();
          });
        })
        .catch((error: unknown) => {
          console.error("[Calculator] Failed to load", error);
          if (!cancelled && mount.isConnected) {
            mount.innerHTML = '<article class="card panel"><p class="form-error" role="alert">Calculator could not be loaded. Please refresh and try again.</p></article>';
          }
        });
    }
  }
  if (activePage === "portfolio") {
    bindPortfolio(root, state, setState, navigate, renderApp);
    // Prices land after the first paint, and go stale after
    // PRICE_STALE_AFTER_MS if the page stays open. Re-render the page each
    // time a (re)fetch lands so the holdings table and hero pick up the
    // canonical snapshot's latest valuation.
    const refetchPortfolio = (): void => {
      if (navigate) navigate("portfolio");
      else renderApp(root, state, setState, "portfolio");
    };
    refreshLivePrices(state, refetchPortfolio);
    const portfolioPriceTimer = setInterval(() => refreshLivePrices(state, refetchPortfolio), PRICE_POLL_INTERVAL_MS);
    const onPortfolioVisible = (): void => {
      if (document.visibilityState === "visible") refreshLivePrices(state, refetchPortfolio);
    };
    document.addEventListener("visibilitychange", onPortfolioVisible);
    priceRefreshCleanup.set(root, () => {
      clearInterval(portfolioPriceTimer);
      document.removeEventListener("visibilitychange", onPortfolioVisible);
    });
  }
  if (activePage === "advisor") bindAdvisor(root, state, setState, navigate);
  if (activePage === "review") bindReview(root, state, setState, navigate, renderApp);
  if (activePage === "settings") bindSettings(root, state, setState, navigate, renderApp);
  if (activePage === "goals") bindGoals(root, state, setState, navigate, renderApp);
  if (activePage === "market") bindMarket(root, state, setState);
  if (activePage === "ledger") bindLedger(root, state, setState, navigate, renderApp);
  if (activePage === "buckets") bindBuckets(root, state, setState, navigate, renderApp);
  if (activePage === "rules") bindRules(root, state, setState, navigate, renderApp);
}

function bindMoneyLeaks(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  const summary = detectMoneyLeaks(state);
  // One canonical recommendation list for the whole page, in Advisor order.
  const leakRecommendations = getAdvisorSnapshot(state).leakRecommendations;
  const initialLeak = summary.leaks.find((leak) => leak.id === selectedMoneyLeakId) ?? summary.topLeak;
  const renderDetail = (leak: MoneyLeak): void => {
    const panel = root.querySelector<HTMLElement>(".leak-detail-panel");
    if (!panel) return;
    const advice = leakAdvice(leakRecommendations, leak.id);
    panel.innerHTML = `
      <div class="leak-detail-content" data-leak-detail="${escapeHtml(leak.id)}">
        <div class="leak-detail-head"><div><span class="eyebrow">${leakCategoryLabels[leak.category]}</span><h2>${escapeHtml(leak.title)}</h2></div><span class="leak-severity leak-${leak.severity}">${leak.severity} priority</span></div>
        <div class="leak-detail-impact"><strong>${money(leak.annualImpact)}</strong><span>${leak.impactBasis === "one-time" ? "observed one-time impact" : "estimated annual impact"}</span></div>
        <section><h3>What was observed</h3><p>${escapeHtml(leak.summary)}</p></section>
        <dl class="leak-evidence">${leak.evidence.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}</dl>
        ${advice ? `<section><h3>Why it matters</h3><p>${escapeHtml(advice.impact)}</p></section>
        <section class="leak-recommendation"><h3>Recommended next move</h3><p>${escapeHtml(advice.action)}</p></section>`
        : `<section class="leak-recommendation"><h3>Recommended next move</h3><p class="empty-state">No recommendation applies to this finding yet. The observation above is the full picture.</p></section>`}
        ${leakActionBlock(state, advice)}
        <div class="leak-detail-actions"><button class="primary-button leak-primary-action" data-action="${leak.primaryAction}">${escapeHtml(leak.actionLabel)}</button><button class="secondary-button leak-advisor-action">Ask Advisor</button></div>
      </div>`;
    bindDetailActions(panel, leak);
    bindMarkDone(panel);
  };

  /**
   * Record that the user carried out a recommendation. This writes execution
   * state only — the finding, its impact and its severity are untouched, and
   * the leak stays on the list.
   */
  const bindMarkDone = (scope: ParentNode): void => {
    scope.querySelector<HTMLButtonElement>(".leak-mark-done")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const recommendationId = button.dataset.recommendationId ?? "";
      const action = button.dataset.actionLabel ?? "";
      if (!recommendationId) return;
      const next: WealthState = {
        ...state,
        actionRecords: markRecommendationDone(state.actionRecords, {
          id: `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          recommendationId,
          action,
        }),
      };
      setState(next, "Marked a money-leak action as done");
      if (navigate) navigate("money-leaks");
      else renderApp(root, next, setState, "money-leaks");
    });
  };
  const bindDetailActions = (scope: ParentNode, leak: MoneyLeak): void => {
    scope.querySelector<HTMLButtonElement>(".leak-primary-action")?.addEventListener("click", () => {
      const pageByAction: Record<MoneyLeak["primaryAction"], string> = {
        "review-recurring": "settings",
        "review-ledger": "ledger",
        "review-budget": "buckets",
        "review-goal": "goals",
        "review-debt": "settings",
      };
      navigate?.(pageByAction[leak.primaryAction]);
    });
    scope.querySelector<HTMLButtonElement>(".leak-advisor-action")?.addEventListener("click", () => navigate?.("advisor"));
  };
  root.querySelectorAll<HTMLButtonElement>(".leak-row").forEach((row) => row.addEventListener("click", () => {
    const leak = summary.leaks.find((item) => item.id === row.dataset.leakId);
    if (!leak) return;
    root.querySelectorAll<HTMLButtonElement>(".leak-row").forEach((item) => {
      const selected = item === row;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    renderDetail(leak);
  }));
  // The first detail panel comes from the template rather than renderDetail(),
  // so its controls need binding here too.
  if (initialLeak) bindDetailActions(root, initialLeak);
  bindMarkDone(root);
}

function bindAdvisor(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  // Mark any recommendation as done — the priority callout and every card in
  // the list. Persists an ActionRecord only: the recommendation itself is
  // untouched, keeps its ranking, and stays on the page.
  const recommendations = getAdvisorSnapshot(state).recommendations;
  root.querySelectorAll<HTMLButtonElement>(".advisor-mark-done").forEach((button) => {
    button.addEventListener("click", (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const recommendationId = target.dataset.recommendationId;
      if (!recommendationId) return;
      // The id must belong to a live recommendation, so a stale button can
      // never write a record for advice that no longer exists.
      const recommendation = recommendations.find((item) => item.id === recommendationId);
      if (!recommendation) return;
      const next: WealthState = {
        ...state,
        actionRecords: markRecommendationDone(state.actionRecords, {
          id: createId("action"),
          recommendationId,
          action: recommendation.action,
        }),
      };
      setState(next, "Mark advisor action done");
      renderApp(root, next, setState, "advisor", navigate);
    });
  });

  root.querySelector<HTMLFormElement>("#drawdownForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const drawdown = Number(root.querySelector<HTMLInputElement>("#drawdownInput")?.value) || 0;
    const allTranches = trancheStatus(state, drawdown);
    const triggered = allTranches.filter((tranche) => drawdown >= tranche.drawdown);
    const result = root.querySelector<HTMLElement>("#drawdownResult");

    // Update tranche status column in the table
    const statusCells = root.querySelectorAll<HTMLElement>(".tranche-status");
    allTranches.forEach((tranche, i) => {
      if (statusCells[i]) {
        const statusColor = tranche.deployed ? "var(--ink-3)" : drawdown >= tranche.drawdown ? "var(--green)" : "var(--ink-3)";
        statusCells[i].textContent = tranche.status;
        statusCells[i].style.color = statusColor;
      }
    });

    if (!result) return;
    if (triggered.length === 0) {
      const remaining = state.opportunity.total - state.opportunity.used;
      result.innerHTML = '<div style="margin-bottom:8px;">No tranche triggered at -' + drawdown + '%.</div>' +
        '<div style="font-size:12px;color:var(--ink-3);">Continue DCA and preserve the Opportunity Reserve of ' + money(remaining) + '.</div>';
      return;
    }
    const totalDeploy = triggered.reduce((sum, t) => sum + t.amount, 0);
    const totalVoo = triggered.reduce((sum, t) => sum + t.suggestedVoo, 0);
    const totalQqqm = triggered.reduce((sum, t) => sum + t.suggestedQqqm, 0);
    result.innerHTML = '<div style="font-size:14px;font-weight:700;color:var(--amber);margin-bottom:8px;">🐻 -' + drawdown + '% Drawdown: Deploy ' + money(totalDeploy) + '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<div style="flex:1;background:var(--surface);border-radius:6px;padding:8px;text-align:center;">' +
          '<div style="font-size:11px;color:var(--ink-3);">VOO</div>' +
          '<div style="font-size:14px;font-weight:700;color:var(--blue);">' + money(totalVoo) + '</div>' +
        '</div>' +
        '<div style="flex:1;background:var(--surface);border-radius:6px;padding:8px;text-align:center;">' +
          '<div style="font-size:11px;color:var(--ink-3);">QQQM</div>' +
          '<div style="font-size:14px;font-weight:700;color:var(--purple);">' + money(totalQqqm) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12px;">' +
        '<div style="font-weight:600;margin-bottom:4px;">Deployment Rules:</div>' +
        allTranches.map((t) => {
          const isTriggered = drawdown >= t.drawdown;
          const icon = t.deployed ? '✅' : isTriggered ? '🟢' : '⬜';
          const color = t.deployed ? 'var(--ink-3)' : isTriggered ? 'var(--green)' : 'var(--ink-3)';
          return '<div style="display:flex;justify-content:space-between;padding:4px 0;color:' + color + ';">' +
            '<span>' + icon + ' -' + t.drawdown + '% → ' + money(t.amount) + ' (VOO ' + money(t.suggestedVoo) + ' / QQQM ' + money(t.suggestedQqqm) + ')</span>' +
            '<span>' + t.status + '</span></div>';
        }).join('') +
      '</div>';
  });
}

