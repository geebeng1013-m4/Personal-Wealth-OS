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
import { buildNextSteps, type NextStep, type NextStepId, type NextSteps } from "../onboarding";
import { queueGuide, type GuideId } from "../onboardingGuide";
import { applyLedgerDraft } from "./ledgerPage";
import { buildCheckins } from "../checkins";
import type { PortfolioSnapshot } from "../portfolioSummary";
import { assetDrawdownBelow } from "../drawdowns";
import { getPrice } from "../marketPrices";
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
  joinNotes,
  valuationNote,
  usdPnlNote,
} from "./valuationFormat";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

/** Who "Good morning, …" greets: the Settings name, else the sign-in name's first word, else "there". */
export function greetingName(profileName: string, signedInName: string): string {
  return profileName.trim() || signedInName.trim().split(/\s+/)[0] || "there";
}

/**
 * The Overview. `signedInName` is the account's display name, used only to
 * greet someone who has not typed a name in Settings yet (P-1): a new account
 * would otherwise read "Good morning, there". Display only, never saved.
 */
export function dashboardTemplate(state: WealthState, signedInName = ""): string {
  // The Dashboard's single read model. Every canonical figure below is read
  // from it — this template formats and renders, it does not calculate.
  const overview = buildOverviewModel(state, new Date(), livePriceInputs());
  const portfolio = overview.portfolio;
  const expenseChange = overview.cashFlow.expenseChange;
  const tracked = overview.trackedWealth;
  const nextGoal = overview.goals.featured;
  const nextGoalCurrent = nextGoal?.currentAmount ?? 0;
  const nextGoalRatio = nextGoal?.progress ?? 0;
  const investedShare = tracked.investedShare;
  const safetyShare = tracked.safetyShare;
  const reserveShare = tracked.reserveShare;

  // Findings and recurring forecasts are read straight from their own canonical
  // sources; the Dashboard only renders them.
  const leakSummary = detectMoneyLeaks(state);

  const statusTone = (s: string): string => s === "healthy" || s === "positive" ? "positive" : s === "watch" ? "warning" : "negative";

  // One card anatomy everywhere (PLAN.md T-1): label row -> one headline
  // figure -> at most one line of explanation -> a small graphic on the bottom
  // edge. Desktop lays the same cards out on a 12-column grid: four figure
  // tiles, then priority and health side by side, then the links row.
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
  const investedNote = pnlKnown ? `Unrealised ${pnl >= 0 ? "+" : "−"}${amount(Math.abs(pnl))} at cost ${amount(portfolio.totalInvestedMyr)}` : "No market price yet";
  const pnlChip = portfolio.unrealizedPnlPercentMyr === null || !pnlKnown
    ? ""
    : `<span class="wu-chip${pnl >= 0 ? "" : " wu-chip--negative"}">${pnl >= 0 ? "+" : "−"}${percent(Math.abs(portfolio.unrealizedPnlPercentMyr))}</span>`;

  return `<div class="wu">
    <a href="#main-content" class="skip-link">Skip to main content</a>

    ${pageHeader({
      eyebrow: `Good ${getGreeting()}, ${greetingName(state.profile.name, signedInName)}`,
      title: "Overview",
      sub: overview.headline,
    })}

    <!-- The user's own goal sentence, in view every visit. Display only: it is
         written on the Goals page, so this stays a line, not a form. -->
    ${state.financialGoal
      ? `<button class="wu-goal-line dashboard-nav" data-page="goals" type="button" aria-label="My financial goal: ${escapeHtml(state.financialGoal)}. Edit on the Goals page"><span class="wu-goal-line__label">Financial goal</span><span class="wu-goal-line__text">${escapeHtml(state.financialGoal)}</span></button>`
      : `<button class="wu-goal-line wu-goal-line--empty dashboard-nav" data-page="goals" type="button"><span class="wu-goal-line__text">Write down your financial goal</span><span aria-hidden="true">→</span></button>`}

    ${nextStepCard(buildNextSteps(state))}

    ${checkinsLine(buildCheckins(state).dueCount)}

    <!-- Filled by bindDashboard after an async price check: shown only when a
         dip-buy tranche is reached and not yet deployed. -->
    <div id="dipAlert" hidden></div>

    <div class="wu-dash">
      <!-- 1 — NET WORTH -->
      <section class="wu-card wu-dash__tile" aria-labelledby="ovNetWorthLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovNetWorthLabel">Net worth</span></div>
        <p class="wu-money"><span class="wu-money__cur">MYR</span><span id="ovNetWorth">${amount(overview.netWorth)}</span></p>
        <p class="wu-dash__note" id="ovNetWorthNote">Assets ${amount(overview.totalAssets)} · liabilities ${amount(overview.totalLiabilities)}</p>
        <div class="wu-split" aria-hidden="true" id="ovNetWorthSplit"><span style="flex:${Math.max(assetsShare, 0.02)};background:var(--accent)"></span><span style="flex:${Math.max(1 - assetsShare, 0.02)};background:var(--highlight)"></span></div>
      </section>

      <!-- 2 — THIS MONTH -->
      <section class="wu-card wu-dash__tile" aria-labelledby="ovMonthLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovMonthLabel">This month</span>${expenseChange !== null
          ? `<span class="wu-chip${expenseChange <= 0 ? "" : " wu-chip--warning"}">${expenseChange <= 0 ? "↓" : "↑"} ${percent(Math.abs(expenseChange), 0)}</span>`
          : ""}</div>
        <p class="wu-money ${overview.cashFlow.surplus >= 0 ? "t-positive" : "t-negative"}"><span class="wu-money__cur">MYR</span><span>${overview.cashFlow.surplus >= 0 ? "+" : "−"}${amount(Math.abs(overview.cashFlow.surplus))}</span></p>
        <p class="wu-dash__note">Income ${amount(overview.cashFlow.income)} · spent ${amount(overview.cashFlow.expenses)}</p>
        <div class="wu-bar" role="progressbar" aria-valuenow="${Math.round(keptRatio * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Share of income kept this month">
          <span class="wu-bar__fill" style="width:${Math.round(keptRatio * 100)}%"></span>
        </div>
      </section>

      <!-- 3 — INVESTED -->
      <section class="wu-card wu-dash__tile" aria-labelledby="ovInvestedLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovInvestedLabel">Invested</span>${pnlChip}</div>
        <p class="wu-money"><span class="wu-money__cur">MYR</span><span>${amount(portfolio.totalInvestedMyr)}</span></p>
        <p class="wu-dash__note" id="ovInvestedNote">${escapeHtml(investedNote)}</p>
        <p class="t-caption t-faint" id="ovValuationNote">${escapeHtml(dashboardValuationNote(portfolio))}</p>
        <div class="wu-split" aria-label="Tracked capital split">
          <span style="flex:${Math.max(investedShare, 0.02)};background:var(--accent)" title="Invested ${amount(portfolio.totalInvestedMyr)}"></span>
          <span style="flex:${Math.max(safetyShare, 0.02)};background:var(--highlight)" title="Safety ${amount(state.emergency.current)}"></span>
          <span style="flex:${Math.max(reserveShare, 0.02)};background:var(--text-faint)" title="Reserve ${amount(tracked.reserve)}"></span>
        </div>
        <!-- the bar's three colours, named: a colour on its own is a riddle -->
        <div class="wu-legend wu-legend--tight">
          <span><i style="background:var(--accent)"></i>Invested <b>${amount(portfolio.totalInvestedMyr)}</b></span>
          <span><i style="background:var(--highlight)"></i>Safety <b>${amount(state.emergency.current)}</b></span>
          <span><i style="background:var(--text-faint)"></i>Reserve <b>${amount(tracked.reserve)}</b></span>
        </div>
      </section>

      <!-- 4 — NEXT GOAL -->
      <section class="wu-card wu-dash__tile" aria-labelledby="ovGoalLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovGoalLabel">Next goal</span></div>
        ${nextGoal ? `
          <p class="wu-money"><span class="wu-money__cur">MYR</span><span>${amount(nextGoalCurrent)}</span></p>
          <p class="wu-dash__note">${escapeHtml(nextGoal.name)} · of ${amount(nextGoal.targetAmount)}${nextGoal.estimatedMonthsToTarget !== null ? ` · ~${nextGoal.estimatedMonthsToTarget} mo left` : ""}</p>
          <div class="wu-bar" role="progressbar" aria-valuenow="${Math.round(nextGoalRatio * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(nextGoal.name)} progress">
            <span class="wu-bar__fill" style="width:${Math.round(Math.min(nextGoalRatio, 1) * 100)}%"></span>
          </div>
        ` : `<p class="wu-dash__note">Create a goal to turn long-term wealth building into a visible journey.</p>`}
      </section>

      <!-- 5 — PRIORITY -->
      ${overview.priorityAction ? `
        <section class="wu-card wu-dash__half wu-stack wu-stack--sm" aria-labelledby="ovPriorityTitle">
          <div class="wu-tc__top"><span class="wu-label">Priority</span><span class="wu-chip wu-chip--${statusTone(overview.priorityAction.severity)}">${overview.priorityAction.severity === "watch" ? "Watch" : "Needs action"}</span></div>
          <h3 class="t-heading" id="ovPriorityTitle">${escapeHtml(overview.priorityAction.title)}</h3>
          <p class="t-body-sm t-muted">${escapeHtml(overview.priorityAction.actionLabel)}</p>
          ${isRecommendationCompleted(state, overview.priorityAction.recommendationId)
            ? `<p class="t-caption t-muted">You marked this done.</p>`
            : ""}
          <div class="wu-row wu-dash__actions">
            <button class="wu-btn wu-btn--primary wu-btn--sm dashboard-nav" data-page="${escapeHtml(overview.priorityAction.destination)}" type="button">Go to ${escapeHtml(overview.priorityAction.destination.replace(/-/g, " "))}</button>
            ${isRecommendationCompleted(state, overview.priorityAction.recommendationId)
              ? ""
              : `<button class="wu-btn wu-btn--ghost wu-btn--sm dashboard-mark-done" type="button" data-recommendation-id="${escapeHtml(overview.priorityAction.recommendationId)}">Mark as done</button>`}
          </div>
        </section>
      ` : `
        <section class="wu-card wu-dash__half wu-stack wu-stack--sm" aria-labelledby="ovPriorityTitle">
          <div class="wu-tc__top"><span class="wu-label">Priority</span><span class="wu-chip">All clear</span></div>
          <h3 class="t-heading" id="ovPriorityTitle">Nothing needs your attention</h3>
          <p class="t-body-sm t-muted">No exceptions were detected against your configured rules.</p>
        </section>
      `}

      <!-- 6 — HEALTH -->
      <section class="wu-card wu-dash__half wu-stack wu-stack--sm" aria-labelledby="ovHealthLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ovHealthLabel">Health</span><span class="wu-chip${watchCount > 0 ? " wu-chip--warning" : ""}">${watchCount > 0 ? `${watchCount} to watch` : escapeHtml(overview.wealthHealth.label)}</span></div>
        <ul class="wu-facts">
          ${overview.wealthHealth.factors.map((factor) => `<li><i class="${factorTone(factor.status)}" aria-hidden="true"></i><span>${escapeHtml(factor.label)}</span><span>${escapeHtml(factor.detail)}</span><span class="visually-hidden">Status: ${escapeHtml(factor.status)}</span></li>`).join("")}
          ${overview.planStatus.progress !== null
            ? `<li><i class="${overview.planStatus.onTrack ? "" : "is-watch"}" aria-hidden="true"></i><span>Monthly plan</span><span>${amount(overview.planStatus.actualAmount)} / ${amount(overview.planStatus.plannedAmount)}</span></li>`
            : ""}
        </ul>
      </section>

      <!-- 7 — MORE DETAIL -->
      <!-- Everything the summary above leaves out lives on its own page; these
           are the ways in, so no detail is lost, only moved. -->
      <section class="wu-card wu-dash__full wu-dash__more wu-stack wu-stack--sm" aria-labelledby="ovMoreLabel">
        <span class="wu-label" id="ovMoreLabel">More detail</span>
        <ul class="wu-navlist wu-navlist--inline">
          <li><button class="dashboard-nav" data-page="advisor" type="button"><span>Guidance<small>What to do next</small></span><span aria-hidden="true">›</span></button></li>
          <li><button class="dashboard-nav" data-page="money-leaks" type="button"><span>Money leaks<small>${leakSummary.leaks.length} found · ${amount(leakSummary.monthlyImpact)}/mo</small></span><span aria-hidden="true">›</span></button></li>
          <li><button class="dashboard-nav" data-page="ledger" type="button"><span>This month's activity<small>Income, spending and accounts</small></span><span aria-hidden="true">›</span></button></li>
          <li><button class="dashboard-nav" data-page="portfolio" type="button"><span>Portfolio<small>Holdings, market value and costs</small></span><span aria-hidden="true">›</span></button></li>
        </ul>
      </section>
    </div>
  </div>`;
}

