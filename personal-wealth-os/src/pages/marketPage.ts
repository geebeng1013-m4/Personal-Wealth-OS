/**
 * Market page — research for one symbol at a time.
 *
 * A live quote header, a TradingView chart, and per-symbol panels for your
 * position, risk, dividends, fund composition, drawdown history and a plain-
 * language context read. Everything that must be correct goes through the
 * server-side /api routes; the fund holdings list is a fixed dated snapshot and
 * says so rather than letting stale data pass for live.
 *
 * bindMarket patches its own DOM rather than re-rendering the page, so it takes
 * no `rerender` — the two state writes it does make (add / remove a tracked
 * symbol) go straight through setState. It starts its own price poll and
 * registers the teardown in the shared priceRefreshCleanup map.
 */

import type { WealthState } from "../models";
import { escapeHtml, getTheme } from "../html";
import { pageHeader } from "../components/pageHeader";
import { UNKNOWN } from "./valuationFormat";
import { tradeUnits } from "../rules";
import { tradesWithExchangeCost } from "../currencyExchange";
import { buildAssetHistory, triggerHistory, type AssetHistory } from "../drawdowns";
import {
  buildTradeTimelineHtml,
  fetchFundamentals,
  fetchEtfComposition,
  fetchHistoricalPrices,
  calcRiskMetrics,
  type Fundamentals,
} from "../market";
import { getHolding, getPortfolioSnapshot } from "../portfolioSummary";
import { livePriceInputs, refreshLivePrices, priceRefreshCleanup, PRICE_POLL_INTERVAL_MS } from "../livePrices";
import type { Ticker } from "../models";
import type { Setter } from "./pageTypes";

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

/** One holdings row. Shared by the static first paint and bindMarket's live
 *  rebuild so the two never disagree on markup. `weight` and `widest` are in
 *  the same unit (both percent, or both fraction) — only their ratio is used. */
export function etfHoldingRow(index: number, symbol: string, name: string, weightLabel: string, weight: number, widest: number): string {
  const barWidth = Math.min(100, Math.max((weight / (widest || 1)) * 100, 2)).toFixed(1);
  return '<li>'
    + '<span class="etf-rank">' + String(index + 1).padStart(2, "0") + '</span>'
    + '<span class="etf-ticker">' + escapeHtml(symbol) + '</span>'
    + '<span class="etf-name">' + escapeHtml(name) + '</span>'
    + '<span class="etf-weight">' + escapeHtml(weightLabel) + '</span>'
    + '<span class="etf-bar"><i style="width:' + barWidth + '%"></i></span>'
    + '</li>';
}

function etfHoldingsRowsTemplate(profile: EtfHoldingsProfile): string {
  const widest = profile.holdings[0]?.weight || 1;
  return profile.holdings.map((holding, index) =>
    etfHoldingRow(index, holding.symbol, holding.name, holding.weight.toFixed(2) + "%", holding.weight, widest),
  ).join("");
}

export function etfTopHoldingsTemplate(selected: EtfHoldingsSymbol = "VOO"): string {
  const profile = ETF_TOP_HOLDINGS[selected];
  return `<section class="wu-card etf-holdings-panel" aria-labelledby="etfHoldingsTitle">
    <div class="wu-card__header">
      <div class="wu-stack wu-stack--sm"><span class="wu-label">Fund Composition</span><h3 class="wu-card__title t-heading" id="etfHoldingsTitle">Top Holdings</h3></div>
      <div class="etf-holdings-tabs" role="tablist" aria-label="Select ETF holdings">
        ${(Object.keys(ETF_TOP_HOLDINGS) as EtfHoldingsSymbol[]).map((symbol) => `<button class="etf-holdings-tab${symbol === selected ? " active" : ""}" data-etf-holdings="${symbol}" type="button" role="tab" aria-selected="${symbol === selected}">${symbol}</button>`).join("")}
      </div>
    </div>
    <div class="wu-stack">
      <!-- Live fund facts. These the data feed really does publish, so they are
           fetched per symbol; the holdings list below it cannot be, and says so
           rather than letting a dated snapshot pass for current. -->
      <dl id="etfLiveFacts" class="wu-list">
        <div class="wu-list__row"><dt>Expense ratio</dt><dd class="t-num" data-fact="expense">${UNKNOWN}</dd></div>
        <div class="wu-list__row"><dt>Dividend yield</dt><dd class="t-num" data-fact="yield">${UNKNOWN}</dd></div>
        <div class="wu-list__row"><dt>Fund size</dt><dd class="t-num" data-fact="aum">${UNKNOWN}</dd></div>
      </dl>
      <div id="etfSectors" class="etf-sectors" hidden></div>
      <div class="wu-row wu-row--between t-caption t-faint" aria-live="polite"><span><strong id="etfHoldingsSymbol" class="t-subheading">${selected}</strong> · Top Holdings <b id="etfHoldingsTotal" class="t-num">${profile.topHoldingsTotalPercent}</b></span><small id="etfHoldingsDateWrap">Holdings as at <time id="etfHoldingsDate">${profile.updateDate}</time> · fixed snapshot, not live</small></div>
      <ol id="etfHoldingsList" class="etf-holdings-list" style="list-style:none;margin:0;padding:0">${etfHoldingsRowsTemplate(profile)}</ol>
    </div>
  </section>`;
}

