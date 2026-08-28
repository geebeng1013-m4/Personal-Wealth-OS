import type { AdvisorRecommendation, LedgerAccountType, LedgerTransaction, LedgerTransactionType, RuleCardId, RuleNote, Ticker, Trade, TradeType, WealthState } from "./models";
import { buildAssetHistory, triggerHistory, type AssetHistory } from "./drawdowns";
import { createId, cloneDefaultState, exportState, importStateFromFile, loadSnapshots, restoreSnapshot, clearSnapshots, type Snapshot } from "./state";
import {
  emergencyRatio,
  money,
  monthsToEmergencyTarget,
  percent,
  projectedAnnualEmergencyYield,
  trancheStatus,
  tradeUnits,
} from "./rules";
import { getAdvisorSnapshot, nextActions } from "./advisor";
import { isRecommendationCompleted, markRecommendationDone } from "./actionRecords";
import { buildTradeTimelineHtml, fetchFundamentals, fetchEtfComposition, fetchHistoricalPrices, calcRiskMetrics, getUsdToMyr, fetchLivePrices, fetchUsdToMyr, type Fundamentals } from "./market";
import { exchangeRateOf, resolveExchangeCoverage, tradesWithExchangeCost } from "./currencyExchange";
import { exchangesFromText, mergeExchanges } from "./exchangeImport";
import { categoryTotals, filterLedgerTransactions, investmentAssetShare, ledgerTotals, monthlyLedgerTotals, normalizeLedgerAmount, openingFunds, type AccountBalance, type LedgerFilters } from "./ledger";
import { getLedgerSnapshot } from "./ledgerSummary";
import { getHolding, getPortfolioSnapshot, type PortfolioHolding, type PortfolioSnapshot, type ValuationInputs } from "./portfolioSummary";
import type { PriceMap } from "./marketPrices";
import { getGoalsSnapshot } from "./goalSummary";
import { getBudgetSnapshot } from "./budgetSummary";
import {
  calculateInflationAdjustedValue,
  solveTvm,
  COMPOUNDING_LABELS,
  type CompoundingFrequency,
  type PaymentTiming,
  type RateKind,
  type TvmSolveInput,
  type TvmVariable,
} from "./tvm";
import { mountSideRays } from "./sideRays";
import { forecastRecurring, getFinancialSnapshot, monthlyClose, nextRecurringOccurrence, rebalanceContributions, tradeExchangeRate } from "./financialHealth";
import type { MoneyLeakCategory } from "./moneyLeaks";
// Money Leaks detect WHAT happened; the Advisor supplies the guidance shown
// alongside each finding. Both arrive pre-merged via this compatibility shape.
import { detectMoneyLeaks, type MoneyLeak } from "./advisor";
import { recordsFromCsv } from "./csvImport";
import { buildOverviewModel } from "./overview";

type Setter = (state: WealthState, changeLabel?: string) => void;
type Navigate = (page: string) => void;

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