/*
 * "Your next step" (O-3, replacing F-7's Get started list). One step at a
 * time, each with the answer it comes from, until the required ones are done
 * or the user hides the card. "Later" moves a step to the back of the queue
 * for this session only.
 */
const laterSteps = new Set<NextStepId>();
/** Steps done at the last render, to spot one finished since. */
let previouslyDone: Set<NextStepId> | null = null;
/**
 * The step most recently finished. Its line stays until the next one is done:
 * the Overview can render more than once on the way back from another page,
 * and a one-render message would be gone before anyone read it.
 */
let lastFinished: NextStepId | null = null;

/* One line of status (P-6a): the check-ins themselves live on Review. */
function checkinsLine(due: number): string {
  if (!due) return "";
  return `<button class="wu-checkins-line dashboard-nav" data-page="review" type="button"><span class="wu-checkins-line__dot" aria-hidden="true"></span>${due} check-in${due > 1 ? "s" : ""} due<span aria-hidden="true">→</span></button>`;
}

function monthsFromNow(months: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return date.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
}

function currentStep(next: NextSteps): NextStep | undefined {
  const open = next.steps.filter((step) => !step.done);
  return open.find((step) => !laterSteps.has(step.id)) ?? open[0];
}

function justDoneLine(next: NextSteps): string {
  const before = previouslyDone;
  previouslyDone = new Set(next.steps.filter((step) => step.done).map((step) => step.id));
  const fresh = before ? next.steps.filter((step) => step.done && !before.has(step.id)) : [];
  if (fresh.length) lastFinished = fresh[fresh.length - 1].id;
  const step = next.steps.find((item) => item.id === lastFinished && item.done);
  if (!step) return "";
  const plan = next.plan;
  const text: Record<NextStepId, string> = {
    "record-pay": "Pay recorded. The Budget page now shows how your plan splits it.",
    balances: "Balances set. Your net worth now starts from real numbers.",
    "safety-buffer": "Safety buffer target set.",
    "move-to-buffer": plan ? `Buffer topped up: ${money(plan.bufferCurrent)} of ${money(plan.bufferTarget)}.` : "Buffer topped up.",
    "log-spending": "Spending recorded. Your Overview now measures it against your plan.",
    goal: "Goal added. Your plan now has a date to aim for.",
    investment: "Trade recorded. Your real return starts counting from here.",
  };
  return `<p class="wu-next__done" role="status"><span aria-hidden="true">✓</span> ${escapeHtml(text[step.id])}</p>`;
}

