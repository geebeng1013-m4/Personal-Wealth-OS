/**
 * Portfolio page — the hero, the allocation panel, the contribution form and
 * CSV import, the currency-conversion ledger, and the position/activity tables.
 *
 * Every figure comes from getPortfolioSnapshot fed livePriceInputs(): market
 * value when a quote is available, cost basis otherwise, and "--" for anything
 * genuinely unknown. The shared valuation formatters render that snapshot the
 * same way the Dashboard does.
 *
 * The currency-conversion panel is the only place a real MYR/USD rate is
 * recorded — the broker exports none — so its import is a two-step read-then-
 * confirm: a misparse here rewrites the ringgit cost basis behind every holding.
 */

import type { Trade, TradeType, WealthState } from "../models";
import { createId } from "../state";
import { money, percent, tradeUnits } from "../rules";
import { escapeHtml, numberInput } from "../html";
import { livePriceInputs } from "../livePrices";
import {
  UNKNOWN,
  moneyOrUnknown,
  pnlText,
  pnlTone,
  joinNotes,
  usdPnlNote,
  valuationNote,
  feeFreeReturnNote,
} from "./valuationFormat";
import {
  getPortfolioSnapshot,
  type PortfolioHolding,
  type PortfolioSnapshot,
} from "../portfolioSummary";
import { exchangeRateOf, resolveExchangeCoverage } from "../currencyExchange";
import { exchangesFromText, mergeExchanges } from "../exchangeImport";
import { rebalanceContributions, tradeExchangeRate } from "../financialHealth";
import { recordsFromCsv } from "../csvImport";
import { getUsdToMyr } from "../market";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

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

export function portfolioTemplate(state: WealthState): string {
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

export function bindPortfolio(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
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
    rerender(root, next, setState, "portfolio", navigate);
  });

  root.querySelector<HTMLInputElement>("#csvInput")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const records = recordsFromCsv(await file.text());
    const next = { ...state, trades: [...state.trades, ...records] };
    setState(next);
    rerender(root, next, setState, "portfolio", navigate);
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
    rerender(root, next, setState, "portfolio", navigate);
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
      rerender(root, next, setState, "portfolio", navigate);
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
    rerender(root, next, setState, "portfolio", navigate);
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
    rerender(root, next, setState, "portfolio", navigate);
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
      rerender(root, next, setState, "portfolio", navigate);

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
