import type { AdvisorMessage, Ticker, Trade, TradeType, WealthState } from "./models";
import type { Snapshot } from "./state";
import { createId, cloneDefaultState, exportState, importStateFromFile, loadSnapshots, restoreSnapshot, clearSnapshots, saveState } from "./state";
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
import { fetchQuote, fetchMultipleQuotes, formatPrice, formatChange, formatVolume, type MarketQuote, calcPnLForTicker, type PortfolioPnL, buildTradeTimelineHtml } from "./market";

type Setter = (state: WealthState, changeLabel?: string) => void;
type Navigate = (page: string) => void;

const pages = [
  ["dashboard", "Overview", "总览"],
  ["portfolio", "Portfolio", "投资组合"],
  ["market", "Market", "行情"],
  ["buckets", "Buckets", "资金桶"],
  ["goals", "Goals", "目标"],
  ["advisor", "Advisor", "理财建议"],
  ["rules", "Rules", "财富规则"],
  ["review", "Review", "月度复盘"],
  ["settings", "Settings", "设置"],
] as const;

function escapeHtml(value: string): string {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

function numberInput(name: string, label: string, value = "", step = "0.01"): string {
  return `<label>${label}<input name="${name}" type="number" min="0" step="${step}" value="${value}"></label>`;
}

function navTemplate(activePage: string): string {
  return pages
    .map(([id, english, chinese]) => `<button class="nav-item ${id === activePage ? "active" : ""}" data-page="${id}" type="button"><span>${english}</span><small>${chinese}</small></button>`)
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
  const userBadge = user ? `<div class="user-badge"><img src="${user.photoURL || ""}" alt="" class="user-avatar" referrerpolicy="no-referrer"><span class="user-name">${user.displayName || user.email || "User"}</span><button class="secondary-button logout-btn" type="button">退出</button></div>` : "";
  return `
    <button class="hamburger" id="hamburgerBtn" type="button" aria-label="Menu">☰</button>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-mark">PW</div>
        <div>
          <h1>Personal Wealth OS</h1>
          <p>投资纪律 · 现金流 · 目标系统</p>
        </div>
      </div>
      <div class="sidebar-scroll-area">
        <nav class="nav" aria-label="Primary">${navTemplate(activePage)}</nav>
        <div class="profile-card">
          <span class="eyebrow">Investor Profile</span>
          <strong>Age ${state.profile.age} · ${state.profile.riskTolerance} Growth</strong>
          <small>${state.profile.stage} · ${state.profile.investmentHorizonYears}+ year horizon</small>
        </div>
      </div>
      <div class="sidebar-actions">
        ${userBadge}
        <button class="secondary-button install-btn" id="installPwa" type="button" style="width:100%;font-size:12px;">📱 Add to Home Screen</button>
        <div class="sidebar-actions-row">
          <button class="theme-toggle" id="themeToggle" type="button" title="Toggle theme">${themeIcon}</button>
          <button class="secondary-button" id="exportJson" type="button">Export</button>
          <label class="file-button">Import<input id="importJson" type="file" accept=".json"></label>
        </div>
        <div class="sidebar-actions-row">
          <button class="secondary-button" id="versionHistory" type="button">📋 Version History</button>
          <button class="danger-button" id="resetData" type="button">Reset</button>
        </div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <span class="eyebrow">MYR BASED · USD PORTFOLIO · LOCAL STORAGE V2</span>
          <h2>${active?.[1] ?? "Overview"} <span>${active?.[2] ?? "总览"}</span></h2>
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
  const surplus = monthlySurplus(state);
  const opportunity = state.opportunity.total - state.opportunity.used;

  // Dynamic health scores (0-1)
  const growthScore = state.dca.monthly > 0 && state.trades.length > 0 ? 1 : state.dca.monthly > 0 ? 0.5 : 0;
  const disciplineScore = [state.goals.length > 0, state.buckets.length > 0, state.profile.name !== ""].filter(Boolean).length / 3;

  return `
    <div class="metric-grid">
      <article class="card metric metric-hero">
        <div class="metric-icon green">💰</div>
        <span>Net Invested Capital</span>
        <strong>${money(portfolio.totalInvestedMyr)}</strong>
        <small>Portfolio principal from transaction log</small>
      </article>
      <article class="card metric">
        <div class="metric-icon blue">🛡️</div>
        <span>Emergency Fund</span>
        <strong>${percent(emergency)}</strong>
        <small>${money(state.emergency.current)} / ${money(state.emergency.target)}</small>
      </article>
      <article class="card metric">
        <div class="metric-icon amber">📊</div>
        <span>Monthly Surplus</span>
        <strong>${money(surplus)}</strong>
        <small>${money(monthlyBasicExpense(state))} basic spending</small>
      </article>
      <article class="card metric">
        <div class="metric-icon cyan">🎯</div>
        <span>Opportunity Reserve</span>
        <strong>${money(opportunity)}</strong>
        <small>Bear market deployment pool</small>
      </article>
    </div>
    <div class="terminal-grid">
      <article class="card panel advisor-panel">
        <div class="panel-head"><div><span class="eyebrow">Planner Brief</span><h3>本月理财行动</h3></div><strong style="color:var(--green);">Priority</strong></div>
        <div class="advice-list">${advisorMessages(state).slice(0, 4).map(adviceCard).join("")}</div>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Health Matrix</span><h3>财富状态</h3></div><strong style="color:var(--green);">${percent((emergency + growthScore + disciplineScore) / 3)}</strong></div>
        <div class="health-section">
          ${healthRow("Safety", emergency, monthsToEmergencyTarget(state) + " months to target")}
          ${healthRow("Growth", growthScore, growthScore > 0 ? "DCA active" : "No DCA plan")}
          ${healthRow("Discipline", disciplineScore, disciplineScore > 0 ? "Rules documented" : "Set up your goals")}
        </div>
        <div class="action-strip">${actions.map((action) => "<span>" + escapeHtml(action) + "</span>").join("")}</div>
      </article>
    </div>
    ${portfolioChartSection(state)}
  `;
}

function healthRow(name: string, value: number, note: string): string {
  const pct = Math.round(value * 100);
  return '<div class="health-row"><div class="h-label"><strong>' + name + '</strong><small>' + note + '</small></div><div class="bar"><span style="width:' + pct + '%"></span></div><div class="h-value">' + pct + '%</div></div>';
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
      <div class="panel-head"><div><span class="eyebrow">Asset Allocation</span><h3>投资配置图</h3></div><strong style="color:var(--green);">${totalMoney}</strong></div>
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

  return `
    <div class="terminal-grid">
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Trade Capture</span><h3>新增交易记录</h3></div><span style="color:var(--muted);font-size:12px;">Moomoo</span></div>
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
          <button class="primary-button" type="submit">Add Record</button>
        </form>
        <div class="import-box">
          <label class="file-button">Import CSV (Moomoo / Excel)<input id="csvInput" type="file" accept=".csv"></label>
          <small>Supports Moomoo Universal Account export & custom CSV (Date, Ticker, Amount, Price, Type).</small>
        </div>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Allocation Desk</span><h3>组合配置</h3></div><strong style="color:var(--green);">${money(portfolio.totalInvestedMyr)}</strong></div>
        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>Ticker</th><th>Invested MYR</th><th>Invested USD</th><th>Units</th><th>Avg Cost</th><th>Actual / Target</th><th>Drift</th></tr></thead>
            <tbody>${positionRows}</tbody>
          </table>
        </div>
      </article>
    </div>
    <article class="card panel">
      <div class="panel-head"><div><span class="eyebrow">Investment Ledger</span><h3>交易流水</h3></div><span style="color:var(--muted);font-size:12px;">${state.trades.length} records</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Platform</th><th>Ticker</th><th>Type</th><th>Amount MYR</th><th>Amount USD</th><th>Price USD</th><th>Units</th><th></th></tr></thead>
          <tbody>${tradeRows || '<tr><td colspan="9" class="empty-state">还没有交易记录。添加第一笔交易开始追踪。</td></tr>'}</tbody>
        </table>
      </div>
    </article>
  `;
}

function marketTemplate(_state: WealthState): string {
  const tickerCards = ["VOO", "QQQM"].map((sym) =>
    '<article class="card market-ticker-card" id="ticker-' + sym + '" data-symbol="' + sym + '" style="cursor:pointer;">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<div class="ticker-badge" style="font-size:14px;padding:4px 10px;">' + sym + '</div>' +
        '<div style="flex:1;">' +
          '<div class="market-price" id="price-' + sym + '" style="font-size:22px;font-weight:700;">--</div>' +
          '<div class="market-change" id="change-' + sym + '" style="font-size:13px;font-weight:600;">--</div>' +
        '</div>' +
        '<div style="text-align:right;font-size:11px;color:var(--ink-3);">' +
          '<div id="volume-' + sym + '">Vol: --</div>' +
          '<div id="ohlc-' + sym + '">O/H/L/C: --</div>' +
        '</div>' +
      '</div>' +
    '</article>'
  ).join("");

  return `
    <div class="section-title">
      <span class="eyebrow">Live Market Data · TradingView</span>
      <h3>📊 行情追踪</h3>
      <p>VOO / QQQM K线走势 · 点击卡片切换标的</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      ${tickerCards}
    </div>
    <article class="card panel" style="margin-bottom:16px;padding:0;overflow:hidden;">
      <div class="panel-head" style="padding:10px 14px;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="ticker-badge" id="chartBadge" style="font-size:16px;padding:6px 14px;font-weight:700;">VOO</span>
          <div>
            <h3 id="chartTitle" style="margin:0;font-size:16px;">VOO · TradingView</h3>
            <div id="chartSubtitle" style="font-size:11px;color:var(--ink-3);">K线 · 技术指标 · 专业图表</div>
          </div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
          <select id="chartSymbol" style="background:var(--surface-2);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:12px;">
            <option value="VOO">VOO</option>
            <option value="QQQM">QQQM</option>
          </select>
          <button id="refreshQuotes" class="secondary-button" type="button" title="Refresh quotes now" style="padding:4px 10px;font-size:12px;">🔄</button>
          <span id="quoteTimestamp" style="font-size:10px;color:var(--ink-3);min-width:80px;"></span>
        </div>
      </div>
      <div id="tradingview_container" style="width:100%;height:520px;"></div>
    </article>
    <div id="tradeTimeline"></div>
    <div id="pnlPanel" style="display:none;margin-bottom:16px;">
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
    <div id="marketError" style="display:none;background:var(--red-dim);color:var(--red);padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:12px;"></div>
  `;
}

// Market state (module-level)
let marketRefreshTimer: ReturnType<typeof setInterval> | null = null;
let tvWidgetRef: { remove: () => void } | null = null;

function bindMarket(_root: HTMLElement, _state: WealthState, _setState: Setter, _navigate?: Navigate): void {
  const tvContainer = _root.querySelector<HTMLElement>("#tradingview_container");
  const badgeEl = _root.querySelector<HTMLElement>("#chartBadge");
  const titleEl = _root.querySelector<HTMLElement>("#chartTitle");
  const subtitleEl = _root.querySelector<HTMLElement>("#chartSubtitle");
  const symbolSelect = _root.querySelector<HTMLSelectElement>("#chartSymbol");
  const errorEl = _root.querySelector<HTMLElement>("#marketError");
  const pnlPanel = _root.querySelector<HTMLElement>("#pnlPanel");
  const timelineEl = _root.querySelector<HTMLElement>("#tradeTimeline");

  let currentSymbol = "VOO";

  function showError(msg: string) {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = "block"; }
  }
  function hideError() {
    if (errorEl) errorEl.style.display = "none";
  }

  function highlightActiveSymbol(sym: string) {
    _root.querySelectorAll<HTMLElement>(".market-ticker-card").forEach((card) => {
      card.style.borderColor = card.dataset.symbol === sym ? "var(--green)" : "";
      card.style.boxShadow = card.dataset.symbol === sym ? "0 0 0 1px var(--green)" : "";
    });
  }

  function createTVWidget(symbol: string) {
    if (!tvContainer) return;
    // Clear container
    tvContainer.innerHTML = "";

    const isDark = getTheme() === "dark";
    const tvSymbol = toTVSymbol(symbol);

    // TradingView Advanced Chart Widget — use tv.js for full disabled_features support
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const widgetContainer = document.createElement("div");
    widgetContainer.className = "tradingview-widget-container";
    widgetContainer.style.height = "520px";
    widgetContainer.innerHTML = `
      <div class="tradingview-widget-container__widget" style="height:100%;width:100%;"></div>
    `;
    tvContainer.appendChild(widgetContainer);

    const widgetConfig = {
      autosize: true,
      symbol: tvSymbol,
      interval: "D",
      timezone: localTz,
      theme: isDark ? "dark" : "light",
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      hide_volume: false,
      withdateranges: true,
      hide_side_toolbar: false,
      details: true,
      studies: ["STD;RSI", "STD;MACD"],
      disabled_features: [
        "header_symbol_search",
        "symbol_search_hot_key",
        "use_localstorage_for_settings",
        "header_compare",
        "compare_symbol",
      ],
      enabled_features: [],
    };

    // @ts-expect-error TradingView global
    if (typeof window.TradingView !== "undefined" && window.TradingView.widget) {
      // @ts-expect-error TradingView global
      new window.TradingView.widget({
        ...widgetConfig,
        container_id: widgetContainer.querySelector(".tradingview-widget-container__widget"),
      });
    } else {
      // Load TradingView widget library first, then create widget
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.type = "text/javascript";
      script.async = true;
      script.onload = () => {
        // @ts-expect-error TradingView global
        new window.TradingView.widget({
          ...widgetConfig,
          container_id: widgetContainer.querySelector(".tradingview-widget-container__widget"),
        });
      };
      document.head.appendChild(script);
    }
  }

  function updatePnLPanel(currentPrice: number) {
    if (!pnlPanel) return;
    const hasTrades = _state.trades.some((t) => t.ticker === currentSymbol);
    if (!hasTrades) {
      pnlPanel.style.display = "none";
      return;
    }
    pnlPanel.style.display = "";
    const pnl = calcPnLForTicker(_state.trades, currentSymbol, currentPrice, 4.25);
    const isProfit = pnl.unrealizedPnlUsd >= 0;
    const color = isProfit ? "var(--green)" : "var(--red)";
    const sign = isProfit ? "+" : "";

    const el = (id: string) => _root.querySelector<HTMLElement>(id);
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

    // Trade list with per-trade P&L
    const tradeListEl = el("#pnl-trades-list");
    if (tradeListEl) {
      const tradesForTicker = _state.trades.filter((t) => t.ticker === currentSymbol);
      const rows = tradesForTicker.map((t) => {
        const isBuy = t.type !== "Sell";
        const units = t.priceUsd > 0 ? (t.amountUsd / t.priceUsd).toFixed(4) : "0";
        const tradePnl = isBuy ? (currentPrice - t.priceUsd) * (t.amountUsd / t.priceUsd) : 0;
        const tradePnlPct = isBuy && t.priceUsd > 0 ? ((currentPrice - t.priceUsd) / t.priceUsd * 100) : 0;
        const pColor = tradePnl >= 0 ? "var(--green)" : "var(--red)";
        const pSign = tradePnl >= 0 ? "+" : "";
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--surface);border-radius:6px;margin-bottom:4px;font-size:12px;">' +
          '<span style="display:flex;gap:8px;align-items:center;">' +
            '<span style="color:' + (isBuy ? 'var(--green)' : 'var(--red)') + ';font-weight:700;width:20px;">' + (isBuy ? '↑' : '↓') + '</span>' +
            '<span>' + escapeHtml(t.date) + '</span>' +
            '<span style="color:var(--ink-3);">' + t.type + '</span>' +
          '</span>' +
          '<span style="display:flex;gap:12px;align-items:center;">' +
            '<span>' + units + ' units @ $' + t.priceUsd.toFixed(2) + '</span>' +
            (isBuy ? '<span style="color:' + pColor + ';font-weight:600;">' + pSign + 'USD ' + Math.abs(tradePnl).toFixed(2) + ' (' + pSign + tradePnlPct.toFixed(1) + '%)</span>' : '<span style="color:var(--red);">SELL</span>') +
          '</span>' +
        '</div>';
      }).join("");
      tradeListEl.innerHTML = rows ? '<div style="font-size:12px;color:var(--ink-3);margin-bottom:6px;font-weight:600;">Trade Details — ' + currentSymbol + '</div>' + rows : "";
    }
  }

  function updateTimeline() {
    if (!timelineEl) return;
    const hasTrades = _state.trades.some((t) => t.ticker === currentSymbol);
    if (!hasTrades) {
      timelineEl.innerHTML = "";
      return;
    }
    // Use last quote price for P&L (default to 0 if not yet fetched)
    const priceEl = _root.querySelector<HTMLElement>("#price-" + currentSymbol);
    const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, "") ?? "0";
    const currentPrice = parseFloat(priceText) || 0;
    timelineEl.innerHTML = buildTradeTimelineHtml(_state.trades, currentSymbol, currentPrice);
  }

  async function updateQuoteCards() {
    for (const sym of ["VOO", "QQQM"]) {
      try {
        const q = await fetchQuote(sym);
        const priceEl = _root.querySelector<HTMLElement>("#price-" + sym);
        const changeEl = _root.querySelector<HTMLElement>("#change-" + sym);
        const volEl = _root.querySelector<HTMLElement>("#volume-" + sym);
        const ohlcCard = _root.querySelector<HTMLElement>("#ohlc-" + sym);

        if (priceEl) priceEl.textContent = formatPrice(q.price, q.currency);
        if (changeEl) {
          changeEl.textContent = formatChange(q.change, q.changePercent);
          changeEl.style.color = q.change >= 0 ? "var(--green)" : "var(--red)";
        }
        if (volEl) volEl.textContent = "Vol: " + formatVolume(q.volume);
        if (ohlcCard) ohlcCard.textContent = "O:" + q.open.toFixed(1) + " H:" + q.high.toFixed(1) + " L:" + q.low.toFixed(1) + " C:" + q.prevClose.toFixed(1);
      } catch { /* ignore per-symbol errors */ }
    }
  }

  function switchSymbol(sym: string) {
    currentSymbol = sym;
    if (badgeEl) badgeEl.textContent = sym;
    if (titleEl) titleEl.textContent = sym + " · TradingView";
    const hasTrades = _state.trades.some((t) => t.ticker === sym);
    if (subtitleEl) subtitleEl.textContent = "K线 · 技术指标 · 专业图表" + (hasTrades ? " · 📊 Trades linked" : "");
    highlightActiveSymbol(sym);
    createTVWidget(sym);
    updateTimeline();
    // Update P&L with last known price
    updateQuoteCards().then(() => {
      const priceEl = _root.querySelector<HTMLElement>("#price-" + sym);
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, "") ?? "0";
      const currentPrice = parseFloat(priceText) || 0;
      updatePnLPanel(currentPrice);
      // Refresh timeline with actual price
      if (timelineEl) {
        timelineEl.innerHTML = buildTradeTimelineHtml(_state.trades, sym, currentPrice);
      }
    });
  }

  // Symbol select dropdown
  symbolSelect?.addEventListener("change", () => {
    switchSymbol(symbolSelect.value);
  });

  // Click ticker card to switch symbol
  _root.querySelectorAll<HTMLElement>(".market-ticker-card").forEach((card) => {
    card.addEventListener("click", () => {
      const sym = card.dataset.symbol;
      if (sym && sym !== currentSymbol) {
        if (symbolSelect) symbolSelect.value = sym;
        switchSymbol(sym);
      }
    });
  });

  // Manual refresh button — force fresh quotes
  _root.querySelector<HTMLElement>("#refreshQuotes")?.addEventListener("click", () => {
    // Clear localStorage cache to force fresh fetch
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith("pwo_market_cache_")) localStorage.removeItem(key);
      }
    } catch { /* ignore */ }
    updateQuoteCards().then(() => {
      const priceEl = _root.querySelector<HTMLElement>("#price-" + currentSymbol);
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, "") ?? "0";
      const currentPrice = parseFloat(priceText) || 0;
      updatePnLPanel(currentPrice);
      updateTimeline();
      const ts = _root.querySelector<HTMLElement>("#quoteTimestamp");
      if (ts) ts.textContent = "Updated " + new Date().toLocaleTimeString();
    });
  });

  highlightActiveSymbol(currentSymbol);

  // Initial load
  createTVWidget(currentSymbol);
  updateQuoteCards().then(() => {
    // After quotes load, update P&L panel
    const priceEl = _root.querySelector<HTMLElement>("#price-" + currentSymbol);
    const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, "") ?? "0";
    const currentPrice = parseFloat(priceText) || 0;
    updatePnLPanel(currentPrice);
    updateTimeline();
    const ts = _root.querySelector<HTMLElement>("#quoteTimestamp");
    if (ts) ts.textContent = "Updated " + new Date().toLocaleTimeString();
  });

  // Auto-refresh quote cards & P&L every 30 seconds
  if (marketRefreshTimer) clearInterval(marketRefreshTimer);
  marketRefreshTimer = setInterval(() => {
    updateQuoteCards().then(() => {
      const priceEl = _root.querySelector<HTMLElement>("#price-" + currentSymbol);
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, "") ?? "0";
      const currentPrice = parseFloat(priceText) || 0;
      updatePnLPanel(currentPrice);
      updateTimeline();
      // Update last-refreshed timestamp
      const ts = _root.querySelector<HTMLElement>("#quoteTimestamp");
      if (ts) ts.textContent = "Updated " + new Date().toLocaleTimeString();
    });
  }, 30_000);

  // Cleanup on navigation away
  const observer = new MutationObserver(() => {
    if (!document.contains(tvContainer)) {
      if (marketRefreshTimer) clearInterval(marketRefreshTimer);
      marketRefreshTimer = null;
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
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
    <div class="section-title"><span class="eyebrow">Capital Routing</span><h3>月度资金分配矩阵</h3><p>把每一块钱安排到明确职责，减少情绪化消费和投资冲动。</p></div>
    <div class="three-col-grid">
      ${bucketCards}
      ${addBucketCard}
    </div>
  `;
}

function goalsTemplate(state: WealthState): string {
  const goalCards = state.goals.map((goal, index) => {
    const ratio = goal.target > 0 ? Math.min(goal.current / goal.target, 1) : 0;
    const months = goal.monthlyContribution > 0 ? Math.ceil(Math.max(goal.target - goal.current, 0) / goal.monthlyContribution) : null;
    const color = ratio >= 0.8 ? "var(--green)" : ratio >= 0.4 ? "var(--amber)" : "var(--ink)";
    const barColor = ratio >= 0.8 ? "var(--green)" : ratio >= 0.4 ? "var(--amber)" : "var(--blue)";
    const extra = months ? " · " + months + " months" : "";
    return '<article class="card data-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<span class="eyebrow">' + escapeHtml(goal.name) + '</span>' +
        '<button class="edit-goal secondary-button" data-index="' + index + '" type="button" style="font-size:11px;padding:4px 8px;">Edit</button>' +
      '</div>' +
      '<h3>' + escapeHtml(goal.label) + '</h3>' +
      '<strong style="color:' + color + ';">' + percent(ratio) + '</strong>' +
      '<div class="bar"><span style="width:' + Math.round(ratio * 100) + '%;background:' + barColor + ';"></span></div>' +
      '<small style="color:var(--ink-3);">' + money(goal.current) + ' / ' + money(goal.target) + extra + '</small>' +
      '<p>' + escapeHtml(goal.note) + '</p>' +
      '<div class="goal-edit-form" id="goalEdit' + index + '" style="display:none;margin-top:12px;">' +
        '<form class="form-grid goalForm" data-index="' + index + '">' +
          '<label>Name<input name="name" type="text" value="' + escapeHtml(goal.name) + '"></label>' +
          '<label>Label<input name="label" type="text" value="' + escapeHtml(goal.label) + '"></label>' +
          numberInput("current", "Current MYR", String(goal.current), "1") +
          numberInput("target", "Target MYR", String(goal.target), "1") +
          numberInput("monthlyContribution", "Monthly MYR", String(goal.monthlyContribution), "1") +
          '<label>Note<textarea name="note" rows="2">' + escapeHtml(goal.note) + '</textarea></label>' +
          '<div style="display:flex;gap:8px;">' +
            '<button class="primary-button" type="submit">Save</button>' +
            '<button class="secondary-button cancel-goal-edit" type="button" data-index="' + index + '">Cancel</button>' +
            '<button class="danger-button delete-goal" type="button" data-index="' + index + '">Delete</button>' +
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
    <div class="section-title"><span class="eyebrow">Goal System</span><h3>目标与愿望清单</h3><p>目标不是为了限制生活，而是给每笔钱一个清楚的方向。</p></div>
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
        <div class="panel-head"><div><span class="eyebrow">Advisor Engine</span><h3>理财规划师建议</h3></div><span style="color:var(--muted);font-size:12px;">Rules-based</span></div>
        <div class="advice-list">${advisorMessages(state).map(adviceCard).join("")}</div>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Scenario Check</span><h3>补仓触发器</h3></div><span style="color:var(--muted);font-size:12px;">Bear Market Plan</span></div>
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
        <div id="drawdownResult" class="scenario-result">输入市场从高点回撤幅度，系统会判断是否触发补仓资金。</div>
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
  const items = [
    ["Monthly Cashflow", "💰 " + money(state.cashflow.allowance) + " allowance, " + money(monthlyBasicExpense(state)) + " basic spending, " + money(monthlySurplus(state)) + " assignable surplus."],
    ["DCA Mandate", "📈 " + money(state.dca.monthly) + " per month. VOO " + percent(state.dca.targets.VOO) + " / QQQM " + percent(state.dca.targets.QQQM) + "."],
    ["Emergency Fund", "🛡️ " + money(state.emergency.current) + " / " + money(state.emergency.target) + ". Estimated annual yield: " + money(projectedAnnualEmergencyYield(state)) + "."],
    ["Opportunity Reserve", "🎯 " + money(state.opportunity.total) + " one-time reserve. Split " + money(state.opportunity.allocation.VOO) + " VOO / " + money(state.opportunity.allocation.QQQM) + " QQQM."],
    ["Bear Market Deployment", "🐻 -10% deploy MYR 80, -15% deploy MYR 120, -20% deploy MYR 200."],
    ["Age-stage Policy", "👤 At " + state.profile.age + ", growth assets may dominate only while emergency and cashflow rules remain intact."],
    ["Data Safety", "💾 All data is stored locally in this browser. Export JSON before switching browsers or devices."],
  ];
  return '<div class="three-col-grid">' + items.map(([title, body]) => {
    return '<article class="card data-card"><span class="eyebrow">' + title + '</span><p>' + body + '</p></article>';
  }).join("") + '</div>';
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
        <div class="panel-head"><div><span class="eyebrow">Monthly Close</span><h3>月度复盘</h3></div><span style="color:var(--muted);font-size:12px;">Discipline</span></div>
        <form id="reviewForm" class="form-grid">
          <label>Month<input name="month" type="month" required></label>
          ${numberInput("income", "Income MYR", String(state.cashflow.allowance), "1")}
          ${numberInput("spending", "Spending MYR", String(monthlyBasicExpense(state)), "1")}
          <label>DCA Done?<select name="dcaDone"><option value="true">Yes</option><option value="false">No</option></select></label>
          ${numberInput("disciplineScore", "Discipline Score", "85", "1")}
          <label class="wide-field">Notes<textarea name="notes" rows="4" placeholder="本月现金流、投资纪律、下月行动"></textarea></label>
          <button class="primary-button" type="submit">Save Review</button>
        </form>
      </article>
      <article class="card panel">
        <div class="panel-head"><div><span class="eyebrow">Review Log</span><h3>历史记录</h3></div><span style="color:var(--muted);font-size:12px;">${state.reviews.length} months</span></div>
        <div class="review-list">${reviewRows || '<p class="empty-state">还没有复盘记录。</p>'}</div>
      </article>
    </div>
  `;
}

function settingsTemplate(state: WealthState): string {
  return `
    <div class="section-title"><span class="eyebrow">Configuration</span><h3>个人资料与参数</h3><p>调整你的投资者资料、现金流和投资参数。</p></div>
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
  const targetRows = state.goals.map((g) => {
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
  const mount = root.querySelector<HTMLElement>("#pageMount");
  if (!mount) return;

  const templates: Record<string, string> = {
    dashboard: dashboardTemplate(state),
    portfolio: portfolioTemplate(state),
    market: marketTemplate(state),
    buckets: bucketsTemplate(state),
    goals: goalsTemplate(state),
    advisor: advisorPageTemplate(state),
    rules: rulesTemplate(state),
    review: reviewTemplate(state),
    settings: settingsTemplate(state),
  };
  mount.innerHTML = templates[activePage] ?? templates.dashboard;

  bindCommon(root, state, setState, navigate, user, onLogout);
  bindPage(root, state, setState, activePage, navigate);
}

function bindCommon(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
  const activePage = activePageFromNav(root) ?? "dashboard";
  const doNavigate = navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate, user));

  root.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.addEventListener("click", () => doNavigate(button.dataset.page ?? "dashboard"));
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

  // Hamburger menu toggle
  const hamburger = root.querySelector<HTMLButtonElement>("#hamburgerBtn");
  const sidebar = root.querySelector<HTMLElement>("#sidebar");
  const overlay = root.querySelector<HTMLElement>("#sidebarOverlay");
  const toggleSidebar = () => {
    sidebar?.classList.toggle("open");
    overlay?.classList.toggle("visible");
  };
  hamburger?.addEventListener("click", toggleSidebar);
  overlay?.addEventListener("click", toggleSidebar);
  // Close sidebar when nav item clicked on mobile
  sidebar?.querySelectorAll<HTMLElement>(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      sidebar?.classList.remove("open");
      overlay?.classList.remove("visible");
    });
  });

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
          '<div style="font-size:16px;font-weight:700;">📋 版本历史</div>' +
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
  if (activePage === "portfolio") bindPortfolio(root, state, setState, navigate);
  if (activePage === "advisor") bindAdvisor(root, state);
  if (activePage === "review") bindReview(root, state, setState, navigate);
  if (activePage === "settings") bindSettings(root, state, setState, navigate);
  if (activePage === "goals") bindGoals(root, state, setState, navigate);
  if (activePage === "market") bindMarket(root, state, setState, navigate);
  if (activePage === "buckets") bindBuckets(root, state, setState, navigate);
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