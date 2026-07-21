import type { AdvisorMessage, LedgerTransaction, LedgerTransactionType, RuleCardId, Ticker, Trade, TradeType, WealthState } from "./models";
import { createId, cloneDefaultState, exportState, importStateFromFile, loadSnapshots, restoreSnapshot, clearSnapshots, type Snapshot } from "./state";
import {
  advisorMessages,
  emergencyRatio,
  money,
  monthlyBasicExpense,
  monthlySurplus,
  monthsToEmergencyTarget,
  nextActions,
  percent,
  portfolioSummary,
  projectedAnnualEmergencyYield,
  trancheStatus,
  tradeUnits,
} from "./rules";
import { fetchQuote, fetchMultipleQuotes, formatPrice, formatChange, formatVolume, type MarketQuote, calcPnLForTicker, type PortfolioPnL, buildTradeTimelineHtml, fetchFundamentals, type Fundamentals, fetchHistoricalPrices, calcRiskMetrics } from "./market";
import { categoryTotals, filterLedgerTransactions, ledgerTotals, monthlyLedgerTotals, normalizeLedgerAmount, type LedgerFilters } from "./ledger";
import { mountSideRays } from "./sideRays";

type Setter = (state: WealthState, changeLabel?: string) => void;
type Navigate = (page: string) => void;

const sideRaysCleanup = new WeakMap<HTMLElement, () => void>();
const calculatorCleanup = new WeakMap<HTMLElement, () => void>();

type Page = readonly [id: string, english: string, subtitle: string];
type PageGroup = readonly [title: string, pages: readonly Page[]];