export function marketTemplate(state: WealthState): string {
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

  const stat = (id: string, label: string, note = ""): string =>
    `<div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">${label}</span><span class="wu-metric__value t-num" id="${id}">--</span>${note ? `<span class="wu-metric__note t-caption">${note}</span>` : ""}</div></div>`;

  return `<div class="wu">
    ${pageHeader({
      eyebrow: "Investment Intelligence",
      title: "Market",
      sub: "Research with a long-term lens — ownership, risk and valuation, not daily noise.",
    })}
    <div class="wu-stack wu-stack--xl">
      <div class="wu-card wu-card--pad-sm wu-row wu-row--between">
        <span class="wu-label">Current principle</span>
        <span class="wu-row wu-row--tight"><strong class="t-subheading">Context before action</strong><span class="t-caption t-faint">Review the mandate before changing allocation.</span></span>
      </div>

      <div class="wu-stack wu-stack--lg">
        <div class="market-symbols" role="group" aria-label="Select investment">
          <button class="market-symbol-btn active" data-symbol="VOO" type="button"><strong>VOO</strong><small>Core market</small></button>
          <button class="market-symbol-btn" data-symbol="QQQM" type="button"><strong>QQQM</strong><small>Growth allocation</small></button>
          ${state.customTickers.map((ticker) => '<div class="market-custom-symbol" data-symbol="' + escapeHtml(ticker) + '"><button class="market-symbol-btn" data-symbol="' + escapeHtml(ticker) + '" type="button"><strong>' + escapeHtml(ticker) + '</strong><small>Custom watchlist</small></button><button class="market-symbol-remove" data-remove-symbol="' + escapeHtml(ticker) + '" type="button" aria-label="Remove ' + escapeHtml(ticker) + '">×</button></div>').join("")}
        </div>
        <form id="customSymbolForm" class="wu-row"><label class="wu-field-row"><span class="wu-field-row__label">Add symbol</span><span class="wu-row wu-row--tight"><input class="wu-field" id="customSymbolInput" name="symbol" type="text" maxlength="20" placeholder="e.g. AAPL" autocomplete="off" spellcheck="false"><button class="wu-btn wu-btn--secondary wu-btn--sm" type="submit">Add</button></span></label><small id="customSymbolMessage" class="t-caption t-faint" aria-live="polite"></small></form>
        <span class="t-caption t-faint">Market data may be delayed</span>
      </div>

      <div class="market-tabs" role="tablist" aria-label="Market research views">
        ${tabButtons}
      </div>

      <!-- Chart Tab -->
      <div class="market-tab-content active" data-tab-content="chart">
        <div class="wu-stack">
          <div class="wu-row wu-row--between"><span class="wu-label">Price context — historical perspective</span><div class="market-intervals" role="group" aria-label="Chart period">
            <button class="interval-btn" data-interval="D" type="button">1D</button>
            <button class="interval-btn" data-interval="W" type="button">1W</button>
            <button class="interval-btn" data-interval="M" type="button">1M</button>
            <button class="interval-btn" data-interval="5" type="button">YTD</button>
            <button class="interval-btn active" data-interval="12M" type="button">1Y</button>
            <button class="interval-btn" data-interval="60M" type="button">5Y</button>
          </div></div>
          <article class="wu-card wu-card--pad-sm market-chart-card">
            <div id="tradingview_container" style="width:100%;height:520px;"></div>
          </article>
        </div>
      </div>

      <!-- P&L Tab -->
      <div class="market-tab-content" data-tab-content="pnl">
        <div id="pnlPanel" style="display:none;">
          <div class="wu-grid wu-grid--wide">
            ${stat("pnl-invested", "💰 Invested USD")}
            ${stat("pnl-units", "📊 Units")}
            ${stat("pnl-cost", "💵 Avg Cost")}
            ${stat("pnl-value", "📈 Market Value")}
            <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">🟢🔴 P&L</span><span class="wu-metric__value t-num" id="pnl-amount">--</span><span class="wu-metric__note t-caption" id="pnl-pct">--</span></div></div>
            ${stat("pnl-fees", "💸 Fees")}
          </div>
          <div id="pnl-trades-list" style="margin-top:var(--space-3)"></div>
        </div>
        <div id="pnl-empty" class="wu-empty">No trades for this ticker</div>
        <div id="tradeTimeline" style="margin-top:var(--space-4)"></div>
      </div>

      <!-- Risk Tab -->
      <div class="market-tab-content" data-tab-content="risk">
        <div id="riskContent" class="wu-grid wu-grid--wide">
          ${stat("risk-drawdown", "📉 Max Drawdown", "From peak to trough")}
          ${stat("risk-sharpe", "📊 Sharpe Ratio", "Risk-adjusted return")}
          ${stat("risk-beta", "🎯 Portfolio Beta", "vs S&amp;P 500")}
          ${stat("risk-volatility", "📐 Volatility", "Annualized σ")}
          ${stat("risk-current-dd", "🔄 Current Drawdown", "From all-time high")}
          ${stat("risk-winrate", "📅 Win Rate", "Positive months")}
        </div>
      </div>

      <!-- Dividends Tab -->
      <div class="market-tab-content" data-tab-content="dividends">
        <div id="dividendsContent" class="wu-stack">
          <p id="div-source" class="ov-detail-row__note"></p>
          <div class="wu-grid wu-grid--wide">
            ${stat("div-yield", "💰 Dividend Yield")}
            ${stat("div-frequency", "📅 Frequency")}
            ${stat("div-annual", "💵 Annual Dividend")}
            ${stat("div-pe", "📊 P/E Ratio")}
          </div>
          <article class="wu-card wu-card--pad-sm">
            <h5 class="t-subheading" style="margin-bottom:var(--space-3)">Recent Dividend History</h5>
            <div id="div-history"></div>
          </article>
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
        <div id="compareContent" class="stock-compare wu-stack">
          <div class="wu-stack wu-stack--sm"><span class="wu-label">Asset Comparison</span><h3 class="t-heading">Your holdings, side by side</h3><p class="t-body-sm t-muted">Every asset you hold or watch, in one view. Fees, yields and fund sizes are fetched live; the descriptive rows are editorial and say what each instrument is for.</p></div>
          <div id="compareProfiles"></div>
          <div id="compareMatrix"></div>
        </div>
      </div>

      <!-- Calendar Tab -->
      <div class="market-tab-content" data-tab-content="calendar">
        <div id="calendarContent">
          <article class="wu-card ctx-card">
            <div class="wu-card__header">
              <div class="wu-stack wu-stack--sm"><span class="wu-label">Historical Context</span><h3 class="wu-card__title t-heading">How this has fallen before</h3></div>
              <span class="wu-badge wu-badge--neutral" id="ctxRange">—</span>
            </div>
            <p class="t-body-sm t-muted" style="margin-bottom:var(--space-3)">Every decline of 10% or more on record, how long it took to come back, and what holding through it was worth. Computed from daily closes.</p>
            <div id="ctxBody"><p class="wu-empty">Loading price history…</p></div>
          </article>
        </div>
      </div>
    </div>
  </div>`;
}