function escapeHtml(value: string): string {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

function numberInput(name: string, label: string, value = "", step = "0.01"): string {
  return `<label>${label}<input name="${name}" type="number" min="0" step="${step}" value="${value}"></label>`;
}

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
// Quotes live here for the lifetime of the page and nowhere else. They are
// deliberately NOT part of WealthState: a price is an observation about the
// world, not something the user owns, and persisting it would mean a stale
// number could later be presented as current. Reloading simply re-fetches.
//
// An empty map is the honest default — it means "no price known", which every
// consumer renders as unknown rather than as zero.
let livePrices: PriceMap = new Map();
let liveUsdToMyr: number | null = null;
let priceFetchInFlight = false;
/** Tickers the last fetch covered, so switching symbols can refetch. */
let pricedSymbols = "";
/** When the current livePrices were fetched, so a long-open tab can tell it has gone stale. */
let pricesFetchedAt = 0;
/**
 * How long a price is trusted before refreshLivePrices() will fetch again.
 *
 * Without this, a tab left open kept showing whatever quote arrived on the
 * very first load, forever — the fetch guard only ever asked "do we have SOME
 * price for these tickers", never "is it still recent". A real comparison
 * against a live brokerage app surfaced this: after the tab had been open a
 * while, the app's gain figure was noticeably behind the brokerage's, purely
 * because the market had moved since that one fetch and nothing ever asked
 * again.
 */
const PRICE_STALE_AFTER_MS = 60_000;
/**
 * How often an open page re-checks whether its price has gone stale.
 *
 * Deliberately shorter than PRICE_STALE_AFTER_MS. Polling at exactly the
 * staleness period never works: the timer starts before the first quote
 * resolves, so every tick lands a few hundred milliseconds INSIDE the freshness
 * window and no-ops, and the price only actually refreshes on the tick after
 * that. Checking twice per window means a stale price is picked up promptly
 * while still making at most one request per window.
 */
const PRICE_POLL_INTERVAL_MS = PRICE_STALE_AFTER_MS / 2;

/** The market inputs handed to the canonical portfolio snapshot. */
function livePriceInputs(): ValuationInputs {
  return { prices: livePrices, usdToMyr: liveUsdToMyr };
}

/** Placeholder for a fact that is genuinely unknown. Never a zero. */
const UNKNOWN = "--";

/**
 * Format a canonical money field that may be unknown.
 * Formatting only — a null stays "--" and is never coerced to 0.
 */
function moneyOrUnknown(value: number | null | undefined): string {
  return value == null ? UNKNOWN : money(value);
}

/** Format a canonical P&L: signed money plus signed percent, or "--". */
function pnlText(
  amount: number | null | undefined,
  ratio: number | null | undefined,
  currency = "MYR",
): string {
  if (amount == null) return UNKNOWN;
  const sign = amount >= 0 ? "+" : "−";
  const percentPart = ratio == null ? "" : ` (${sign}${percent(Math.abs(ratio), 2)})`;
  return `${sign}${money(Math.abs(amount), currency)}${percentPart}`;
}

/** A conversion rate, at the precision the difference actually shows up in. */
function rateText(rate: number): string {
  return `MYR ${rate.toFixed(4)} / USD`;
}

/**
 * One honest sentence about how much of the ringgit cost basis rests on a rate
 * the user really paid.
 *
 * This is the panel's reason for existing, so it leads rather than hides in a
 * tooltip. Without conversions the ringgit figures are built on the rate that
 * happened to be live when a CSV was imported — a number from the wrong day,
 * which the copy says plainly instead of implying the cost basis is solid.
 */
function conversionCoverageNote(state: WealthState): string {
  const records = state.currencyExchanges ?? [];
  if (records.length === 0) {
    return "No conversions recorded. Ringgit costs currently use the rate that was live when each trade was imported, which is not a rate you paid — the dollar figures are unaffected.";
  }
  const coverage = resolveExchangeCoverage(state.trades, records);
  const average = coverage.averageRecordedRate;
  const rate = average === null ? "" : ` Average ${rateText(average)}.`;
  const leftover = coverage.unspentUsd > 0.01
    ? ` USD ${coverage.unspentUsd.toFixed(2)} converted but not yet invested.`
    : "";
  if (coverage.totalBuyUsd <= 0) {
    return `${records.length} conversions recorded.${rate}${leftover}`;
  }
  if (coverage.coverage >= 0.9995) {
    return `Every dollar of your cost basis is backed by a recorded conversion.${rate}${leftover}`;
  }
  return `${percent(coverage.coverage, 0)} of your cost basis is backed by a recorded conversion.${rate} The remaining ${percent(1 - coverage.coverage, 0)} still uses the rate stamped on those trades at import.${leftover}`;
}

/**
 * Currency conversions: the only record of a real MYR/USD rate.
 *
 * The broker offers no export for these, so the input is whatever copying that
 * on-screen list produces. Parsing is deliberately a two-step — read, then
 * confirm — because a misread here silently rewrites the cost basis behind
 * every holding.
 */
function currencyConversionsPanel(state: WealthState): string {
  const records = [...(state.currencyExchanges ?? [])].reverse();
  const rows = records.map((record) => {
    const into = record.direction === "myr-to-usd";
    return '<tr>'
      + '<td>' + escapeHtml(record.date) + '</td>'
      + '<td>' + (into ? "MYR → USD" : "USD → MYR") + '</td>'
      // Statement amounts, so both columns keep two decimals: money() drops a
      // trailing .00 and made a MYR column of exact figures look rounded.
      + '<td>MYR ' + record.myrAmount.toFixed(2) + '</td>'
      + '<td>USD ' + record.usdAmount.toFixed(2) + '</td>'
      + '<td>' + exchangeRateOf(record).toFixed(4) + '</td>'
      + '<td><button class="icon-button danger delete-exchange" data-id="' + escapeHtml(record.id) + '" type="button" aria-label="Delete conversion on ' + escapeHtml(record.date) + '">✕</button></td>'
      + '</tr>';
  }).join("");

  return `
    <article class="card panel">
      <div class="panel-head">
        <div><span class="eyebrow">Ringgit Cost Basis</span><h3>Currency conversions</h3></div>
        <div class="panel-head-actions"><span class="panel-note">${records.length} records</span>${records.length > 0
          ? '<button class="secondary-button danger-button clear-exchanges" type="button">Clear all</button>'
          : ""}</div>
      </div>
      <p class="fx-coverage">${escapeHtml(conversionCoverageNote(state))}</p>
      <div class="import-box">
        <label>Paste your broker's exchange history
          <textarea id="fxPaste" rows="4" placeholder="MYR&#10;USD&#10;Aug 9, 2026 22:06 MYT&#10;Completed&#10;4.85 USD&#10;20.00 MYR"></textarea>
        </label>
        <button class="primary-button" id="fxImport" type="button">Read conversions</button>
        <small>Select the whole list in your broker app and paste it here — headings and dates included. Re-pasting a range you have already added updates it instead of duplicating it.</small>
      </div>
      <p id="fxImportStatus" class="form-error" role="alert"></p>
      ${records.length > 0 ? `<div class="table-wrap financial-table">
        <table>
          <thead><tr><th>Date</th><th>Direction</th><th>MYR</th><th>USD</th><th>Rate</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : ""}
    </article>`;
}

/**
 * The same unrealised P&L, stated in USD.
 *
 * Shown next to the ringgit figure because users compare the ringgit one
 * against their broker app, where it does not match — and the mismatch is real:
 * the two are converted on different terms. The USD figure is the exact one,
 * since units and prices come straight off the broker's own data, while the
 * ringgit cost basis depends on the FX rate each trade happens to carry (see
 * csvImport.ts for why that rate is weak on imported trades).
 *
 * Returns "" rather than "--" when unknown, so a caller can drop it into a
 * separator-joined note without leaving a dangling placeholder.
 */
function usdPnlNote(portfolio: PortfolioSnapshot): string {
  if (portfolio.unrealizedPnlUsd == null) return "";
  return pnlText(portfolio.unrealizedPnlUsd, portfolio.unrealizedPnlPercent, "USD");
}

/**
 * What the return would have been with no trading costs.
 *
 * Shown next to the headline because the two answer different questions and
 * the user asked for both: the headline is what every ringgit handed over
 * became, this is how the investment itself did. The gap between them is the
 * broker's cut, which is otherwise invisible — buried inside the cost basis
 * with nothing on screen to say so.
 *
 * Returns "" when unknown or when nothing was charged, so it can be dropped
 * into a separator-joined note without leaving a stray placeholder.
 */
function feeFreeReturnNote(portfolio: PortfolioSnapshot): string {
  if (portfolio.feesInCostBasisMyr <= 0.005) return "";
  if (portfolio.unrealizedPnlMyrExFees === null) return "";
  return `Before trading costs ${pnlText(portfolio.unrealizedPnlMyrExFees, portfolio.unrealizedPnlPercentMyrExFees)}`;
}

/** The Trading costs row's contents, shared by the first paint and the repaint. */
function feeRowHtml(portfolio: PortfolioSnapshot): string {
  const note = feeFreeReturnNote(portfolio) || "Commission paid, already inside the cost above";
  return `${money(portfolio.feesInCostBasisMyr)} <span class="ov-detail-row__note">${escapeHtml(note)}</span>`;
}

/**
 * The amount a holding's allocation percentage was actually computed from.
 *
 * Allocation moved to market value, so showing cost beside the percentage would
 * make the panel argue with itself. Falls back to cost when that is what the
 * weighting used, which allocationBasis already decided.
 */
function allocationAmount(portfolio: PortfolioSnapshot, holding: PortfolioHolding): string {
  if (portfolio.allocationBasis === "market" && holding.marketValueMyr !== null) {
    return money(holding.marketValueMyr);
  }
  return money(holding.investedMyr);
}

/** Join note fragments with the standard separator, dropping empty ones. */
function joinNotes(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" · ");
}

/** CSS modifier for a canonical P&L value. Neutral while unknown. */
function pnlTone(amount: number | null | undefined): string {
  if (amount == null) return "";
  return amount >= 0 ? "ov-metric__value--positive" : "ov-metric__value--negative";
}

/**
 * One honest sentence about how complete a valuation is, straight from the
 * canonical status. The UI never decides this itself.
 */
function valuationNote(portfolio: PortfolioSnapshot): string {
  // The age is shown alongside the delayed-data disclaimer rather than instead
  // of it: "may be delayed" alone gave no way to tell a 30-second-old quote
  // from one that had sat unrefreshed for an hour.
  const age = quoteAgeLabel(portfolio.valuedAt);
  const ageSuffix = age ? ` · ${age}` : "";
  if (portfolio.valuationStatus === "complete") return `Market data may be delayed${ageSuffix}`;
  if (portfolio.valuationStatus === "partial") {
    const missing = portfolio.unpricedTickers.length;
    return `Partial valuation · ${missing} ${missing === 1 ? "holding" : "holdings"} unavailable${ageSuffix}`;
  }
  return portfolio.totalInvestedMyr > 0 ? "No market price available yet" : "No holdings recorded";
}

/**
 * Fetch quotes for the tickers the user actually holds, then re-render.
 *
 * Guarded so a page that renders repeatedly does not queue duplicate requests.
 * Once fetched, a price is reused for PRICE_STALE_AFTER_MS rather than forever
 * — a tab left open must eventually ask again, or its valuation quietly falls
 * behind a real brokerage's live view. Silent on failure: no prices simply
 * means the valuation stays unknown (or keeps whatever was last known).
 */
function refreshLivePrices(state: WealthState, onUpdated: () => void): void {
  const symbols = [...new Set([
    ...state.trades.map((trade) => trade.ticker),
    ...Object.keys(state.dca.targets),
  ])].filter(Boolean).sort();
  if (symbols.length === 0) return;

  const key = symbols.join(",");
  const isFresh = key === pricedSymbols && livePrices.size > 0 && Date.now() - pricesFetchedAt < PRICE_STALE_AFTER_MS;
  if (priceFetchInFlight || isFresh) return;
  priceFetchInFlight = true;

  void Promise.all([
    fetchLivePrices(symbols),
    fetchUsdToMyr(state.trades, state.currencyExchanges).catch(() => null),
  ]).then(([prices, rate]) => {
    priceFetchInFlight = false;
    if (prices.size === 0) return; // unknown stays unknown; do not overwrite a good price with nothing
    livePrices = prices;
    pricedSymbols = key;
    pricesFetchedAt = Date.now();
    liveUsdToMyr = typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
    onUpdated();
  }).catch(() => { priceFetchInFlight = false; });
}

/** Human-scale "how long ago" for a quote timestamp. Never claims to be live. */
function quoteAgeLabel(quotedAtMs: number | null): string {
  if (!quotedAtMs) return "";
  const ageMs = Date.now() - quotedAtMs;
  if (ageMs < 0) return "";
  const minutes = Math.floor(ageMs / 60_000);
  // "priced" read as "the app last refreshed", which sent a user hunting for a
  // bug during a normal US market close. The timestamp is the market's, not
  // ours: the app re-asks every 30 seconds, and outside trading hours every
  // answer is the same closing print. "last traded" says whose clock this is.
  if (minutes < 1) return "last traded moments ago";
  if (minutes < 60) return `last traded ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last traded ${hours}h ago`;
  return `last traded ${Math.floor(hours / 24)}d ago`;
}

function leakInsightStrip(state: WealthState, categories: MoneyLeakCategory[], label: string): string {
  const leak = detectMoneyLeaks(state).leaks.find((item) => categories.includes(item.category));
  if (!leak) return "";
  return `<aside class="leak-insight-strip leak-insight-strip--${leak.severity}"><div><span class="eyebrow">${escapeHtml(label)}</span><strong>${escapeHtml(leak.title)}</strong><p>${escapeHtml(leak.summary)}</p></div><div class="leak-insight-impact"><small>Potential impact</small><b>${money(leak.monthlyImpact)}${leak.impactBasis === "one-time" ? " observed" : "/mo"}</b><button class="secondary-button dashboard-nav" data-page="money-leaks" data-leak-id="${escapeHtml(leak.id)}" type="button">Review finding</button></div></aside>`;
}

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

function portfolioTemplate(state: WealthState): string {
  const portfolio = getPortfolioSnapshot(state, new Date(), livePriceInputs());
  const positionRows = portfolio.holdings.map((position) => {
    const driftClass = Math.abs(position.drift) > 0.08 ? "negative" : "positive";
    const driftSign = position.drift >= 0 ? "+" : "";
    // Market price, value and P&L come straight off the holding. A holding with
    // no usable quote shows "--" rather than being valued at zero.
    const pnlClass = position.unrealizedPnlMyr == null
      ? "" : position.unrealizedPnlMyr >= 0 ? "positive" : "negative";
    return '<tr>' +
      '<td><span class="ticker-badge">' + position.ticker + '</span></td>' +
      '<td>' + money(position.investedMyr) + '</td>' +
      '<td>USD ' + position.investedUsd.toFixed(2) + '</td>' +
      '<td>' + position.units.toFixed(5) + '</td>' +
      '<td>USD ' + position.averageCostUsd.toFixed(2) + '</td>' +
      '<td>' + (position.priceUsd == null ? UNKNOWN : 'USD ' + position.priceUsd.toFixed(2)) + '</td>' +
      '<td>' + moneyOrUnknown(position.marketValueMyr) + '</td>' +
      '<td class="' + pnlClass + '">' + pnlText(position.unrealizedPnlMyr, position.unrealizedPnlPercentMyr) + '</td>' +
      '<td>' + percent(position.actualAllocation) + ' / ' + percent(position.targetAllocation) + '</td>' +
      '<td class="' + driftClass + '">' + driftSign + percent(position.drift, 1) + '</td>' +
      '</tr>';
  }).join("");

  const tradeRows = [...state.trades]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((trade) => {
      return '<tr>' +
        '<td>' + escapeHtml(trade.date) + '</td>' +
        '<td>' + escapeHtml(trade.platform) + '</td>' +
        '<td><span class="ticker-badge">' + trade.ticker + '</span></td>' +
        '<td><span class="type-badge" style="background:' + tradeTypeColor(trade.type) + ';color:' + tradeTypeTextColor(trade.type) + ';">' + trade.type + '</span></td>' +
        '<td>' + money(trade.amountMyr) + '</td>' +
        '<td>USD ' + trade.amountUsd.toFixed(2) + '</td>' +
        '<td>USD ' + trade.priceUsd.toFixed(2) + '</td>' +
        '<td>' + tradeExchangeRate(trade).toFixed(4) + '</td>' +
        '<td>' + tradeUnits(trade).toFixed(5) + '</td>' +
        '<td><button class="icon-button danger delete-trade" data-id="' + trade.id + '" type="button" aria-label="Delete trade" title="Delete trade">✕</button></td>' +
        '</tr>';
    }).join("");

  const allocationHealth = portfolio.maxAbsoluteDrift <= 0.05 ? "Aligned" : portfolio.maxAbsoluteDrift <= 0.1 ? "Monitor" : "Rebalance";
  // Fed the same snapshot the panels above render, so the plan and the weights
  // it is closing can never disagree on screen.
  const contributionPlan = rebalanceContributions(state, portfolio);
  const heldCount = portfolio.holdings.filter((position) => position.units > 0).length;
  return `
    <section class="portfolio-hero card">
      <!-- Count only positions actually held. The holdings list also carries
           target tickers with zero units, so the raw length would claim
           holdings the user does not own. Figures themselves are unchanged. -->
      <div><span class="eyebrow">Long-term Investment Portfolio</span><strong>${money(portfolio.totalInvestedMyr)}</strong><p>${heldCount > 0
        ? `Capital contributed across ${heldCount} ${heldCount === 1 ? "holding" : "holdings"} · USD ${portfolio.totalInvestedUsd.toFixed(2)} cost basis`
        : "No contributions recorded yet · targets are configured but nothing is held"}</p></div>
      <!-- What it is worth now, beside what went in. Read from the canonical
           snapshot; unknown renders "--" and is never shown as zero. -->
      <div class="portfolio-health" data-valuation-status="${portfolio.valuationStatus}"><span>Market value</span><strong id="pfMarketValue">${moneyOrUnknown(portfolio.totalInvestmentValueMyr)}</strong><small id="pfUnrealised" class="${pnlTone(portfolio.unrealizedPnlMyr)}">${pnlText(portfolio.unrealizedPnlMyr, portfolio.unrealizedPnlPercentMyr)} · ${escapeHtml(joinNotes(usdPnlNote(portfolio), valuationNote(portfolio)))}</small>${portfolio.feesInCostBasisMyr > 0.005
        ? `<small class="fee-drag">${escapeHtml(joinNotes(`${money(portfolio.feesInCostBasisMyr)} in trading costs`, feeFreeReturnNote(portfolio)))}</small>`
        : ""}</div>
      <div class="portfolio-health"><span>Allocation health</span><strong>${allocationHealth}</strong><small>Largest drift ${percent(portfolio.maxAbsoluteDrift, 1)}</small></div>
    </section>
    <article class="card panel"><div class="panel-head"><div><span class="eyebrow">Next Contribution</span><h3>Rebalance with new money</h3></div><span class="panel-note">No selling required</span></div><div class="rebalance-plan">${contributionPlan.map((item) => `<div><strong>${escapeHtml(item.ticker)}</strong><span>${money(item.amount)}</span></div>`).join("")}</div></article>
    <div class="portfolio-command-grid">
      <article class="card panel portfolio-allocation-panel">
        <div class="panel-head"><div><span class="eyebrow">Strategic Allocation</span><h3>Portfolio structure</h3><small class="panel-note">${portfolio.allocationBasis === "market" ? "Weighted by market value" : "Weighted by cost — no live price yet"}</small></div><span class="status-pill ${portfolio.maxAbsoluteDrift <= 0.08 ? "positive" : "attention"}">${allocationHealth}</span></div>
        ${portfolio.holdings.length ? `<div class="portfolio-positions">${portfolio.holdings.map((position, index) => `<div class="position-card"><div class="position-identity"><span class="position-index">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(position.ticker)}</strong><small>${position.ticker === "VOO" ? "Core market exposure" : position.ticker === "QQQM" ? "Growth allocation" : "Portfolio holding"}</small></div></div><div class="position-value"><strong>${allocationAmount(portfolio, position)}</strong><small>${percent(position.actualAllocation)} of portfolio</small></div><div class="allocation-track"><span style="width:${Math.min(position.actualAllocation * 100, 100)}%"></span><i style="left:${Math.min(position.targetAllocation * 100, 100)}%" title="Target ${percent(position.targetAllocation)}"></i></div><div class="position-meta"><span>Target ${percent(position.targetAllocation)}</span><span class="${Math.abs(position.drift) > 0.08 ? "negative" : "positive"}">${position.drift >= 0 ? "+" : ""}${percent(position.drift, 1)} drift</span></div></div>`).join("")}</div>` : '<p class="empty-state">No portfolio positions yet. Record a contribution to establish your long-term allocation.</p>'}
      </article>
      <article class="card panel contribution-panel">
        <div class="panel-head"><div><span class="eyebrow">Contribution Record</span><h3>Add investment activity</h3></div><span class="panel-note">Cost basis</span></div>
        <form id="tradeForm" class="form-grid">
          <label>Date<input name="date" type="date" required></label>
          <label>Ticker<select name="ticker" id="tickerSelect"><option>VOO</option><option>QQQM</option>${state.customTickers.map((t) => '<option>' + escapeHtml(t) + '</option>').join('')}<option value="__custom__">+ Custom</option></select></label>
          <div id="customTickerWrap" style="display:none;"><label>Custom Ticker<input name="customTicker" id="customTickerInput" type="text" placeholder="e.g. AAPL" style="text-transform:uppercase;"></label></div>
          <label>Type<select name="type"><option>DCA</option><option>Dip Buy</option><option>Manual Buy</option><option>Sell</option></select></label>
          ${numberInput("amountMyr", "Amount MYR")}
          ${numberInput("amountUsd", "Amount USD")}
          ${numberInput("priceUsd", "Price / Unit USD")}
          ${numberInput("units", "Filled Quantity")}
          ${numberInput("feeMyr", "Fee MYR", "0")}
          <label>Notes<input name="notes" type="text" placeholder="Optional"></label>
          <button class="primary-button" type="submit">Record contribution</button>
        </form>
        <div class="import-box">
          <label class="file-button">Import broker CSV<input id="csvInput" type="file" accept=".csv"></label>
          <small>Moomoo and custom transaction exports are supported.</small>
        </div>
      </article>
    </div>
    ${currencyConversionsPanel(state)}
    <details class="card panel portfolio-details">
      <summary><div><span class="eyebrow">Position Detail</span><h3>Cost basis and allocation data</h3></div><span>${portfolio.holdings.length} holdings</span></summary>
      <div class="portfolio-details-content">
        <div class="table-wrap compact-table financial-table">
          <table>
            <thead><tr><th>Ticker</th><th>Invested MYR</th><th>Invested USD</th><th>Units</th><th>Avg Cost</th><th>Market Price</th><th>Market Value</th><th>Unrealised P&amp;L</th><th>Actual / Target</th><th>Drift</th></tr></thead>
            <tbody>${positionRows}</tbody>
          </table>
        </div>
      </div>
    </details>
    <article class="card panel portfolio-activity">
      <div class="panel-head"><div><span class="eyebrow">Portfolio Activity</span><h3>Contribution history</h3></div><div class="panel-head-actions"><span class="panel-note">${state.trades.length} records</span>${state.trades.length > 0
        ? '<button class="secondary-button danger-button clear-trades" type="button">Clear all</button>'
        : ""}</div></div>
      <div class="table-wrap financial-table">
        <table>
          <thead><tr><th>Date</th><th>Platform</th><th>Ticker</th><th>Type</th><th>Amount MYR</th><th>Amount USD</th><th>Price USD</th><th>FX</th><th>Units</th><th></th></tr></thead>
          <tbody>${tradeRows || '<tr><td colspan="10" class="empty-state">No transactions yet. Add your first transaction to begin tracking.</td></tr>'}</tbody>
        </table>
      </div>
    </article>
  `;
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

function tradeTypeColor(type: string): string {
  switch (type) {
    case "DCA": return "var(--green-dim)";
    case "Dip Buy": return "var(--blue-dim)";
    case "Manual Buy": return "var(--purple-dim)";
    case "Sell": return "var(--red-dim)";
    default: return "var(--surface-2)";
  }
}

function tradeTypeTextColor(type: string): string {
  switch (type) {
    case "DCA": return "var(--green)";
    case "Dip Buy": return "var(--blue)";
    case "Manual Buy": return "var(--purple)";
    case "Sell": return "var(--red)";
    default: return "var(--ink-2)";
  }
}

let ledgerFilters: LedgerFilters = { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "" };
let ledgerEditingId = "";
let ledgerEntryType: LedgerTransactionType = "expense";
let suppressLedgerAmountFocus = false;
let ledgerEntryDraft = {
  amount: "",
  accountId: "",
  fromAccountId: "",
  toAccountId: "",
  date: "",
  note: "",
};
let ledgerHistoryOpen = false;
let ledgerCategoriesOpen = false;
let ledgerAccountsOpen = false;
const ledgerAccountGroupsOpen: Record<LedgerAccountType, boolean> = {
  bank: true,
  wallet: true,
  investment: true,
};

function resetLedgerEntry(): void {
  ledgerEditingId = "";
  ledgerEntryType = "expense";
  ledgerEntryDraft = {
    amount: "",
    accountId: "",
    fromAccountId: "",
    toAccountId: "",
    date: "",
    note: "",
  };
}

function localDateValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

// --- TVM Calculator ---------------------------------------------------------
// Session-only inputs: deliberately not persisted to WealthState, localStorage
// or Firebase. Refreshing the page resets the calculator, which is fine for a
// hypothetical planning tool.

// --- TVM Calculator ---------------------------------------------------------
// Classic five-variable solver: fill any four of PV / PMT / FV / Rate /
// Periods and solve for the fifth.
//
// Session-only inputs: deliberately not persisted to WealthState, localStorage
// or Firebase. Refreshing the page resets the calculator, which is fine for a
// hypothetical planning tool.

type TvmFieldName = "presentValue" | "payment" | "futureValue" | "annualRatePercent" | "periods";

const TVM_DEFAULTS: Record<TvmFieldName, string> = {
  presentValue: "-1000",
  payment: "-300",
  futureValue: "",
  annualRatePercent: "8",
  periods: "120",
};

let tvmValues: Record<TvmFieldName, string> = { ...TVM_DEFAULTS };
let tvmFrequency: CompoundingFrequency = "monthly";
let tvmTiming: PaymentTiming = "end";
let tvmRateKind: RateKind = "nominal";
/** The most recent solve, so the result panel survives re-renders. */
let tvmSolved: { variable: TvmVariable; result: ReturnType<typeof solveTvm> } | null = null;

/** Inflation is a separate small tool, not one of the five variables. */
const tvmInflation = { futureAmount: "100000", inflationRatePercent: "3", years: "10" };

const TVM_ROWS: Array<{ name: TvmFieldName; label: string; button: string; unit: string; step: string }> = [
  { name: "presentValue", label: "Present Value", button: "PV", unit: "MYR", step: "100" },
  { name: "payment", label: "Payments", button: "PMT", unit: "MYR", step: "50" },
  { name: "futureValue", label: "Future Value", button: "FV", unit: "MYR", step: "1000" },
  { name: "annualRatePercent", label: "Annual Rate (%)", button: "Rate", unit: "%", step: "0.1" },
  { name: "periods", label: "Periods", button: "Periods", unit: "n", step: "1" },
];

/** Parse a field. Empty means "not filled in", never silently 0. */
function tvmNumber(name: TvmFieldName): number {
  const raw = tvmValues[name].trim();
  if (raw === "") return Number.NaN;
  return Number(raw);
}

function tvmSolveInput(): TvmSolveInput {
  return {
    presentValue: tvmNumber("presentValue"),
    payment: tvmNumber("payment"),
    futureValue: tvmNumber("futureValue"),
    annualRatePercent: tvmNumber("annualRatePercent"),
    periods: tvmNumber("periods"),
    frequency: tvmFrequency,
    timing: tvmTiming,
    rateKind: tvmRateKind,
  };
}

function tvmFormat(variable: TvmVariable, value: number): string {
  if (variable === "annualRatePercent") return `${(Math.round(value * 1000) / 1000).toLocaleString("en-MY")}%`;
  if (variable === "periods") return `${Math.round(value * 100) / 100}`;
  return money(value);
}

const TVM_LABELS: Record<TvmVariable, string> = {
  presentValue: "Present Value",
  payment: "Payment",
  futureValue: "Future Value",
  annualRatePercent: "Annual Rate",
  periods: "Periods",
};

function tvmResultTemplate(): string {
  if (!tvmSolved) {
    return `
      <div class="tvm-result tvm-result--empty" role="status">
        <p class="tvm-result__label">Result</p>
        <p class="tvm-result__hint">Fill in any four values, then press the button beside the one you want to solve.</p>
      </div>`;
  }

  const { variable, result } = tvmSolved;
  if (!result.ok) {
    return `
      <div class="tvm-result tvm-result--invalid" role="status">
        <p class="tvm-result__label">${escapeHtml(TVM_LABELS[variable])}</p>
        <p class="tvm-result__value">—</p>
        <ul class="tvm-errors" role="alert">
          ${result.errors.map((error) => `<li><span aria-hidden="true">⚠</span> ${escapeHtml(error.message)}</li>`).join("")}
        </ul>
      </div>`;
  }

  const v = result.value;
  const periodsLabel = `${Math.round(v.periods * 100) / 100} ${COMPOUNDING_LABELS[tvmFrequency].toLowerCase()} periods`;
  return `
    <div class="tvm-result" role="status">
      <p class="tvm-result__label">Solved for ${escapeHtml(TVM_LABELS[variable])}</p>
      <p class="tvm-result__value">${escapeHtml(tvmFormat(variable, v.value))}</p>
      <dl class="tvm-result__rows">
        <div class="tvm-result__row"><dt>Present value</dt><dd>${money(v.presentValue)}</dd></div>
        <div class="tvm-result__row"><dt>Payment</dt><dd>${money(v.payment)}</dd></div>
        <div class="tvm-result__row"><dt>Future value</dt><dd>${money(v.futureValue)}</dd></div>
        <div class="tvm-result__row"><dt>Annual rate</dt><dd>${Math.round(v.annualRatePercent * 1000) / 1000}% ${escapeHtml(tvmRateKind)}</dd></div>
        <div class="tvm-result__row"><dt>Periods</dt><dd>${escapeHtml(periodsLabel)}</dd></div>
        <div class="tvm-result__row"><dt>Total payments</dt><dd>${money(v.totalPayments)}</dd></div>
        <div class="tvm-result__row"><dt>Total interest</dt><dd>${money(v.totalInterest)}</dd></div>
      </dl>
      <p class="tvm-result__summary">Based on your own assumptions: ${escapeHtml(COMPOUNDING_LABELS[tvmFrequency].toLowerCase())} compounding, payments at the ${tvmTiming === "end" ? "end" : "beginning"} of each period, ${escapeHtml(tvmRateKind)} rate. Projections only — not guaranteed returns or investment advice.</p>
    </div>`;
}

function tvmInflationTemplate(): string {
  const result = calculateInflationAdjustedValue({
    futureAmount: Number(tvmInflation.futureAmount.trim() === "" ? Number.NaN : tvmInflation.futureAmount),
    inflationRatePercent: Number(tvmInflation.inflationRatePercent.trim() === "" ? Number.NaN : tvmInflation.inflationRatePercent),
    years: Number(tvmInflation.years.trim() === "" ? Number.NaN : tvmInflation.years),
  });

  const fields: Array<{ name: keyof typeof tvmInflation; label: string; unit: string; step: string }> = [
    { name: "futureAmount", label: "Future amount", unit: "MYR", step: "1000" },
    { name: "inflationRatePercent", label: "Inflation rate", unit: "%", step: "0.1" },
    { name: "years", label: "Years", unit: "years", step: "1" },
  ];

  return `
    <section class="card panel tvm-card" aria-labelledby="tvmInflationTitle">
      <div class="panel-head">
        <div>
          <span class="eyebrow">Planning Tool</span>
          <h3 id="tvmInflationTitle">Inflation Adjustment</h3>
          <p class="card-sub">What a future amount is worth in today's money.</p>
        </div>
      </div>
      <div class="tvm-layout">
        <div class="tvm-inputs">
          ${fields.map((field) => `
            <label class="tvm-field" for="tvmInf-${field.name}">
              <span class="tvm-field__label">${escapeHtml(field.label)}</span>
              <span class="tvm-field__control">
                <span class="tvm-field__unit" aria-hidden="true">${escapeHtml(field.unit)}</span>
                <input class="tvm-field__input" id="tvmInf-${field.name}" type="number" inputmode="decimal"
                       step="${field.step}" value="${escapeHtml(tvmInflation[field.name])}"
                       data-tvm-inflation="${field.name}">
              </span>
            </label>`).join("")}
        </div>
        <div class="tvm-output" aria-live="polite">
          ${result.ok ? `
            <div class="tvm-result" role="status">
              <p class="tvm-result__label">Today's purchasing power</p>
              <p class="tvm-result__value">${money(result.value.todaysPurchasingPower)}</p>
              <dl class="tvm-result__rows">
                <div class="tvm-result__row"><dt>Purchasing-power loss</dt><dd>${money(result.value.purchasingPowerLoss)}</dd></div>
                <div class="tvm-result__row"><dt>Loss</dt><dd>${percent(result.value.purchasingPowerLossPercent, 1)}</dd></div>
              </dl>
              <p class="tvm-result__summary">Assumption: constant ${escapeHtml(tvmInflation.inflationRatePercent || "0")}% inflation.</p>
            </div>` : `
            <div class="tvm-result tvm-result--invalid" role="status">
              <p class="tvm-result__label">Today's purchasing power</p>
              <p class="tvm-result__value">—</p>
              <ul class="tvm-errors" role="alert">
                ${result.errors.map((e) => `<li><span aria-hidden="true">⚠</span> ${escapeHtml(e.message)}</li>`).join("")}
              </ul>
            </div>`}
        </div>
      </div>
    </section>`;
}

function tvmCalculatorTemplate(): string {
  // Wrapper so Reset can re-render just the calculator, not the page shell.
  return `<div id="tvmRoot">${tvmCardsTemplate()}</div>`;
}

function tvmCardsTemplate(): string {
  return `
    <section class="card panel tvm-card" aria-labelledby="tvmTitle">
      <div class="panel-head">
        <div>
          <span class="eyebrow">Planning Tool</span>
          <h3 id="tvmTitle">TVM Calculator</h3>
          <p class="card-sub">Fill in any four values, then solve for the fifth.</p>
        </div>
        <button class="secondary-button" type="button" id="tvmReset">Reset</button>
      </div>

      <div class="tvm-options">
        <fieldset class="tvm-fieldset">
          <legend class="tvm-legend">Annual Rate</legend>
          ${(["nominal", "effective"] as RateKind[]).map((kind) => `
            <label class="tvm-radio">
              <input type="radio" name="tvmRateKind" value="${kind}" data-tvm-ratekind="${kind}"${tvmRateKind === kind ? " checked" : ""}>
              <span>${kind === "nominal" ? "Nominal" : "Effective"}</span>
            </label>`).join("")}
        </fieldset>
        <fieldset class="tvm-fieldset">
          <legend class="tvm-legend">Mode</legend>
          ${(["end", "beginning"] as PaymentTiming[]).map((timing) => `
            <label class="tvm-radio">
              <input type="radio" name="tvmTiming" value="${timing}" data-tvm-timing="${timing}"${tvmTiming === timing ? " checked" : ""}>
              <span>${timing === "end" ? "End" : "Beginning"}</span>
            </label>`).join("")}
        </fieldset>
      </div>

      <div class="tvm-solver">
        ${TVM_ROWS.map((row) => `
          <div class="tvm-row">
            <label class="tvm-row__label" for="tvm-${row.name}">${escapeHtml(row.label)}</label>
            <span class="tvm-field__control">
              <span class="tvm-field__unit" aria-hidden="true">${escapeHtml(row.unit)}</span>
              <input class="tvm-field__input" id="tvm-${row.name}" type="number" inputmode="decimal"
                     step="${row.step}" value="${escapeHtml(tvmValues[row.name])}"
                     data-tvm-input="${row.name}" aria-describedby="tvmSignNote">
            </span>
            <button class="v2-btn v2-btn--secondary v2-btn--sm tvm-solve" type="button"
                    data-tvm-solve="${row.name}"
                    aria-label="Solve for ${escapeHtml(row.label)}">${escapeHtml(row.button)}</button>
          </div>`).join("")}

        <div class="tvm-row tvm-row--select">
          <label class="tvm-row__label" for="tvmFrequency">Compounding</label>
          <select class="v2-input tvm-select" id="tvmFrequency" data-tvm-frequency>
            ${(Object.keys(COMPOUNDING_LABELS) as CompoundingFrequency[]).map((key) => `
              <option value="${key}"${key === tvmFrequency ? " selected" : ""}>${escapeHtml(COMPOUNDING_LABELS[key])}</option>`).join("")}
          </select>
        </div>
      </div>

      <p class="tvm-note" id="tvmSignNote">Cash-flow signs matter: money you pay in is negative, money you receive is positive. Leave the value you want to solve for blank, or just press its button to overwrite it.</p>

      <div class="tvm-output" id="tvmOutput" aria-live="polite">
        ${tvmResultTemplate()}
      </div>
    </section>
    ${tvmInflationTemplate()}`;
}

function bindTvmCalculator(root: HTMLElement): void {
  const rerenderAll = () => {
    const host = root.querySelector<HTMLElement>("#tvmRoot");
    if (!host) return;
    host.innerHTML = tvmCardsTemplate();
    bindTvmCalculator(root);
  };
  const rerenderResult = () => {
    const output = root.querySelector<HTMLElement>("#tvmOutput");
    if (output) output.innerHTML = tvmResultTemplate();
  };

  root.querySelectorAll<HTMLInputElement>("[data-tvm-input]").forEach((input) => {
    input.addEventListener("input", () => {
      const name = input.dataset.tvmInput as TvmFieldName | undefined;
      if (name) tvmValues[name] = input.value;
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-tvm-solve]").forEach((button) => {
    button.addEventListener("click", () => {
      const variable = button.dataset.tvmSolve as TvmVariable | undefined;
      if (!variable) return;
      const result = solveTvm(variable, tvmSolveInput());
      tvmSolved = { variable, result };
      // Write the solved value back into its own field, as a solver does.
      if (result.ok) {
        const solved = result.value.value;
        tvmValues[variable as TvmFieldName] = String(
          variable === "annualRatePercent" || variable === "periods"
            ? Math.round(solved * 1e4) / 1e4
            : Math.round(solved * 100) / 100,
        );
        const field = root.querySelector<HTMLInputElement>(`[data-tvm-input="${variable}"]`);
        if (field) field.value = tvmValues[variable as TvmFieldName];
      }
      rerenderResult();
    });
  });

  root.querySelectorAll<HTMLInputElement>("[data-tvm-ratekind]").forEach((input) => {
    input.addEventListener("change", () => {
      tvmRateKind = input.dataset.tvmRatekind as RateKind;
      rerenderResult();
    });
  });

  root.querySelectorAll<HTMLInputElement>("[data-tvm-timing]").forEach((input) => {
    input.addEventListener("change", () => {
      tvmTiming = input.dataset.tvmTiming as PaymentTiming;
      rerenderResult();
    });
  });

  root.querySelector<HTMLSelectElement>("[data-tvm-frequency]")?.addEventListener("change", (event) => {
    tvmFrequency = (event.currentTarget as HTMLSelectElement).value as CompoundingFrequency;
    rerenderResult();
  });

  root.querySelector<HTMLButtonElement>("#tvmReset")?.addEventListener("click", () => {
    tvmValues = { ...TVM_DEFAULTS };
    tvmFrequency = "monthly";
    tvmTiming = "end";
    tvmRateKind = "nominal";
    tvmSolved = null;
    rerenderAll();
    root.querySelector<HTMLInputElement>('[data-tvm-input="presentValue"]')?.focus();
  });

  root.querySelectorAll<HTMLInputElement>("[data-tvm-inflation]").forEach((input) => {
    input.addEventListener("input", () => {
      const name = input.dataset.tvmInflation as keyof typeof tvmInflation | undefined;
      if (!name) return;
      tvmInflation[name] = input.value;
      const card = input.closest(".tvm-card");
      const output = card?.querySelector<HTMLElement>(".tvm-output");
      if (!output) return;
      // Re-render only the inflation card's output, preserving focus.
      const wrapper = document.createElement("div");
      wrapper.innerHTML = tvmInflationTemplate();
      const fresh = wrapper.querySelector(".tvm-output");
      if (fresh) output.innerHTML = fresh.innerHTML;
    });
  });
}

function ledgerTemplate(state: WealthState): string {
  const filtered = filterLedgerTransactions(state.ledgerTransactions, ledgerFilters, new Date(), state.ledgerCategories, state.ledgerAccounts);
  // Totals here follow the user's own filter (arbitrary range/type/category),
  // so they deliberately stay on the raw path rather than the canonical model.
  const totals = ledgerTotals(filtered);
  const totalOpeningFunds = openingFunds(state.ledgerAccounts);
  // Account balances and type totals are canonical ledger facts.
  const ledger = getLedgerSnapshot(state);
  const liquidNetAssets = ledger.accountTypeBalances.bank + ledger.accountTypeBalances.wallet;
  const totalNetAssets = liquidNetAssets + ledger.accountTypeBalances.investment;
  const editing = state.ledgerTransactions.find((transaction) => transaction.id === ledgerEditingId);
  const entryType = editing?.type ?? ledgerEntryType;
  const entryCategories = state.ledgerCategories.filter((category) => category.type === entryType);
  const balances = ledger.accountBalances;
  const accountTypeMeta = (type: LedgerAccountType): { label: string; emptyLabel: string; icon: string } => {
    if (type === "bank") return { label: "Bank account", emptyLabel: "bank accounts", icon: "🏦" };
    if (type === "wallet") return { label: "E-wallet", emptyLabel: "e-wallets", icon: "👛" };
    return { label: "Investment account", emptyLabel: "investment accounts", icon: "📈" };
  };
  const accountGroup = (type: LedgerAccountType, title: string, icon: string): string => {
    const groupBalances = balances.filter(({ account }) => account.type === type);
    const subtotal = groupBalances.reduce((sum, { balance }) => sum + balance, 0);
    const meta = accountTypeMeta(type);
    const rows = groupBalances.map(({ account, balance }: AccountBalance) => `<div class="ledger-account-row"><div class="ledger-account-copy"><span class="ledger-account-icon" aria-hidden="true">${escapeHtml(account.icon ?? icon)}</span><div><strong>${escapeHtml(account.name)}</strong><small>${meta.label}</small></div></div><strong class="ledger-account-balance ${balance >= 0 ? "income" : "expense"}">${balance < 0 ? "−" : ""}${money(Math.abs(balance))}</strong></div>`).join("");
    return `<details class="ledger-account-group ledger-account-group-${type}" data-ledger-account-group="${type}"${ledgerAccountGroupsOpen[type] ? " open" : ""}><summary><div class="ledger-account-group-title"><span class="ledger-account-group-icon" aria-hidden="true">${icon}</span><div><h4>${title}</h4><small>${groupBalances.length} ${groupBalances.length === 1 ? "account" : "accounts"}</small></div></div><div class="ledger-account-group-total"><strong class="${subtotal >= 0 ? "income" : "expense"}">${subtotal < 0 ? "−" : ""}${money(Math.abs(subtotal))}</strong><span class="ledger-account-group-switch" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="m4 6 4 4 4-4" /></svg></span></div></summary><div class="ledger-account-list">${rows || `<p class="empty-state">No ${meta.emptyLabel} added.</p>`}</div></details>`;
  };
  const accountName = (id?: string): string => state.ledgerAccounts.find((account) => account.id === id)?.name ?? "Unknown account";
  const accountOptions = (selected?: string): string => state.ledgerAccounts.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === selected ? " selected" : ""}>${escapeHtml((account.icon ?? accountTypeMeta(account.type).icon) + " " + account.name)}</option>`).join("");
  const accountIds = new Set(state.ledgerAccounts.map((account) => account.id));
  const defaultAccountId = state.ledgerAccounts[0]?.id ?? "";
  const selectedAccountId = accountIds.has(editing?.accountId ?? ledgerEntryDraft.accountId) ? editing?.accountId ?? ledgerEntryDraft.accountId : defaultAccountId;
  const requestedFromAccountId = editing?.fromAccountId ?? ledgerEntryDraft.fromAccountId;
  const selectedFromAccountId = accountIds.has(requestedFromAccountId) ? requestedFromAccountId : defaultAccountId;
  const requestedToAccountId = editing?.toAccountId ?? ledgerEntryDraft.toAccountId;
  const selectedToAccountId = accountIds.has(requestedToAccountId) && requestedToAccountId !== selectedFromAccountId
    ? requestedToAccountId
    : state.ledgerAccounts.find((account) => account.id !== selectedFromAccountId)?.id ?? "";
  const transferUnavailable = entryType === "transfer" && state.ledgerAccounts.length < 2;
  const entryAmount = editing ? String(editing.amount) : ledgerEntryDraft.amount;
  const entryDate = editing?.date ? localDateValue(editing.date) : ledgerEntryDraft.date || localDateValue();
  const entryNote = editing?.note ?? ledgerEntryDraft.note;
  const expenses = categoryTotals(filtered, state.ledgerCategories, "expense");
  const palette = ["#ef6461", "#f59e0b", "#8b5cf6", "#3b82f6", "#14b8a6", "#ec4899", "#84cc16"];
  let angle = 0;
  const donut = expenses.length ? expenses.map((item, index) => {
    const start = angle;
    angle += item.share * 360;
    return `${palette[index % palette.length]} ${start.toFixed(1)}deg ${angle.toFixed(1)}deg`;
  }).join(",") : "var(--surface-2) 0deg 360deg";
  const maxCategory = Math.max(...expenses.map((item) => item.amount), 1);
  const monthly = monthlyLedgerTotals(state.ledgerTransactions, new Date().getFullYear());
  const monthlyMax = Math.max(...monthly.flatMap((item) => [item.income, item.expense]), 1);
  const categoryOptions = state.ledgerCategories.map((category) => `<option value="${escapeHtml(category.id)}"${ledgerFilters.categoryId === category.id ? " selected" : ""}>${escapeHtml(category.icon + " " + category.label)}</option>`).join("");
  const transactionRows = filtered.map((transaction) => {
    const category = state.ledgerCategories.find((item) => item.id === transaction.categoryId);
    const title = transaction.type === "transfer" ? `${accountName(transaction.fromAccountId)} → ${accountName(transaction.toAccountId)}` : category?.label ?? "Unknown category";
    const accountMeta = transaction.type === "transfer" ? "Transfer" : accountName(transaction.accountId);
    const icon = transaction.type === "transfer" ? "↔" : category?.icon ?? "•";
    const amountPrefix = transaction.type === "income" ? "+" : transaction.type === "expense" ? "−" : "↔ ";
    return `<article class="ledger-row"><div class="ledger-row-icon">${escapeHtml(icon)}</div><div class="ledger-row-copy"><strong>${escapeHtml(title)}</strong><small>${new Date(transaction.date).toLocaleDateString()} · ${escapeHtml(accountMeta)}${transaction.note ? " · " + escapeHtml(transaction.note) : ""}</small></div><strong class="ledger-amount ${transaction.type}">${amountPrefix}${money(transaction.amount)}</strong><div class="ledger-row-actions"><button class="icon-button edit-ledger" data-id="${escapeHtml(transaction.id)}" aria-label="Edit transaction">✎</button><button class="icon-button danger delete-ledger" data-id="${escapeHtml(transaction.id)}" aria-label="Delete transaction">✕</button></div></article>`;
  }).join("");

  return `<div class="section-title"><span class="eyebrow">Everyday Money</span><h3>Ledger</h3><p>Capture income, expenses, and account transfers, then understand where your money goes.</p></div>
    ${leakInsightStrip(state, ["duplicate", "fee", "subscription"], "Transaction check")}
    <div class="ledger-layout">
      <article class="card panel ledger-entry"><div class="panel-head"><div><span class="eyebrow">Quick Entry</span><h3>${editing ? "Edit Transaction" : "Add Transaction"}</h3></div>${editing ? '<button id="cancelLedgerEdit" class="secondary-button" type="button">Cancel</button>' : ""}</div>
        <form id="ledgerForm"><input name="id" type="hidden" value="${escapeHtml(editing?.id ?? "")}"><div class="ledger-type-toggle" role="group" aria-label="Transaction type"><button type="button" data-ledger-type="expense" class="${entryType === "expense" ? "active expense" : ""}">− Expense</button><button type="button" data-ledger-type="income" class="${entryType === "income" ? "active income" : ""}">+ Income</button><button type="button" data-ledger-type="transfer" class="${entryType === "transfer" ? "active transfer" : ""}">↔ Transfer</button></div><input name="type" type="hidden" value="${entryType}">
          <label class="ledger-amount-input"><span>Amount (MYR)</span><input id="ledgerAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${escapeHtml(entryAmount)}" placeholder="0.00"></label>
          ${entryType === "transfer" ? `<div class="ledger-account-fields"><label>From account<select name="fromAccountId" required>${accountOptions(selectedFromAccountId)}</select></label><label>To account<select name="toAccountId" required>${accountOptions(selectedToAccountId)}</select></label></div>` : `<label class="ledger-account-select">Account<select name="accountId" required>${accountOptions(selectedAccountId)}</select></label><fieldset class="category-picker"><legend>Category</legend>${entryCategories.map((category, index) => `<label><input name="categoryId" type="radio" value="${escapeHtml(category.id)}"${category.id === editing?.categoryId || (!editing && index === 0) ? " checked" : ""}><span><b>${escapeHtml(category.icon)}</b>${escapeHtml(category.label)}</span></label>`).join("")}</fieldset>`}
          <details class="ledger-more"${editing ? " open" : ""}><summary>Date & note</summary><div class="form-grid"><label>Date<input name="date" type="date" required value="${entryDate}"></label><label>Note<input name="note" maxlength="500" value="${escapeHtml(entryNote)}" placeholder="Optional"></label></div></details><p id="ledgerFormError" class="form-error" role="alert">${transferUnavailable ? "Add at least two accounts before recording a transfer." : ""}</p><button class="primary-button ledger-save" type="submit"${transferUnavailable ? " disabled" : ""}>${editing ? "Save Changes" : "Save Transaction"}</button>
        </form>
      </article>
      <div class="ledger-main">
        <div class="ledger-summary"><article class="card"><span>Opening Funds</span><strong>${money(totalOpeningFunds)}</strong><small>Starting balance across all accounts</small></article><article class="card"><span>Income</span><strong class="income">+${money(totals.income)}</strong><small>Income in the selected period</small></article><article class="card"><span>Expenses</span><strong class="expense">−${money(totals.expense)}</strong><small>Expenses in the selected period</small></article><article class="card"><span>Total Net Assets</span><strong class="${totalNetAssets >= 0 ? "income" : "expense"}">${totalNetAssets < 0 ? "−" : ""}${money(Math.abs(totalNetAssets))}</strong><small>Bank + E-wallet + Investment</small></article><article class="card"><span>Liquid Net Assets</span><strong class="${liquidNetAssets >= 0 ? "income" : "expense"}">${liquidNetAssets < 0 ? "−" : ""}${money(Math.abs(liquidNetAssets))}</strong><small>Bank + E-wallet · Investment excluded</small></article></div>
        <article class="card ledger-account-summary"><div class="ledger-account-summary-head"><div><span class="eyebrow">Cash Locations</span><h3>Account Balances</h3><p>Opening balances adjusted by income, expenses, and transfers.</p></div><div><small>Total Net Assets</small><strong class="${totalNetAssets >= 0 ? "income" : "expense"}">${totalNetAssets < 0 ? "−" : ""}${money(Math.abs(totalNetAssets))}</strong></div></div><div class="ledger-account-columns">${accountGroup("bank", "Bank", "🏦")}${accountGroup("wallet", "E-wallet", "👛")}${accountGroup("investment", "Investment", "📈")}</div></article>
        <article class="card panel ledger-filters"><form id="ledgerFilterForm"><div class="filter-presets">${(["today", "week", "month", "year", "custom"] as const).map((preset) => `<button type="button" data-preset="${preset}" class="${ledgerFilters.preset === preset ? "active" : ""}">${preset === "today" ? "Today" : preset === "week" ? "This week" : preset === "month" ? "This month" : preset === "year" ? "This year" : "Custom"}</button>`).join("")}</div><div class="ledger-filter-fields ${ledgerFilters.preset === "custom" ? "show-custom" : ""}"><label class="custom-date">From<input name="startDate" type="date" value="${ledgerFilters.startDate}"></label><label class="custom-date">To<input name="endDate" type="date" value="${ledgerFilters.endDate}"></label><label>Type<select name="type"><option value="all">All types</option><option value="expense"${ledgerFilters.type === "expense" ? " selected" : ""}>Expense</option><option value="income"${ledgerFilters.type === "income" ? " selected" : ""}>Income</option><option value="transfer"${ledgerFilters.type === "transfer" ? " selected" : ""}>Transfer</option></select></label><label>Category<select name="categoryId"><option value="">All categories</option>${categoryOptions}</select></label><label>Search<input name="query" type="search" value="${escapeHtml(ledgerFilters.query)}" placeholder="Note, category, account"></label><button class="secondary-button" id="resetLedgerFilters" type="button">Reset</button></div></form></article>
        <div class="ledger-report-grid"><article class="card panel"><div class="panel-head"><div><span class="eyebrow">Expense Mix</span><h3>Category Share</h3></div></div>${expenses.length ? `<div class="ledger-donut-wrap"><div class="ledger-donut" style="background:conic-gradient(${donut})"><span>${money(totals.expense)}</span></div><div class="ledger-legend">${expenses.map((item, index) => `<div><i style="background:${palette[index % palette.length]}"></i><span>${escapeHtml(item.category.icon + " " + item.category.label)}</span><strong>${percent(item.share, 1)}</strong></div>`).join("")}</div></div><div class="ledger-bars">${expenses.map((item, index) => `<div><span>${escapeHtml(item.category.label)}</span><div><i style="width:${(item.amount / maxCategory) * 100}%;background:${palette[index % palette.length]}"></i></div><strong>${money(item.amount)}</strong></div>`).join("")}</div>` : '<p class="empty-state">No expense data in this period.</p>'}</article>
          <article class="card panel"><div class="panel-head"><div><span class="eyebrow">Annual Overview</span><h3>Monthly Income vs Expense</h3></div></div><div class="monthly-chart">${monthly.map((item) => `<div class="month-column"><div class="month-bars"><i class="income" style="height:${Math.max(item.income / monthlyMax * 100, item.income ? 3 : 0)}%" title="Income ${money(item.income)}"></i><i class="expense" style="height:${Math.max(item.expense / monthlyMax * 100, item.expense ? 3 : 0)}%" title="Expense ${money(item.expense)}"></i></div><small>${new Date(2000, item.month).toLocaleString("en", { month: "short" }).slice(0, 1)}</small></div>`).join("")}</div><div class="chart-key"><span><i class="income"></i>Income</span><span><i class="expense"></i>Expense</span></div></article></div>
        <details id="ledgerHistoryPanel" class="card panel ledger-collapsible"${ledgerHistoryOpen ? " open" : ""}><summary><div><span class="eyebrow">Transactions</span><h3>History</h3></div><span class="ledger-collapsible-meta">${filtered.length} records</span></summary><div class="ledger-collapsible-content"><div class="ledger-list">${transactionRows || '<p class="empty-state">No transactions match this view. Add your first record above.</p>'}</div></div></details>
        <details id="ledgerCategoriesPanel" class="card panel ledger-collapsible"${ledgerCategoriesOpen ? " open" : ""}><summary><div><span class="eyebrow">Custom Labels</span><h3>Category Manager</h3></div><span class="ledger-collapsible-meta">${state.ledgerCategories.length} categories</span></summary><div class="ledger-collapsible-content"><form id="ledgerCategoryForm" class="category-form"><label>Icon<input name="icon" maxlength="12" value="✨" required></label><label>Label<input name="label" maxlength="40" placeholder="Category name" required></label><label>Type<select name="type"><option value="expense">Expense</option><option value="income">Income</option></select></label><button class="primary-button" type="submit">Add Category</button></form><div class="category-manager">${state.ledgerCategories.map((category) => `<div><span>${escapeHtml(category.icon)} ${escapeHtml(category.label)} <small>${category.type}</small></span><button class="secondary-button edit-category" data-id="${escapeHtml(category.id)}" type="button">Edit</button><button class="icon-button danger delete-category" data-id="${escapeHtml(category.id)}" aria-label="Delete ${escapeHtml(category.label)}">✕</button></div>`).join("")}</div></div></details>
        <details id="ledgerAccountsPanel" class="card panel ledger-collapsible"${ledgerAccountsOpen ? " open" : ""}><summary><div><span class="eyebrow">Cash Locations</span><h3>Account Manager</h3></div><span class="ledger-collapsible-meta">${state.ledgerAccounts.length} accounts</span></summary><div class="ledger-collapsible-content"><form id="ledgerAccountForm" class="category-form"><label>Icon<input name="icon" maxlength="12" value="🏦" required></label><label>Name<input name="name" maxlength="40" placeholder="Account name" required></label><label>Type<select name="type"><option value="bank">Bank</option><option value="wallet">Wallet</option><option value="investment">Investment</option></select></label><label>Opening balance (MYR)<input name="openingBalance" type="number" min="0" step="0.01" value="0" required></label><button class="primary-button" type="submit">Add Account</button></form><p id="ledgerAccountError" class="form-error" role="alert"></p><div class="ledger-account-manager">${balances.map(({ account, balance }) => `<article class="ledger-managed-account"><header><div class="ledger-managed-account-title"><span class="ledger-managed-account-icon" aria-hidden="true">${escapeHtml(account.icon ?? "•")}</span><div><strong>${escapeHtml(account.name)}</strong><small>${accountTypeMeta(account.type).label}</small></div></div><div class="ledger-managed-account-actions"><button class="secondary-button edit-account" data-id="${escapeHtml(account.id)}" type="button" aria-label="Edit ${escapeHtml(account.name)}">Edit</button><button class="icon-button danger delete-account" data-id="${escapeHtml(account.id)}" type="button" aria-label="Delete ${escapeHtml(account.name)}">✕</button></div></header><div class="ledger-managed-account-balances"><div><small>Opening balance</small><strong>${money(account.openingBalance)}</strong></div><div><small>Current balance</small><strong class="${balance >= 0 ? "income" : "expense"}">${balance < 0 ? "−" : ""}${money(Math.abs(balance))}</strong></div></div>${account.type === "investment" ? `<label class="account-portfolio-link"><input type="checkbox" class="toggle-portfolio-link" data-id="${escapeHtml(account.id)}"${account.holdsTrackedPortfolio ? " checked" : ""}><span>This account holds my tracked portfolio<small>${account.holdsTrackedPortfolio ? "Net worth uses the portfolio's market value for this account instead of the balance above, so the same money is not counted twice." : "Tick this if the balance above is the value of the shares recorded in Portfolio. Leave it off for brokerage cash or money-market funds."}</small></span></label>` : ""}</article>`).join("")}</div></div></details>
      </div>
    </div>`;
}

