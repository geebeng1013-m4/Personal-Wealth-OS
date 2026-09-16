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
import { money, percent } from "../rules";
import { escapeHtml } from "../html";
import { buildOverviewModel } from "../overview";
import { assetDrawdownBelow } from "../drawdowns";
import { pageHeader } from "../components/pageHeader";
import { detectMoneyLeaks } from "../advisor";
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
  feeFreeReturnNote,
} from "./valuationFormat";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

export function dashboardTemplate(state: WealthState): string {
  // The Dashboard's single read model. Every canonical figure below is read
  // from it — this template formats and renders, it does not calculate.
  const overview = buildOverviewModel(state, new Date(), livePriceInputs());
  const portfolio = overview.portfolio;
  const expenseChange = overview.cashFlow.expenseChange;
  const tracked = overview.trackedWealth;
  const nextGoal = overview.goals.featured;
  const nextGoalCurrent = nextGoal?.currentAmount ?? 0;
  const nextGoalRatio = nextGoal?.progress ?? 0;
  const opportunity = tracked.reserve;
  const investedShare = tracked.investedShare;
  const safetyShare = tracked.safetyShare;
  const reserveShare = tracked.reserveShare;

  // Findings and recurring forecasts are read straight from their own canonical
  // sources; the Dashboard only renders them.
  const leakSummary = detectMoneyLeaks(state);

  // UI interaction state: the goal picker's options list.
  const overviewGoalOptions = state.goals
    .map((goal) => `<option value="${escapeHtml(goal.id)}"${goal.id === nextGoal?.id ? " selected" : ""}>${escapeHtml(goal.name)}</option>`)
    .join("");

  const statusTone = (s: string): string => s === "healthy" || s === "positive" ? "positive" : s === "watch" ? "warning" : "negative";

  // One card anatomy everywhere (PLAN.md T-1): label row -> one headline
  // figure -> at most one line of explanation -> an optional small graphic.
  // Figures print without the "MYR" prefix so the currency can be set small
  // beside them; money() stays the single formatter.
  const amount = (value: number): string => money(value, "").trim();
  const factorTone = (status: string): string => status === "healthy" || status === "positive" ? "" : status === "watch" ? "is-watch" : "is-alert";
  const watchCount = overview.wealthHealth.factors.filter((factor) => factor.status !== "healthy").length;
  const assetsShare = overview.totalAssets + overview.totalLiabilities > 0
    ? overview.totalAssets / (overview.totalAssets + overview.totalLiabilities)
    : 1;
  const keptRatio = overview.cashFlow.income > 0
    ? Math.min(Math.max(overview.cashFlow.surplus / overview.cashFlow.income, 0), 1)
    : 0;
  const pnl = portfolio.unrealizedPnlMyr ?? 0;
  const pnlKnown = portfolio.unrealizedPnlMyr !== null;
  const pnlChip = portfolio.unrealizedPnlPercentMyr === null || !pnlKnown
    ? ""
    : `<span class="wu-chip${pnl >= 0 ? "" : " wu-chip--negative"}">${pnl >= 0 ? "+" : "−"}${percent(Math.abs(portfolio.unrealizedPnlPercentMyr))} invested</span>`;

  return `<div class="wu">
    <a href="#main-content" class="skip-link">Skip to main content</a>

    ${pageHeader({
      eyebrow: `Good ${getGreeting()}, ${overview.greetingName}`,
      title: "Overview",
      sub: overview.headline,
    })}

    <!-- The user's own goal sentence, in view every visit. Display only: it is
         written on the Goals page, so this stays a line, not a form. -->
    ${state.financialGoal
      ? `<button class="wu-goal-line dashboard-nav" data-page="goals" type="button" aria-label="My financial goal: ${escapeHtml(state.financialGoal)}. Edit on the Goals page"><span class="wu-goal-line__label">Financial goal</span><span class="wu-goal-line__text">${escapeHtml(state.financialGoal)}</span></button>`
      : `<button class="wu-goal-line wu-goal-line--empty dashboard-nav" data-page="goals" type="button"><span class="wu-goal-line__text">Write down your financial goal</span><span aria-hidden="true">→</span></button>`}

    <div class="wu-stack">
      <!-- Filled by bindDashboard after an async price check: shown only when a
           dip-buy tranche is reached and not yet deployed. -->
      <div id="dipAlert" hidden></div>

      <!-- 1 — NET WORTH -->
      <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ovNetWorthLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovNetWorthLabel">Net worth</span>${pnlChip}</div>
        <p class="wu-money"><span class="wu-money__cur">MYR</span><span id="ovNetWorth">${amount(overview.netWorth)}</span></p>
        <div class="wu-split" aria-hidden="true" id="ovNetWorthSplit"><span style="flex:${Math.max(assetsShare, 0.02)};background:var(--accent)"></span><span style="flex:${Math.max(1 - assetsShare, 0.02)};background:var(--highlight)"></span></div>
        <div class="wu-legend" id="ovNetWorthNote"><span><i style="background:var(--accent)"></i>Assets <b>${amount(overview.totalAssets)}</b></span><span><i style="background:var(--highlight)"></i>Liabilities <b>${amount(overview.totalLiabilities)}</b></span></div>
      </section>

      <!-- 2 — THIS MONTH -->
      <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ovMonthLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovMonthLabel">This month</span>${expenseChange !== null
          ? `<span class="wu-chip${expenseChange <= 0 ? "" : " wu-chip--warning"}">Spending ${expenseChange <= 0 ? "↓" : "↑"} ${percent(Math.abs(expenseChange), 0)}</span>`
          : `<span class="wu-chip wu-chip--muted">First month recorded</span>`}</div>
        <div class="wu-three">
          <div><span>Income</span><b>${amount(overview.cashFlow.income)}</b></div>
          <div><span>Spent</span><b>${amount(overview.cashFlow.expenses)}</b></div>
          <div><span>Surplus</span><b class="${overview.cashFlow.surplus >= 0 ? "t-positive" : "t-negative"}">${overview.cashFlow.surplus >= 0 ? "+" : "−"}${amount(Math.abs(overview.cashFlow.surplus))}</b></div>
        </div>
        <div class="wu-bar" role="progressbar" aria-valuenow="${Math.round(keptRatio * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Share of income kept this month">
          <span class="wu-bar__fill" style="width:${Math.round(keptRatio * 100)}%"></span>
        </div>
        <p class="t-caption t-muted">${Math.round(keptRatio * 100)}% of income kept this month</p>
      </section>

      <!-- 3 — PRIORITY -->
      ${overview.priorityAction ? `
        <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ovPriorityTitle">
          <div class="wu-tc__top"><span class="wu-label">Priority</span><span class="wu-chip wu-chip--${statusTone(overview.priorityAction.severity)}">${overview.priorityAction.severity === "watch" ? "Watch" : "Needs action"}</span></div>
          <h3 class="t-subheading" id="ovPriorityTitle">${escapeHtml(overview.priorityAction.title)}</h3>
          <p class="t-body-sm t-muted">${escapeHtml(overview.priorityAction.actionLabel)}</p>
          ${isRecommendationCompleted(state, overview.priorityAction.recommendationId)
            ? `<p class="t-caption t-muted">You marked this done.</p>`
            : ""}
          <div class="wu-row">
            <button class="wu-btn wu-btn--primary wu-btn--sm dashboard-nav" data-page="${escapeHtml(overview.priorityAction.destination)}" type="button">Go to ${escapeHtml(overview.priorityAction.destination.replace(/-/g, " "))}</button>
            ${isRecommendationCompleted(state, overview.priorityAction.recommendationId)
              ? ""
              : `<button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-mark-done" type="button" data-recommendation-id="${escapeHtml(overview.priorityAction.recommendationId)}">Mark as done</button>`}
          </div>
        </section>
      ` : `
        <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ovPriorityTitle">
          <div class="wu-tc__top"><span class="wu-label">Priority</span><span class="wu-chip">All clear</span></div>
          <h3 class="t-subheading" id="ovPriorityTitle">Nothing needs your attention</h3>
          <p class="t-body-sm t-muted">No exceptions were detected against your configured rules.</p>
        </section>
      `}

      <!-- 4 — HEALTH -->
      <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ovHealthLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovHealthLabel">Health</span><span class="wu-chip${watchCount > 0 ? " wu-chip--warning" : ""}">${watchCount > 0 ? `${watchCount} to watch` : escapeHtml(overview.wealthHealth.label)}</span></div>
        <ul class="wu-facts">
          ${overview.wealthHealth.factors.map((factor) => `<li><i class="${factorTone(factor.status)}" aria-hidden="true"></i><span>${escapeHtml(factor.label)}</span><span>${escapeHtml(factor.detail)}</span><span class="visually-hidden">Status: ${escapeHtml(factor.status)}</span></li>`).join("")}
          ${overview.planStatus.progress !== null
            ? `<li><i class="${overview.planStatus.onTrack ? "" : "is-watch"}" aria-hidden="true"></i><span>Monthly plan</span><span>${amount(overview.planStatus.actualAmount)} / ${amount(overview.planStatus.plannedAmount)}</span></li>`
            : ""}
        </ul>
      </section>

      <!-- 5 — WHERE IT SITS -->
      <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ovTrackedLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovTrackedLabel">Where it sits</span>${pnlKnown ? `<span class="wu-chip${pnl >= 0 ? "" : " wu-chip--negative"}">${pnl >= 0 ? "+" : "−"}${amount(Math.abs(pnl))} P&amp;L</span>` : ""}</div>
        <div class="wu-split" aria-label="Tracked capital split">
          <span style="flex:${Math.max(investedShare, 0.02)};background:var(--accent)"></span>
          <span style="flex:${Math.max(safetyShare, 0.02)};background:var(--highlight)"></span>
          <span style="flex:${Math.max(reserveShare, 0.02)};background:var(--text-faint)"></span>
        </div>
        <div class="wu-legend">
          <span><i style="background:var(--accent)"></i>Invested <b>${amount(portfolio.totalInvestedMyr)}</b></span>
          <span><i style="background:var(--highlight)"></i>Safety <b>${amount(state.emergency.current)}</b></span>
          <span><i style="background:var(--text-faint)"></i>Reserve <b>${amount(opportunity)}</b></span>
        </div>
        <ul class="wu-facts wu-facts--plain wu-valuation" data-valuation-status="${portfolio.valuationStatus}">
          <li><span>Market value</span><span id="ovMarketValue">${moneyOrUnknown(portfolio.totalInvestmentValueMyr)}</span></li>
          <li id="ovFeeRow"${portfolio.feesInCostBasisMyr > 0.005 ? "" : " hidden"}><span>Trading costs</span><span id="ovFeeDrag">${money(portfolio.feesInCostBasisMyr)}</span></li>
          <li><span>Unrealised P&amp;L</span><span id="ovUnrealised" class="${pnlTone(portfolio.unrealizedPnlMyr)}">${pnlText(portfolio.unrealizedPnlMyr, portfolio.unrealizedPnlPercentMyr)}</span></li>
        </ul>
        <p class="t-caption t-faint" id="ovValuationNote">${escapeHtml(joinNotes(valuationNote(portfolio), usdPnlNote(portfolio), feeFreeReturnNote(portfolio)))}</p>
      </section>

      <!-- 6 — NEXT GOAL -->
      <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ovGoalLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovGoalLabel">Next goal</span>${nextGoal ? `<span class="wu-chip${nextGoalRatio >= 1 ? "" : " wu-chip--muted"}">${nextGoalRatio >= 1 ? "Funded" : `${percent(nextGoalRatio)} funded`}</span>` : ""}</div>
        ${nextGoal ? `
          <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amount(nextGoalCurrent)}</span><span class="wu-money__of">of ${amount(nextGoal.targetAmount)}</span></p>
          <div class="wu-bar" role="progressbar" aria-valuenow="${Math.round(nextGoalRatio * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(nextGoal.name)} progress">
            <span class="wu-bar__fill" style="width:${Math.round(Math.min(nextGoalRatio, 1) * 100)}%"></span>
          </div>
          <p class="t-caption t-muted">${escapeHtml(nextGoal.name)}${nextGoal.estimatedMonthsToTarget !== null ? ` · about ${nextGoal.estimatedMonthsToTarget} months left at ${amount(nextGoal.monthlyContribution)}/mo` : " · add a monthly contribution for a timeline"}</p>
        ` : `<p class="wu-empty">Create a goal to turn long-term wealth building into a visible, measurable journey.</p>`}
        <div class="wu-row wu-row--between wu-card__footer">
          ${state.goals.length > 0 ? `<label class="wu-field-row"><span class="wu-field-row__label">Featured</span><select class="wu-field" id="overviewGoalSelect" aria-label="Choose the goal shown on the Dashboard">${overviewGoalOptions}</select></label>` : `<span></span>`}
          <button class="wu-btn wu-btn--ghost wu-btn--sm wu-self-end dashboard-nav" data-page="goals" type="button">All goals →</button>
        </div>
      </section>

      <!-- 7 — MORE DETAIL -->
      <!-- Everything the summary above leaves out lives on its own page; these
           are the ways in, so no detail is lost, only moved. -->
      <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ovMoreLabel">
        <span class="wu-label" id="ovMoreLabel">More detail</span>
        <ul class="wu-navlist">
          <li><button class="dashboard-nav" data-page="advisor" type="button"><span>Guidance<small>What to do next</small></span><span aria-hidden="true">›</span></button></li>
          <li><button class="dashboard-nav" data-page="money-leaks" type="button"><span>Money leaks<small>${leakSummary.leaks.length} found · ${amount(leakSummary.monthlyImpact)}/mo</small></span><span aria-hidden="true">›</span></button></li>
          <li><button class="dashboard-nav" data-page="ledger" type="button"><span>This month's activity<small>Income, spending and accounts</small></span><span aria-hidden="true">›</span></button></li>
          <li><button class="dashboard-nav" data-page="portfolio" type="button"><span>Portfolio<small>Holdings and contributions</small></span><span aria-hidden="true">›</span></button></li>
        </ul>
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
    // Figures print without the currency prefix (T-1); the note under the list
    // is its own element, so the value cells hold nothing but the number.
    const plain = (value: number): string => money(value, "").trim();
    const netWorthEl = root.querySelector<HTMLElement>("#ovNetWorth");
    const netWorthNoteEl = root.querySelector<HTMLElement>("#ovNetWorthNote");
    const netWorthSplitEl = root.querySelector<HTMLElement>("#ovNetWorthSplit");
    if (netWorthEl) netWorthEl.textContent = plain(updated.netWorth);
    if (netWorthNoteEl) {
      netWorthNoteEl.innerHTML = `<span><i style="background:var(--accent)"></i>Assets <b>${plain(updated.totalAssets)}</b></span><span><i style="background:var(--highlight)"></i>Liabilities <b>${plain(updated.totalLiabilities)}</b></span>`;
    }
    if (netWorthSplitEl) {
      const total = updated.totalAssets + updated.totalLiabilities;
      const share = total > 0 ? updated.totalAssets / total : 1;
      netWorthSplitEl.innerHTML = `<span style="flex:${Math.max(share, 0.02)};background:var(--accent)"></span><span style="flex:${Math.max(1 - share, 0.02)};background:var(--highlight)"></span>`;
    }
    const valueEl = root.querySelector<HTMLElement>("#ovMarketValue");
    const pnlEl = root.querySelector<HTMLElement>("#ovUnrealised");
    const noteEl = root.querySelector<HTMLElement>("#ovValuationNote");
    if (valueEl) valueEl.textContent = moneyOrUnknown(portfolio.totalInvestmentValueMyr);
    if (pnlEl) {
      pnlEl.className = pnlTone(portfolio.unrealizedPnlMyr);
      pnlEl.textContent = pnlText(portfolio.unrealizedPnlMyr, portfolio.unrealizedPnlPercentMyr);
    }
    if (noteEl) noteEl.textContent = joinNotes(valuationNote(portfolio), usdPnlNote(portfolio), feeFreeReturnNote(portfolio));
    // The fee-free return moves with the price, so it is repainted with the
    // rest. The fee itself does not, but the two live on one line.
    const feeEl = root.querySelector<HTMLElement>("#ovFeeDrag");
    const feeRow = root.querySelector<HTMLElement>("#ovFeeRow");
    if (feeEl) feeEl.textContent = money(portfolio.feesInCostBasisMyr);
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
