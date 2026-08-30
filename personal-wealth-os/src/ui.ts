import type { AdvisorRecommendation, Ticker, WealthState } from "./models";
import { buildAssetHistory, triggerHistory, type AssetHistory } from "./drawdowns";
import { createId, cloneDefaultState, exportState, importStateFromFile, loadSnapshots, restoreSnapshot, clearSnapshots, type Snapshot } from "./state";
import {
  emergencyRatio,
  money,
  monthsToEmergencyTarget,
  percent,
  trancheStatus,
  tradeUnits,
} from "./rules";
import { getAdvisorSnapshot, nextActions } from "./advisor";
import { isRecommendationCompleted, markRecommendationDone } from "./actionRecords";
import { buildTradeTimelineHtml, fetchFundamentals, fetchEtfComposition, fetchHistoricalPrices, calcRiskMetrics, type Fundamentals } from "./market";
import { tradesWithExchangeCost } from "./currencyExchange";
import { investmentAssetShare } from "./ledger";
import { getHolding, getPortfolioSnapshot } from "./portfolioSummary";
import { livePriceInputs, refreshLivePrices, PRICE_POLL_INTERVAL_MS } from "./livePrices";
import { getGoalsSnapshot } from "./goalSummary";
import { getBudgetSnapshot } from "./budgetSummary";
import { bindTvmCalculator, tvmCalculatorTemplate } from "./pages/tvmPage";
import { escapeHtml } from "./html";
import { leakInsightStrip } from "./components/leakInsightStrip";
import { UNKNOWN, moneyOrUnknown, pnlText, pnlTone, joinNotes, valuationNote, usdPnlNote, feeRowHtml } from "./pages/valuationFormat";
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

const sideRaysCleanup = new WeakMap<HTMLElement, () => void>();
const calculatorCleanup = new WeakMap<HTMLElement, () => void>();
/** Stops the periodic live-price refresh (see PRICE_STALE_AFTER_MS) started for this root. */
const priceRefreshCleanup = new WeakMap<HTMLElement, () => void>();
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

function getTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? "dark";
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

type EtfHolding = {
  symbol: string;
  name: string;
  weight: number;
};

type EtfHoldingsProfile = {
  updateDate: string;
  topHoldingsTotalPercent: string;
  holdings: EtfHolding[];
};

const ETF_TOP_HOLDINGS = {
  VOO: {
    updateDate: "Jun 30, 2026",
    topHoldingsTotalPercent: "36.33%",
    holdings: [
      { symbol: "NVDA", name: "NVIDIA", weight: 7.5 },
      { symbol: "AAPL", name: "Apple", weight: 6.58 },
      { symbol: "MSFT", name: "Microsoft", weight: 4.29 },
      { symbol: "AMZN", name: "Amazon", weight: 3.61 },
      { symbol: "GOOGL", name: "Alphabet-A", weight: 3.24 },
      { symbol: "AVGO", name: "Broadcom", weight: 2.77 },
      { symbol: "GOOG", name: "Alphabet-C", weight: 2.58 },
      { symbol: "MU", name: "Micron Technology", weight: 2.02 },
      { symbol: "META", name: "Meta Platforms", weight: 1.91 },
      { symbol: "TSLA", name: "Tesla", weight: 1.83 },
    ],
  },
  QQQM: {
    updateDate: "Jun 30, 2026",
    topHoldingsTotalPercent: "48.50%",
    holdings: [
      { symbol: "AAPL", name: "Apple", weight: 8.9 },
      { symbol: "MSFT", name: "Microsoft", weight: 8.5 },
      { symbol: "NVDA", name: "NVIDIA", weight: 7.8 },
      { symbol: "AMZN", name: "Amazon", weight: 5.2 },
      { symbol: "META", name: "Meta Platforms", weight: 4.6 },
      { symbol: "AVGO", name: "Broadcom", weight: 4.1 },
      { symbol: "TSLA", name: "Tesla", weight: 3.2 },
      { symbol: "GOOGL", name: "Alphabet-A", weight: 3.0 },
      { symbol: "COST", name: "Costco Wholesale", weight: 1.6 },
      { symbol: "NFLX", name: "Netflix", weight: 1.6 },
    ],
  },
  VXUS: {
    updateDate: "Jun 30, 2026",
    topHoldingsTotalPercent: "10.20%",
    holdings: [
      { symbol: "TSMC", name: "Taiwan Semiconductor", weight: 1.85 },
      { symbol: "ASML", name: "ASML Holding", weight: 1.15 },
      { symbol: "NESN", name: "Nestle", weight: 1.05 },
      { symbol: "SHEL", name: "Shell", weight: 0.98 },
      { symbol: "AZN", name: "AstraZeneca", weight: 0.95 },
      { symbol: "RMS", name: "Hermes International", weight: 0.88 },
      { symbol: "TOYOTA", name: "Toyota Motor", weight: 0.85 },
      { symbol: "NVO", name: "Novo Nordisk", weight: 0.84 },
      { symbol: "SAP", name: "SAP SE", weight: 0.83 },
      { symbol: "ROG", name: "Roche Holding", weight: 0.8 },
    ],
  },
} satisfies Record<string, EtfHoldingsProfile>;

type EtfHoldingsSymbol = keyof typeof ETF_TOP_HOLDINGS;

function etfHoldingsRowsTemplate(profile: EtfHoldingsProfile): string {
  const maxWeight = Math.max(...profile.holdings.map((holding) => holding.weight), 1);
  return profile.holdings.map((holding, index) => {
    const barWidth = Math.max((holding.weight / maxWeight) * 100, 2);
    return `<li class="etf-holding-row">
      <div class="etf-holding-copy"><span class="etf-holding-rank">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(holding.symbol)}</strong><span>${escapeHtml(holding.name)}</span><b>${holding.weight.toFixed(2)}%</b></div>
      <div class="etf-holding-track" role="meter" aria-label="${escapeHtml(holding.symbol)} portfolio weight" aria-valuemin="0" aria-valuemax="${maxWeight}" aria-valuenow="${holding.weight}"><i style="width:${barWidth.toFixed(2)}%"></i></div>
    </li>`;
  }).join("");
}

function etfTopHoldingsTemplate(selected: EtfHoldingsSymbol = "VOO"): string {
  const profile = ETF_TOP_HOLDINGS[selected];
  return `<section class="etf-holdings-panel" aria-labelledby="etfHoldingsTitle">
    <header class="etf-holdings-head">
      <div><span class="eyebrow">Fund Composition</span><h3 id="etfHoldingsTitle">Top Holdings</h3></div>
      <div class="etf-holdings-tabs" role="tablist" aria-label="Select ETF holdings">
        ${(Object.keys(ETF_TOP_HOLDINGS) as EtfHoldingsSymbol[]).map((symbol) => `<button class="etf-holdings-tab${symbol === selected ? " active" : ""}" data-etf-holdings="${symbol}" type="button" role="tab" aria-selected="${symbol === selected}">${symbol}</button>`).join("")}
      </div>
    </header>
    <!-- Live fund facts. These the data feed really does publish, so they are
         fetched per symbol; the holdings list below it cannot be, and says so
         rather than letting a dated snapshot pass for current. -->
    <dl id="etfLiveFacts" class="etf-live-facts">
      <div><dt>Expense ratio</dt><dd data-fact="expense">${UNKNOWN}</dd></div>
      <div><dt>Dividend yield</dt><dd data-fact="yield">${UNKNOWN}</dd></div>
      <div><dt>Fund size</dt><dd data-fact="aum">${UNKNOWN}</dd></div>
    </dl>
    <div id="etfSectors" class="etf-sectors" hidden></div>
    <div class="etf-holdings-summary" aria-live="polite"><span><strong id="etfHoldingsSymbol">${selected}</strong> · Top Holdings <b id="etfHoldingsTotal">${profile.topHoldingsTotalPercent}</b></span><small id="etfHoldingsDateWrap">Holdings as at <time id="etfHoldingsDate">${profile.updateDate}</time> · fixed snapshot, not live</small></div>
    <ol id="etfHoldingsList" class="etf-holdings-list">${etfHoldingsRowsTemplate(profile)}</ol>
  </section>`;
}