function nextStepCard(next: NextSteps): string {
  if (!next.visible) {
    previouslyDone = null;
    lastFinished = null;
    return "";
  }
  const step = currentStep(next);
  const acknowledged = justDoneLine(next);
  const plan = next.plan;
  const estimate = `<span class="wu-next__est">estimate</span>`;
  const bufferCell = plan && plan.bufferTarget > 0
    ? `<div><span class="wu-next__k">Safety buffer ${plan.bufferEstimate ? estimate : ""}</span>
        <span class="wu-next__v">${money(Math.min(plan.bufferCurrent, plan.bufferTarget))} <small>/ ${money(plan.bufferTarget)}</small></span>
        <span class="wu-bar" aria-hidden="true"><span class="wu-bar__fill" style="width:${Math.min(100, Math.round((plan.bufferCurrent / plan.bufferTarget) * 100))}%"></span></span></div>`
    : "";
  const goalCell = plan && plan.goalName
    ? `<div><span class="wu-next__k">${escapeHtml(plan.goalName)} ${plan.goalEstimate ? estimate : ""}</span>
        <span class="wu-next__v wu-next__v--text">${plan.goalMonths !== null ? `Around ${monthsFromNow(plan.goalMonths)}` : "No date yet"}</span></div>`
    : "";
  const planStrip = bufferCell || goalCell ? `<div class="wu-next__plan">${bufferCell}${goalCell}</div>` : "";
  const openCount = next.steps.filter((item) => !item.done).length;
  return `<section class="wu-card wu-onboard wu-next wu-stack wu-stack--sm" aria-labelledby="ovNextTitle">
      <div class="wu-tc__top"><span class="wu-label" id="ovNextTitle">Your next step</span><span class="wu-chip">${next.doneCount} of ${next.steps.length} done</span></div>
      ${planStrip}
      ${acknowledged}
      ${step ? `<div class="wu-next__step">
        <h3 class="wu-next__title">${escapeHtml(step.title)}${step.optional ? ` <small class="wu-onboard__optional">Optional</small>` : ""}</h3>
        <p class="wu-next__because"><strong>Because:</strong> ${escapeHtml(step.because)}</p>
        ${step.detail ? `<p class="t-body-sm t-muted">${escapeHtml(step.detail)}</p>` : ""}
        <div class="wu-row wu-dash__actions">
          <button class="wu-btn wu-btn--primary wu-btn--sm" type="button" data-next-step="${step.id}">${escapeHtml(step.cta)}</button>
          ${openCount > 1 ? `<button class="wu-btn wu-btn--ghost wu-btn--sm" type="button" data-next-later="${step.id}">Later</button>` : ""}
        </div>
      </div>` : ""}
      <ol class="wu-next__path" aria-label="All steps">
        ${next.steps.map((item) => `<li class="${item.done ? "is-done" : item === step ? "is-now" : ""}">
          <span class="wu-onboard__check" aria-hidden="true">${item.done ? "✓" : ""}</span>
          <span>${escapeHtml(item.title)}${item.optional ? " (optional)" : ""}</span>
          <span class="visually-hidden">${item.done ? "Done" : "Not done yet"}</span></li>`).join("")}
      </ol>
      <div class="wu-row wu-dash__actions"><button class="wu-btn wu-btn--ghost wu-btn--sm" id="onboardHide" type="button">Hide this for good</button></div>
    </section>`;
}