function bucketsTemplate(state: WealthState): string {
  // Bucket allocation facts come from the canonical budget read model.
  const bucketCards = getBudgetSnapshot(state).buckets.map((bucket) => {
    const index = bucket.index;
    const width = bucket.allocationRatio * 100;
    return '<article class="card data-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<span class="eyebrow">' + escapeHtml(bucket.name) + '</span>' +
        '<button class="edit-bucket secondary-button" data-index="' + index + '" type="button" style="font-size:11px;padding:4px 8px;">Edit</button>' +
      '</div>' +
      '<h3>' + escapeHtml(bucket.label) + '</h3>' +
      '<strong>' + money(bucket.amount) + '</strong>' +
      '<div class="bar"><span style="width:' + width + '%"></span></div>' +
      '<small style="color:var(--ink-3);">' + (bucket.cadence === "monthly" ? "Monthly" : "One-time") + ' · ' + escapeHtml(bucket.note) + '</small>' +
      '<div class="bucket-edit-form" id="bucketEdit' + index + '" style="display:none;margin-top:12px;">' +
        '<form class="form-grid bucketForm" data-index="' + index + '">' +
          '<label>Name<input name="name" type="text" value="' + escapeHtml(bucket.name) + '"></label>' +
          '<label>Label<input name="label" type="text" value="' + escapeHtml(bucket.label) + '"></label>' +
          '<label>Cadence<select name="cadence"><option value="monthly"' + (bucket.cadence === "monthly" ? " selected" : "") + '>Monthly</option><option value="one-time"' + (bucket.cadence === "one-time" ? " selected" : "") + '>One-time</option></select></label>' +
          numberInput("amount", "Amount MYR", String(bucket.amount), "1") +
          '<label>Note<textarea name="note" rows="2">' + escapeHtml(bucket.note) + '</textarea></label>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
            '<button class="primary-button" type="submit" style="font-size:12px;padding:5px 10px;">Save</button>' +
            '<button class="secondary-button cancel-bucket-edit" type="button" data-index="' + index + '" style="font-size:12px;padding:5px 10px;">Cancel</button>' +
            '<button class="danger-button delete-bucket" type="button" data-index="' + index + '" style="font-size:12px;padding:5px 10px;">Delete</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
      '</article>';
  }).join("");

  const addBucketCard = '<article class="card data-card" style="display:flex;align-items:center;justify-content:center;min-height:120px;border-style:dashed;cursor:pointer;" id="addBucketBtn">' +
    '<div style="text-align:center;color:var(--ink-3);">' +
      '<div style="font-size:24px;margin-bottom:4px;">+</div>' +
      '<span>Add Bucket</span>' +
    '</div>' +
  '</article>';

  return `
    <div class="section-title"><span class="eyebrow">Capital Routing</span><h3>Monthly Fund Allocation Matrix</h3><p>Give every ringgit a clear purpose to reduce emotional spending and impulsive investing.</p></div>
    ${leakInsightStrip(state, ["budget"], "Budget signal")}
    <div class="three-col-grid">
      ${bucketCards}
      ${addBucketCard}
    </div>
  `;
}

