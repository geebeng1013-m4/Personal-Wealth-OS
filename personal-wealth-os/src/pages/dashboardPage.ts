/**
 * Overview page — the financial command centre.
 *
 * Everything on it is read from buildOverviewModel, the one Dashboard read
 * model: this file formats and renders, it never calculates. When a live quote
 * lands after the first paint, bindDashboard patches only the Net Worth and
 * valuation rows in place — re-rendering the whole page would throw away the
 * user's scroll position and any open control.
 */

import type { WealthState } from "../models";
import { createId } from "../state";
import { money, percent, monthsToEmergencyTarget } from "../rules";
import { escapeHtml } from "../html";
import { buildOverviewModel } from "../overview";
import { detectMoneyLeaks, nextActions } from "../advisor";
import { investmentAssetShare } from "../ledger";
import { forecastRecurring, nextRecurringOccurrence } from "../financialHealth";
import { getAdvisorSnapshot } from "../advisor";
import { isRecommendationCompleted, markRecommendationDone } from "../actionRecords";
import {
  livePriceInputs,
  refreshLivePrices,
  priceRefreshCleanup,
  PRICE_POLL_INTERVAL_MS,
} from "../livePrices";
import {
  moneyOrUnknown,
  pnlText,
  pnlTone,
  joinNotes,
  valuationNote,
  usdPnlNote,
  feeRowHtml,
} from "./valuationFormat";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

export function dashboardTemplate(state: WealthState): string {
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function bindDashboard(
  root: HTMLElement,
  state: WealthState,
  setState: Setter,
  navigate: Navigate | undefined,
  rerender: RenderApp,
): void {
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
    else rerender(root, next, setState, "dashboard");
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
    else rerender(root, next, setState, "dashboard");
  });
}