/*
 * The Dashboard's one-line valuation note.
 *
 * When every holding is priced, "Market data may be delayed · last traded 9h
 * ago" is noise on a summary page — the Portfolio page still carries it next
 * to the figures it qualifies. An incomplete valuation is different: that
 * sentence stays, because the number beside it is not the whole picture.
 */
function dashboardValuationNote(portfolio: PortfolioSnapshot): string {
  const status = portfolio.valuationStatus === "complete" ? "" : valuationNote(portfolio);
  return joinNotes(status, usdPnlNote(portfolio));
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
  // "Your next step" (O-3). Finishing the required steps retires the card for
  // good, so emptying the data later never brings a beginner's card back.
  const nextSteps = buildNextSteps(state);
  // `state` itself is replaced so every handler here, which builds its next
  // state from it, carries the flag instead of quietly writing it back to false.
  if (nextSteps.complete && !state.onboardingDone) {
    state = { ...state, onboardingDone: true };
    setState(state);
  }
  const go = (page: string, next: WealthState = state) => {
    if (navigate) navigate(page);
    else rerender(root, next, setState, page);
  };
  root.querySelectorAll<HTMLButtonElement>("[data-next-step]").forEach((button) => button.addEventListener("click", () => {
    const step = nextSteps.steps.find((item) => item.id === button.dataset.nextStep);
    if (!step) return;
    if (step.id === "move-to-buffer") {
      // Only the user knows the transfer happened; this is their confirmation.
      const next: WealthState = { ...state, emergency: { ...state.emergency, current: state.emergency.current + (step.amount ?? 0) } };
      setState(next, "Moved money into the safety buffer");
      go("dashboard", next);
      return;
    }
    if (step.id === "record-pay" || step.id === "log-spending") {
      // Open the entry form already filled from the user's answer; Save stays theirs.
      const income = step.id === "record-pay";
      const category = income
        ? state.ledgerCategories.find((item) => item.id === "income-salary") ?? state.ledgerCategories.find((item) => item.type === "income")
        : undefined;
      const account = state.ledgerAccounts.find((item) => item.id === "account-bank")
        ?? state.ledgerAccounts.find((item) => item.type === "bank");
      applyLedgerDraft({
        kind: "ledger",
        type: income ? "income" : "expense",
        amount: income ? state.onboardingAnswers?.monthlyIncome ?? 0 : 0,
        categoryId: category?.id,
        accountId: account?.id,
        date: new Date().toLocaleDateString("en-CA"),
        note: income ? "Pay" : "",
        unresolved: [],
        dropped: [],
      });
    }
    go(queueGuide(step.id as GuideId));
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-next-later]").forEach((button) => button.addEventListener("click", () => {
    laterSteps.add(button.dataset.nextLater as NextStepId);
    go("dashboard");
  }));
  root.querySelector<HTMLButtonElement>("#onboardHide")?.addEventListener("click", () => {
    if (!confirm("Hide your next steps? They will not come back.")) return;
    const next: WealthState = { ...state, onboardingDone: true };
    setState(next, "Hide next steps");
    go("dashboard", next);
  });

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
      netWorthNoteEl.textContent = `Assets ${plain(updated.totalAssets)} · liabilities ${plain(updated.totalLiabilities)}`;
    }
    if (netWorthSplitEl) {
      const total = updated.totalAssets + updated.totalLiabilities;
      const share = total > 0 ? updated.totalAssets / total : 1;
      netWorthSplitEl.innerHTML = `<span style="flex:${Math.max(share, 0.02)};background:var(--accent)"></span><span style="flex:${Math.max(1 - share, 0.02)};background:var(--highlight)"></span>`;
    }
    const investedNoteEl = root.querySelector<HTMLElement>("#ovInvestedNote");
    const noteEl = root.querySelector<HTMLElement>("#ovValuationNote");
    if (investedNoteEl) {
      const livePnl = portfolio.unrealizedPnlMyr;
      investedNoteEl.textContent = livePnl === null
        ? "No market price yet"
        : `Unrealised ${livePnl >= 0 ? "+" : "−"}${plain(Math.abs(livePnl))} at cost ${plain(portfolio.totalInvestedMyr)}`;
    }
    if (noteEl) noteEl.textContent = dashboardValuationNote(portfolio);
  };
  // The dip-buy watch below reads the same live quote, so it is re-checked
  // whenever the valuation is.
  const onDashboardPrices = (): void => {
    patchDashboardValuation();
    paintDipWatch();
  };
  refreshLivePrices(state, onDashboardPrices);
  // Keep asking while this Dashboard stays on screen, so a tab left open
  // does not freeze on the price it happened to load first.
  const dashboardPriceTimer = setInterval(() => refreshLivePrices(state, onDashboardPrices), PRICE_POLL_INTERVAL_MS);
  // Browsers throttle timers in background tabs, so coming back to a tab
  // that has been hidden for hours would otherwise show a very old price
  // until the next tick. Ask again the moment it becomes visible.
  const onDashboardVisible = (): void => {
    if (document.visibilityState === "visible") refreshLivePrices(state, onDashboardPrices);
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
  // Re-run on every price refresh, measured against the live quote.
  function paintDipWatch(): void {
    const pending = state.opportunity.tranches.filter((tranche) => !tranche.deployed);
    const dipAlert = root.querySelector<HTMLElement>("#dipAlert");
    if (!dipAlert || pending.length === 0) return;
    const live = (symbol: string): number | null => getPrice(livePriceInputs().prices, symbol)?.priceUsd ?? null;
    void Promise.all([assetDrawdownBelow("VOO", live("VOO")), assetDrawdownBelow("QQQM", live("QQQM"))]).then(([voo, qqqm]) => {
      if (voo === null && qqqm === null) return;
      const worst = Math.max(voo ?? 0, qqqm ?? 0);
      const reached = pending.filter((tranche) => worst >= tranche.drawdown);
      // A market that has recovered since the last check takes the banner down.
      if (reached.length === 0) {
        dipAlert.hidden = true;
        return;
      }
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
    }).catch(() => { /* the banner just stays as it was */ });
  }
  paintDipWatch();

}