export function bindMarket(root: HTMLElement, state: WealthState, setState: Setter): void {
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
        etfHoldingRow(index, holding.symbol, holding.name, weightText(holding.weight), holding.weight, widest),
      ).join("");
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
      button.classList.toggle("active", button === btn);
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
    const color = isProfit ? "var(--positive)" : "var(--negative)";
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
            '<span style="color:' + (isBuy ? 'var(--positive)' : 'var(--negative)') + ';font-weight:700;width:20px;">' + (isBuy ? '↑' : '↓') + '</span>' +
            '<span>' + escapeHtml(t.date) + '</span>' +
            '<span style="color:var(--text-faint);">' + t.type + '</span>' +
          '</span>' +
          '<span>' + units + ' units @ $' + t.priceUsd.toFixed(2) + '</span>' +
        '</div>';
      }).join("");
      tradeListEl.innerHTML = rows ? '<div style="font-size:12px;color:var(--text-faint);margin-bottom:6px;font-weight:600;">Trade Details — ' + symbol + '</div>' + rows : "";
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
          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">' +
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
      if (ddEl) ddEl.style.color = "var(--negative)";

      setT("#risk-sharpe", metrics.sharpeRatio.toFixed(2));
      const sharpeEl = root.querySelector<HTMLElement>("#risk-sharpe");
      if (sharpeEl) sharpeEl.style.color = metrics.sharpeRatio >= 1 ? "var(--positive)" : metrics.sharpeRatio >= 0.5 ? "var(--warning)" : "var(--negative)";

      setT("#risk-beta", metrics.beta.toFixed(2));
      const betaEl = root.querySelector<HTMLElement>("#risk-beta");
      if (betaEl) betaEl.style.color = metrics.beta <= 1 ? "var(--positive)" : "var(--warning)";

      setT("#risk-volatility", pct(metrics.volatility));
      setT("#risk-current-dd", pct(metrics.currentDrawdown));
      const curDDEl = root.querySelector<HTMLElement>("#risk-current-dd");
      if (curDDEl) curDDEl.style.color = metrics.currentDrawdown < 0 ? "var(--negative)" : "var(--positive)";

      setT("#risk-winrate", pct(metrics.winRate));
      const winEl = root.querySelector<HTMLElement>("#risk-winrate");
      if (winEl) winEl.style.color = metrics.winRate >= 0.6 ? "var(--positive)" : "var(--warning)";

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
          (last ? "" : "border-bottom:1px solid var(--border);") +
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
          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">' +
            '<span>Next Ex-Dividend</span><span style="font-weight:600;">' + sd.exDiv + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">' +
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
