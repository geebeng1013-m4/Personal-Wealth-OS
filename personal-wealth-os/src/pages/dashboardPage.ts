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
import { assetDrawdownBelow } from "../drawdowns";
import { pageHeader } from "../components/pageHeader";
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

  const statusTone = (s: string): string => s === "healthy" || s === "positive" ? "positive" : s === "watch" ? "warning" : "negative";
  const factorDot = (s: string): string => `<span aria-hidden="true" style="flex:none;width:8px;height:8px;border-radius:50%;background:var(--${statusTone(s)})"></span>`;

  return `<div class="wu">
    <a href="#main-content" class="skip-link">Skip to main content</a>

    ${pageHeader({
      eyebrow: `Good ${getGreeting()}, ${overview.greetingName}`,
      title: "Wealth Overview",
      sub: overview.headline,
    })}

    <div class="wu-stack wu-stack--lg">
      <!-- Filled by bindDashboard after an async price check: shown only when a
           dip-buy tranche is reached and not yet deployed. -->
      <div id="dipAlert" hidden></div>

      <!-- SECTION 1 — FINANCIAL SNAPSHOT -->
      <section aria-labelledby="ovSnapshotTitle" class="wu-stack wu-stack--sm">
        <div class="wu-stack wu-stack--sm"><h3 class="t-heading" id="ovSnapshotTitle">Financial Snapshot</h3><p class="t-body-sm t-muted">Recorded position and this month's cash flow</p></div>
        <div class="wu-grid wu-grid--4">
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Net Worth</span><span class="wu-metric__value t-num" id="ovNetWorth">${money(overview.netWorth)}</span><span class="wu-metric__note t-caption" id="ovNetWorthNote">${money(overview.totalAssets)} assets − ${money(overview.totalLiabilities)} liabilities</span></div></div>
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Income</span><span class="wu-metric__value t-num wu-metric__value--positive">${money(overview.cashFlow.income)}</span><span class="wu-metric__note t-caption">Recorded this month</span></div></div>
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Expenses</span><span class="wu-metric__value t-num">${money(overview.cashFlow.expenses)}</span><span class="wu-metric__note t-caption">${overview.cashFlow.expenseChange !== null
            ? `${overview.cashFlow.expenseChange <= 0 ? "↓" : "↑"} ${percent(Math.abs(overview.cashFlow.expenseChange), 0)} vs last month`
            : "Recorded this month"}</span></div></div>
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Surplus</span><span class="wu-metric__value t-num wu-metric__value--${overview.cashFlow.surplus >= 0 ? "positive" : "negative"}">${overview.cashFlow.surplus >= 0 ? "+" : "−"}${money(Math.abs(overview.cashFlow.surplus))}</span><span class="wu-metric__note t-caption">Income minus expenses</span></div></div>
        </div>
      </section>

      <!-- SECTION 2 & 3 — WEALTH HEALTH + PLAN STATUS -->
      <div class="wu-grid wu-grid--2 wu-grid--top">
        <section class="wu-card wu-card--${statusTone(overview.wealthHealth.status)}" aria-labelledby="ovHealthTitle">
          <div class="wu-stack wu-stack--sm" style="margin-bottom:var(--space-3)"><h3 class="t-heading" id="ovHealthTitle">Wealth Health</h3><p class="t-body-sm t-muted">Overall financial condition</p></div>
          <p class="wu-badge wu-badge--${statusTone(overview.wealthHealth.status)}">
            <span aria-hidden="true">${overview.wealthHealth.status === "healthy" ? "✓" : overview.wealthHealth.status === "watch" ? "!" : "▲"}</span>
            ${escapeHtml(overview.wealthHealth.label)}
          </p>
          <p class="t-body-sm" style="margin:var(--space-3) 0">${escapeHtml(overview.wealthHealth.summary)}</p>
          <ul class="wu-list">
            ${overview.wealthHealth.factors.map((factor) => `<li class="wu-list__row">${factorDot(factor.status)}<span style="flex:1;color:var(--text)">${escapeHtml(factor.label)}</span><span class="t-caption t-faint" style="text-align:right">${escapeHtml(factor.detail)}</span><span class="visually-hidden">Status: ${escapeHtml(factor.status)}</span></li>`).join("")}
          </ul>
        </section>

        <section class="wu-card" aria-labelledby="ovPlanTitle">
          <div class="wu-stack wu-stack--sm" style="margin-bottom:var(--space-3)"><h3 class="t-heading" id="ovPlanTitle">Plan Status</h3><p class="t-body-sm t-muted">Monthly contribution plan</p></div>
          <p class="wu-badge wu-badge--${overview.planStatus.onTrack ? "positive" : "warning"}">
            <span aria-hidden="true">${overview.planStatus.onTrack ? "✓" : "!"}</span>
            ${escapeHtml(overview.planStatus.label)}
          </p>
          <div class="wu-row" style="gap:var(--space-5);margin:var(--space-3) 0;align-items:stretch">
            <div class="wu-metric"><span class="wu-metric__label wu-label">Planned</span><span class="wu-metric__value t-num">${money(overview.planStatus.plannedAmount)}</span></div>
            <span aria-hidden="true" style="width:1px;background:var(--border)"></span>
            <div class="wu-metric"><span class="wu-metric__label wu-label">Contributed</span><span class="wu-metric__value t-num">${money(overview.planStatus.actualAmount)}</span></div>
          </div>
          ${overview.planStatus.progress !== null ? `
            <div class="wu-bar" role="progressbar" aria-valuenow="${Math.round(overview.planStatus.progress * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Monthly contribution progress">
              <span class="wu-bar__fill" style="width:${Math.round(overview.planStatus.progress * 100)}%"></span>
            </div>
            <p class="t-caption t-muted" style="margin-top:var(--space-2)">${Math.round(overview.planStatus.progress * 100)}% of this month's plan · ${escapeHtml(overview.planStatus.detail)}</p>
          ` : `<p class="t-caption t-muted">${escapeHtml(overview.planStatus.detail)}</p>`}
          <div class="wu-card__footer"><button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-nav" data-page="portfolio" type="button">Open portfolio →</button></div>
        </section>
      </div>

      <!-- SECTION 4 — PRIORITY ACTION -->
      ${overview.priorityAction ? `
        <section class="wu-card wu-card--${statusTone(overview.priorityAction.severity)}" aria-labelledby="ovPriorityTitle">
          <span class="wu-badge wu-badge--${statusTone(overview.priorityAction.severity)}">Priority ${escapeHtml(overview.priorityAction.severity === "positive" ? "status" : overview.priorityAction.severity)}</span>
          <h3 class="t-heading" id="ovPriorityTitle" style="margin:var(--space-3) 0">${escapeHtml(overview.priorityAction.title)}</h3>
          <div class="wu-stack wu-stack--sm">
            <p class="t-body-sm"><span class="wu-label" style="display:inline-block;min-width:44px;margin-right:var(--space-3)">Why</span>${escapeHtml(overview.priorityAction.explanation)}</p>
            <p class="t-body-sm"><span class="wu-label" style="display:inline-block;min-width:44px;margin-right:var(--space-3)">Do</span>${escapeHtml(overview.priorityAction.actionLabel)}</p>
            ${isRecommendationCompleted(state, overview.priorityAction.recommendationId)
              ? '<p class="t-body-sm"><span class="wu-label" style="display:inline-block;min-width:44px;margin-right:var(--space-3)">Status</span><span class="wu-badge wu-badge--positive"><span aria-hidden="true">✓</span> You marked this done</span></p>'
              : ""}
          </div>
          <div class="wu-card__footer wu-row">
            <button class="wu-btn wu-btn--primary wu-btn--sm dashboard-nav" data-page="${escapeHtml(overview.priorityAction.destination)}" type="button">Go to ${escapeHtml(overview.priorityAction.destination.replace(/-/g, " "))}</button>
            ${isRecommendationCompleted(state, overview.priorityAction.recommendationId)
              ? ""
              : `<button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-mark-done" type="button" data-recommendation-id="${escapeHtml(overview.priorityAction.recommendationId)}">Mark as done</button>`}
          </div>
        </section>
      ` : `
        <section class="wu-card wu-card--positive" aria-labelledby="ovPriorityTitle">
          <span class="wu-badge wu-badge--positive"><span aria-hidden="true">✓</span> Priority status</span>
          <h3 class="t-heading" id="ovPriorityTitle" style="margin:var(--space-3) 0">Nothing needs your attention</h3>
          <p class="t-body-sm"><span class="wu-label" style="display:inline-block;min-width:44px;margin-right:var(--space-3)">Why</span>No exceptions were detected against your configured rules.</p>
        </section>
      `}

      <!-- SECONDARY — DETAILS -->
      <section class="wu-stack wu-stack--lg" style="border-top:1px solid var(--border);padding-top:var(--space-6)">
        <div class="wu-stack wu-stack--sm"><h3 class="t-heading">Details</h3><p class="t-body-sm t-muted">Supporting breakdowns behind the summary above</p></div>

        <!-- A. WEALTH DETAILS -->
        <section aria-labelledby="ovGroupWealth" class="wu-stack">
          <div class="wu-stack wu-stack--sm"><h4 class="wu-label">Wealth Details</h4><p class="t-body-sm t-muted">Where your tracked capital sits</p></div>
          <div class="wu-grid wu-grid--2 wu-grid--top">
            <section class="wu-card wu-card--pad-sm" aria-label="Tracked wealth allocation">
              <h5 class="t-subheading" style="margin-bottom:var(--space-3)">Tracked Wealth Base</h5>
              <div class="v2-allocation">
                <div class="v2-allocation__ring" style="background:conic-gradient(var(--accent) 0% ${Math.round(investedShare * 100)}%, var(--highlight) ${Math.round(investedShare * 100)}% ${Math.round((investedShare + safetyShare) * 100)}%, var(--text-faint) ${Math.round((investedShare + safetyShare) * 100)}% 100%);" aria-label="Wealth allocation ring showing ${percent(investedShare + safetyShare + reserveShare)} allocated">
                  <div class="v2-allocation__center">
                    <strong>${percent(investedShare + safetyShare + reserveShare)}</strong>
                    <small>Allocated</small>
                  </div>
                </div>
                <div class="v2-allocation__legend">
                  <div class="v2-allocation__legend-item"><span class="v2-allocation__legend-dot" style="background:var(--accent)"></span>Investments <strong>${money(portfolio.totalInvestedMyr)}</strong></div>
                  <div class="v2-allocation__legend-item"><span class="v2-allocation__legend-dot" style="background:var(--highlight)"></span>Safety <strong>${money(state.emergency.current)}</strong></div>
                  <div class="v2-allocation__legend-item"><span class="v2-allocation__legend-dot" style="background:var(--text-faint)"></span>Reserve <strong>${money(opportunity)}</strong></div>
                </div>
              </div>
              <dl class="wu-list wu-valuation" data-valuation-status="${portfolio.valuationStatus}">
                <div class="wu-list__row"><dt>Market value</dt><dd id="ovMarketValue">${moneyOrUnknown(portfolio.totalInvestmentValueMyr)} <span class="wu-note">${escapeHtml(valuationNote(portfolio))}</span></dd></div>
                <div class="wu-list__row"><dt>Invested</dt><dd>${money(portfolio.totalInvestedMyr)} <span class="wu-note">Capital contributed, at cost</span></dd></div>
                <div class="wu-list__row" id="ovFeeRow"${portfolio.feesInCostBasisMyr > 0.005 ? "" : " hidden"}><dt>Trading costs</dt><dd id="ovFeeDrag">${feeRowHtml(portfolio)}</dd></div>
                <div class="wu-list__row"><dt>Unrealised P&amp;L</dt><dd id="ovUnrealised" class="${pnlTone(portfolio.unrealizedPnlMyr)}">${pnlText(portfolio.unrealizedPnlMyr, portfolio.unrealizedPnlPercentMyr)} <span class="wu-note">${escapeHtml(joinNotes(usdPnlNote(portfolio), portfolio.realizedPnlMyr !== 0 ? `Realised to date ${money(portfolio.realizedPnlMyr)}` : "Excludes realised gains"))}</span></dd></div>
              </dl>
            </section>

            <section class="wu-card wu-card--pad-sm" aria-label="Financial health breakdown">
              <h5 class="t-subheading" style="margin-bottom:var(--space-3)">Financial Health</h5>
              <dl class="wu-list">
                <div class="wu-list__row"><dt>Safety reserve</dt><dd>${percent(emergency)} <span class="wu-note">${state.emergency.target > 0
                  ? `${money(state.emergency.current)} of ${money(state.emergency.target)}${Number.isFinite(emergencyMonths) && emergencyMonths > 0 ? ` · ${emergencyMonths}mo to target` : emergency >= 1 ? " · fully funded" : ""}`
                  : "No emergency-fund target set"}</span></dd></div>
                <div class="wu-list__row"><dt>Recurring forecast</dt><dd>${money(forecast.surplus)} <span class="wu-note">${money(forecast.income)} in · ${money(forecast.expense)} out${nextRecurring ? ` · Next ${nextRecurring.date.toLocaleDateString("en-MY", { day: "numeric", month: "short" })}` : ""}</span></dd></div>
                <div class="wu-list__row"><dt>DCA mandate</dt><dd>${money(budget.plannedDcaAmount)} <span class="wu-note">${portfolio.tradeCount} contributions recorded</span></dd></div>
                <div class="wu-list__row"><dt>Investment accounts</dt><dd>${assetShare.ratio === null ? "N/A" : percent(assetShare.ratio)} <span class="wu-note">${assetShare.ratio === null ? `No account balances recorded` : `${money(assetShare.investmentAssets)} of ${money(assetShare.totalAssets)} account balances`}</span></dd></div>
              </dl>
              <div class="wu-card__footer"><button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-nav" data-page="advisor" type="button">See what to do →</button></div>
            </section>
          </div>
        </section>

        <!-- B. ACTIVITY & FINDINGS -->
        <section aria-labelledby="ovGroupActivity" class="wu-stack">
          <div class="wu-stack wu-stack--sm"><h4 class="wu-label">Activity &amp; Findings</h4><p class="t-body-sm t-muted">Detected cash-flow drag and this month's position</p></div>
          <div class="wu-grid wu-grid--2 wu-grid--top">
            <section class="wu-card wu-card--pad-sm" aria-labelledby="overviewLeakTitle">
              <div class="wu-card__header"><h5 class="t-subheading" id="overviewLeakTitle">Money Leaks</h5><span class="wu-badge wu-badge--${leakSummary.highCount > 0 ? "negative" : "warning"}">${leakSummary.leaks.length} detected</span></div>
              <p class="t-body"><strong class="t-num">${money(leakSummary.monthlyImpact)}</strong><span class="wu-note">/mo across ${leakSummary.categoryCount} ${leakSummary.categoryCount === 1 ? "category" : "categories"}</span></p>
              <dl class="wu-list">
                <div class="wu-list__row"><dt>Highest impact</dt><dd>${escapeHtml(leakSummary.topLeak?.title ?? "No material leak detected")} <span class="wu-note">${escapeHtml(leakSummary.topLeak?.recommendation ?? "Keep transactions and recurring payments current to improve coverage.")}</span></dd></div>
              </dl>
              <div class="wu-card__footer"><button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-nav" data-page="money-leaks" type="button">Review findings →</button></div>
            </section>

            <section class="wu-card wu-card--pad-sm" aria-label="Monthly financial position">
              <h5 class="t-subheading" style="margin-bottom:var(--space-3)">Monthly Position</h5>
              <dl class="wu-list">
                <div class="wu-list__row"><dt>Recorded spending</dt><dd>${money(snapshot.currentMonthExpenses)} <span class="wu-note">${expenseChange !== null ? `${expenseChange <= 0 ? "↓" : "↑"} ${percent(Math.abs(expenseChange), 0)} month over month` : "A second month unlocks trend comparison"}</span></dd></div>
                <div class="wu-list__row"><dt>Assignable surplus (planned)</dt><dd>${money(surplus)} <span class="wu-note">${planOnTrack ? "Current DCA mandate is covered" : `DCA funding gap: ${money(budget.plannedDcaAmount - surplus)}`}</span></dd></div>
                <div class="wu-list__row"><dt>Opportunity liquidity</dt><dd>${money(opportunity)} <span class="wu-note">${state.opportunity.used > 0 ? `${money(state.opportunity.used)} deployed under your rules` : "Held for predefined deployment conditions"}</span></dd></div>
              </dl>
              <div class="wu-card__footer"><button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-nav" data-page="ledger" type="button">Open activity →</button></div>
            </section>
          </div>
        </section>

        <!-- C. GUIDANCE -->
        <section aria-labelledby="ovGroupGuidance" class="wu-stack">
          <div class="wu-stack wu-stack--sm"><h4 class="wu-label">Guidance</h4><p class="t-body-sm t-muted">Full briefing behind the priority action above</p></div>
          <section class="wu-card wu-card--pad-sm" aria-label="Financial coaching insight">
            <h5 class="t-subheading" style="margin-bottom:var(--space-3)">Personal CFO briefing</h5>
            <p class="t-body-sm t-muted">${escapeHtml(overview.briefing)}</p>
            <ul class="wu-list" style="margin-top:var(--space-2)">
              ${actions.slice(0, 3).map((action) => `<li class="wu-list__row"><span>${escapeHtml(action)}</span></li>`).join("")}
            </ul>
            <div class="wu-card__footer"><button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-nav" data-page="advisor" type="button">View full guidance →</button></div>
          </section>
        </section>

        <!-- D. GOALS -->
        <section aria-labelledby="ovGroupGoals" class="wu-stack">
          <div class="wu-stack wu-stack--sm"><h4 class="wu-label">Goals</h4><p class="t-body-sm t-muted">Progress toward your funded milestones</p></div>
          <section class="wu-card wu-card--pad-sm" aria-label="Wealth journey progress">
            <div class="wu-row wu-row--between" style="margin-bottom:var(--space-4)">
              <h5 class="t-subheading">${nextGoal ? escapeHtml(nextGoal.name) : "Define your next milestone"}</h5>
              <div class="wu-row">
                ${state.goals.length > 0 ? `<label class="wu-field-row"><span class="wu-field-row__label">Featured goal</span><select class="wu-field" id="overviewGoalSelect" aria-label="Choose the goal shown in Wealth Journey">${overviewGoalOptions}</select></label>` : ""}
                <button class="wu-btn wu-btn--ghost wu-btn--sm wu-self-end dashboard-nav" data-page="goals" type="button">All goals →</button>
              </div>
            </div>
            ${nextGoal ? `
              <div class="wu-row" style="gap:var(--space-8)">
                <div style="position:relative;width:140px;height:140px;flex:none">
                  <svg viewBox="0 0 140 140" style="width:100%;height:100%;transform:rotate(-90deg)">
                    <circle cx="70" cy="70" r="60" fill="none" stroke="var(--border)" stroke-width="8" />
                    <circle cx="70" cy="70" r="60" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"
                      stroke-dasharray="${Math.round(2 * Math.PI * 60)}" stroke-dashoffset="${Math.round(2 * Math.PI * 60 * (1 - nextGoalRatio))}" />
                  </svg>
                  <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center">
                    <div><strong class="t-num-lg" style="display:block">${percent(nextGoalRatio)}</strong><small class="wu-label">funded</small></div>
                  </div>
                </div>
                <div style="flex:1;min-width:200px">
                  <strong class="t-num-lg" style="display:block;margin-bottom:var(--space-2)">${money(nextGoalCurrent)}</strong>
                  <p class="t-body-sm t-muted" style="margin:0 0 var(--space-4)">toward ${money(nextGoal.targetAmount)}. ${nextGoal.estimatedMonthsToTarget !== null ? `At ${money(nextGoal.monthlyContribution)} monthly, the current plan has approximately ${nextGoal.estimatedMonthsToTarget} months remaining.` : "Add a monthly contribution to establish a projected timeline."}</p>
                  <div class="wu-row wu-row--tight t-caption t-faint">
                    <span class="wu-badge wu-badge--neutral">Today</span> →
                    <span class="wu-badge wu-badge--warning">Next milestone</span> →
                    <span class="wu-badge wu-badge--positive">Target</span>
                  </div>
                </div>
              </div>
            ` : `<p class="wu-empty">Create a goal to turn long-term wealth building into a visible, measurable journey.</p>`}
          </section>
        </section>
      </section>
    </div>
  </div>`;
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
      valueEl.innerHTML = `${moneyOrUnknown(portfolio.totalInvestmentValueMyr)} <span class="wu-note">${escapeHtml(valuationNote(portfolio))}</span>`;
    }
    if (pnlEl) {
      pnlEl.className = pnlTone(portfolio.unrealizedPnlMyr);
      pnlEl.innerHTML = `${pnlText(portfolio.unrealizedPnlMyr, portfolio.unrealizedPnlPercentMyr)} <span class="wu-note">${escapeHtml(joinNotes(usdPnlNote(portfolio), portfolio.realizedPnlMyr !== 0 ? `Realised to date ${money(portfolio.realizedPnlMyr)}` : "Excludes realised gains"))}</span>`;
    }
    // The fee-free return moves with the price, so it is repainted with the
    // rest. The fee itself does not, but the two live on one line.
    const feeEl = root.querySelector<HTMLElement>("#ovFeeDrag");
    const feeRow = root.querySelector<HTMLElement>("#ovFeeRow");
    if (feeEl) feeEl.innerHTML = feeRowHtml(portfolio);
    if (feeRow) feeRow.hidden = portfolio.feesInCostBasisMyr <= 0.005;
    root.querySelector<HTMLElement>(".wu-valuation")?.setAttribute("data-valuation-status", portfolio.valuationStatus);
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

  // Dip-buy watch: this is as close to "notify me" as a client-only PWA gets —
  // when the Dashboard loads, check how far VOO / QQQM are below their highs
  // and, if an undeployed tranche is now in range, surface it here. Nothing
  // runs while the app is closed.
  const pending = state.opportunity.tranches.filter((tranche) => !tranche.deployed);
  const dipAlert = root.querySelector<HTMLElement>("#dipAlert");
  if (dipAlert && pending.length > 0) {
    void Promise.all([assetDrawdownBelow("VOO"), assetDrawdownBelow("QQQM")]).then(([voo, qqqm]) => {
      if (voo === null && qqqm === null) return;
      const worst = Math.max(voo ?? 0, qqqm ?? 0);
      const reached = pending.filter((tranche) => worst >= tranche.drawdown);
      if (reached.length === 0) return;
      const amount = reached.reduce((sum, tranche) => sum + tranche.amount, 0);
      const steps = reached.map((tranche) => `−${tranche.drawdown}%`).join(", ");
      const part = (label: string, value: number | null): string => value === null ? "" : `${label} −${value.toFixed(1)}%`;
      const levels = [part("VOO", voo), part("QQQM", qqqm)].filter(Boolean).join(" · ");
      dipAlert.className = "wu-card wu-card--pad-sm wu-card--negative";
      dipAlert.innerHTML = `<div class="wu-row wu-row--between" style="align-items:flex-start;gap:var(--space-4)">
        <div class="wu-stack wu-stack--sm">
          <span class="wu-label">Dip-buy plan</span>
          <strong class="t-subheading">${reached.length === 1 ? "A tranche is" : `${reached.length} tranches are`} in range — deploy ${money(amount)}</strong>
          <span class="t-caption t-muted">${steps} reached · ${levels} below all-time highs</span>
        </div>
        <button class="wu-btn wu-btn--secondary wu-btn--sm dashboard-nav" data-page="advisor" type="button">Open Advisor →</button>
      </div>`;
      dipAlert.hidden = false;
    }).catch(() => { /* the banner just stays hidden */ });
  }

  root.querySelector<HTMLSelectElement>("#overviewGoalSelect")?.addEventListener("change", (event) => {
    const overviewGoalId = (event.currentTarget as HTMLSelectElement).value;
    if (!state.goals.some((goal) => goal.id === overviewGoalId)) return;
    const next = { ...state, overviewGoalId };
    setState(next, "Changed featured Overview goal");
    if (navigate) navigate("dashboard");
    else rerender(root, next, setState, "dashboard");
  });
}