function marketTemplate(state: WealthState): string {
  const tabs = [
    { id: "chart", label: "Long-term view", icon: "" },
    { id: "pnl", label: "Your position", icon: "" },
    { id: "risk", label: "Risk", icon: "" },
    { id: "dividends", label: "Income", icon: "" },
    { id: "sectors", label: "Composition", icon: "" },
    { id: "compare", label: "Compare", icon: "" },
    { id: "calendar", label: "Context", icon: "" },
  ];

  const tabButtons = tabs.map((t, i) =>
    '<button class="market-tab-btn' + (i === 0 ? ' active' : '') + '" data-tab="' + t.id + '" type="button">' + t.label + '</button>'
  ).join("");

  return `
    <section class="market-hero card">
      <div><span class="eyebrow">Investment Intelligence</span><h3>Research with a long-term lens</h3><p>Use market information to understand ownership, risk and valuation—not to react to daily noise.</p></div>
      <div class="market-principle"><span>Current principle</span><strong>Context before action</strong><small>Review the mandate before changing allocation.</small></div>
    </section>

    <div class="market-toolbar">
      <div class="market-symbols" role="group" aria-label="Select investment">
        <button class="market-symbol-btn active" data-symbol="VOO" type="button"><strong>VOO</strong><small>Core market</small></button>
        <button class="market-symbol-btn" data-symbol="QQQM" type="button"><strong>QQQM</strong><small>Growth allocation</small></button>
        ${state.customTickers.map((ticker) => '<div class="market-custom-symbol" data-symbol="' + escapeHtml(ticker) + '"><button class="market-symbol-btn" data-symbol="' + escapeHtml(ticker) + '" type="button"><strong>' + escapeHtml(ticker) + '</strong><small>Custom watchlist</small></button><button class="market-symbol-remove" data-remove-symbol="' + escapeHtml(ticker) + '" type="button" aria-label="Remove ' + escapeHtml(ticker) + '">×</button></div>').join("")}
      </div>
      <form id="customSymbolForm" class="market-custom-form"><label for="customSymbolInput">Add symbol</label><div><input id="customSymbolInput" name="symbol" type="text" maxlength="20" placeholder="e.g. AAPL" autocomplete="off" spellcheck="false"><button class="secondary-button" type="submit">Add</button></div><small id="customSymbolMessage" class="market-custom-message" aria-live="polite"></small></form>
      <span class="market-data-note">Market data may be delayed</span>
    </div>

    <div class="market-tabs" role="tablist" aria-label="Market research views">
      ${tabButtons}
    </div>

    <!-- Chart Tab -->
    <div class="market-tab-content active" data-tab-content="chart">
      <div class="market-view-head"><div><span class="eyebrow">Price Context</span><h3>Historical perspective</h3></div><div class="market-intervals" role="group" aria-label="Chart period">
        <button class="interval-btn" data-interval="D" type="button">1D</button>
        <button class="interval-btn" data-interval="W" type="button">1W</button>
        <button class="interval-btn" data-interval="M" type="button">1M</button>
        <button class="interval-btn" data-interval="5" type="button">YTD</button>
        <button class="interval-btn active" data-interval="12M" type="button">1Y</button>
        <button class="interval-btn" data-interval="60M" type="button">5Y</button>
      </div></div>
      <article class="card market-chart-card">
        <div id="tradingview_container" style="width:100%;height:520px;"></div>
      </article>
    </div>

    <!-- P&L Tab -->
    <div class="market-tab-content" data-tab-content="pnl">
      <div id="pnlPanel" style="display:none;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
          <div class="card" style="padding:12px;text-align:center;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:2px;">💰 Invested USD</div>
            <div id="pnl-invested" style="font-size:16px;font-weight:700;">--</div>
          </div>
          <div class="card" style="padding:12px;text-align:center;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:2px;">📊 Units</div>
            <div id="pnl-units" style="font-size:16px;font-weight:700;">--</div>
          </div>
          <div class="card" style="padding:12px;text-align:center;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:2px;">💵 Avg Cost</div>
            <div id="pnl-cost" style="font-size:16px;font-weight:700;">--</div>
          </div>
          <div class="card" style="padding:12px;text-align:center;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:2px;">📈 Market Value</div>
            <div id="pnl-value" style="font-size:16px;font-weight:700;">--</div>
          </div>
          <div class="card" style="padding:12px;text-align:center;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:2px;">🟢🔴 P&L</div>
            <div id="pnl-amount" style="font-size:16px;font-weight:700;">--</div>
            <div id="pnl-pct" style="font-size:12px;font-weight:600;">--</div>
          </div>
          <div class="card" style="padding:12px;text-align:center;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:2px;">💸 Fees</div>
            <div id="pnl-fees" style="font-size:16px;font-weight:700;">--</div>
          </div>
        </div>
        <div id="pnl-trades-list" style="margin-top:10px;"></div>
      </div>
      <div id="pnl-empty" style="text-align:center;padding:40px;color:var(--ink-3);">No trades for this ticker</div>
      <div id="tradeTimeline" style="margin-top:16px;"></div>
    </div>

    <!-- Risk Tab -->
    <div class="market-tab-content" data-tab-content="risk">
      <div id="riskContent" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
        <div class="card" style="padding:16px;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📉 Max Drawdown</div>
          <div id="risk-drawdown" style="font-size:24px;font-weight:700;">--</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:4px;">From peak to trough</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📊 Sharpe Ratio</div>
          <div id="risk-sharpe" style="font-size:24px;font-weight:700;">--</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:4px;">Risk-adjusted return</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">🎯 Portfolio Beta</div>
          <div id="risk-beta" style="font-size:24px;font-weight:700;">--</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:4px;">vs S&P 500</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📐 Volatility</div>
          <div id="risk-volatility" style="font-size:24px;font-weight:700;">--</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:4px;">Annualized σ</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">🔄 Current Drawdown</div>
          <div id="risk-current-dd" style="font-size:24px;font-weight:700;">--</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:4px;">From all-time high</div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📅 Win Rate</div>
          <div id="risk-winrate" style="font-size:24px;font-weight:700;">--</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:4px;">Positive months</div>
        </div>
      </div>
    </div>

    <!-- Dividends Tab -->
    <div class="market-tab-content" data-tab-content="dividends">
      <div id="dividendsContent">
        <p id="div-source" class="ov-detail-row__note" style="margin:0 0 10px;"></p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;">
          <div class="card" style="padding:16px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">💰 Dividend Yield</div>
            <div id="div-yield" style="font-size:24px;font-weight:700;">--</div>
          </div>
          <div class="card" style="padding:16px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📅 Frequency</div>
            <div id="div-frequency" style="font-size:24px;font-weight:700;">--</div>
          </div>
          <div class="card" style="padding:16px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">💵 Annual Dividend</div>
            <div id="div-annual" style="font-size:24px;font-weight:700;">--</div>
          </div>
          <div class="card" style="padding:16px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📊 P/E Ratio</div>
            <div id="div-pe" style="font-size:24px;font-weight:700;">--</div>
          </div>
        </div>
        <div class="card" style="padding:16px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:12px;">Recent Dividend History</div>
          <div id="div-history"></div>
        </div>
      </div>
    </div>

    <!-- Sectors Tab -->
    <div class="market-tab-content" data-tab-content="sectors">
      <div id="sectorsContent">
        ${etfTopHoldingsTemplate()}
      </div>
    </div>

    <!-- Compare Tab -->
    <div class="market-tab-content" data-tab-content="compare">
      <div id="compareContent" class="stock-compare">
        <div class="compare-intro"><span class="eyebrow">Asset Comparison</span><h3>Your holdings, side by side</h3><p>Every asset you hold or watch, in one view. Fees, yields and fund sizes are fetched live; the descriptive rows are editorial and say what each instrument is for.</p></div>
        <div id="compareProfiles"></div>
        <div id="compareMatrix"></div>
      </div>
    </div>

    <!-- Calendar Tab -->
    <div class="market-tab-content" data-tab-content="calendar">
      <div id="calendarContent">
        <div class="card ctx-card">
          <div class="ctx-head">
            <div><span class="eyebrow">Historical Context</span><h3>How this has fallen before</h3></div>
            <span class="ctx-range" id="ctxRange">—</span>
          </div>
          <p class="ctx-lede">Every decline of 10% or more on record, how long it took to come back, and what holding through it was worth. Computed from daily closes.</p>
          <div id="ctxBody"><p class="empty-state">Loading price history…</p></div>
        </div>
      </div>
    </div>
  `;
}