const pageGroups = [
  ["Today", [
    ["dashboard", "Overview", "Your next move"],
    ["advisor", "Coach", "Guidance & scenarios"],
  ]],
  ["Plan", [
    ["buckets", "Money Plan", "Fund allocation"],
    ["goals", "Goals", "Progress & targets"],
    ["rules", "Rules", "Decision framework"],
  ]],
  ["Grow", [
    ["portfolio", "Investments", "Portfolio & activity"],
    ["market", "Market", "Research when needed"],
    ["calculator", "Scenarios", "Growth calculator"],
  ]],
  ["Reflect", [
    ["ledger", "Activity", "Income & expenses"],
    ["review", "Review", "Monthly check-in"],
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
const TV_SYMBOL_MAP: Record<string, string> = {
  VOO: "NYSEARCA:VOO",
  QQQM: "NASDAQ:QQQM",
};

function toTVSymbol(ticker: string): string {
  return TV_SYMBOL_MAP[ticker.toUpperCase()] ?? ticker;
}

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
          <div class="brand-mark" aria-hidden="true">PW</div>
          <div><h1>Personal Wealth OS</h1><p>Personal CFO System</p></div>
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
    <main class="main">
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
  const portfolio = portfolioSummary(state);
  const emergency = emergencyRatio(state);
  const actions = nextActions(state);
  const opportunity = state.opportunity.total - state.opportunity.used;
  const trackedCapital = portfolio.totalInvestedMyr + state.emergency.current + opportunity;
  const currentMonthTransactions = filterLedgerTransactions(state.ledgerTransactions, {
    preset: "month",
    startDate: "",
    endDate: "",
    type: "all",
    categoryId: "",
    query: "",
  });
  const currentMonthLedger = ledgerTotals(currentMonthTransactions);
  const previousMonth = new Date();
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  const previousMonthTransactions = state.ledgerTransactions.filter((transaction) => {
    const date = new Date(transaction.date);
    return date.getFullYear() === previousMonth.getFullYear() && date.getMonth() === previousMonth.getMonth();
  });
  const previousMonthLedger = ledgerTotals(previousMonthTransactions);
  const expenseChange = previousMonthLedger.expense > 0
    ? (currentMonthLedger.expense - previousMonthLedger.expense) / previousMonthLedger.expense
    : null;
  const nextGoal = goalsWithIncompleteFirst(state).find(({ goal }) => goal.target > 0 && goal.current < goal.target)?.goal;
  const nextGoalRatio = nextGoal && nextGoal.target > 0 ? Math.min(nextGoal.current / nextGoal.target, 1) : 0;
  const coachMessages = advisorMessages(state);
  const primaryCoach = coachMessages.find((message) => message.severity === "action")
    ?? coachMessages.find((message) => message.severity === "watch")
    ?? coachMessages[0];
  const emergencyMonths = monthsToEmergencyTarget(state);
  const trackedBase = Math.max(trackedCapital, 1);
  const investedShare = Math.min(portfolio.totalInvestedMyr / trackedBase, 1);
  const safetyShare = Math.min(state.emergency.current / trackedBase, 1);
  const reserveShare = Math.min(opportunity / trackedBase, 1);
  const planOnTrack = monthlySurplus(state) >= state.dca.monthly;

  return `
    <section class="wealth-hero card">
      <div class="wealth-hero-copy">
        <div class="wealth-hero-topline"><span class="eyebrow">Tracked Wealth Base</span><span class="status-pill ${planOnTrack ? "positive" : "attention"}">${planOnTrack ? "Plan on track" : "Review required"}</span></div>
        <strong class="wealth-total">${trackedCapital > 0 ? money(trackedCapital) : "Not established"}</strong>
        <p>Investment cost, safety cash and undeployed opportunity reserve. This is a planning base, not a complete net-worth valuation.</p>
        <div class="wealth-hero-actions"><button class="primary-button dashboard-nav" data-page="portfolio" type="button">Review portfolio</button><button class="secondary-button dashboard-nav" data-page="ledger" type="button">Open cash flow</button></div>
      </div>
      <div class="wealth-allocation" aria-label="Tracked wealth allocation">
        <div class="allocation-ring" style="--invested:${Math.round(investedShare * 100)}%;--safety:${Math.round((investedShare + safetyShare) * 100)}%;"><span><small>Allocated</small><strong>${percent(investedShare + safetyShare + reserveShare)}</strong></span></div>
        <div class="allocation-legend">
          <div><i class="invested"></i><span>Investments</span><strong>${money(portfolio.totalInvestedMyr)}</strong></div>
          <div><i class="safety"></i><span>Safety</span><strong>${money(state.emergency.current)}</strong></div>
          <div><i class="reserve"></i><span>Reserve</span><strong>${money(opportunity)}</strong></div>
        </div>
      </div>
    </section>
    <div class="metric-grid wealth-metrics">
      <article class="card metric"><span>Monthly cash flow</span><strong class="${currentMonthLedger.balance >= 0 ? "income" : "expense"}">${currentMonthLedger.balance >= 0 ? "+" : "−"}${money(Math.abs(currentMonthLedger.balance))}</strong><small>${currentMonthTransactions.length ? `${money(currentMonthLedger.income)} in · ${money(currentMonthLedger.expense)} out` : "No activity recorded this month"}</small></article>
      <article class="card metric"><span>Safety reserve</span><strong>${percent(emergency)}</strong><div class="bar"><span style="width:${Math.min(Math.round(emergency * 100), 100)}%"></span></div><small>${money(state.emergency.current)} of ${money(state.emergency.target)}${Number.isFinite(emergencyMonths) ? ` · ${emergencyMonths} months to target` : ""}</small></article>
      <article class="card metric"><span>Monthly investment mandate</span><strong>${money(state.dca.monthly)}</strong><small>${state.trades.length} contributions recorded · long-term allocation plan</small></article>
    </div>
    <div class="cfo-grid">
      <article class="card panel cfo-briefing">
        <div class="panel-head"><div><span class="eyebrow">Personal CFO Briefing</span><h3>${primaryCoach ? escapeHtml(primaryCoach.title) : "Continue the plan"}</h3></div><span class="gold-marker">Priority</span></div>
        <p class="mission-explanation">${primaryCoach ? escapeHtml(primaryCoach.body) : "Your plan has no urgent exceptions. Stay consistent with the next scheduled contribution."}</p>
        <ol class="weekly-actions">${actions.slice(0, 3).map((action, index) => `<li><b>${String(index + 1).padStart(2, "0")}</b><span>${escapeHtml(action)}</span></li>`).join("")}</ol>
        <button class="text-button dashboard-nav" data-page="advisor" type="button">View full guidance <span aria-hidden="true">→</span></button>
      </article>
      <article class="card panel monthly-review-card">
        <div class="panel-head"><div><span class="eyebrow">Monthly Position</span><h3>Cash-flow discipline</h3></div><button class="text-button dashboard-nav" data-page="ledger" type="button">Activity →</button></div>
        <div class="change-list">
          <div><span>Recorded spending</span><strong>${money(currentMonthLedger.expense)}</strong><small>${expenseChange === null ? "A second month unlocks trend comparison." : `${expenseChange <= 0 ? "Lower" : "Higher"} by ${percent(Math.abs(expenseChange), 0)} month over month.`}</small></div>
          <div><span>Assignable surplus</span><strong>${money(monthlySurplus(state))}</strong><small>${planOnTrack ? "Current DCA mandate is covered." : `DCA funding gap: ${money(state.dca.monthly - monthlySurplus(state))}.`}</small></div>
          <div><span>Opportunity liquidity</span><strong>${money(opportunity)}</strong><small>${state.opportunity.used > 0 ? `${money(state.opportunity.used)} deployed under your rules.` : "Held for predefined deployment conditions."}</small></div>
        </div>
      </article>
    </div>
    <article class="card panel wealth-journey">
      <div class="panel-head"><div><span class="eyebrow">Wealth Journey</span><h3>${nextGoal ? escapeHtml(nextGoal.name) : "Define your next milestone"}</h3></div><button class="text-button dashboard-nav" data-page="goals" type="button">All goals →</button></div>
      ${nextGoal ? `<div class="journey-layout"><div class="goal-ring" style="--progress:${Math.round(nextGoalRatio * 360)}deg"><span><strong>${percent(nextGoalRatio)}</strong><small>funded</small></span></div><div><strong class="journey-amount">${money(nextGoal.current)}</strong><p>toward ${money(nextGoal.target)}. ${nextGoal.monthlyContribution > 0 ? `At ${money(nextGoal.monthlyContribution)} monthly, the current plan has approximately ${Math.ceil(Math.max(nextGoal.target - nextGoal.current, 0) / nextGoal.monthlyContribution)} months remaining.` : "Add a monthly contribution to establish a projected timeline."}</p><div class="milestone-line"><i></i><span>Today</span><i></i><span>Next milestone</span><i class="gold"></i><span>Target</span></div></div></div>` : '<p class="empty-state">Create a goal to turn long-term wealth building into a visible, measurable journey.</p>'}
    </article>
  `;
}

function portfolioChartSection(state: WealthState): string {
  const portfolio = portfolioSummary(state);
  if (portfolio.positions.length === 0) return "";
  const canvasId = "allocationChart";
  const chartData = portfolio.positions.map((p) => ({
    ticker: p.ticker,
    value: p.investedMyr,
    color: p.ticker === "VOO" ? "#3b82f6" : "#a855f7",
  }));
  const chartJson = JSON.stringify(chartData);
  const totalMoney = money(portfolio.totalInvestedMyr);

  return `
    <article class="card panel">
      <div class="panel-head"><div><span class="eyebrow">Asset Allocation</span><h3>Portfolio Allocation</h3></div><strong style="color:var(--green);">${totalMoney}</strong></div>
      <div class="chart-grid">
        <div>
          ${chartData.map((d) => {
            const pct = portfolio.totalInvestedMyr > 0 ? Math.round((d.value / portfolio.totalInvestedMyr) * 100) : 0;
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
              '<div style="width:12px;height:12px;border-radius:3px;background:' + d.color + ';"></div>' +
              '<div style="flex:1;">' +
              '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;"><span>' + d.ticker + '</span><span>' + money(d.value) + '</span></div>' +
              '<div class="bar"><span style="width:' + pct + '%;background:' + d.color + ';"></span></div>' +
              '</div></div>';
          }).join("")}
        </div>
        <canvas id="${canvasId}" width="300" height="300" style="max-height:280px;margin:0 auto;"></canvas>
      </div>
      <script>
        (function(){
          try {
            var canvas = document.getElementById('${canvasId}');
            if (!canvas) return;
            var ctx = canvas.getContext('2d');
            if (!ctx) return;
            var data = ${chartJson};
            var total = data.reduce(function(s,d){return s+d.value;},0);
            if (total <= 0) return;
            var cx=150,cy=150,r=120,inner=70;
            var start = -Math.PI / 2;
            data.forEach(function(d) {
              var angle = (d.value / total) * Math.PI * 2;
              ctx.beginPath();
              ctx.arc(cx, cy, r, start, start + angle);
              ctx.arc(cx, cy, inner, start + angle, start, true);
              ctx.closePath();
              ctx.fillStyle = d.color;
              ctx.fill();
              start += angle;
            });
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#e2e8ec';
            ctx.font = '700 20px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('${totalMoney}', cx, cy - 8);
            ctx.font = '500 11px Inter, sans-serif';
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim() || '#5f7584';
            ctx.fillText('TOTAL INVESTED', cx, cy + 14);
          } catch(e) {}
        })();
      </script>
    </article>
  `;
}

function portfolioTemplate(state: WealthState): string {
  const portfolio = portfolioSummary(state);
  const positionRows = portfolio.positions.map((position) => {
    const driftClass = Math.abs(position.drift) > 0.08 ? "negative" : "positive";
    const driftSign = position.drift >= 0 ? "+" : "";
    return '<tr>' +
      '<td><span class="ticker-badge">' + position.ticker + '</span></td>' +
      '<td>' + money(position.investedMyr) + '</td>' +
      '<td>USD ' + position.investedUsd.toFixed(2) + '</td>' +
      '<td>' + position.units.toFixed(5) + '</td>' +
      '<td>USD ' + position.averageCostUsd.toFixed(2) + '</td>' +
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
        '<td>' + tradeUnits(trade).toFixed(5) + '</td>' +
        '<td><button class="icon-button danger delete-trade" data-id="' + trade.id + '" title="Delete trade">✕</button></td>' +
        '</tr>';
    }).join("");

  const allocationHealth = portfolio.maxAbsoluteDrift <= 0.05 ? "Aligned" : portfolio.maxAbsoluteDrift <= 0.1 ? "Monitor" : "Rebalance";
  return `
    <section class="portfolio-hero card">
      <div><span class="eyebrow">Long-term Investment Portfolio</span><strong>${money(portfolio.totalInvestedMyr)}</strong><p>Capital contributed across ${portfolio.positions.length} holdings · USD ${portfolio.totalInvestedUsd.toFixed(2)} cost basis</p></div>
      <div class="portfolio-health"><span>Allocation health</span><strong>${allocationHealth}</strong><small>Largest drift ${percent(portfolio.maxAbsoluteDrift, 1)}</small></div>
    </section>
    <div class="portfolio-command-grid">
      <article class="card panel portfolio-allocation-panel">
        <div class="panel-head"><div><span class="eyebrow">Strategic Allocation</span><h3>Portfolio structure</h3></div><span class="status-pill ${portfolio.maxAbsoluteDrift <= 0.08 ? "positive" : "attention"}">${allocationHealth}</span></div>
        ${portfolio.positions.length ? `<div class="portfolio-positions">${portfolio.positions.map((position, index) => `<div class="position-card"><div class="position-identity"><span class="position-index">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(position.ticker)}</strong><small>${position.ticker === "VOO" ? "Core market exposure" : position.ticker === "QQQM" ? "Growth allocation" : "Portfolio holding"}</small></div></div><div class="position-value"><strong>${money(position.investedMyr)}</strong><small>${percent(position.actualAllocation)} of portfolio</small></div><div class="allocation-track"><span style="width:${Math.min(position.actualAllocation * 100, 100)}%"></span><i style="left:${Math.min(position.targetAllocation * 100, 100)}%" title="Target ${percent(position.targetAllocation)}"></i></div><div class="position-meta"><span>Target ${percent(position.targetAllocation)}</span><span class="${Math.abs(position.drift) > 0.08 ? "negative" : "positive"}">${position.drift >= 0 ? "+" : ""}${percent(position.drift, 1)} drift</span></div></div>`).join("")}</div>` : '<p class="empty-state">No portfolio positions yet. Record a contribution to establish your long-term allocation.</p>'}
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
    <details class="card panel portfolio-details">
      <summary><div><span class="eyebrow">Position Detail</span><h3>Cost basis and allocation data</h3></div><span>${portfolio.positions.length} holdings</span></summary>
      <div class="portfolio-details-content">
        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>Ticker</th><th>Invested MYR</th><th>Invested USD</th><th>Units</th><th>Avg Cost</th><th>Actual / Target</th><th>Drift</th></tr></thead>
            <tbody>${positionRows}</tbody>
          </table>
        </div>
      </div>
    </details>
    <article class="card panel portfolio-activity">
      <div class="panel-head"><div><span class="eyebrow">Portfolio Activity</span><h3>Contribution history</h3></div><span class="panel-note">${state.trades.length} records</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Platform</th><th>Ticker</th><th>Type</th><th>Amount MYR</th><th>Amount USD</th><th>Price USD</th><th>Units</th><th></th></tr></thead>
          <tbody>${tradeRows || '<tr><td colspan="9" class="empty-state">No transactions yet. Add your first transaction to begin tracking.</td></tr>'}</tbody>
        </table>
      </div>
    </article>
  `;
}

function marketTemplate(_state: WealthState): string {
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
      </div>
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
        <div class="card" style="padding:16px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:12px;">🏭 Sector Allocation</div>
          <div id="sector-bars"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
          <div class="card" style="padding:16px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Top 10 Holdings</div>
            <div id="top-holdings"></div>
          </div>
          <div class="card" style="padding:16px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Key Metrics</div>
            <div id="key-metrics"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Compare Tab -->
    <div class="market-tab-content" data-tab-content="compare">
      <div id="compareContent">
        <div class="card" style="padding:16px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:12px;">⚖️ Performance Comparison (YTD)</div>
          <div id="compare-bars"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:12px;">
          <div class="card" style="padding:16px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">VOO vs QQQM Correlation</div>
            <div id="compare-correlation" style="font-size:24px;font-weight:700;">--</div>
          </div>
          <div class="card" style="padding:16px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">VOO Expense Ratio</div>
            <div id="compare-expense-voo" style="font-size:24px;font-weight:700;">0.03%</div>
          </div>
          <div class="card" style="padding:16px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">QQQM Expense Ratio</div>
            <div id="compare-expense-qqqm" style="font-size:24px;font-weight:700;">0.15%</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Calendar Tab -->
    <div class="market-tab-content" data-tab-content="calendar">
      <div id="calendarContent">
        <div class="card" style="padding:16px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:12px;">📅 Upcoming Economic Events</div>
          <div id="calendar-events"></div>
        </div>
      </div>
    </div>
  `;
}

function bindMarket(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  let currentSymbol = "VOO";
  let currentInterval = "12M";

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

    const pnl = calcPnLForTicker(state.trades, symbol, 0, 4.25);
    const isProfit = pnl.unrealizedPnlUsd >= 0;
    const color = isProfit ? "var(--green)" : "var(--red)";
    const sign = isProfit ? "+" : "";

    const el = (id: string) => root.querySelector<HTMLElement>(id);
    const setT = (id: string, v: string) => { const e = el(id); if (e) e.textContent = v; };
    const setC = (id: string, c: string) => { const e = el(id); if (e) e.style.color = c; };

    setT("#pnl-invested", "USD " + pnl.totalInvestedUsd.toFixed(2));
    setT("#pnl-units", pnl.totalUnits.toFixed(4));
    setT("#pnl-cost", "USD " + pnl.averageCostUsd.toFixed(2));
    setT("#pnl-value", "USD " + pnl.currentValueUsd.toFixed(2));
    setT("#pnl-amount", sign + "USD " + Math.abs(pnl.unrealizedPnlUsd).toFixed(2));
    setC("#pnl-amount", color);
    setT("#pnl-pct", sign + (pnl.unrealizedPnlPct * 100).toFixed(2) + "%");
    setC("#pnl-pct", color);
    setT("#pnl-fees", "MYR " + pnl.feeMyr.toFixed(2));

    // Trade list
    const tradeListEl = el("#pnl-trades-list");
    if (tradeListEl) {
      const tradesForTicker = state.trades.filter((t) => t.ticker === symbol);
      const rows = tradesForTicker.map((t) => {
        const isBuy = t.type !== "Sell";
        const units = t.priceUsd > 0 ? (t.amountUsd / t.priceUsd).toFixed(4) : "0";
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
    timelineEl.innerHTML = buildTradeTimelineHtml(state.trades, symbol, 0);
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

    // Sectors tab
    const sectorData: Record<string, { name: string; pct: number }[]> = {
      VOO: [
        { name: "Technology", pct: 31.2 },
        { name: "Healthcare", pct: 12.8 },
        { name: "Financials", pct: 12.5 },
        { name: "Consumer Discretionary", pct: 10.8 },
        { name: "Industrials", pct: 8.9 },
        { name: "Communication", pct: 8.7 },
        { name: "Consumer Staples", pct: 6.2 },
        { name: "Energy", pct: 3.8 },
        { name: "Utilities", pct: 2.5 },
        { name: "Real Estate", pct: 2.4 },
      ],
      QQQM: [
        { name: "Technology", pct: 51.8 },
        { name: "Communication", pct: 16.2 },
        { name: "Consumer Discretionary", pct: 14.5 },
        { name: "Healthcare", pct: 6.8 },
        { name: "Industrials", pct: 4.2 },
        { name: "Consumer Staples", pct: 3.1 },
        { name: "Utilities", pct: 1.5 },
        { name: "Energy", pct: 0.8 },
        { name: "Financials", pct: 0.7 },
        { name: "Real Estate", pct: 0.4 },
      ],
    };

    const holdings: Record<string, { name: string; pct: number }[]> = {
      VOO: [
        { name: "Apple", pct: 7.1 },
        { name: "Microsoft", pct: 6.8 },
        { name: "NVIDIA", pct: 6.2 },
        { name: "Amazon", pct: 3.8 },
        { name: "Meta", pct: 2.9 },
        { name: "Alphabet A", pct: 2.1 },
        { name: "Alphabet C", pct: 1.8 },
        { name: "Berkshire B", pct: 1.7 },
        { name: "Broadcom", pct: 1.5 },
        { name: "JPMorgan", pct: 1.4 },
      ],
      QQQM: [
        { name: "Apple", pct: 8.9 },
        { name: "Microsoft", pct: 8.5 },
        { name: "NVIDIA", pct: 7.8 },
        { name: "Amazon", pct: 5.2 },
        { name: "Meta", pct: 4.5 },
        { name: "Alphabet A", pct: 3.2 },
        { name: "Alphabet C", pct: 2.8 },
        { name: "Broadcom", pct: 2.5 },
        { name: "Tesla", pct: 2.1 },
        { name: "Costco", pct: 1.8 },
      ],
    };

    // Compare tab
    const compareData = { voo: "+5.2%", qqqm: "+8.7%", spy: "+5.1%", qqq: "+8.5%", correlation: "0.92" };

    // Calendar tab
    const calendarEvents = [
      { date: "Jul 15", event: "CPI (Inflation)", impact: "High" },
      { date: "Jul 16", event: "Retail Sales", impact: "Medium" },
      { date: "Jul 29", event: "FOMC Decision", impact: "High" },
      { date: "Aug 1", event: "Non-Farm Payrolls", impact: "High" },
      { date: "Aug 12", event: "CPI (Inflation)", impact: "High" },
      { date: "Sep 17", event: "FOMC Decision", impact: "High" },
    ];

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

      // Sectors
      const sectorEl = root.querySelector<HTMLElement>("#sector-bars");
      if (sectorEl) {
        const sd = sectorData[sym] || sectorData.VOO;
        sectorEl.innerHTML = sd.map((s) =>
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
            '<span style="width:140px;font-size:12px;color:var(--ink-2);">' + s.name + '</span>' +
            '<div style="flex:1;height:20px;background:var(--surface);border-radius:4px;overflow:hidden;">' +
              '<div style="width:' + s.pct + '%;height:100%;background:linear-gradient(90deg,var(--green),var(--blue));border-radius:4px;"></div>' +
            '</div>' +
            '<span style="width:50px;text-align:right;font-size:12px;font-weight:600;">' + s.pct + '%</span>' +
          '</div>'
        ).join("");
      }

      const holdingsEl = root.querySelector<HTMLElement>("#top-holdings");
      if (holdingsEl) {
        const hd = holdings[sym] || holdings.VOO;
        holdingsEl.innerHTML = hd.map((h) =>
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px;">' +
            '<span>' + h.name + '</span><span style="font-weight:600;">' + h.pct + '%</span></div>'
        ).join("");
      }
    }

    // Compare tab (static)
    const compareBarsEl = root.querySelector<HTMLElement>("#compare-bars");
    if (compareBarsEl) {
      const bars = [
        { label: "VOO", value: 5.2, color: "var(--green)" },
        { label: "QQQM", value: 8.7, color: "var(--blue)" },
        { label: "SPY", value: 5.1, color: "var(--amber)" },
        { label: "QQQ", value: 8.5, color: "var(--purple)" },
      ];
      compareBarsEl.innerHTML = bars.map((b) =>
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<span style="width:60px;font-size:12px;font-weight:600;">' + b.label + '</span>' +
          '<div style="flex:1;height:24px;background:var(--surface);border-radius:4px;overflow:hidden;">' +
            '<div style="width:' + (b.value * 5) + '%;height:100%;background:' + b.color + ';border-radius:4px;display:flex;align-items:center;padding-left:8px;">' +
              '<span style="font-size:11px;font-weight:600;color:#fff;">+' + b.value + '%</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      ).join("");
    }
    const corrEl = root.querySelector<HTMLElement>("#compare-correlation");
    if (corrEl) corrEl.textContent = compareData.correlation;

    // Calendar tab (static)
    const calEl = root.querySelector<HTMLElement>("#calendar-events");
    if (calEl) {
      calEl.innerHTML = calendarEvents.map((e) => {
        const impactColor = e.impact === "High" ? "var(--red)" : "var(--amber)";
        return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);">' +
          '<span style="width:60px;font-size:12px;color:var(--ink-3);">' + e.date + '</span>' +
          '<span style="flex:1;font-size:13px;font-weight:500;">' + e.event + '</span>' +
          '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:' + impactColor + '20;color:' + impactColor + ';">' + e.impact + '</span>' +
        '</div>';
      }).join("");
    }

    return updateForSymbol;
  }

  const updateStaticForSymbol = populateStaticData();

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
      const color = (v: number) => v >= 0 ? "var(--green)" : "var(--red)";

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

  // Real Sectors key metrics from Yahoo Finance
  async function loadSectors(symbol: string) {
    const metricsEl = root.querySelector<HTMLElement>("#key-metrics");
    if (!metricsEl) return;

    // Show loading state
    metricsEl.innerHTML = '<div style="font-size:12px;color:var(--ink-3);padding:8px;">Loading metrics...</div>';

    // Static fallback data for VOO/QQQM (updated quarterly)
    const staticData: Record<string, { expenseRatio: string; aum: string; divYield: string; pe: string; ytd: string; threeY: string; fiveY: string }> = {
      VOO: { expenseRatio: "0.03%", aum: "$1.3T", divYield: "1.32%", pe: "24.5", ytd: "+5.2%", threeY: "+9.8%", fiveY: "+14.2%" },
      QQQM: { expenseRatio: "0.15%", aum: "$25B", divYield: "0.58%", pe: "32.1", ytd: "+8.7%", threeY: "+12.5%", fiveY: "+18.1%" },
    };

    try {
      const fund = await fetchFundamentals(symbol);
      const formatAUM = (v: number) => {
        if (v >= 1e12) return "$" + (v / 1e12).toFixed(1) + "T";
        if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
        if (v >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M";
        return "$" + v.toLocaleString();
      };
      metricsEl.innerHTML =
        '<div style="font-size:12px;line-height:2;">' +
          '<div style="display:flex;justify-content:space-between;"><span>Expense Ratio</span><span style="font-weight:600;">' + (fund.expenseRatio > 0 ? (fund.expenseRatio * 100).toFixed(2) + "%" : "N/A") + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>AUM</span><span style="font-weight:600;">' + (fund.totalAssets > 0 ? formatAUM(fund.totalAssets) : "N/A") + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>Dividend Yield</span><span style="font-weight:600;">' + (fund.dividendYield > 0 ? (fund.dividendYield * 100).toFixed(2) + "%" : "N/A") + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>P/E Ratio</span><span style="font-weight:600;">' + (fund.trailingPE > 0 ? fund.trailingPE.toFixed(1) : "N/A") + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>YTD Return</span><span style="font-weight:600;color:' + (fund.ytdReturn >= 0 ? "var(--green)" : "var(--red)") + ';">' + (fund.ytdReturn !== 0 ? (fund.ytdReturn * 100).toFixed(1) + "%" : "N/A") + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>3Y Return</span><span style="font-weight:600;color:' + (fund.threeYearReturn >= 0 ? "var(--green)" : "var(--red)") + ';">' + (fund.threeYearReturn !== 0 ? (fund.threeYearReturn * 100).toFixed(1) + "%" : "N/A") + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>5Y Return</span><span style="font-weight:600;color:' + (fund.fiveYearReturn >= 0 ? "var(--green)" : "var(--red)") + ';">' + (fund.fiveYearReturn !== 0 ? (fund.fiveYearReturn * 100).toFixed(1) + "%" : "N/A") + '</span></div>' +
        '</div>';
    } catch (err) {
      console.warn("[Market] API failed, using static data for " + symbol, err);
      const sd = staticData[symbol] || staticData.VOO;
      metricsEl.innerHTML =
        '<div style="font-size:12px;line-height:2;">' +
          '<div style="display:flex;justify-content:space-between;"><span>Expense Ratio</span><span style="font-weight:600;">' + sd.expenseRatio + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>AUM</span><span style="font-weight:600;">' + sd.aum + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>Dividend Yield</span><span style="font-weight:600;">' + sd.divYield + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>P/E Ratio</span><span style="font-weight:600;">' + sd.pe + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>YTD Return</span><span style="font-weight:600;">' + sd.ytd + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>3Y Return</span><span style="font-weight:600;">' + sd.threeY + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>5Y Return</span><span style="font-weight:600;">' + sd.fiveY + '</span></div>' +
        '</div>';
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
      setT("#div-yield", (fund.dividendYield * 100).toFixed(2) + "%");
      setT("#div-frequency", fund.dividendFrequency);
      setT("#div-annual", "$" + fund.dividendRate.toFixed(2));
      setT("#div-pe", fund.trailingPE > 0 ? fund.trailingPE.toFixed(1) : "N/A");

      const historyEl = root.querySelector<HTMLElement>("#div-history");
      if (historyEl && fund.exDividendDate) {
        historyEl.innerHTML =
          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;">' +
            '<span>Next Ex-Dividend</span><span style="font-weight:600;">' + fund.exDividendDate + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;">' +
            '<span>5Y Avg Yield</span><span style="font-weight:600;">' + (fund.fiveYearAvgDividendYield * 100).toFixed(2) + '%</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;">' +
            '<span>Annual Dividend</span><span style="font-weight:600;">$' + fund.trailingAnnualDividendRate.toFixed(2) + '</span></div>';
      }
    } catch (err) {
      console.warn("[Market] API failed, using static dividend data for " + symbol, err);
      const sd = staticDiv[symbol] || staticDiv.VOO;
      setT("#div-yield", sd.yield);
      setT("#div-frequency", sd.freq);
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

  // Symbol buttons
  root.querySelectorAll<HTMLButtonElement>(".market-symbol-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSymbol = btn.dataset.symbol || "VOO";
      root.querySelectorAll<HTMLButtonElement>(".market-symbol-btn").forEach((b) => {
        b.style.borderColor = b === btn ? "var(--green)" : "var(--line)";
        b.style.background = b === btn ? "var(--green-dim)" : "var(--surface)";
        b.style.color = b === btn ? "var(--green)" : "var(--ink)";
      });
      createWidget(currentSymbol, currentInterval);
      updatePnL(currentSymbol);
      updateTimeline(currentSymbol);
      updateStaticForSymbol(currentSymbol);
      loadDividends(currentSymbol);
      loadRisk(currentSymbol);
      loadSectors(currentSymbol);
    });
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
  loadSectors(currentSymbol);
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
let ledgerHistoryOpen = false;
let ledgerCategoriesOpen = false;

function localDateValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function ledgerTemplate(state: WealthState): string {
  const filtered = filterLedgerTransactions(state.ledgerTransactions, ledgerFilters);
  const totals = ledgerTotals(filtered);
  const editing = state.ledgerTransactions.find((transaction) => transaction.id === ledgerEditingId);
  const entryType = editing?.type ?? "expense";
  const entryCategories = state.ledgerCategories.filter((category) => category.type === entryType);
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
    return `<article class="ledger-row"><div class="ledger-row-icon">${escapeHtml(category?.icon ?? "•")}</div><div class="ledger-row-copy"><strong>${escapeHtml(category?.label ?? "Unknown category")}</strong><small>${new Date(transaction.date).toLocaleDateString()}${transaction.note ? " · " + escapeHtml(transaction.note) : ""}</small></div><strong class="ledger-amount ${transaction.type}">${transaction.type === "income" ? "+" : "−"}${money(transaction.amount)}</strong><div class="ledger-row-actions"><button class="icon-button edit-ledger" data-id="${escapeHtml(transaction.id)}" aria-label="Edit transaction">✎</button><button class="icon-button danger delete-ledger" data-id="${escapeHtml(transaction.id)}" aria-label="Delete transaction">✕</button></div></article>`;
  }).join("");

  return `<div class="section-title"><span class="eyebrow">Everyday Money</span><h3>Ledger / 记账</h3><p>Capture income and expenses quickly, then understand where your money goes.</p></div>
    <div class="ledger-layout">
      <article class="card panel ledger-entry"><div class="panel-head"><div><span class="eyebrow">Quick Entry</span><h3>${editing ? "Edit Transaction" : "Add Transaction"}</h3></div>${editing ? '<button id="cancelLedgerEdit" class="secondary-button" type="button">Cancel</button>' : ""}</div>
        <form id="ledgerForm"><input name="id" type="hidden" value="${escapeHtml(editing?.id ?? "")}"><div class="ledger-type-toggle" role="group" aria-label="Transaction type"><button type="button" data-ledger-type="expense" class="${entryType === "expense" ? "active expense" : ""}">− Expense</button><button type="button" data-ledger-type="income" class="${entryType === "income" ? "active income" : ""}">+ Income</button></div><input name="type" type="hidden" value="${entryType}">
          <label class="ledger-amount-input"><span>Amount (MYR)</span><input id="ledgerAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${editing?.amount ?? ""}" placeholder="0.00"></label>
          <fieldset class="category-picker"><legend>Category</legend>${entryCategories.map((category, index) => `<label><input name="categoryId" type="radio" value="${escapeHtml(category.id)}"${category.id === editing?.categoryId || (!editing && index === 0) ? " checked" : ""}><span><b>${escapeHtml(category.icon)}</b>${escapeHtml(category.label)}</span></label>`).join("")}</fieldset>
          <details class="ledger-more"${editing ? " open" : ""}><summary>Date & note</summary><div class="form-grid"><label>Date<input name="date" type="date" required value="${localDateValue(editing?.date)}"></label><label>Note<input name="note" maxlength="500" value="${escapeHtml(editing?.note ?? "")}" placeholder="Optional"></label></div></details><p id="ledgerFormError" class="form-error" role="alert"></p><button class="primary-button ledger-save" type="submit">${editing ? "Save Changes" : "Save Transaction"}</button>
        </form>
      </article>
      <div class="ledger-main">
        <div class="ledger-summary"><article class="card"><span>Income / 收入</span><strong class="income">+${money(totals.income)}</strong></article><article class="card"><span>Expenses / 支出</span><strong class="expense">−${money(totals.expense)}</strong></article><article class="card"><span>Net / 净额</span><strong class="${totals.balance >= 0 ? "income" : "expense"}">${totals.balance >= 0 ? "+" : "−"}${money(Math.abs(totals.balance))}</strong></article></div>
        <article class="card panel ledger-filters"><form id="ledgerFilterForm"><div class="filter-presets">${(["week", "month", "year", "custom"] as const).map((preset) => `<button type="button" data-preset="${preset}" class="${ledgerFilters.preset === preset ? "active" : ""}">${preset === "week" ? "This week" : preset === "month" ? "This month" : preset === "year" ? "This year" : "Custom"}</button>`).join("")}</div><div class="ledger-filter-fields ${ledgerFilters.preset === "custom" ? "show-custom" : ""}"><label class="custom-date">From<input name="startDate" type="date" value="${ledgerFilters.startDate}"></label><label class="custom-date">To<input name="endDate" type="date" value="${ledgerFilters.endDate}"></label><label>Type<select name="type"><option value="all">All types</option><option value="expense"${ledgerFilters.type === "expense" ? " selected" : ""}>Expense</option><option value="income"${ledgerFilters.type === "income" ? " selected" : ""}>Income</option></select></label><label>Category<select name="categoryId"><option value="">All categories</option>${categoryOptions}</select></label><label>Search note<input name="query" type="search" value="${escapeHtml(ledgerFilters.query)}" placeholder="Keyword"></label><button class="secondary-button" id="resetLedgerFilters" type="button">Reset</button></div></form></article>
        <div class="ledger-report-grid"><article class="card panel"><div class="panel-head"><div><span class="eyebrow">Expense Mix</span><h3>Category Share</h3></div></div>${expenses.length ? `<div class="ledger-donut-wrap"><div class="ledger-donut" style="background:conic-gradient(${donut})"><span>${money(totals.expense)}</span></div><div class="ledger-legend">${expenses.map((item, index) => `<div><i style="background:${palette[index % palette.length]}"></i><span>${escapeHtml(item.category.icon + " " + item.category.label)}</span><strong>${percent(item.share, 1)}</strong></div>`).join("")}</div></div><div class="ledger-bars">${expenses.map((item, index) => `<div><span>${escapeHtml(item.category.label)}</span><div><i style="width:${(item.amount / maxCategory) * 100}%;background:${palette[index % palette.length]}"></i></div><strong>${money(item.amount)}</strong></div>`).join("")}</div>` : '<p class="empty-state">No expense data in this period.</p>'}</article>
          <article class="card panel"><div class="panel-head"><div><span class="eyebrow">Annual Overview</span><h3>Monthly Income vs Expense</h3></div></div><div class="monthly-chart">${monthly.map((item) => `<div class="month-column"><div class="month-bars"><i class="income" style="height:${Math.max(item.income / monthlyMax * 100, item.income ? 3 : 0)}%" title="Income ${money(item.income)}"></i><i class="expense" style="height:${Math.max(item.expense / monthlyMax * 100, item.expense ? 3 : 0)}%" title="Expense ${money(item.expense)}"></i></div><small>${new Date(2000, item.month).toLocaleString("en", { month: "short" }).slice(0, 1)}</small></div>`).join("")}</div><div class="chart-key"><span><i class="income"></i>Income</span><span><i class="expense"></i>Expense</span></div></article></div>
        <details id="ledgerHistoryPanel" class="card panel ledger-collapsible"${ledgerHistoryOpen ? " open" : ""}><summary><div><span class="eyebrow">Transactions</span><h3>History</h3></div><span class="ledger-collapsible-meta">${filtered.length} records</span></summary><div class="ledger-collapsible-content"><div class="ledger-list">${transactionRows || '<p class="empty-state">No transactions match this view. Add your first record above.</p>'}</div></div></details>
        <details id="ledgerCategoriesPanel" class="card panel ledger-collapsible"${ledgerCategoriesOpen ? " open" : ""}><summary><div><span class="eyebrow">Custom Labels</span><h3>Category Manager</h3></div><span class="ledger-collapsible-meta">${state.ledgerCategories.length} categories</span></summary><div class="ledger-collapsible-content"><form id="ledgerCategoryForm" class="category-form"><label>Icon<input name="icon" maxlength="12" value="✨" required></label><label>Label<input name="label" maxlength="40" placeholder="Category name" required></label><label>Type<select name="type"><option value="expense">Expense</option><option value="income">Income</option></select></label><button class="primary-button" type="submit">Add Category</button></form><div class="category-manager">${state.ledgerCategories.map((category) => `<div><span>${escapeHtml(category.icon)} ${escapeHtml(category.label)} <small>${category.type}</small></span><button class="secondary-button edit-category" data-id="${escapeHtml(category.id)}" type="button">Edit</button><button class="icon-button danger delete-category" data-id="${escapeHtml(category.id)}" aria-label="Delete ${escapeHtml(category.label)}">✕</button></div>`).join("")}</div></div></details>
      </div>
    </div>`;
}

function bucketsTemplate(state: WealthState): string {
  const surplus = Math.max(monthlySurplus(state), 1);
  const bucketCards = state.buckets.map((bucket, index) => {
    const base = bucket.id === "survival" ? state.cashflow.allowance : bucket.cadence === "one-time" ? bucket.amount : surplus;
    const width = Math.min((bucket.amount / base) * 100, 100);
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
    <div class="three-col-grid">
      ${bucketCards}
      ${addBucketCard}
    </div>
  `;
}

function goalsWithIncompleteFirst(state: WealthState): Array<{ goal: WealthState["goals"][number]; originalIndex: number }> {
  return state.goals
    .map((goal, originalIndex) => ({ goal, originalIndex }))
    .sort((a, b) => {
      const aComplete = a.goal.target > 0 && a.goal.current >= a.goal.target;
      const bComplete = b.goal.target > 0 && b.goal.current >= b.goal.target;
      return Number(aComplete) - Number(bComplete);
    });
}

function goalsTemplate(state: WealthState): string {
  const goalCards = goalsWithIncompleteFirst(state).map(({ goal, originalIndex }) => {
    const ratio = goal.target > 0 ? Math.min(goal.current / goal.target, 1) : 0;
    const months = goal.monthlyContribution > 0 ? Math.ceil(Math.max(goal.target - goal.current, 0) / goal.monthlyContribution) : null;
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
      '<small style="color:var(--ink-3);">' + money(goal.current) + ' / ' + money(goal.target) + extra + '</small>' +
      '<p>' + escapeHtml(goal.note) + '</p>' +
      '<div class="goal-edit-form" id="goalEdit' + originalIndex + '" style="display:none;margin-top:12px;">' +
        '<form class="form-grid goalForm" data-index="' + originalIndex + '">' +
          '<label>Name<input name="name" type="text" value="' + escapeHtml(goal.name) + '"></label>' +
          '<label>Label<input name="label" type="text" value="' + escapeHtml(goal.label) + '"></label>' +
          numberInput("current", "Current MYR", String(goal.current), "1") +
          numberInput("target", "Target MYR", String(goal.target), "1") +
          numberInput("monthlyContribution", "Monthly MYR", String(goal.monthlyContribution), "1") +
          '<label>Note<textarea name="note" rows="2">' + escapeHtml(goal.note) + '</textarea></label>' +
          '<div style="display:flex;gap:8px;">' +
            '<button class="primary-button" type="submit">Save</button>' +
            '<button class="secondary-button cancel-goal-edit" type="button" data-index="' + originalIndex + '">Cancel</button>' +
            '<button class="danger-button delete-goal" type="button" data-index="' + originalIndex + '">Delete</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
      '</article>';
  }).join("");

  const addGoalCard = '<article class="card data-card" style="display:flex;align-items:center;justify-content:center;min-height:120px;border-style:dashed;cursor:pointer;" id="addGoalBtn">' +
    '<div style="text-align:center;color:var(--ink-3);">' +
      '<div style="font-size:24px;margin-bottom:4px;">+</div>' +
      '<span>Add Goal</span>' +
    '</div>' +
  '</article>';

  return `
    <div class="section-title"><span class="eyebrow">Goal System</span><h3>Goals and Wishlist</h3><p>Goals do not restrict your life; they give every ringgit a clear direction.</p></div>
    <div class="two-col-grid">
      ${goalCards}
      ${addGoalCard}
    </div>
  `;
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
    <div class="terminal-grid">
      <article class="card panel advisor-panel">
        <div class="panel-head"><div><span class="eyebrow">Advisor Engine</span><h3>Financial Planning Guidance</h3></div><span style="color:var(--muted);font-size:12px;">Rules-based</span></div>
        <div class="advice-list">${advisorMessages(state).map(adviceCard).join("")}</div>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Scenario Check</span><h3>Dip-Buy Trigger</h3></div><span style="color:var(--muted);font-size:12px;">Bear Market Plan</span></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="flex:1;min-width:140px;background:var(--surface);border-radius:8px;padding:10px 12px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">🎯 Opportunity Reserve</div>
            <div style="font-size:16px;font-weight:700;color:var(--green);">${money(state.opportunity.total)}</div>
            <div style="font-size:11px;color:var(--ink-3);">Used: ${money(state.opportunity.used)} · Remaining: ${money(state.opportunity.total - state.opportunity.used)}</div>
          </div>
          <div style="flex:1;min-width:140px;background:var(--surface);border-radius:8px;padding:10px 12px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📊 VOO Allocation</div>
            <div style="font-size:16px;font-weight:700;">${money(state.opportunity.allocation.VOO)}</div>
          </div>
          <div style="flex:1;min-width:140px;background:var(--surface);border-radius:8px;padding:10px 12px;">
            <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">📊 QQQM Allocation</div>
            <div style="font-size:16px;font-weight:700;">${money(state.opportunity.allocation.QQQM)}</div>
          </div>
        </div>
        <form id="drawdownForm" class="scenario-form">
          <label>Market Drawdown %<input id="drawdownInput" type="number" min="0" max="80" step="1" value="0"></label>
          <button class="primary-button" type="submit">Check Rule</button>
        </form>
        <div id="drawdownResult" class="scenario-result">Enter the market drawdown from its peak to check whether reserve deployment is triggered.</div>
        <div class="table-wrap compact-table">
          <table><thead><tr><th>Trigger</th><th>Reserve %</th><th>Amount</th><th>VOO / QQQM</th><th>Status</th></tr></thead><tbody>${trancheRows}</tbody></table>
        </div>
      </article>
    </div>
  `;
}

function adviceCard(msg: AdvisorMessage): string {
  return '<div class="advice ' + msg.severity + '"><strong>' + escapeHtml(msg.title) + '</strong><span>' + escapeHtml(msg.body) + '</span></div>';
}

function rulesTemplate(state: WealthState): string {
  const defaultItems: Array<{ id: RuleCardId; title: string; body: string }> = [
    { id: "monthly-cashflow", title: "Monthly Cashflow", body: "💰 " + money(state.cashflow.allowance) + " allowance, " + money(monthlyBasicExpense(state)) + " basic spending, " + money(monthlySurplus(state)) + " assignable surplus." },
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
  if (state.ruleNotes.trim()) {
    cards.push('<article class="card data-card rule-card"><div class="rule-card-head"><span class="eyebrow">' + escapeHtml(state.ruleNoteTitle || "Personal Rule Notes") + '</span><div class="rule-card-actions"><button class="secondary-button edit-rule-notes" type="button" aria-label="Edit personal rule notes">Edit</button><button class="icon-button danger delete-rule-notes" type="button" aria-label="Delete personal rule notes" title="Delete rule">X</button></div></div><p style="white-space:pre-wrap;">' + escapeHtml(state.ruleNotes.trim()) + '</p></article>');
  }
  return '<div class="three-col-grid">' + (cards.join("") || '<p class="empty-state">No rule cards remain. Add personal notes below to create a new rule.</p>') + '</div>' +
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
  const reviewRows = state.reviews.map((review) => {
    return '<article class="review-item"><div style="display:flex;justify-content:space-between;align-items:flex-start;"><strong>' + escapeHtml(review.month) + '</strong><button class="icon-button danger delete-review" data-id="' + review.id + '" title="Delete review">🗑️</button></div><span>Income ' +
      money(review.income) + ' · Spending ' + money(review.spending) + ' · Score ' +
      review.disciplineScore + '/100</span><p>' + escapeHtml(review.notes || "No notes") + '</p></article>';
  }).join("");

  return `
    <div class="terminal-grid">
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Monthly Close</span><h3>Monthly Review</h3></div><span style="color:var(--muted);font-size:12px;">Discipline</span></div>
        <form id="reviewForm" class="form-grid">
          <label>Month<input name="month" type="month" required></label>
          ${numberInput("income", "Income MYR", String(state.cashflow.allowance), "1")}
          ${numberInput("spending", "Spending MYR", String(monthlyBasicExpense(state)), "1")}
          <label>DCA Done?<select name="dcaDone"><option value="true">Yes</option><option value="false">No</option></select></label>
          ${numberInput("disciplineScore", "Discipline Score", "85", "1")}
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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(current.trim());
      current = "";
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseMoomooDate(raw: string): string {
  // "Jun 26, 2026 00:00:00 ET" or "May 12, 2026 10:52:00 ET"
  const match = raw.match(/^(\w+ \d+), (\d{4})/);
  if (!match) return raw;
  const d = new Date(match[0]);
  if (isNaN(d.getTime())) return raw;
  return d.toISOString().slice(0, 10);
}

export function quickViewTemplate(state: WealthState): string {
  const portfolio = portfolioSummary(state);
  const emergency = emergencyRatio(state);
  const surplus = monthlySurplus(state);
  const investedMyr = portfolio.totalInvestedMyr;
  const targetRows = goalsWithIncompleteFirst(state).map(({ goal: g }) => {
    const pct = g.target > 0 ? Math.min(Math.round(g.current / g.target * 100), 100) : 0;
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);">' +
      '<span style="font-size:13px;color:var(--ink-2);">' + escapeHtml(g.label) + '</span>' +
      '<span style="font-size:13px;font-weight:600;color:' + (pct >= 80 ? 'var(--green)' : 'var(--ink)') + ';">' + pct + '%</span>' +
    '</div>';
  }).join('');

  return `
    <div style="max-width:400px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:20px;">
        <div class="brand-mark" style="width:48px;height:48px;margin:0 auto 8px;font-size:18px;">PW</div>
        <h2 style="font-size:20px;margin:0;">Personal Wealth OS</h2>
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
          <div style="font-size:11px;color:var(--ink-3);margin-bottom:4px;">MONTHLY SURPLUS</div>
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

function recordsFromCsv(text: string): Trade[] {
  const [headers = [], ...rows] = parseCsv(text);
  const normalized = headers.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  const get = (row: string[], names: string[]) => {
    const idx = normalized.findIndex((h) => names.includes(h));
    return idx >= 0 ? row[idx] ?? "" : "";
  };

  // Detect Moomoo Universal Account format by checking for "Symbol" and "Side" columns
  const isMoomooFormat = normalized.includes("symbol") && normalized.includes("side");

  if (isMoomooFormat) {
    const USD_TO_MYR = 4.25; // fallback rate for display
    return rows
      .filter((row) => {
        const status = get(row, ["status"]).toLowerCase();
        return status === "filled"; // only import filled orders
      })
      .map((row): Trade | null => {
        const ticker = get(row, ["symbol"]).toUpperCase();
        if (!ticker) return null;

        const side = get(row, ["side"]).toLowerCase();
        const fillAmountUsd = Number(get(row, ["fill amount"])) || Number(get(row, ["order amount"])) || 0;
        const fillPrice = Number(get(row, ["filled@avg price"])) || Number(get(row, ["order price"])) || 0;
        const platformFees = Number(get(row, ["platform fees"])) || 0;

        // Determine trade type from side
        let tradeType: TradeType = "DCA";
        if (side === "sell") {
          tradeType = "Sell";
        }

        return {
          id: createId("csv"),
          date: parseMoomooDate(get(row, ["order time"])),
          platform: "moomoo",
          ticker: ticker as Ticker,
          type: tradeType,
          amountMyr: Math.round(fillAmountUsd * USD_TO_MYR * 100) / 100,
          amountUsd: Math.round(fillAmountUsd * 100) / 100,
          priceUsd: Math.round(fillPrice * 100) / 100,
          feeMyr: Math.round(platformFees * USD_TO_MYR * 100) / 100,
        };
      })
      .filter((trade): trade is Trade => trade !== null);
  }

  // Fallback: original simple CSV format
  return rows
    .map((row): Trade | null => {
      const ticker = get(row, ["ticker"]).toUpperCase();
      if (!ticker) return null;
      return {
        id: createId("csv"),
        date: get(row, ["date"]),
        platform: get(row, ["platform"]) || "moomoo",
        ticker: ticker as Ticker,
        amountMyr: Number(get(row, ["amount(rm)", "amount myr", "total(rm)"])) || 0,
        amountUsd: Number(get(row, ["amount (usd)", "amount usd"])) || 0,
        priceUsd: Number(get(row, ["price/unit (usd)", "price usd"])) || 0,
        type: (get(row, ["type"]) || "DCA") as TradeType,
        feeMyr: Number(get(row, ["fee", "fee myr"])) || 0,
      };
    })
    .filter((trade): trade is Trade => trade !== null);
}

export function renderApp(root: HTMLElement, state: WealthState, setState: Setter, activePage = "dashboard", navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
  calculatorCleanup.get(root)?.();
  calculatorCleanup.delete(root);
  sideRaysCleanup.get(root)?.();
  sideRaysCleanup.delete(root);

  // Quick view — no sidebar, just condensed data
  if (activePage === "quick") {
    root.className = "app-shell";
    root.innerHTML = '<main class="main" style="padding:20px;">' + quickViewTemplate(state) + '</main>';
    root.querySelector("#openFullApp")?.addEventListener("click", () => {
      renderApp(root, state, setState, "dashboard", navigate, user, onLogout);
    });
    return;
  }

  root.className = "app-shell";
  root.innerHTML = shellTemplate(activePage, state, user);
  keepActiveNavigationVisible(root);
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
    calculator: '<div id="investmentGrowthCalculator"></div>',
    advisor: advisorPageTemplate(state),
    rules: rulesTemplate(state),
    review: reviewTemplate(state),
    settings: settingsTemplate(state),
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
  const activePage = activePageFromNav(root) ?? "dashboard";
  const doNavigate = navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate, user));

  root.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
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

  root.querySelector<HTMLButtonElement>("#exportJson")?.addEventListener("click", () => exportState(state));
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
    renderVersionHistoryModal(root, state, setState, snapshots, navigate, user, onLogout);
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

function renderVersionHistoryModal(root: HTMLElement, state: WealthState, setState: Setter, snapshots: Snapshot[], navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
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
    button.addEventListener("click", () => navigate?.(button.dataset.page ?? "dashboard"));
  });
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
  if (activePage === "portfolio") bindPortfolio(root, state, setState, navigate);
  if (activePage === "advisor") bindAdvisor(root, state);
  if (activePage === "review") bindReview(root, state, setState, navigate);
  if (activePage === "settings") bindSettings(root, state, setState, navigate);
  if (activePage === "goals") bindGoals(root, state, setState, navigate);
  if (activePage === "market") bindMarket(root, state, setState, navigate);
  if (activePage === "ledger") bindLedger(root, state, setState, navigate);
  if (activePage === "buckets") bindBuckets(root, state, setState, navigate);
  if (activePage === "rules") bindRules(root, state, setState, navigate);
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

  root.querySelector<HTMLButtonElement>(".delete-rule-notes")?.addEventListener("click", () => {
    if (!confirm("Delete your personal rule notes? A snapshot will be saved first.")) return;
    showRules({ ...state, ruleNoteTitle: "", ruleNotes: "" }, "Delete rule notes");
  });

  root.querySelector<HTMLButtonElement>(".edit-rule-notes")?.addEventListener("click", () => {
    const titleInput = root.querySelector<HTMLInputElement>("#ruleNoteTitle");
    const notesInput = root.querySelector<HTMLTextAreaElement>("#ruleNotes");
    if (titleInput) titleInput.value = state.ruleNoteTitle;
    if (notesInput) notesInput.value = state.ruleNotes;
    titleInput?.scrollIntoView({ behavior: "smooth", block: "center" });
    titleInput?.focus({ preventScroll: true });
  });

  root.querySelector<HTMLFormElement>("#ruleNotesForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const ruleNoteTitle = String(data.get("ruleNoteTitle") ?? "").trim().slice(0, 80);
    const ruleNotes = String(data.get("ruleNotes") ?? "").slice(0, 5000);
    const next = { ...state, ruleNoteTitle, ruleNotes };
    setState(next, "Update rules notes");
    if (navigate) navigate("rules");
    else renderApp(root, next, setState, "rules");
  });
}

function bindLedger(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate): void {
  const refresh = (next = state, label?: string) => {
    if (next !== state) setState(next, label);
    renderApp(root, next, setState, "ledger", navigate);
  };

  root.querySelector<HTMLDetailsElement>("#ledgerHistoryPanel")?.addEventListener("toggle", (event) => {
    ledgerHistoryOpen = (event.currentTarget as HTMLDetailsElement).open;
  });
  root.querySelector<HTMLDetailsElement>("#ledgerCategoriesPanel")?.addEventListener("toggle", (event) => {
    ledgerCategoriesOpen = (event.currentTarget as HTMLDetailsElement).open;
  });

  root.querySelector<HTMLInputElement>("#ledgerAmount")?.focus();
  root.querySelectorAll<HTMLButtonElement>("[data-ledger-type]").forEach((button) => button.addEventListener("click", () => {
    const type = button.dataset.ledgerType as LedgerTransactionType;
    const form = root.querySelector<HTMLFormElement>("#ledgerForm");
    const typeInput = form?.elements.namedItem("type") as HTMLInputElement | null;
    const amount = (form?.elements.namedItem("amount") as HTMLInputElement | null)?.value ?? "";
    const date = (form?.elements.namedItem("date") as HTMLInputElement | null)?.value ?? "";
    const note = (form?.elements.namedItem("note") as HTMLInputElement | null)?.value ?? "";
    ledgerEditingId = "";
    const temporary = { ...state, ledgerTransactions: state.ledgerTransactions };
    if (typeInput) typeInput.value = type;
    renderApp(root, temporary, setState, "ledger", navigate);
    const nextForm = root.querySelector<HTMLFormElement>("#ledgerForm");
    const fields = { amount: nextForm?.elements.namedItem("amount"), date: nextForm?.elements.namedItem("date"), note: nextForm?.elements.namedItem("note"), type: nextForm?.elements.namedItem("type") };
    if (fields.amount instanceof HTMLInputElement) fields.amount.value = amount;
    if (fields.date instanceof HTMLInputElement) fields.date.value = date;
    if (fields.note instanceof HTMLInputElement) fields.note.value = note;
    if (fields.type instanceof HTMLInputElement) fields.type.value = type;
    root.querySelectorAll<HTMLButtonElement>("[data-ledger-type]").forEach((item) => item.className = item.dataset.ledgerType === type ? `active ${type}` : "");
    const picker = root.querySelector<HTMLElement>(".category-picker");
    if (picker) picker.innerHTML = `<legend>Category</legend>${state.ledgerCategories.filter((category) => category.type === type).map((category, index) => `<label><input name="categoryId" type="radio" value="${escapeHtml(category.id)}"${index === 0 ? " checked" : ""}><span><b>${escapeHtml(category.icon)}</b>${escapeHtml(category.label)}</span></label>`).join("")}`;
  }));

  root.querySelector<HTMLFormElement>("#ledgerForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const amount = normalizeLedgerAmount(String(data.get("amount") ?? ""));
    const type = String(data.get("type")) as LedgerTransactionType;
    const categoryId = String(data.get("categoryId") ?? "");
    const dateValue = String(data.get("date") ?? "");
    const date = new Date(`${dateValue}T00:00:00`);
    const error = root.querySelector<HTMLElement>("#ledgerFormError");
    if (!amount || !["income", "expense"].includes(type) || !state.ledgerCategories.some((category) => category.id === categoryId && category.type === type) || !Number.isFinite(date.getTime())) {
      if (error) error.textContent = "Enter a positive amount, valid date, and matching category.";
      return;
    }
    const id = String(data.get("id") || createId("ledger"));
    const note = String(data.get("note") ?? "").trim().slice(0, 500);
    const transaction: LedgerTransaction = { id, amount, type, categoryId, date: date.toISOString(), ...(note ? { note } : {}) };
    const exists = state.ledgerTransactions.some((item) => item.id === id);
    const ledgerTransactions = exists ? state.ledgerTransactions.map((item) => item.id === id ? transaction : item) : [...state.ledgerTransactions, transaction];
    ledgerEditingId = "";
    refresh({ ...state, ledgerTransactions }, exists ? "Edit ledger transaction" : "Add ledger transaction");
  });

  root.querySelectorAll<HTMLButtonElement>(".edit-ledger").forEach((button) => button.addEventListener("click", () => { ledgerEditingId = button.dataset.id ?? ""; refresh(); }));
  root.querySelector<HTMLButtonElement>("#cancelLedgerEdit")?.addEventListener("click", () => { ledgerEditingId = ""; refresh(); });
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
    refresh();
  };
  root.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => button.addEventListener("click", () => { ledgerFilters.preset = button.dataset.preset as LedgerFilters["preset"]; applyFilters(); }));
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#ledgerFilterForm input, #ledgerFilterForm select").forEach((field) => field.addEventListener("change", applyFilters));
  root.querySelector<HTMLInputElement>('#ledgerFilterForm input[name="query"]')?.addEventListener("search", applyFilters);
  root.querySelector<HTMLButtonElement>("#resetLedgerFilters")?.addEventListener("click", () => { ledgerFilters = { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "" }; refresh(); });

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

  // Save goal form
  root.querySelectorAll<HTMLFormElement>(".goalForm").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const index = Number(form.dataset.index);
      const data = new FormData(form);
      const goals = [...state.goals];
      goals[index] = {
        ...goals[index],
        name: String(data.get("name") ?? goals[index].name),
        label: String(data.get("label") ?? goals[index].label),
        current: Number(data.get("current")) || 0,
        target: Number(data.get("target")) || 0,
        monthlyContribution: Number(data.get("monthlyContribution")) || 0,
        note: String(data.get("note") ?? goals[index].note),
      };
      const next = { ...state, goals };
      setState(next);
      doNavigate("goals");
    });
  });

  // Delete goal
  root.querySelectorAll<HTMLButtonElement>(".delete-goal").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!confirm("Delete this goal?")) return;
      const goals = state.goals.filter((_, i) => i !== index);
      const next = { ...state, goals };
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
  const doNavigate = navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate));

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
      feeMyr: Number(data.get("feeMyr")) || 0,
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

  root.querySelectorAll<HTMLButtonElement>(".delete-trade").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id || !confirm("Delete this trade record?")) return;
      const next = { ...state, trades: state.trades.filter((t) => t.id !== id) };
      setState(next);
      renderApp(root, next, setState, "portfolio", navigate);
    });
  });
}

function bindAdvisor(root: HTMLElement, state: WealthState): void {
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
    const latest = triggered.at(-1)!;
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