function goalsTemplate(state: WealthState): string {
  // Goal facts come from the canonical read model.
  const goalCards = getGoalsSnapshot(state).ordered.map((snapshot) => {
    const goal = state.goals[snapshot.index];
    const originalIndex = snapshot.index;
    const current = snapshot.currentAmount;
    const linkedAccount = snapshot.linkedAccountName;
    const ratio = snapshot.progress;
    const months = snapshot.estimatedMonthsToTarget;
    const color = ratio >= 0.8 ? "var(--green)" : ratio >= 0.4 ? "var(--amber)" : "var(--ink)";
    const barColor = ratio >= 0.8 ? "var(--green)" : ratio >= 0.4 ? "var(--amber)" : "var(--blue)";
    const extra = months ? " · " + months + " months" : "";
    return '<article class="card data-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<span class="eyebrow">' + escapeHtml(goal.name) + '</span>' +
        '<button class="edit-goal secondary-button" data-index="' + originalIndex + '" type="button" style="font-size:11px;padding:4px 8px;">Edit</button>' +
      '</div>' +
      '<h3>' + escapeHtml(goal.label) + '</h3>' +
      '<strong style="color:' + color + ';">' + percent(ratio) + '</strong>' +
      '<div class="bar"><span style="width:' + Math.round(ratio * 100) + '%;background:' + barColor + ';"></span></div>' +
      '<small style="color:var(--ink-3);">' + money(current) + ' / ' + money(goal.target) + extra + '</small>' +
      '<small class="goal-account-link" style="color:var(--ink-3);">' + (linkedAccount ? 'Linked account: ' + escapeHtml(linkedAccount) : snapshot.isAccountLinked ? 'Linked account: Account unavailable' : 'Progress: Manual') + '</small>' +
      '<p>' + escapeHtml(goal.note) + '</p>' +
      '<div class="goal-edit-form" id="goalEdit' + originalIndex + '" style="display:none;margin-top:12px;">' +
        '<form class="form-grid goalForm" data-index="' + originalIndex + '">' +
          '<label>Name<input name="name" type="text" value="' + escapeHtml(goal.name) + '"></label>' +
          '<label>Label<input name="label" type="text" value="' + escapeHtml(goal.label) + '"></label>' +
          numberInput("current", "Current MYR", String(goal.current), "1") +
          numberInput("target", "Target MYR", String(goal.target), "1") +
          numberInput("monthlyContribution", "Monthly MYR", String(goal.monthlyContribution), "1") +
          '<label>Linked account<select name="accountId"><option value="">Manual progress</option>' + state.ledgerAccounts.map((account) => '<option value="' + escapeHtml(account.id) + '"' + (account.id === goal.accountId ? ' selected' : '') + '>' + escapeHtml(account.name) + '</option>').join('') + '</select></label>' +
          '<label>Note<textarea name="note" rows="2">' + escapeHtml(goal.note) + '</textarea></label>' +
          '<p class="form-error goal-form-error" role="alert" hidden></p>' +
          '<div style="display:flex;gap:8px;">' +
            '<button class="primary-button save-goal" type="button">Save</button>' +
            '<button class="secondary-button cancel-goal-edit" type="button" data-index="' + originalIndex + '">Cancel</button>' +
            '<button class="danger-button delete-goal" type="button" data-index="' + originalIndex + '">Delete</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
      '</article>';
  }).join("");

  // A real button: the card was previously an <article> with a click handler,
  // so it could not be reached or activated from the keyboard.
  const addGoalCard = '<button class="card data-card" type="button" style="display:flex;align-items:center;justify-content:center;min-height:120px;border-style:dashed;cursor:pointer;width:100%;" id="addGoalBtn">' +
    '<div style="text-align:center;color:var(--ink-3);">' +
      '<div style="font-size:24px;margin-bottom:4px;" aria-hidden="true">+</div>' +
      '<span>Add Goal</span>' +
    '</div>' +
  '</button>';

  // With no goals the page was otherwise blank: no explanation of what a goal
  // is for, and nothing but a dashed card to click.
  const goalsEmptyState = state.goals.length === 0
    ? '<p class="empty-state">No goals yet. A goal gives a specific amount of money a job — a trip, a purchase, a buffer — so surplus stops drifting. Add one to start tracking progress against a target.</p>'
    : "";

  return `
    <div class="section-title"><span class="eyebrow">Goal System</span><h3>Goals and Wishlist</h3><p>Goals do not restrict your life; they give every ringgit a clear direction.</p></div>
    ${leakInsightStrip(state, ["goal"], "Goal pace")}
    ${goalsEmptyState}
    <div class="two-col-grid">
      ${goalCards}
      ${addGoalCard}
    </div>
  `;
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

function rulesTemplate(state: WealthState): string {
  const rulesBudget = getBudgetSnapshot(state);
  const defaultItems: Array<{ id: RuleCardId; title: string; body: string }> = [
    { id: "monthly-cashflow", title: "Monthly Cashflow", body: "💰 " + money(rulesBudget.plannedAllowance) + " allowance, " + money(rulesBudget.plannedSpending) + " basic spending, " + money(rulesBudget.plannedSurplus) + " assignable surplus." },
    { id: "dca-mandate", title: "DCA Mandate", body: "📈 " + money(state.dca.monthly) + " per month. VOO " + percent(state.dca.targets.VOO) + " / QQQM " + percent(state.dca.targets.QQQM) + "." },
    { id: "emergency-fund", title: "Emergency Fund", body: "🛡️ " + money(state.emergency.current) + " / " + money(state.emergency.target) + ". Estimated annual yield: " + money(projectedAnnualEmergencyYield(state)) + "." },
    { id: "opportunity-reserve", title: "Opportunity Reserve", body: "🎯 " + money(state.opportunity.total) + " one-time reserve. Split " + money(state.opportunity.allocation.VOO) + " VOO / " + money(state.opportunity.allocation.QQQM) + " QQQM." },
    { id: "bear-market-deployment", title: "Bear Market Deployment", body: "🐻 -10% deploy MYR 80, -15% deploy MYR 120, -20% deploy MYR 200." },
    { id: "age-stage-policy", title: "Age-stage Policy", body: "👤 At " + state.profile.age + ", growth assets may dominate only while emergency and cashflow rules remain intact." },
    { id: "data-safety", title: "Data Safety", body: "💾 All data is stored locally in this browser. Export JSON before switching browsers or devices." },
  ];
  const items = defaultItems.map((item) => ({ ...item, ...state.ruleCardOverrides[item.id] }));
  const cards = items
    .filter((item) => !state.hiddenRuleIds.includes(item.id))
    .map((item) => '<article class="card data-card rule-card"><div class="rule-card-head"><span class="eyebrow">' + escapeHtml(item.title) + '</span><div class="rule-card-actions"><button class="secondary-button edit-rule" data-rule-id="' + item.id + '" type="button" aria-label="Edit ' + escapeHtml(item.title) + ' rule">Edit</button><button class="icon-button danger delete-rule" data-rule-id="' + item.id + '" type="button" aria-label="Delete ' + escapeHtml(item.title) + ' rule" title="Delete rule">X</button></div></div><p style="white-space:pre-wrap;">' + escapeHtml(item.body) + '</p><form class="rule-edit-form" data-rule-id="' + item.id + '" hidden><label>Title<input name="title" maxlength="80" required value="' + escapeHtml(item.title) + '"></label><label>Content<textarea name="body" maxlength="2000" rows="5" required>' + escapeHtml(item.body) + '</textarea></label><p class="form-error" role="alert"></p><div class="rule-form-actions"><button class="primary-button" type="submit">Save</button><button class="secondary-button cancel-rule-edit" type="button">Cancel</button></div></form></article>');
  if (state.ruleNotesList.length > 0) {
    state.ruleNotesList.forEach((note) => {
      const title = note.title || "Personal Rule Notes";
      cards.push('<article class="card data-card rule-card"><div class="rule-card-head"><span class="eyebrow">' + escapeHtml(title) + '</span><div class="rule-card-actions"><button class="secondary-button edit-rule-notes" data-note-id="' + note.id + '" type="button" aria-label="Edit ' + escapeHtml(title) + '">Edit</button><button class="icon-button danger delete-rule-notes" data-note-id="' + note.id + '" type="button" aria-label="Delete ' + escapeHtml(title) + '" title="Delete note">X</button></div></div><p style="white-space:pre-wrap;">' + escapeHtml(note.body.trim()) + '</p></article>');
    });
  } else if (state.ruleNotes.trim()) {
    cards.push('<article class="card data-card rule-card"><div class="rule-card-head"><span class="eyebrow">' + escapeHtml(state.ruleNoteTitle || "Personal Rule Notes") + '</span><div class="rule-card-actions"><button class="secondary-button edit-rule-notes" type="button" aria-label="Edit personal rule notes">Edit</button><button class="icon-button danger delete-rule-notes" type="button" aria-label="Delete personal rule notes" title="Delete rule">X</button></div></div><p style="white-space:pre-wrap;">' + escapeHtml(state.ruleNotes.trim()) + '</p></article>');
  }
  return leakInsightStrip(state, ["debt", "budget", "goal"], "Rule check") + '<div class="three-col-grid">' + (cards.join("") || '<p class="empty-state">No rule cards remain. Add personal notes below to create a new rule.</p>') + '</div>' +
    '<article class="card panel" style="margin-top:16px;">' +
      '<div class="panel-head"><div><span class="eyebrow">Custom Rules</span><h3>Rule Notes</h3></div><span style="color:var(--muted);font-size:12px;">Up to 5,000 characters</span></div>' +
      '<form id="ruleNotesForm">' +
        '<label for="ruleNoteTitle">Title</label>' +
        '<input id="ruleNoteTitle" name="ruleNoteTitle" maxlength="80" value="" placeholder="e.g. Monthly Cashflow">' +
        '<label for="ruleNotes">Add reminders, principles, or action items to your rules</label>' +
        '<textarea id="ruleNotes" name="ruleNotes" maxlength="5000" rows="8" placeholder="Write your personal rules here..."></textarea>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-top:10px;">' +
          '<button class="primary-button" type="submit">Save Notes</button>' +
          '<span id="ruleNotesStatus" role="status" style="color:var(--green);font-size:12px;"></span>' +
        '</div>' +
      '</form>' +
    '</article>';
}

function reviewTemplate(state: WealthState): string {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const close = monthlyClose(state, month);
  const snapshot = getFinancialSnapshot(state, now);
  const reviewRows = state.reviews.map((review) => {
    return '<article class="review-item"><div style="display:flex;justify-content:space-between;align-items:flex-start;"><strong>' + escapeHtml(review.month) + '</strong><button class="icon-button danger delete-review" data-id="' + review.id + '" type="button" aria-label="Delete review for ' + escapeHtml(review.month) + '" title="Delete review">🗑️</button></div><span>Income ' +
      money(review.income) + ' · Spending ' + money(review.spending) + ' · Score ' +
      review.disciplineScore + '/100</span><p>' + escapeHtml(review.notes || "No notes") + '</p></article>';
  }).join("");

  return `
    ${leakInsightStrip(state, ["fee", "duplicate", "subscription", "budget", "goal", "debt"], "Monthly review signal")}
    <div class="terminal-grid">
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Monthly Close</span><h3>Monthly Review</h3></div><span style="color:var(--muted);font-size:12px;">Discipline</span></div>
        <form id="reviewForm" class="form-grid">
          <label>Month<input name="month" type="month" required value="${month}"></label>
          ${numberInput("income", "Income MYR", String(snapshot.currentMonthIncome), "1")}
          ${numberInput("spending", "Spending MYR", String(snapshot.currentMonthExpenses), "1")}
          <label>DCA Done?<select name="dcaDone"><option value="true"${close.dcaDone ? " selected" : ""}>Yes</option><option value="false"${!close.dcaDone ? " selected" : ""}>No</option></select></label>
          ${numberInput("disciplineScore", "Discipline Score", String(close.disciplineScore), "1")}
          <p class="wide-field panel-note">Calculated from ${money(snapshot.currentMonthIncome)} income, ${money(snapshot.currentMonthExpenses)} spending and ${money(close.dcaInvested)} invested this month.</p>
          <label class="wide-field">Notes<textarea name="notes" rows="4" placeholder="This month's cash flow, investment discipline, and next month's actions"></textarea></label>
          <button class="primary-button" type="submit">Save Review</button>
        </form>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Review Log</span><h3>Review History</h3></div><span style="color:var(--muted);font-size:12px;">${state.reviews.length} months</span></div>
        <div class="review-list">${reviewRows || '<p class="empty-state">No monthly reviews yet.</p>'}</div>
      </article>
    </div>
  `;
}

function settingsTemplate(state: WealthState): string {
  return `
    <div class="section-title"><span class="eyebrow">Configuration</span><h3>Profile and Parameters</h3><p>Adjust your investor profile, cash flow, and investment parameters.</p></div>
    <div class="settings-grid">
      <article class="card settings-section">
        <h3>👤 Investor Profile</h3>
        <form id="profileForm" class="form-grid">
          <label>Name<input name="name" type="text" value="${escapeHtml(state.profile.name)}"></label>
          <label>Age<input name="age" type="number" min="16" max="100" step="1" value="${state.profile.age}"></label>
          <label>Risk Tolerance<select name="riskTolerance"><option${state.profile.riskTolerance === "High" ? " selected" : ""}>High</option><option${state.profile.riskTolerance === "Medium" ? " selected" : ""}>Medium</option><option${state.profile.riskTolerance === "Low" ? " selected" : ""}>Low</option></select></label>
          <label>Stage<select name="stage"><option${state.profile.stage === "Student" ? " selected" : ""}>Student</option><option${state.profile.stage === "Early Career" ? " selected" : ""}>Early Career</option><option${state.profile.stage === "Mid Career" ? " selected" : ""}>Mid Career</option><option${state.profile.stage === "Pre-Retirement" ? " selected" : ""}>Pre-Retirement</option></select></label>
          ${numberInput("investmentHorizonYears", "Investment Horizon (years)", String(state.profile.investmentHorizonYears), "1")}
          <label>Base Currency<select name="baseCurrency"><option${state.profile.baseCurrency === "MYR" ? " selected" : ""}>MYR</option><option${state.profile.baseCurrency === "USD" ? " selected" : ""}>USD</option></select></label>
          <button class="primary-button" type="submit">Save Profile</button>
        </form>
      </article>
      <article class="card settings-section">
        <h3>Recurring Cash Flow</h3>
        <form id="recurringForm" class="form-grid"><label>Label<input name="label" maxlength="60" required></label>${numberInput("amount", "Amount MYR", "", "0.01")}<label>Type<select name="type"><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Day of month<input name="dayOfMonth" type="number" min="1" max="31" value="1" required><small class="field-hint">If a month is shorter, it runs on the last day.</small></label><button class="primary-button" type="submit">Add recurring item</button></form>
        <div class="settings-list">${state.recurringTransactions.map((item) => `<div><span>${escapeHtml(item.label)} · ${item.type} · day ${item.dayOfMonth}${item.dayOfMonth >= 29 ? " · short-month fallback" : ""}</span><strong>${money(item.amount)}</strong><button class="icon-button danger delete-recurring" data-id="${escapeHtml(item.id)}" aria-label="Delete recurring item">✕</button></div>`).join("") || '<p class="empty-state">No recurring items.</p>'}</div>
      </article>
      <article class="card settings-section">
        <h3>Liabilities</h3>
        <form id="liabilityForm" class="form-grid"><label>Name<input name="name" maxlength="60" required></label>${numberInput("balance", "Balance MYR", "", "0.01")}${numberInput("annualRate", "Annual rate %", "0", "0.01")}${numberInput("minimumPayment", "Minimum payment MYR", "0", "0.01")}<button class="primary-button" type="submit">Add liability</button></form>
        <div class="settings-list">${state.liabilities.map((item) => `<div><span>${escapeHtml(item.name)} · ${item.annualRate.toFixed(2)}%</span><strong>${money(item.balance)}</strong><button class="icon-button danger delete-liability" data-id="${escapeHtml(item.id)}" aria-label="Delete liability">✕</button></div>`).join("") || '<p class="empty-state">No liabilities recorded.</p>'}</div>
      </article>
      <article class="card settings-section">
        <h3>Privacy</h3><form id="privacyForm"><label class="setting-check"><input name="maskAmounts" type="checkbox"${state.privacy.maskAmounts ? " checked" : ""}>Mask financial amounts on screen</label><label class="setting-check"><input name="requireExportConfirmation" type="checkbox"${state.privacy.requireExportConfirmation ? " checked" : ""}>Confirm before exporting financial data</label><button class="primary-button" type="submit">Save privacy</button></form>
      </article>
      <article class="card settings-section">
        <h3>💰 Cashflow & DCA</h3>
        <form id="cashflowForm" class="form-grid">
          ${numberInput("allowance", "Monthly Allowance MYR", String(state.cashflow.allowance), "1")}
          ${numberInput("transport", "Transport MYR", String(state.cashflow.transport), "1")}
          ${numberInput("food", "Food MYR", String(state.cashflow.food), "1")}
          ${numberInput("otherFixed", "Other Fixed MYR", String(state.cashflow.otherFixed), "1")}
          ${numberInput("irregularIncome", "Irregular Income MYR", String(state.cashflow.irregularIncome), "1")}
          ${numberInput("dcaMonthly", "DCA Monthly MYR", String(state.dca.monthly), "1")}
          <button class="primary-button" type="submit">Save Cashflow</button>
        </form>
      </article>
      <article class="card settings-section">
        <h3>🛡️ Emergency Fund</h3>
        <form id="emergencyForm" class="form-grid">
          ${numberInput("current", "Current Emergency MYR", String(state.emergency.current), "1")}
          ${numberInput("target", "Target Emergency MYR", String(state.emergency.target), "1")}
          ${numberInput("monthlyTopUp", "Monthly Top-Up MYR", String(state.emergency.monthlyTopUp), "1")}
          ${numberInput("annualYield", "Annual Yield %", String(state.emergency.annualYield * 100), "0.01")}
          <button class="primary-button" type="submit">Save Emergency</button>
        </form>
      </article>
      <article class="card settings-section">
        <h3>🎯 DCA Targets</h3>
        <form id="targetsForm" class="form-grid">
          ${numberInput("vooTarget", "VOO Target %", String(Math.round(state.dca.targets.VOO * 100)), "1")}
          ${numberInput("qqqmTarget", "QQQM Target %", String(Math.round(state.dca.targets.QQQM * 100)), "1")}
          ${numberInput("opportunityTotal", "Opportunity Reserve MYR", String(state.opportunity.total), "1")}
          ${numberInput("vooAlloc", "Opportunity VOO MYR", String(state.opportunity.allocation.VOO), "1")}
          ${numberInput("qqqmAlloc", "Opportunity QQQM MYR", String(state.opportunity.allocation.QQQM), "1")}
          <button class="primary-button" type="submit">Save Targets</button>
        </form>
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
    bindPortfolio(root, state, setState, navigate);
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
  if (activePage === "review") bindReview(root, state, setState, navigate);
  if (activePage === "settings") bindSettings(root, state, setState, navigate);
  if (activePage === "goals") bindGoals(root, state, setState, navigate);
  if (activePage === "market") bindMarket(root, state, setState);
  if (activePage === "ledger") bindLedger(root, state, setState, navigate);
  if (activePage === "buckets") bindBuckets(root, state, setState, navigate);
  if (activePage === "rules") bindRules(root, state, setState, navigate);
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

function bindRules(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  const showRules = (next: WealthState, label: string): void => {
    setState(next, label);
    if (navigate) navigate("rules");
    else renderApp(root, next, setState, "rules");
  };

  root.querySelectorAll<HTMLButtonElement>(".edit-rule").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest<HTMLElement>(".rule-card")?.querySelector<HTMLFormElement>(".rule-edit-form");
      if (!form) return;
      form.hidden = false;
      button.closest<HTMLElement>(".rule-card")?.classList.add("editing");
      form.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".cancel-rule-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>(".rule-card");
      const form = button.closest<HTMLFormElement>(".rule-edit-form");
      if (form) form.hidden = true;
      card?.classList.remove("editing");
    });
  });

  root.querySelectorAll<HTMLFormElement>(".rule-edit-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const ruleId = form.dataset.ruleId as RuleCardId | undefined;
      const error = form.querySelector<HTMLElement>(".form-error");
      const data = new FormData(form);
      const title = String(data.get("title") ?? "").trim().slice(0, 80);
      const body = String(data.get("body") ?? "").trim().slice(0, 2000);
      if (!ruleId || !title || !body) {
        if (error) error.textContent = "Title and content are required.";
        return;
      }
      showRules({ ...state, ruleCardOverrides: { ...state.ruleCardOverrides, [ruleId]: { title, body } } }, "Edit rule card");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-rule").forEach((button) => {
    button.addEventListener("click", () => {
      const ruleId = button.dataset.ruleId as RuleCardId | undefined;
      if (!ruleId || state.hiddenRuleIds.includes(ruleId) || !confirm("Delete this rule card? A snapshot will be saved first.")) return;
      showRules({ ...state, hiddenRuleIds: [...state.hiddenRuleIds, ruleId] }, "Delete rule card");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-rule-notes").forEach((btn) => {
    btn.addEventListener("click", () => {
      const noteId = btn.dataset.noteId;
      if (!confirm("Delete this rule note? A snapshot will be saved first.")) return;
      if (noteId) {
        const nextNotes = state.ruleNotesList.filter((n) => n.id !== noteId);
        showRules({ ...state, ruleNotesList: nextNotes }, "Delete rule note");
      } else {
        showRules({ ...state, ruleNoteTitle: "", ruleNotes: "" }, "Delete rule notes");
      }
    });
  });

    let editingNoteId: string | null = null;
    let lastUpdatedState: WealthState | null = null;
  root.querySelectorAll<HTMLButtonElement>(".edit-rule-notes").forEach((btn) => {
    btn.addEventListener("click", () => {
      const noteId = btn.dataset.noteId;
      const titleInput = root.querySelector<HTMLInputElement>("#ruleNoteTitle");
      const notesInput = root.querySelector<HTMLTextAreaElement>("#ruleNotes");
      if (noteId) {
        const note = state.ruleNotesList.find((n) => n.id === noteId);
        if (note) {
          if (titleInput) titleInput.value = note.title;
          if (notesInput) notesInput.value = note.body;
          editingNoteId = noteId;
        }
      } else {
        if (titleInput) titleInput.value = state.ruleNoteTitle;
        if (notesInput) notesInput.value = state.ruleNotes;
        editingNoteId = null;
      }
      titleInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      titleInput?.focus({ preventScroll: true });
    });
  });

  root.querySelector<HTMLFormElement>("#ruleNotesForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const title = String(data.get("ruleNoteTitle") ?? "").trim().slice(0, 80);
    const body = String(data.get("ruleNotes") ?? "").slice(0, 5000);
    if (!body.trim()) return;
    // Use lastUpdatedState when available so multiple sequential edits/adds
    // build on the latest persisted list instead of the stale closure `state`.
    const baseState = lastUpdatedState ?? state;
    if (editingNoteId) {
      const nextNotes = baseState.ruleNotesList.map((n) => n.id === editingNoteId ? { ...n, title, body } : n);
      lastUpdatedState = { ...baseState, ruleNotesList: nextNotes };
      setState(lastUpdatedState, "Edit rule note");
    } else {
      const newNote: RuleNote = { id: `rulenote-${Date.now()}-${Math.random().toString(16).slice(2)}`, title, body, createdAt: Date.now() };
      lastUpdatedState = { ...baseState, ruleNotesList: [...baseState.ruleNotesList, newNote] };
      setState(lastUpdatedState, "Add rule note");
    }
    const updatedState = lastUpdatedState ?? state;
    renderApp(root, updatedState, setState, "rules", navigate);
  });
}

function bindLedger(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  const refresh = (next = state, label?: string, preserveScroll = false) => {
    const anchorTop = preserveScroll
      ? root.querySelector<HTMLElement>(".ledger-filters")?.getBoundingClientRect().top
      : undefined;
    const scrollPosition = preserveScroll
      ? { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 }
      : null;
    if (preserveScroll) suppressLedgerAmountFocus = true;
    if (next !== state) setState(next, label);
    renderApp(root, next, setState, "ledger", navigate);
    if (!scrollPosition) return;

    const restoreScroll = () => {
      const nextAnchorTop = root.querySelector<HTMLElement>(".ledger-filters")?.getBoundingClientRect().top;
      if (anchorTop !== undefined && nextAnchorTop !== undefined) {
        window.scrollBy(0, nextAnchorTop - anchorTop);
      } else {
        window.scrollTo(scrollPosition.x, scrollPosition.y);
        document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
      }
    };
    restoreScroll();
    requestAnimationFrame(() => {
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    });
  };

  root.querySelector<HTMLDetailsElement>("#ledgerHistoryPanel")?.addEventListener("toggle", (event) => {
    ledgerHistoryOpen = (event.currentTarget as HTMLDetailsElement).open;
  });
  root.querySelector<HTMLDetailsElement>("#ledgerCategoriesPanel")?.addEventListener("toggle", (event) => {
    ledgerCategoriesOpen = (event.currentTarget as HTMLDetailsElement).open;
  });
  root.querySelector<HTMLDetailsElement>("#ledgerAccountsPanel")?.addEventListener("toggle", (event) => {
    ledgerAccountsOpen = (event.currentTarget as HTMLDetailsElement).open;
  });
  root.querySelectorAll<HTMLDetailsElement>("[data-ledger-account-group]").forEach((group) => {
    group.addEventListener("toggle", () => {
      const type = group.dataset.ledgerAccountGroup as LedgerAccountType | undefined;
      if (type) ledgerAccountGroupsOpen[type] = group.open;
    });
  });

  if (suppressLedgerAmountFocus) {
    suppressLedgerAmountFocus = false;
  } else {
    root.querySelector<HTMLInputElement>("#ledgerAmount")?.focus({ preventScroll: true });
  }
  root.querySelectorAll<HTMLButtonElement>("[data-ledger-type]").forEach((button) => button.addEventListener("click", () => {
    const type = button.dataset.ledgerType as LedgerTransactionType;
    const form = root.querySelector<HTMLFormElement>("#ledgerForm");
    ledgerEntryDraft = {
      amount: (form?.elements.namedItem("amount") as HTMLInputElement | null)?.value ?? "",
      accountId: (form?.elements.namedItem("accountId") as HTMLSelectElement | null)?.value ?? ledgerEntryDraft.accountId,
      fromAccountId: (form?.elements.namedItem("fromAccountId") as HTMLSelectElement | null)?.value ?? ledgerEntryDraft.fromAccountId,
      toAccountId: (form?.elements.namedItem("toAccountId") as HTMLSelectElement | null)?.value ?? ledgerEntryDraft.toAccountId,
      date: (form?.elements.namedItem("date") as HTMLInputElement | null)?.value ?? "",
      note: (form?.elements.namedItem("note") as HTMLInputElement | null)?.value ?? "",
    };
    ledgerEditingId = "";
    ledgerEntryType = type;
    renderApp(root, { ...state, ledgerTransactions: state.ledgerTransactions }, setState, "ledger", navigate);
  }));

  root.querySelector<HTMLFormElement>("#ledgerForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const amount = normalizeLedgerAmount(String(data.get("amount") ?? ""));
    const type = String(data.get("type")) as LedgerTransactionType;
    const categoryId = String(data.get("categoryId") ?? "");
    const accountId = String(data.get("accountId") ?? "");
    const fromAccountId = String(data.get("fromAccountId") ?? "");
    const toAccountId = String(data.get("toAccountId") ?? "");
    const dateValue = String(data.get("date") ?? "");
    const date = new Date(`${dateValue}T00:00:00`);
    const error = root.querySelector<HTMLElement>("#ledgerFormError");
    const accountIds = new Set(state.ledgerAccounts.map((account) => account.id));
    const categoryValid = type === "transfer" || state.ledgerCategories.some((category) => category.id === categoryId && category.type === type);
    const accountValid = type === "transfer" ? accountIds.has(fromAccountId) && accountIds.has(toAccountId) && fromAccountId !== toAccountId : accountIds.has(accountId);
    if (!amount || !["income", "expense", "transfer"].includes(type) || !categoryValid || !accountValid || !Number.isFinite(date.getTime())) {
      if (error) {
        error.textContent = type === "transfer" && state.ledgerAccounts.length < 2
          ? "Add at least two accounts before recording a transfer."
          : type === "transfer" && fromAccountId === toAccountId
            ? "Choose two different accounts for a transfer."
            : "Enter a positive amount, valid date, and valid account details.";
      }
      return;
    }
    const id = String(data.get("id") || createId("ledger"));
    const note = String(data.get("note") ?? "").trim().slice(0, 500);
    const transaction: LedgerTransaction = type === "transfer"
      ? { id, amount, type, fromAccountId, toAccountId, date: date.toISOString(), ...(note ? { note } : {}) }
      : { id, amount, type, categoryId, accountId, date: date.toISOString(), ...(note ? { note } : {}) };
    const exists = state.ledgerTransactions.some((item) => item.id === id);
    const ledgerTransactions = exists ? state.ledgerTransactions.map((item) => item.id === id ? transaction : item) : [...state.ledgerTransactions, transaction];
    resetLedgerEntry();
    refresh({ ...state, ledgerTransactions }, exists ? "Edit ledger transaction" : "Add ledger transaction");
  });

  root.querySelectorAll<HTMLButtonElement>(".edit-ledger").forEach((button) => button.addEventListener("click", () => {
    ledgerEditingId = button.dataset.id ?? "";
    refresh();
  }));
  root.querySelector<HTMLButtonElement>("#cancelLedgerEdit")?.addEventListener("click", () => {
    resetLedgerEntry();
    refresh();
  });
  root.querySelectorAll<HTMLButtonElement>(".delete-ledger").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    if (!id || !confirm("Delete this transaction? A snapshot will be saved first.")) return;
    refresh({ ...state, ledgerTransactions: state.ledgerTransactions.filter((item) => item.id !== id) }, "Delete ledger transaction");
  }));

  const applyFilters = () => {
    const form = root.querySelector<HTMLFormElement>("#ledgerFilterForm");
    if (!form) return;
    const data = new FormData(form);
    ledgerFilters = { ...ledgerFilters, startDate: String(data.get("startDate") ?? ""), endDate: String(data.get("endDate") ?? ""), type: String(data.get("type")) as LedgerFilters["type"], categoryId: String(data.get("categoryId") ?? ""), query: String(data.get("query") ?? "") };
    refresh(state, undefined, true);
  };
  root.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => button.addEventListener("click", () => { ledgerFilters.preset = button.dataset.preset as LedgerFilters["preset"]; applyFilters(); }));
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#ledgerFilterForm input, #ledgerFilterForm select").forEach((field) => field.addEventListener("change", applyFilters));
  root.querySelector<HTMLInputElement>('#ledgerFilterForm input[name="query"]')?.addEventListener("search", applyFilters);
  root.querySelector<HTMLButtonElement>("#resetLedgerFilters")?.addEventListener("click", () => { ledgerFilters = { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "" }; refresh(state, undefined, true); });

  root.querySelector<HTMLFormElement>("#ledgerCategoryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const label = String(data.get("label") ?? "").trim().slice(0, 40);
    const icon = String(data.get("icon") ?? "").trim().slice(0, 12) || "•";
    const type = String(data.get("type")) as LedgerTransactionType;
    if (!label || !["income", "expense"].includes(type)) return;
    refresh({ ...state, ledgerCategories: [...state.ledgerCategories, { id: createId("category"), label, icon, type }] }, "Add ledger category");
  });
  root.querySelectorAll<HTMLButtonElement>(".edit-category").forEach((button) => button.addEventListener("click", () => {
    const category = state.ledgerCategories.find((item) => item.id === button.dataset.id);
    if (!category) return;
    const label = prompt("Category label", category.label)?.trim();
    if (!label) return;
    const icon = prompt("Category icon", category.icon)?.trim() || "•";
    refresh({ ...state, ledgerCategories: state.ledgerCategories.map((item) => item.id === category.id ? { ...item, label: label.slice(0, 40), icon: icon.slice(0, 12) } : item) }, "Edit ledger category");
  }));
  root.querySelectorAll<HTMLButtonElement>(".delete-category").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    if (!id) return;
    if (state.ledgerTransactions.some((transaction) => transaction.categoryId === id)) { alert("This category is used by existing transactions. Reassign or delete those transactions first."); return; }
    if (!confirm("Delete this unused category?")) return;
    refresh({ ...state, ledgerCategories: state.ledgerCategories.filter((category) => category.id !== id) }, "Delete ledger category");
  }));

  root.querySelector<HTMLFormElement>("#ledgerAccountForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const name = String(data.get("name") ?? "").trim().slice(0, 40);
    const icon = String(data.get("icon") ?? "").trim().slice(0, 12) || "•";
    const type = String(data.get("type")) as LedgerAccountType;
    const openingBalance = Number(data.get("openingBalance"));
    const error = root.querySelector<HTMLElement>("#ledgerAccountError");
    if (!name || !["bank", "wallet", "investment"].includes(type) || !Number.isFinite(openingBalance) || openingBalance < 0) {
      if (error) error.textContent = "Enter a name, valid type, and non-negative opening balance.";
      return;
    }
    refresh({ ...state, ledgerAccounts: [...state.ledgerAccounts, { id: createId("account"), name, icon, type, openingBalance: Math.round((openingBalance + Number.EPSILON) * 100) / 100 }] }, "Add ledger account");
  });
  root.querySelectorAll<HTMLButtonElement>(".edit-account").forEach((button) => button.addEventListener("click", () => {
    const account = state.ledgerAccounts.find((item) => item.id === button.dataset.id);
    if (!account) return;
    const name = prompt("Account name", account.name)?.trim();
    if (!name) return;
    const fallbackIcon = account.type === "bank" ? "🏦" : account.type === "wallet" ? "👛" : "📈";
    const icon = prompt("Account icon", account.icon ?? fallbackIcon)?.trim() || "•";
    const openingInput = prompt("Opening balance (MYR)", String(account.openingBalance));
    if (openingInput === null) return;
    const openingBalance = Number(openingInput);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) { alert("Opening balance must be a non-negative number."); return; }
    refresh({ ...state, ledgerAccounts: state.ledgerAccounts.map((item) => item.id === account.id ? { ...item, name: name.slice(0, 40), icon: icon.slice(0, 12), openingBalance: Math.round((openingBalance + Number.EPSILON) * 100) / 100 } : item) }, "Edit ledger account");
  }));
  // Mark an investment account as holding the tracked portfolio, so net worth
  // takes its value from the portfolio's market price instead of counting the
  // recorded balance on top of the holdings it already represents.
  root.querySelectorAll<HTMLInputElement>(".toggle-portfolio-link").forEach((input) => input.addEventListener("change", () => {
    const account = state.ledgerAccounts.find((item) => item.id === input.dataset.id);
    if (!account) return;
    const linked = input.checked;
    refresh({
      ...state,
      ledgerAccounts: state.ledgerAccounts.map((item) => {
        if (item.id !== account.id) return item;
        const { holdsTrackedPortfolio: _was, ...rest } = item;
        return linked ? { ...rest, holdsTrackedPortfolio: true } : rest;
      }),
    }, linked ? "Linked account to portfolio" : "Unlinked account from portfolio");
  }));

  root.querySelectorAll<HTMLButtonElement>(".delete-account").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    if (!id) return;
    const referenced = state.ledgerTransactions.some((transaction) => transaction.accountId === id || transaction.fromAccountId === id || transaction.toAccountId === id);
    if (referenced) { alert("This account is used by existing transactions. Reassign or delete those transactions first."); return; }
    if (state.ledgerAccounts.length <= 1) { alert("Keep at least one account so income and expenses have a valid destination."); return; }
    if (!confirm("Delete this unused account?")) return;
    refresh({ ...state, ledgerAccounts: state.ledgerAccounts.filter((account) => account.id !== id) }, "Delete ledger account");
  }));
}

function bindBuckets(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  const doNavigate = navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate));

  root.querySelectorAll<HTMLButtonElement>(".edit-bucket").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      const form = root.querySelector<HTMLElement>("#bucketEdit" + index);
      if (form) form.style.display = form.style.display === "none" ? "block" : "none";
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".cancel-bucket-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      const form = root.querySelector<HTMLElement>("#bucketEdit" + index);
      if (form) form.style.display = "none";
    });
  });

  root.querySelectorAll<HTMLFormElement>(".bucketForm").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const index = Number(form.dataset.index);
      const data = new FormData(form);
      const buckets = [...state.buckets];
      buckets[index] = {
        ...buckets[index],
        name: String(data.get("name") ?? buckets[index].name),
        label: String(data.get("label") ?? buckets[index].label),
        cadence: String(data.get("cadence") ?? buckets[index].cadence) as "monthly" | "one-time",
        amount: Number(data.get("amount")) || 0,
        note: String(data.get("note") ?? buckets[index].note),
      };
      const next = { ...state, buckets };
      setState(next);
      doNavigate("buckets");
    });
  });

  // Delete bucket
  root.querySelectorAll<HTMLButtonElement>(".delete-bucket").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!confirm("Delete this bucket?")) return;
      const buckets = state.buckets.filter((_, i) => i !== index);
      const next = { ...state, buckets };
      setState(next);
      doNavigate("buckets");
    });
  });

  // Add new bucket
  root.querySelector<HTMLElement>("#addBucketBtn")?.addEventListener("click", () => {
    const buckets = [...state.buckets, {
      id: createId("bucket"),
      name: "NEW BUCKET",
      label: "New Bucket",
      amount: 0,
      cadence: "monthly" as const,
      note: "",
    }];
    const next = { ...state, buckets };
    setState(next);
    doNavigate("buckets");
  });
}

function bindGoals(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  const doNavigate = navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate));

  // Edit button toggle
  root.querySelectorAll<HTMLButtonElement>(".edit-goal").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      const form = root.querySelector<HTMLElement>("#goalEdit" + index);
      if (form) form.style.display = form.style.display === "none" ? "block" : "none";
    });
  });

  // Cancel button
  root.querySelectorAll<HTMLButtonElement>(".cancel-goal-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      const form = root.querySelector<HTMLElement>("#goalEdit" + index);
      if (form) form.style.display = "none";
    });
  });

  // Save explicitly on click so the action remains reliable across browsers/PWA shells.
  root.querySelectorAll<HTMLFormElement>(".goalForm").forEach((form) => {
    const saveGoal = (): void => {
      const index = Number(form.dataset.index);
      const error = form.querySelector<HTMLElement>(".goal-form-error");
      const showError = (message: string): void => {
        if (!error) return;
        error.textContent = message;
        error.hidden = false;
      };
      if (!Number.isInteger(index) || index < 0 || index >= state.goals.length) {
        showError("This goal is no longer available. Please refresh the Goals page and try again.");
        return;
      }
      const data = new FormData(form);
      const name = String(data.get("name") ?? "").trim();
      const label = String(data.get("label") ?? "").trim();
      const current = Number(data.get("current"));
      const target = Number(data.get("target"));
      const monthlyContribution = Number(data.get("monthlyContribution"));
      if (!name || !label) {
        showError("Name and label are required.");
        return;
      }
      if (![current, target, monthlyContribution].every((value) => Number.isFinite(value) && value >= 0)) {
        showError("Current, target, and monthly amounts must be zero or more.");
        return;
      }
      const goals = [...state.goals];
      goals[index] = {
        ...goals[index],
        name,
        label,
        current,
        target,
        monthlyContribution,
        accountId: String(data.get("accountId") ?? "") || undefined,
        note: String(data.get("note") ?? goals[index].note),
      };
      const next = { ...state, goals };
      setState(next, "Updated goal");
      const saved = form.querySelector<HTMLElement>(".goal-form-error");
      if (saved) {
        saved.textContent = "Saved";
        saved.hidden = false;
        saved.classList.add("form-success");
      }
      renderApp(root, next, setState, "goals", navigate);
    };
    form.querySelector<HTMLButtonElement>(".save-goal")?.addEventListener("click", saveGoal);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveGoal();
    });
  });

  // Delete goal
  root.querySelectorAll<HTMLButtonElement>(".delete-goal").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!confirm("Delete this goal?")) return;
      const goals = state.goals.filter((_, i) => i !== index);
      // Re-pick the featured goal through the canonical model so completion
      // here matches what the Goals cards show.
      const overviewGoalId = state.overviewGoalId === state.goals[index]?.id
        ? getGoalsSnapshot({ ...state, goals, overviewGoalId: "" }).featuredGoalId
        : state.overviewGoalId;
      const next = { ...state, goals, overviewGoalId };
      setState(next);
      doNavigate("goals");
    });
  });

  // Add new goal
  root.querySelector<HTMLElement>("#addGoalBtn")?.addEventListener("click", () => {
    const goals = [...state.goals, {
      id: createId("goal"),
      name: "NEW GOAL",
      label: "New Goal",
      current: 0,
      target: 0,
      monthlyContribution: 0,
      note: "",
    }];
    const next = { ...state, goals };
    setState(next);
    doNavigate("goals");
  });
}

function bindPortfolio(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  // Toggle custom ticker input
  const tickerSelect = root.querySelector<HTMLSelectElement>("#tickerSelect");
  const customWrap = root.querySelector<HTMLElement>("#customTickerWrap");
  tickerSelect?.addEventListener("change", () => {
    if (customWrap) customWrap.style.display = tickerSelect.value === "__custom__" ? "block" : "none";
  });

  root.querySelector<HTMLFormElement>("#tradeForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    let ticker = String(data.get("ticker") ?? "");
    if (ticker === "__custom__") {
      ticker = String(data.get("customTicker") ?? "").toUpperCase().trim();
      if (!ticker) return;
    }
    const trade: Trade = {
      id: createId("trade"),
      date: String(data.get("date") ?? ""),
      platform: "moomoo",
      ticker,
      type: String(data.get("type")) as TradeType,
      amountMyr: Number(data.get("amountMyr")) || 0,
      amountUsd: Number(data.get("amountUsd")) || 0,
      priceUsd: Number(data.get("priceUsd")) || 0,
      units: Number(data.get("units")) || undefined,
      feeMyr: Number(data.get("feeMyr")) || 0,
      exchangeRate: Number(data.get("amountUsd")) > 0 ? Number(data.get("amountMyr")) / Number(data.get("amountUsd")) : getUsdToMyr(),
      notes: String(data.get("notes") ?? ""),
    };
    // Save custom ticker to memory if new
    const customTickers = state.customTickers.includes(ticker)
      ? state.customTickers
      : (ticker !== "VOO" && ticker !== "QQQM")
        ? [...state.customTickers, ticker]
        : state.customTickers;
    const next = { ...state, trades: [...state.trades, trade], customTickers };
    setState(next);
    renderApp(root, next, setState, "portfolio", navigate);
  });

  root.querySelector<HTMLInputElement>("#csvInput")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const records = recordsFromCsv(await file.text());
    const next = { ...state, trades: [...state.trades, ...records] };
    setState(next);
    renderApp(root, next, setState, "portfolio", navigate);
  });

  // Read a pasted exchange history. Parsing is separated from committing: the
  // summary states what was understood — how much money, over what span, at
  // what average rate — so a misparse is caught before it rewrites the ringgit
  // cost of every holding.
  root.querySelector<HTMLButtonElement>("#fxImport")?.addEventListener("click", () => {
    const box = root.querySelector<HTMLTextAreaElement>("#fxPaste");
    const status = root.querySelector<HTMLElement>("#fxImportStatus");
    if (!box || !status) return;
    const parsed = exchangesFromText(box.value);
    if (parsed.length === 0) {
      status.textContent = "No conversions found. Paste the list exactly as it appears, including the MYR / USD lines above each date.";
      return;
    }
    status.textContent = "";

    const intoUsd = parsed.filter((record) => record.direction === "myr-to-usd");
    const myr = intoUsd.reduce((sum, record) => sum + record.myrAmount, 0);
    const usd = intoUsd.reduce((sum, record) => sum + record.usdAmount, 0);
    const existing = state.currencyExchanges ?? [];
    const merged = mergeExchanges(existing, parsed);
    const added = merged.length - existing.length;
    const back = parsed.length - intoUsd.length;

    const confirmed = confirm(
      `Found ${parsed.length} conversions, ${parsed[0].date} to ${parsed[parsed.length - 1].date}.\n\n` +
      (intoUsd.length > 0
        ? `Into USD: ${money(myr)} → USD ${usd.toFixed(2)}, average ${rateText(usd > 0 ? myr / usd : 0)}\n`
        : "") +
      (back > 0 ? `Back into MYR: ${back} ${back === 1 ? "record" : "records"}\n` : "") +
      `\n${added} new, ${parsed.length - added} already recorded.\n\n` +
      "Your ringgit cost basis will be rebuilt from these rates. Dollar figures are unaffected.",
    );
    if (!confirmed) return;

    const next = { ...state, currencyExchanges: merged };
    setState(next, "Imported currency conversions");
    renderApp(root, next, setState, "portfolio", navigate);
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-exchange").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id) return;
      const record = (state.currencyExchanges ?? []).find((item) => item.id === id);
      if (!record) return;
      const confirmed = confirm(
        `Delete the ${record.date} conversion of ${money(record.myrAmount)} and USD ${record.usdAmount.toFixed(2)}?\n\n` +
        "The ringgit cost of any holding it funded will fall back to the rate stamped on those trades at import.",
      );
      if (!confirmed) return;
      const next = { ...state, currencyExchanges: (state.currencyExchanges ?? []).filter((item) => item.id !== id) };
      setState(next, "Deleted currency conversion");
      renderApp(root, next, setState, "portfolio", navigate);
    });
  });

  root.querySelector<HTMLButtonElement>(".clear-exchanges")?.addEventListener("click", () => {
    const count = (state.currencyExchanges ?? []).length;
    if (count === 0) return;
    const confirmed = confirm(
      `Delete all ${count} currency ${count === 1 ? "conversion" : "conversions"}?\n\n` +
      "Every ringgit cost basis goes back to the rate that was live when its trade was imported. Your trades and all dollar figures are untouched. This cannot be undone.",
    );
    if (!confirmed) return;
    const next = { ...state, currencyExchanges: [] };
    setState(next, "Cleared currency conversions");
    renderApp(root, next, setState, "portfolio", navigate);
  });

  // Clear the whole contribution history in one step — the practical way to
  // undo a bad CSV import without deleting dozens of rows by hand. Deliberately
  // spells out how many records are going and that it cannot be undone, since
  // this wipes the entire cost-basis history the portfolio is derived from.
  root.querySelector<HTMLButtonElement>(".clear-trades")?.addEventListener("click", () => {
    const count = state.trades.length;
    if (count === 0) return;
    const confirmed = confirm(
      `Delete all ${count} contribution ${count === 1 ? "record" : "records"}?\n\n` +
      "This clears the entire cost-basis history behind your portfolio — units, average cost and realised P&L will all reset. This cannot be undone.",
    );
    if (!confirmed) return;
    const next = { ...state, trades: [] };
    setState(next, "Cleared contribution history");
    renderApp(root, next, setState, "portfolio", navigate);
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-trade").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id || !confirm("Delete this trade record?")) return;
      const scrollPosition = {
        x: window.scrollX,
        y: window.scrollY,
        documentY: document.scrollingElement?.scrollTop ?? 0,
      };
      const next = { ...state, trades: state.trades.filter((t) => t.id !== id) };
      setState(next);
      renderApp(root, next, setState, "portfolio", navigate);

      const restoreScroll = () => {
        window.scrollTo(scrollPosition.x, scrollPosition.y);
        document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
      };
      restoreScroll();
      requestAnimationFrame(() => {
        restoreScroll();
        requestAnimationFrame(restoreScroll);
      });
    });
  });
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

function bindReview(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  root.querySelector<HTMLFormElement>("#reviewForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next = {
      ...state,
      reviews: [
        {
          id: createId("review"),
          month: String(data.get("month") ?? ""),
          income: Number(data.get("income")) || 0,
          spending: Number(data.get("spending")) || 0,
          dcaDone: String(data.get("dcaDone")) === "true",
          disciplineScore: Number(data.get("disciplineScore")) || 0,
          notes: String(data.get("notes") ?? ""),
        },
        ...state.reviews,
      ],
    };
    setState(next);
    renderApp(root, next, setState, "review", navigate);
  });

  // Delete review
  root.querySelectorAll<HTMLButtonElement>(".delete-review").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id || !confirm("Delete this review?")) return;
      const next = { ...state, reviews: state.reviews.filter((r) => r.id !== id) };
      setState(next);
      renderApp(root, next, setState, "review", navigate);
    });
  });
}

function bindSettings(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  const refreshSettings = (next: WealthState, label: string): void => { setState(next, label); renderApp(root, next, setState, "settings", navigate); };
  root.querySelector<HTMLFormElement>("#recurringForm")?.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const amount = Number(data.get("amount")); const dayOfMonth = Number(data.get("dayOfMonth")); if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return; refreshSettings({ ...state, recurringTransactions: [...state.recurringTransactions, { id: createId("recurring"), label: String(data.get("label") ?? "").trim().slice(0, 60), amount, type: String(data.get("type")) as "income" | "expense", dayOfMonth, active: true }] }, "Add recurring transaction"); });
  root.querySelectorAll<HTMLButtonElement>(".delete-recurring").forEach((button) => button.addEventListener("click", () => refreshSettings({ ...state, recurringTransactions: state.recurringTransactions.filter((item) => item.id !== button.dataset.id) }, "Delete recurring transaction")));
  root.querySelector<HTMLFormElement>("#liabilityForm")?.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const balance = Number(data.get("balance")); const annualRate = Number(data.get("annualRate")); const minimumPayment = Number(data.get("minimumPayment")); if (![balance, annualRate, minimumPayment].every((value) => Number.isFinite(value) && value >= 0)) return; refreshSettings({ ...state, liabilities: [...state.liabilities, { id: createId("liability"), name: String(data.get("name") ?? "").trim().slice(0, 60), balance, annualRate, minimumPayment }] }, "Add liability"); });
  root.querySelectorAll<HTMLButtonElement>(".delete-liability").forEach((button) => button.addEventListener("click", () => refreshSettings({ ...state, liabilities: state.liabilities.filter((item) => item.id !== button.dataset.id) }, "Delete liability")));
  root.querySelector<HTMLFormElement>("#privacyForm")?.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); refreshSettings({ ...state, privacy: { maskAmounts: data.get("maskAmounts") === "on", requireExportConfirmation: data.get("requireExportConfirmation") === "on" } }, "Update privacy settings"); });
  root.querySelector<HTMLFormElement>("#profileForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next: WealthState = {
      ...state,
      profile: {
        name: String(data.get("name") ?? state.profile.name),
        age: Number(data.get("age")) || 19,
        stage: String(data.get("stage") ?? state.profile.stage),
        riskTolerance: String(data.get("riskTolerance")) as WealthState["profile"]["riskTolerance"],
        investmentHorizonYears: Number(data.get("investmentHorizonYears")) || 10,
        baseCurrency: String(data.get("baseCurrency")) as WealthState["profile"]["baseCurrency"],
      },
    };
    setState(next);
    renderApp(root, next, setState, "settings", navigate);
  });

  root.querySelector<HTMLFormElement>("#cashflowForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next: WealthState = {
      ...state,
      cashflow: {
        allowance: Number(data.get("allowance")) || 0,
        transport: Number(data.get("transport")) || 0,
        food: Number(data.get("food")) || 0,
        otherFixed: Number(data.get("otherFixed")) || 0,
        irregularIncome: Number(data.get("irregularIncome")) || 0,
      },
      dca: {
        ...state.dca,
        monthly: Number(data.get("dcaMonthly")) || 0,
      },
    };
    setState(next);
    renderApp(root, next, setState, "settings", navigate);
  });

  root.querySelector<HTMLFormElement>("#emergencyForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next: WealthState = {
      ...state,
      emergency: {
        ...state.emergency,
        current: Number(data.get("current")) || 0,
        target: Number(data.get("target")) || 0,
        monthlyTopUp: Number(data.get("monthlyTopUp")) || 0,
        annualYield: (Number(data.get("annualYield")) || 3.5) / 100,
      },
    };
    setState(next);
    renderApp(root, next, setState, "settings", navigate);
  });

  root.querySelector<HTMLFormElement>("#targetsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const next: WealthState = {
      ...state,
      dca: {
        ...state.dca,
        targets: {
          VOO: (Number(data.get("vooTarget")) || 65) / 100,
          QQQM: (Number(data.get("qqqmTarget")) || 35) / 100,
        },
      },
      opportunity: {
        ...state.opportunity,
        total: Number(data.get("opportunityTotal")) || 0,
        allocation: {
          VOO: Number(data.get("vooAlloc")) || 0,
          QQQM: Number(data.get("qqqmAlloc")) || 0,
        },
      },
    };
    setState(next);
    renderApp(root, next, setState, "settings", navigate);
  });
}