function bindMarket(root: HTMLElement, state: WealthState, setState: Setter): void {
  let currentSymbol = "VOO";
  // Which fund the Composition panel is showing. Tracked separately because a
  // slow fundamentals response must not paint itself over a fund the user has
  // already moved on from.
  let currentEtfSymbol = "VOO";
  let currentInterval = "12M";
  let customTickers = [...state.customTickers];

  function setCustomSymbolMessage(message: string, isError = false): void {
    const messageEl = root.querySelector<HTMLElement>("#customSymbolMessage");
    if (messageEl) {
      messageEl.textContent = message;
      messageEl.classList.toggle("error", isError);
    }
  }

  /** Percent from a 0..1 weight, at the precision holdings are published in. */
  const weightText = (weight: number): string => (weight * 100).toFixed(2) + "%";

  /** The provider keys sectors in snake_case; these are the names people use. */
  const SECTOR_LABELS: Record<string, string> = {
    realestate: "Real estate", consumer_cyclical: "Consumer cyclical",
    basic_materials: "Basic materials", consumer_defensive: "Consumer defensive",
    technology: "Technology", communication_services: "Communication services",
    financial_services: "Financial services", utilities: "Utilities",
    industrials: "Industrials", energy: "Energy", healthcare: "Healthcare",
  };

  function renderSectors(sectors: Array<{ sector: string; weight: number }>): void {
    const host = root.querySelector<HTMLElement>("#etfSectors");
    if (!host) return;
    if (sectors.length === 0) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    const widest = sectors[0].weight || 1;
    host.innerHTML = '<div class="etf-sectors-head">Sector weights</div>'
      + sectors.map((entry) =>
        '<div class="etf-sector-row"><span>' + escapeHtml(SECTOR_LABELS[entry.sector] ?? entry.sector)
        + '</span><i style="width:' + Math.max(2, (entry.weight / widest) * 100).toFixed(1) + '%"></i>'
        + '<b>' + weightText(entry.weight) + '</b></div>').join("");
  }

  /**
   * Fill the live half of the Composition panel.
   *
   * Fee, yield and fund size come from one provider; holdings and sector
   * weights from another, which needs a session the server opens on our behalf.
   * A fund that answers neither keeps the hand-typed snapshot, clearly
   * labelled, rather than showing an empty panel.
   */
  function loadEtfLiveFacts(symbol: string): void {
    const facts = root.querySelector<HTMLElement>("#etfLiveFacts");
    if (!facts) return;
    const set = (key: string, value: string) => {
      const cell = facts.querySelector<HTMLElement>('[data-fact="' + key + '"]');
      if (cell) cell.textContent = value;
    };
    set("expense", UNKNOWN);
    set("yield", UNKNOWN);
    set("aum", UNKNOWN);
    const requested = symbol;
    void fetchFundamentals(symbol).then((data) => {
      // A slow response for a symbol the user has already navigated away from
      // must not overwrite the one now on screen.
      if (!data || requested !== currentEtfSymbol) return;
      set("expense", fundPercentOrDash(data.expenseRatio));
      set("yield", fundPercentOrDash(data.dividendYield));
      set("aum", fundSize(data.totalAssets));
    }).catch(() => { /* dashes stand */ });
  }

  function loadEtfComposition(symbol: string): void {
    const list = root.querySelector<HTMLOListElement>("#etfHoldingsList");
    const totalEl = root.querySelector<HTMLElement>("#etfHoldingsTotal");
    const dateWrap = root.querySelector<HTMLElement>("#etfHoldingsDateWrap");
    const requested = symbol;
    void fetchEtfComposition(symbol).then((composition) => {
      if (requested !== currentEtfSymbol) return;
      // Nothing published for this symbol: whatever is already on screen — the
      // dated snapshot, or the "none on file" note — is the honest answer.
      if (!composition) {
        if (!(symbol in ETF_TOP_HOLDINGS) && list) {
          if (dateWrap) dateWrap.textContent = "";
          list.innerHTML = '<li class="etf-holdings-empty">No holdings published for '
            + escapeHtml(symbol) + '. Single companies do not have any; the figures above are live.</li>';
        }
        return;
      }
      renderSectors(composition.sectors);
      if (!list || composition.holdings.length === 0) return;
      const total = composition.holdings.reduce((sum, holding) => sum + holding.weight, 0);
      if (totalEl) totalEl.textContent = weightText(total);
      if (dateWrap) dateWrap.textContent = "Live, from the fund's latest published holdings";
      const widest = composition.holdings[0].weight || 1;
      list.innerHTML = composition.holdings.map((holding, index) =>
        '<li><span class="etf-rank">' + String(index + 1).padStart(2, "0") + '</span>'
        + '<span class="etf-ticker">' + escapeHtml(holding.symbol) + '</span>'
        + '<span class="etf-name">' + escapeHtml(holding.name) + '</span>'
        + '<span class="etf-weight">' + weightText(holding.weight) + '</span>'
        + '<span class="etf-bar"><i style="width:' + Math.min(100, (holding.weight / widest) * 100).toFixed(1) + '%"></i></span>'
        + '</li>').join("");
    }).catch(() => { /* whatever is on screen stands */ });
  }

  function selectEtfHoldings(symbol: string): void {
    const profile = (ETF_TOP_HOLDINGS as Record<string, EtfHoldingsProfile | undefined>)[symbol];
    const list = root.querySelector<HTMLOListElement>("#etfHoldingsList");
    const symbolEl = root.querySelector<HTMLElement>("#etfHoldingsSymbol");
    const totalEl = root.querySelector<HTMLElement>("#etfHoldingsTotal");
    const dateEl = root.querySelector<HTMLTimeElement>("#etfHoldingsDate");
    const dateWrap = root.querySelector<HTMLElement>("#etfHoldingsDateWrap");
    if (!list || !symbolEl || !totalEl) return;

    currentEtfSymbol = symbol;
    root.querySelectorAll<HTMLButtonElement>(".etf-holdings-tab").forEach((button) => {
      const active = button.dataset.etfHoldings === symbol;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    symbolEl.textContent = symbol;
    renderSectors([]);
    loadEtfLiveFacts(symbol);

    // Paint what is known synchronously so the panel is never blank while the
    // network answers; live data replaces it a moment later.
    if (profile) {
      totalEl.textContent = profile.topHoldingsTotalPercent;
      if (dateWrap && dateEl) {
        dateWrap.textContent = "";
        dateWrap.append("Holdings as at ", dateEl, " · fixed snapshot, not live");
        dateEl.textContent = profile.updateDate;
      }
      list.innerHTML = etfHoldingsRowsTemplate(profile);
    } else {
      totalEl.textContent = UNKNOWN;
      if (dateWrap) dateWrap.textContent = "Fetching published holdings…";
      list.innerHTML = '<li class="etf-holdings-empty">Loading holdings for '
        + escapeHtml(symbol) + '…</li>';
    }
    loadEtfComposition(symbol);
  }

  function selectSymbol(btn: HTMLButtonElement): void {
    currentSymbol = btn.dataset.symbol || "VOO";
    root.querySelectorAll<HTMLButtonElement>(".market-symbol-btn").forEach((button) => {
      const active = button === btn;
      button.classList.toggle("active", active);
      button.style.borderColor = active ? "var(--green)" : "var(--line)";
      button.style.background = active ? "var(--green-dim)" : "var(--surface)";
      button.style.color = active ? "var(--green)" : "var(--ink)";
    });
    createWidget(currentSymbol, currentInterval);
    updatePnL(currentSymbol);
    updateTimeline(currentSymbol);
    updateStaticForSymbol(currentSymbol);
    selectEtfHoldings(currentSymbol);
    loadContext(currentSymbol);
    loadDividends(currentSymbol);
    loadRisk(currentSymbol);
  }

  function createCustomSymbolElement(symbol: string): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "market-custom-symbol";
    item.dataset.symbol = symbol;

    const symbolButton = document.createElement("button");
    symbolButton.className = "market-symbol-btn";
    symbolButton.dataset.symbol = symbol;
    symbolButton.type = "button";

    const symbolName = document.createElement("strong");
    symbolName.textContent = symbol;
    const symbolDescription = document.createElement("small");
    symbolDescription.textContent = "Custom watchlist";
    symbolButton.append(symbolName, symbolDescription);
    symbolButton.addEventListener("click", () => selectSymbol(symbolButton));

    const removeButton = document.createElement("button");
    removeButton.className = "market-symbol-remove";
    removeButton.dataset.removeSymbol = symbol;
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", "Remove " + symbol);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => removeCustomSymbol(symbol, item));

    item.append(symbolButton, removeButton);
    return item;
  }

  function removeCustomSymbol(symbol: string, item: HTMLElement): void {
    customTickers = customTickers.filter((ticker) => ticker !== symbol);
    setState({ ...state, customTickers }, "Remove market symbol");
    item.remove();

    if (currentSymbol === symbol) {
      const fallbackButton = root.querySelector<HTMLButtonElement>('.market-symbol-btn[data-symbol="VOO"]');
      if (fallbackButton) selectSymbol(fallbackButton);
    }
    setCustomSymbolMessage(symbol + " removed.");
  }

  function createWidget(symbol: string, interval: string) {
    const container = root.querySelector<HTMLElement>("#tradingview_container");
    if (!container) return;
    container.innerHTML = "";

    const isDark = getTheme() === "dark";
    const rangeMap: Record<string, string> = { "D": "1D", "W": "1W", "M": "1M", "5": "YTD", "12M": "12M", "60M": "60M" };
    const intervalMap: Record<string, string> = { "D": "D", "W": "W", "M": "M", "5": "D", "12M": "W", "60M": "M" };

    const widgetConfig = {
      autosize: true,
      symbol: symbol,
      interval: intervalMap[interval] || "D",
      range: rangeMap[interval] || "1D",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: isDark ? "dark" : "light",
      style: "1",
      locale: "en",
      hide_volume: true,
      allow_symbol_change: true,
      hide_side_toolbar: true,
      withdateranges: true,
      details: false,
      studies: [],
      container_id: "tradingview_container",
    };

    // @ts-expect-error TradingView global
    if (typeof window.TradingView !== "undefined") {
      // @ts-expect-error TradingView global
      new window.TradingView.widget(widgetConfig);
    } else {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = () => {
        // @ts-expect-error TradingView global
        new window.TradingView.widget(widgetConfig);
      };
      document.head.appendChild(script);
    }
  }

  // Update P&L panel
  function updatePnL(symbol: string) {
    const pnlPanel = root.querySelector<HTMLElement>("#pnlPanel");
    const pnlEmpty = root.querySelector<HTMLElement>("#pnl-empty");
    const hasTrades = state.trades.some((t) => t.ticker === symbol);
    if (!hasTrades) {
      if (pnlPanel) pnlPanel.style.display = "none";
      if (pnlEmpty) pnlEmpty.style.display = "";
      return;
    }
    if (pnlPanel) pnlPanel.style.display = "";
    if (pnlEmpty) pnlEmpty.style.display = "none";

    // Valuation comes from the canonical portfolio snapshot, which is the only
    // place that turns a live price into a market value. This panel renders;
    // it does not calculate. A holding with no usable price stays unknown --
    // never zero, which would report a total loss that did not happen.
    const holding = getHolding(getPortfolioSnapshot(state, new Date(), livePriceInputs()), symbol as Ticker);
    const valued = holding?.marketValueUsd != null;
    const pnlUsd = holding?.unrealizedPnlUsd ?? null;
    const isProfit = (pnlUsd ?? 0) >= 0;
    const color = isProfit ? "var(--green)" : "var(--red)";
    const sign = isProfit ? "+" : "−";
    const UNKNOWN = "--";

    const el = (id: string) => root.querySelector<HTMLElement>(id);
    const setT = (id: string, v: string) => { const e = el(id); if (e) e.textContent = v; };
    const setC = (id: string, c: string) => { const e = el(id); if (e) e.style.color = c; };

    // Recorded facts — always known, shown whether or not a price exists.
    setT("#pnl-invested", "USD " + (holding?.investedUsd ?? 0).toFixed(2));
    setT("#pnl-units", (holding?.units ?? 0).toFixed(4));
    setT("#pnl-cost", "USD " + (holding?.averageCostUsd ?? 0).toFixed(2));
    setT("#pnl-fees", "MYR " + (holding?.feesMyr ?? 0).toFixed(2));

    // Live facts — unknown until a real quote arrives.
    setT("#pnl-value", valued ? "USD " + holding!.marketValueUsd!.toFixed(2) : UNKNOWN);
    setT("#pnl-amount", pnlUsd !== null ? sign + "USD " + Math.abs(pnlUsd).toFixed(2) : UNKNOWN);
    setC("#pnl-amount", pnlUsd !== null ? color : "");
    setT("#pnl-pct", holding?.unrealizedPnlPercent != null
      ? sign + (Math.abs(holding.unrealizedPnlPercent) * 100).toFixed(2) + "%"
      : UNKNOWN);
    setC("#pnl-pct", holding?.unrealizedPnlPercent != null ? color : "");

    // Trade list
    const tradeListEl = el("#pnl-trades-list");
    if (tradeListEl) {
      const tradesForTicker = tradesWithExchangeCost(state.trades, state.currencyExchanges ?? []).filter((t) => t.ticker === symbol);
      const rows = tradesForTicker.map((t) => {
        const isBuy = t.type !== "Sell";
        const units = tradeUnits(t).toFixed(4);
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--surface);border-radius:6px;margin-bottom:4px;font-size:12px;">' +
          '<span style="display:flex;gap:8px;align-items:center;">' +
            '<span style="color:' + (isBuy ? 'var(--green)' : 'var(--red)') + ';font-weight:700;width:20px;">' + (isBuy ? '↑' : '↓') + '</span>' +
            '<span>' + escapeHtml(t.date) + '</span>' +
            '<span style="color:var(--ink-3);">' + t.type + '</span>' +
          '</span>' +
          '<span>' + units + ' units @ $' + t.priceUsd.toFixed(2) + '</span>' +
        '</div>';
      }).join("");
      tradeListEl.innerHTML = rows ? '<div style="font-size:12px;color:var(--ink-3);margin-bottom:6px;font-weight:600;">Trade Details — ' + symbol + '</div>' + rows : "";
    }
  }

  // Update trade timeline
  function updateTimeline(symbol: string) {
    const timelineEl = root.querySelector<HTMLElement>("#tradeTimeline");
    if (!timelineEl) return;
    const hasTrades = state.trades.some((t) => t.ticker === symbol);
    if (!hasTrades) {
      timelineEl.innerHTML = "";
      return;
    }
    timelineEl.innerHTML = buildTradeTimelineHtml(tradesWithExchangeCost(state.trades, state.currencyExchanges ?? []), symbol, 0);
  }

  // Populate static data for tabs
  function populateStaticData() {
    // Risk tab — use known data for VOO/QQQM
    const riskData: Record<string, { maxDD: string; sharpe: string; beta: string; vol: string; currentDD: string; winRate: string }> = {
      VOO: { maxDD: "-33.9%", sharpe: "1.02", beta: "1.00", vol: "15.2%", currentDD: "-2.1%", winRate: "78%" },
      QQQM: { maxDD: "-35.1%", sharpe: "0.95", beta: "1.15", vol: "19.8%", currentDD: "-3.4%", winRate: "75%" },
    };

    // Dividends tab
    const divData: Record<string, { yield: string; freq: string; annual: string; pe: string }> = {
      VOO: { yield: "1.32%", freq: "Quarterly", annual: "$6.84", pe: "24.5" },
      QQQM: { yield: "0.58%", freq: "Quarterly", annual: "$1.69", pe: "32.1" },
    };
    const divHistory: Record<string, { date: string; amount: string }[]> = {
      VOO: [
        { date: "2026-06-28", amount: "$1.71" },
        { date: "2026-03-28", amount: "$1.68" },
        { date: "2025-12-27", amount: "$1.65" },
        { date: "2025-09-26", amount: "$1.62" },
      ],
      QQQM: [
        { date: "2026-06-28", amount: "$0.42" },
        { date: "2026-03-28", amount: "$0.40" },
        { date: "2025-12-27", amount: "$0.39" },
        { date: "2025-09-26", amount: "$0.38" },
      ],
    };

    function updateForSymbol(sym: string) {
      // Risk
      const rd = riskData[sym] || riskData.VOO;
      const setT = (id: string, v: string) => { const e = root.querySelector<HTMLElement>(id); if (e) e.textContent = v; };
      setT("#risk-drawdown", rd.maxDD);
      setT("#risk-sharpe", rd.sharpe);
      setT("#risk-beta", rd.beta);
      setT("#risk-volatility", rd.vol);
      setT("#risk-current-dd", rd.currentDD);
      setT("#risk-winrate", rd.winRate);

      // Dividends
      const dd = divData[sym] || divData.VOO;
      setT("#div-yield", dd.yield);
      setT("#div-frequency", dd.freq);
      setT("#div-annual", dd.annual);
      setT("#div-pe", dd.pe);

      const historyEl = root.querySelector<HTMLElement>("#div-history");
      if (historyEl) {
        const dh = divHistory[sym] || divHistory.VOO;
        historyEl.innerHTML = dh.map((d) =>
          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;">' +
            '<span>' + d.date + '</span><span style="font-weight:600;">' + d.amount + '</span></div>'
        ).join("");
      }

    }

    return updateForSymbol;
  }

  const updateStaticForSymbol = populateStaticData();
  type StaticComparisonAsset = {
    symbol: string;
    name: string;
    category: string;
    exposure: string;
    role: string;
    risk: string;
    diversification: string;
    income: string;
    fit: string;
    accent: string;
    referenceSnapshot?: string;
  };

  const comparisonAssets: StaticComparisonAsset[] = [
    { symbol: "VOO", name: "Vanguard S&P 500 ETF", category: "US large-cap equity ETF", exposure: "The 500 largest US listed companies, weighted by market value.", role: "Core holding", risk: "US market risk, concentrated in the largest few names", diversification: "500 companies across every US sector", income: "Quarterly dividends, reinvested by hand", fit: "The long-term base a portfolio is built around", accent: "green" },
    { symbol: "QQQM", name: "Invesco NASDAQ 100 ETF", category: "US growth equity ETF", exposure: "The 100 largest non-financial companies on the Nasdaq, tilted to technology.", role: "Growth satellite", risk: "Sector concentration — a technology drawdown hits it harder than the market", diversification: "100 companies, heavily weighted to a handful of technology names", income: "Quarterly dividends, small relative to price", fit: "Add growth on top of a broad core, in a size you can sit through", accent: "blue" },
    { symbol: "VXUS", name: "Vanguard Total International Stock ETF", category: "Global ex-US equity ETF", exposure: "Developed and emerging-market equities outside the United States.", role: "International diversifier", risk: "Market, currency and emerging-market exposure", diversification: "Broad developed and emerging ex-US markets", income: "Quarterly dividends, the largest of the three", fit: "Reduce reliance on a single US equity market", accent: "gold", referenceSnapshot: "P/E 14.5 · P/B 1.7 · High liquidity · Moderate-to-low growth with valuation-recovery potential" },
    { symbol: "AAPL", name: "Apple Inc.", category: "Single US company", exposure: "Consumer devices, services and a global hardware ecosystem.", role: "Concentrated satellite", risk: "Company-specific", diversification: "Single issuer", income: "Quarterly dividends", fit: "High-conviction position", accent: "red" },
  ];

  /**
   * Live figures for the compared assets, by symbol.
   *
   * Empty until the fetch lands. Every cell that reads from it degrades to a
   * dash rather than to a stale hard-coded number — a wrong expense ratio is
   * worse than an absent one, because it looks authoritative.
   */
  const comparisonLive = new Map<string, Fundamentals>();

  /** The symbols actually being compared: the plan's targets plus the watchlist. */
  function comparisonSymbols(): string[] {
    return [...new Set([
      ...Object.keys(state.dca.targets),
      ...customTickers,
    ])].filter(Boolean);
  }

  /** A fund-only ratio: absent or zero means the concept does not apply here,
   *  which is the honest answer for a single company's "expense ratio". */
  const fundPercentOrDash = (value: number | undefined, digits = 2): string =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? `${(value * 100).toFixed(digits)}%`
      : UNKNOWN;

  /** Fund size in the units people actually say out loud. */
  function fundSize(value: number | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return UNKNOWN;
    if (value >= 1e12) return `USD ${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `USD ${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `USD ${(value / 1e6).toFixed(0)}M`;
    return `USD ${value.toFixed(0)}`;
  }

  function renderStaticComparison(): void {
    const profiles = root.querySelector<HTMLElement>("#compareProfiles");
    const matrix = root.querySelector<HTMLElement>("#compareMatrix");
    if (!profiles || !matrix) return;

    // Driven by what the user actually holds and watches, not a fixed four.
    // Editorial copy exists for the assets we have written about; anything else
    // still appears, carrying its live figures and blanks where prose is owed.
    const symbols = comparisonSymbols();
    const assets: StaticComparisonAsset[] = symbols.map((symbol) =>
      comparisonAssets.find((asset) => asset.symbol === symbol)
      ?? {
        // Live figures still fill this column; the prose rows stay blank rather
        // than inventing a description of an instrument nobody has written up.
        symbol,
        name: "Not yet described",
        category: UNKNOWN, exposure: UNKNOWN, role: UNKNOWN, risk: UNKNOWN,
        diversification: UNKNOWN, income: UNKNOWN, fit: UNKNOWN,
        accent: "neutral",
      });
    if (assets.length === 0) return;

    profiles.innerHTML = '<div class="compare-profiles">' + assets.map((asset) => {
      const live = comparisonLive.get(asset.symbol);
      const fee = fundPercentOrDash(live?.expenseRatio);
      return '<article class="compare-profile compare-profile-' + asset.accent + '">'
        + '<div class="compare-profile-head"><span class="compare-symbol">' + escapeHtml(asset.symbol) + '</span>'
        + '<span class="compare-name">' + escapeHtml(asset.name) + '</span></div>'
        + '<p>' + escapeHtml(asset.exposure) + '</p>'
        + '<div class="compare-profile-live"><span>Ongoing fee</span><strong>' + fee + '</strong></div>'
        + '</article>';
    }).join("") + '</div>';

    // Rows split into two kinds. The editorial ones describe what an instrument
    // is for and cannot come from an API. The live ones are numbers a data feed
    // owns, and were previously frozen prose — "0.07%" for VXUS, "yield about
    // 3.0%" — which quietly went stale and disagreed with the Income tab.
    const rows: Array<{ label: string; description: string; live?: true; value: (asset: StaticComparisonAsset) => string }> = [
      { label: "Structure", description: "What you own", value: (asset) => asset.category },
      { label: "Primary exposure", description: "Main source of return", value: (asset) => asset.exposure },
      { label: "Portfolio role", description: "How it can be used", value: (asset) => asset.role },
      { label: "Risk profile", description: "Main concentration trade-off", value: (asset) => asset.risk },
      { label: "Ongoing fund fee", description: "Expense ratio, live", live: true,
        value: (asset) => fundPercentOrDash(comparisonLive.get(asset.symbol)?.expenseRatio) },
      { label: "Dividend yield", description: "Trailing, live", live: true,
        value: (asset) => fundPercentOrDash(comparisonLive.get(asset.symbol)?.dividendYield) },
      { label: "Fund size", description: "Assets under management, live", live: true,
        value: (asset) => fundSize(comparisonLive.get(asset.symbol)?.totalAssets) },
      { label: "Diversification", description: "Breadth of holdings", value: (asset) => asset.diversification },
      { label: "Income treatment", description: "How distributions are handled", value: (asset) => asset.income },
      { label: "Typical fit", description: "Most natural use case", value: (asset) => asset.fit },
    ];

    const headers = assets.map((asset) =>
      '<th scope="col"><strong>' + escapeHtml(asset.symbol) + '</strong><span>' + escapeHtml(asset.name) + '</span></th>').join("");
    const body = rows.map((row) =>
      '<tr' + (row.live ? ' class="compare-row-live"' : '') + '>'
      + '<th scope="row"><strong>' + row.label + '</strong><span>' + row.description + '</span></th>'
      + assets.map((asset) => '<td>' + escapeHtml(row.value(asset)) + '</td>').join("")
      + '</tr>').join("");

    const anyLive = assets.some((asset) => comparisonLive.has(asset.symbol));
    matrix.innerHTML = '<div class="compare-context"><strong>Different instruments, different jobs</strong>'
      + '<span>' + (anyLive
        ? 'Fees, yields and fund sizes are fetched live. The descriptive rows are editorial and do not change with the market.'
        : 'Live figures have not arrived yet — the descriptive rows below are editorial and do not depend on them.')
      + '</span></div>'
      + '<div class="compare-table-wrap"><table class="compare-table"><thead><tr><th scope="col">Measure</th>' + headers + '</tr></thead>'
      + '<tbody>' + body + '</tbody></table></div>';
  }

  /** Fetch the live half of the comparison, then repaint it. */
  function loadComparisonFundamentals(): void {
    const symbols = comparisonSymbols();
    if (symbols.length === 0) return;
    void Promise.all(symbols.map(async (symbol) => {
      try {
        const data = await fetchFundamentals(symbol);
        if (data) comparisonLive.set(symbol, data);
      } catch { /* a missing feed leaves that column dashed, never stale */ }
    })).then(() => renderStaticComparison());
  }

  /**
   * Historical context for one asset: its declines, and what sitting through
   * them was worth.
   *
   * This tab used to hold a hand-typed calendar of CPI and FOMC dates, which is
   * an odd thing for a page whose own header asks the reader not to react to
   * daily noise. What a monthly buyer actually needs to know is that declines
   * are frequent, that they end, and roughly how long that takes.
   */
  function loadContext(symbol: string): void {
    const body = root.querySelector<HTMLElement>("#ctxBody");
    const range = root.querySelector<HTMLElement>("#ctxRange");
    if (!body) return;
    const requested = symbol;
    body.innerHTML = '<p class="empty-state">Loading price history for ' + escapeHtml(symbol) + '…</p>';
    if (range) range.textContent = "—";

    void fetchHistoricalPrices(symbol, "10y").then((prices) => {
      if (requested !== currentSymbol) return;
      const history = buildAssetHistory(
        prices.map((point) => ({ time: Date.parse(point.date), close: point.close })),
        { threshold: 0.10, holdingYears: [1, 3, 5] },
      );
      if (!history) {
        body.innerHTML = '<p class="empty-state">Not enough price history for ' + escapeHtml(symbol) + ' yet.</p>';
        return;
      }
      renderContext(history, body, range);
    }).catch(() => {
      if (requested !== currentSymbol) return;
      body.innerHTML = '<p class="empty-state">Could not load price history. The other tabs are unaffected.</p>';
    });
  }

  function renderContext(history: AssetHistory, body: HTMLElement, range: HTMLElement | null): void {
    const pct = (value: number, digits = 1) => (value * 100).toFixed(digits) + "%";
    const when = (time: number) => new Date(time).toISOString().slice(0, 7);
    const months = (days: number) => days >= 60 ? " (" + (days / 30.44).toFixed(1) + " months)" : "";

    if (range) {
      range.textContent = when(history.firstAt) + " – " + when(history.lastAt)
        + " · " + history.observations.toLocaleString("en-MY") + " trading days";
    }

    const standing = history.currentDrawdown < -0.001
      ? '<div class="ctx-standing ctx-standing--down"><span>Right now</span><strong>'
        + pct(history.currentDrawdown) + ' below its high</strong></div>'
      : '<div class="ctx-standing"><span>Right now</span><strong>At or near its high</strong></div>';

    // Declines, worst first: the deepest one is the question people actually
    // have, not the most recent.
    const worstFirst = [...history.drawdowns].sort((a, b) => a.depth - b.depth);
    const rows = worstFirst.map((item) => {
      const recovery = item.daysToRecover === null
        ? '<b class="ctx-open">still recovering</b>'
        : '<b>' + item.daysToRecover + ' days' + months(item.daysToRecover) + '</b>';
      return '<tr><td>' + when(item.startedAt) + '</td>'
        + '<td class="ctx-depth">' + pct(item.depth) + '</td>'
        + '<td>' + item.daysToTrough + ' days</td>'
        + '<td>' + recovery + '</td></tr>';
    }).join("");

    const declines = history.drawdowns.length === 0
      ? '<p class="empty-state">No decline of 10% or more in this period.</p>'
      : '<div class="compare-table-wrap"><table class="ctx-table"><thead><tr>'
        + '<th scope="col">Peak</th><th scope="col">Depth</th><th scope="col">To bottom</th><th scope="col">Back to even</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table></div>';

    // Holding outcomes. The loss rate is the line that matters, so it leads.
    const outcomes = history.outcomes.map((outcome) =>
      '<div class="ctx-outcome"><span>Held ' + outcome.years + (outcome.years === 1 ? ' year' : ' years') + '</span>'
      + '<strong>' + pct(outcome.lossRate) + ' of start dates ended down</strong>'
      + '<small>worst ' + pct(outcome.worst) + ' · median ' + pct(outcome.median) + ' · best ' + pct(outcome.best) + '</small></div>').join("");

    // The user's own tranche thresholds, answered with this asset's record.
    const thresholds = [...new Set(state.opportunity.tranches.map((tranche) => tranche.drawdown / 100))]
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    const triggers = thresholds.map((threshold) => {
      const hit = triggerHistory(history.drawdowns, threshold);
      const recovery = hit.medianRecoveryDays === null
        ? "no completed recovery on record"
        : "median " + hit.medianRecoveryDays + " days back to even";
      return '<div class="ctx-trigger"><span>−' + (threshold * 100).toFixed(0) + '%</span>'
        + '<strong>' + hit.occurrences + (hit.occurrences === 1 ? ' time' : ' times') + '</strong>'
        + '<small>' + recovery + '</small></div>';
    }).join("");

    body.innerHTML = standing
      + '<h4 class="ctx-sub">Declines of 10% or more</h4>' + declines
      + '<h4 class="ctx-sub">What holding through them was worth</h4>'
      + '<div class="ctx-outcomes">' + outcomes + '</div>'
      + (triggers === "" ? "" :
        '<h4 class="ctx-sub">Your reserve triggers, against this record</h4>'
        + '<div class="ctx-triggers">' + triggers + '</div>'
        + '<p class="ctx-foot">Your Opportunity Reserve releases at these depths. How often they have actually been reached is what decides whether that cash is waiting for something common or something rare.</p>');
  }

  // Real risk metrics from Yahoo Finance historical prices
  async function loadRisk(symbol: string) {
    try {
      const setT = (id: string, v: string) => { const e = root.querySelector<HTMLElement>(id); if (e) e.textContent = v; };

      // Show loading state
      setT("#risk-drawdown", "...");
      setT("#risk-sharpe", "...");
      setT("#risk-beta", "...");
      setT("#risk-volatility", "...");
      setT("#risk-current-dd", "...");
      setT("#risk-winrate", "...");

      // Fetch 1y historical prices for symbol and SPY (benchmark)
      const [prices, spyPrices] = await Promise.all([
        fetchHistoricalPrices(symbol, "1y"),
        fetchHistoricalPrices("SPY", "1y"),
      ]);

      const metrics = calcRiskMetrics(prices, spyPrices);

      const pct = (v: number) => (v * 100).toFixed(1) + "%";

      setT("#risk-drawdown", pct(metrics.maxDrawdown));
      const ddEl = root.querySelector<HTMLElement>("#risk-drawdown");
      if (ddEl) ddEl.style.color = "var(--red)";

      setT("#risk-sharpe", metrics.sharpeRatio.toFixed(2));
      const sharpeEl = root.querySelector<HTMLElement>("#risk-sharpe");
      if (sharpeEl) sharpeEl.style.color = metrics.sharpeRatio >= 1 ? "var(--green)" : metrics.sharpeRatio >= 0.5 ? "var(--amber)" : "var(--red)";

      setT("#risk-beta", metrics.beta.toFixed(2));
      const betaEl = root.querySelector<HTMLElement>("#risk-beta");
      if (betaEl) betaEl.style.color = metrics.beta <= 1 ? "var(--green)" : "var(--amber)";

      setT("#risk-volatility", pct(metrics.volatility));
      setT("#risk-current-dd", pct(metrics.currentDrawdown));
      const curDDEl = root.querySelector<HTMLElement>("#risk-current-dd");
      if (curDDEl) curDDEl.style.color = metrics.currentDrawdown < 0 ? "var(--red)" : "var(--green)";

      setT("#risk-winrate", pct(metrics.winRate));
      const winEl = root.querySelector<HTMLElement>("#risk-winrate");
      if (winEl) winEl.style.color = metrics.winRate >= 0.6 ? "var(--green)" : "var(--amber)";

    } catch (err) {
      console.warn("[Market] Failed to load risk metrics for " + symbol, err);
    }
  }

  // Real dividend data from Yahoo Finance
  async function loadDividends(symbol: string) {
    const setT = (id: string, v: string) => { const e = root.querySelector<HTMLElement>(id); if (e) e.textContent = v; };

    // Show loading state
    setT("#div-yield", "...");
    setT("#div-frequency", "...");
    setT("#div-annual", "...");
    setT("#div-pe", "...");

    // Static fallback
    const staticDiv: Record<string, { yield: string; freq: string; annual: string; pe: string; exDiv: string; avgYield: string }> = {
      VOO: { yield: "1.32%", freq: "Quarterly", annual: "$6.84", pe: "24.5", exDiv: "2026-06-27", avgYield: "1.45%" },
      QQQM: { yield: "0.58%", freq: "Quarterly", annual: "$1.69", pe: "32.1", exDiv: "2026-06-27", avgYield: "0.62%" },
    };

    try {
      const fund = await fetchFundamentals(symbol);
      // A zero from this provider means "not reported for this instrument",
      // never "the value is zero" — so each field renders unknown rather than
      // a misleading 0.00%.
      setT("#div-source", "Live data from the market provider.");
      setT("#div-yield", fund.dividendYield > 0 ? (fund.dividendYield * 100).toFixed(2) + "%" : UNKNOWN);
      setT("#div-frequency", fund.dividendFrequency || UNKNOWN);
      setT("#div-annual", fund.dividendRate > 0 ? "$" + fund.dividendRate.toFixed(2) : UNKNOWN);
      setT("#div-pe", fund.trailingPE > 0 ? fund.trailingPE.toFixed(1) : UNKNOWN);

      // Only the rows the provider actually answered. Expense ratio and AUM
      // are reported for ETFs and matter more to a long-term holder than the
      // ex-dividend date this source does not carry.
      const historyEl = root.querySelector<HTMLElement>("#div-history");
      if (historyEl) {
        const row = (label: string, value: string, last = false) =>
          '<div style="display:flex;justify-content:space-between;padding:8px 0;' +
          (last ? "" : "border-bottom:1px solid var(--line);") +
          'font-size:13px;"><span>' + escapeHtml(label) + '</span>' +
          '<span style="font-weight:600;">' + escapeHtml(value) + '</span></div>';
        const rows: string[] = [];
        if (fund.expenseRatio > 0) rows.push(row("Expense ratio", (fund.expenseRatio * 100).toFixed(2) + "%"));
        if (fund.totalAssets > 0) rows.push(row("Fund size (AUM)", "USD " + (fund.totalAssets / 1e9).toFixed(1) + "B"));
        if (fund.exDividendDate) rows.push(row("Next Ex-Dividend", fund.exDividendDate));
        if (fund.trailingAnnualDividendRate > 0) rows.push(row("Annual dividend / share", "$" + fund.trailingAnnualDividendRate.toFixed(2)));
        historyEl.innerHTML = rows.length > 0
          ? rows.join("")
          : '<div class="empty-state">No further fund detail is reported for ' + escapeHtml(symbol) + '.</div>';
      }
    } catch (err) {
      console.warn("[Market] API failed, using static dividend data for " + symbol, err);
      const sd = staticDiv[symbol];
      if (!sd) {
        setT("#div-source", "Dividend data is unavailable for this symbol.");
        setT("#div-yield", "N/A");
        setT("#div-frequency", "N/A");
        setT("#div-annual", "N/A");
        setT("#div-pe", "N/A");
        const historyEl = root.querySelector<HTMLElement>("#div-history");
        if (historyEl) historyEl.innerHTML = '<div class="empty-state">Dividend data is unavailable for ' + escapeHtml(symbol) + '.</div>';
        return;
      }
      setT("#div-yield", sd.yield);
      setT("#div-frequency", sd.freq);
      // These are hardcoded reference figures, not a live reading. The provider
      // endpoint requires an authenticated session and now returns 401 for
      // everyone, so this fallback is what users actually see — saying nothing
      // would present a stale snapshot as today's dividend data.
      setT("#div-source", "Reference snapshot — the live dividend feed is unavailable, so these figures are indicative only and may be out of date.");
      setT("#div-annual", sd.annual);
      setT("#div-pe", sd.pe);
      const historyEl = root.querySelector<HTMLElement>("#div-history");
      if (historyEl) {
        historyEl.innerHTML =
          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;">' +
            '<span>Next Ex-Dividend</span><span style="font-weight:600;">' + sd.exDiv + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;">' +
            '<span>5Y Avg Yield</span><span style="font-weight:600;">' + sd.avgYield + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;">' +
            '<span>Annual Dividend</span><span style="font-weight:600;">' + sd.annual + '</span></div>';
      }
    }
  }

  // Tab switching
  root.querySelectorAll<HTMLButtonElement>(".market-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll<HTMLButtonElement>(".market-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      root.querySelectorAll<HTMLElement>(".market-tab-content").forEach((c) => c.classList.remove("active"));
      const tabId = btn.dataset.tab;
      const content = root.querySelector<HTMLElement>('[data-tab-content="' + tabId + '"]');
      if (content) content.classList.add("active");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".etf-holdings-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.dataset.etfHoldings;
      if (!symbol || !(symbol in ETF_TOP_HOLDINGS)) return;
      selectEtfHoldings(symbol as EtfHoldingsSymbol);
    });
  });

  // Symbol buttons
  root.querySelectorAll<HTMLButtonElement>(".market-symbol-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectSymbol(btn));
  });

  root.querySelectorAll<HTMLButtonElement>(".market-symbol-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const symbol = btn.dataset.removeSymbol;
      const item = btn.closest<HTMLElement>(".market-custom-symbol");
      if (!symbol || !item) return;
      removeCustomSymbol(symbol, item);
    });
  });

  root.querySelector<HTMLFormElement>("#customSymbolForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLInputElement>("#customSymbolInput");
    const symbol = input?.value.trim().toUpperCase() ?? "";
    if (!/^[A-Z0-9._^:-]{1,20}$/.test(symbol)) {
      setCustomSymbolMessage("Use a valid symbol, such as AAPL or BTC-USD.", true);
      return;
    }
    if (symbol === "VOO" || symbol === "QQQM" || customTickers.includes(symbol)) {
      setCustomSymbolMessage(symbol + " is already on the list.", true);
      return;
    }
    if (customTickers.length >= 30) {
      setCustomSymbolMessage("You can save up to 30 custom symbols.", true);
      return;
    }
    customTickers = [...customTickers, symbol];
    setState({ ...state, customTickers }, "Add market symbol");

    const symbols = root.querySelector<HTMLElement>(".market-symbols");
    const item = createCustomSymbolElement(symbol);
    symbols?.appendChild(item);
    if (input) input.value = "";
    setCustomSymbolMessage(symbol + " added.");
    const symbolButton = item.querySelector<HTMLButtonElement>(".market-symbol-btn");
    if (symbolButton) selectSymbol(symbolButton);
  });

  // Interval buttons
  root.querySelectorAll<HTMLButtonElement>(".interval-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentInterval = btn.dataset.interval || "D";
      root.querySelectorAll<HTMLButtonElement>(".interval-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      createWidget(currentSymbol, currentInterval);
    });
  });

  // Initial load
  createWidget(currentSymbol, currentInterval);
  updatePnL(currentSymbol);
  updateTimeline(currentSymbol);
  updateStaticForSymbol(currentSymbol);
  loadDividends(currentSymbol);
  loadRisk(currentSymbol);
  renderStaticComparison();
  loadComparisonFundamentals();
  // The Composition panel ships with the first symbol already selected, so its
  // live figures have to be fetched here too — otherwise the opening view is
  // the only one that never gets any.
  selectEtfHoldings(currentSymbol);
  loadContext(currentSymbol);

  // Quotes arrive asynchronously, and go stale after PRICE_STALE_AFTER_MS if
  // this page stays open. Until a price lands the panel shows "--"; each
  // (re)fetch repaints it with the current quote behind it.
  refreshLivePrices(state, () => updatePnL(currentSymbol));
  const marketPriceTimer = setInterval(() => refreshLivePrices(state, () => updatePnL(currentSymbol)), PRICE_POLL_INTERVAL_MS);
  priceRefreshCleanup.set(root, () => clearInterval(marketPriceTimer));
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

