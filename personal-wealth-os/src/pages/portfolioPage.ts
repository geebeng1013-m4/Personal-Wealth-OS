/**
 * Portfolio page — four figures, the holdings against target, where the next
 * contribution goes and the latest trades. The trade form, the full history,
 * the currency-conversion ledger and the position table open on demand.
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

import type { Dividend, Market, TradeType, WealthState } from "../models";
import { createId } from "../state";
import { money, percent, tradeUnits } from "../rules";
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import { livePriceInputs, quoteAgeLabel } from "../livePrices";
import {
  UNKNOWN,
  moneyOrUnknown,
  pnlText,
  valuationNote,
  joinNotes,
} from "./valuationFormat";
import { nextContributionLead } from "../nextContribution";
import {
  getPortfolioExposure,
  getPortfolioSnapshot,
  type CurrencySubtotal,
  type ExposureSlice,
  type PortfolioHolding,
  type PortfolioSnapshot,
} from "../portfolioSummary";
import { exchangeRateOf, resolveExchangeCoverage, tradesWithExchangeCost } from "../currencyExchange";
import { MARKETS, isMarket, lotsText, marketLabel, marketOfTicker, ringgitLeg, sidesOf, tradeAmounts } from "../tradeCurrency";
import { currenciesFor, tradeFromEntry } from "../tradeEntry";
import { exchangesFromText, mergeExchanges } from "../exchangeImport";
import { rebalanceContributions, tradeExchangeRate } from "../financialHealth";
import { recordsFromCsv } from "../csvImport";
import { fetchRatesToMyr, getUsdToMyr, loadDividendSuggestions } from "../market";
import {
  dismissedFromSuggestion,
  dividendFromSuggestion,
  type DividendSuggestion,
} from "../dividendSuggestions";
import { dividendRateToMyr, netDividend } from "../dividends";
import type { TradeDraft } from "../components/assistant/assistantTypes";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

/**
 * A trade the assistant has read from plain language, waiting to be written
 * into the form.
 *
 * Unlike the Ledger, the trade form keeps no module draft of its own — it
 * renders empty every time — so the pre-fill is applied to the DOM once, in
 * bindPortfolio, and then cleared. Cleared on use, not on navigation: applying
 * it is the last step of a navigate() the assistant just triggered, and leaving
 * it set would refill the form the next time the page is opened.
 */
let pendingTradePrefill: TradeDraft | null = null;

/** Queue an assistant draft; the caller then navigates to "portfolio". */
export function queueTradePrefill(draft: TradeDraft): void {
  pendingTradePrefill = draft;
  // The form is collapsed by default (T-3); open it so the page renders with
  // the form the draft is about to be written into.
  tradeFormOpen = true;
}

/**
 * Write a queued draft into the trade form.
 *
 * Only fields the draft actually carries are touched, so an omitted figure
 * stays empty for the user to fill rather than being invented as 0. A ticker or
 * broker that is not already on file goes down the form's own "+ Custom" path,
 * including revealing the custom input — exactly what a change event on those
 * selects would have done.
 */
function applyTradePrefill(root: HTMLElement, draft: TradeDraft): void {
  const form = root.querySelector<HTMLFormElement>("#tradeForm");
  if (!form) return;

  const setField = (name: string, value: string): void => {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
  };
  const setNumber = (name: string, value: number | undefined): void => {
    if (value !== undefined) setField(name, String(value));
  };

  setField("date", draft.date);
  setField("type", draft.tradeType);

  if (draft.isCustomTicker) {
    setField("ticker", "__custom__");
    setField("customTicker", draft.ticker);
    const wrap = root.querySelector<HTMLElement>("#customTickerWrap");
    if (wrap) wrap.style.display = "block";
  } else {
    setField("ticker", draft.ticker);
  }

  if (draft.isCustomPlatform) {
    setField("platform", "__custom__");
    setField("customPlatform", draft.platform);
    const wrap = root.querySelector<HTMLElement>("#customPlatformWrap");
    if (wrap) wrap.style.display = "block";
  } else {
    setField("platform", draft.platform);
  }

  // The assistant reads US trades in dollars with a ringgit fee. Put the form on
  // the ticker's market first, so the labels and fee choices match the figures.
  setField("market", marketOfTicker(draft.ticker));
  syncTradeFormMarket(root);
  setNumber("amountMyr", draft.amountMyr);
  setNumber("amount", draft.amountUsd);
  setNumber("price", draft.priceUsd);
  setNumber("units", draft.units);
  setNumber("fee", draft.feeMyr);
  if (draft.feeMyr !== undefined) setField("feeCurrency", "MYR");
  if (draft.notes) setField("notes", draft.notes);

  // Bring it into view and mark it, so a form filled in from the other side of
  // a page change is not something the user has to go hunting for.
  form.classList.add("is-assistant-filled");
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** A placeholder ticker for each market, in the form the user would type it. */
const TICKER_EXAMPLES: Record<Market, string> = { US: "e.g. AAPL", MY: "e.g. 1155", HK: "e.g. 0700", SG: "e.g. D05", LSE: "e.g. VWRA" };

/**
 * Bring the Record-trade form in line with its chosen market and currency:
 * the currency choices, the currency named in each label, the fee's currency
 * choices, whether a separate ringgit amount is asked for, and the lots hint.
 * Called on every change to market, currency, ticker or quantity.
 */
function syncTradeFormMarket(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("#tradeForm");
  if (!form) return;
  const marketField = form.elements.namedItem("market");
  const currencyField = form.elements.namedItem("currency");
  const feeCurrencyField = form.elements.namedItem("feeCurrency");
  if (!(marketField instanceof HTMLSelectElement) || !(currencyField instanceof HTMLSelectElement) || !(feeCurrencyField instanceof HTMLSelectElement)) return;
  const market: Market = isMarket(marketField.value) ? marketField.value : "US";

  const choices = currenciesFor(market);
  const currency = choices.includes(currencyField.value) ? currencyField.value : choices[0];
  if (currencyField.options.length !== choices.length || [...currencyField.options].some((option, index) => option.value !== choices[index])) {
    currencyField.innerHTML = choices.map((code) => `<option>${escapeHtml(code)}</option>`).join("");
  }
  currencyField.value = currency;
  currencyField.disabled = choices.length === 1;

  const feeChoices = currency === "MYR" ? ["MYR"] : [currency, "MYR"];
  const feeCurrency = feeChoices.includes(feeCurrencyField.value) ? feeCurrencyField.value : feeChoices[0];
  feeCurrencyField.innerHTML = feeChoices.map((code) => `<option>${escapeHtml(code)}</option>`).join("");
  feeCurrencyField.value = feeCurrency;

  root.querySelectorAll<HTMLElement>(".pf-cur").forEach((label) => { label.textContent = currency; });
  const ringgitWrap = root.querySelector<HTMLElement>("#pfAmountMyrWrap");
  if (ringgitWrap) ringgitWrap.hidden = currency === "MYR";
  const customTicker = root.querySelector<HTMLInputElement>("#customTickerInput");
  if (customTicker) customTicker.placeholder = TICKER_EXAMPLES[market];

  const lotsHint = root.querySelector<HTMLElement>("#pfLotsHint");
  const unitsField = form.elements.namedItem("units");
  if (lotsHint && unitsField instanceof HTMLInputElement) {
    const lots = lotsText(market, Number(unitsField.value));
    lotsHint.textContent = lots ? `= ${lots}` : "";
    lotsHint.hidden = !lots;
  }
}

/** A conversion rate, at the precision the difference actually shows up in. */
function rateText(rate: number): string {
  return `MYR ${rate.toFixed(4)} / USD`;
}

/**
 * The brokers this account has actually used, newest first, for the trade
 * form's datalist. Derived from the trades themselves — no separate list to
 * keep in sync — with "Moomoo" always offered as the common starting point.
 */
/**
 * Brokers the trade form offers. Exported so the assistant proposes a platform
 * from exactly the same list the form will accept, rather than its own copy.
 */
export function knownPlatforms(state: WealthState): string[] {
  const seen = new Set<string>();
  for (let i = state.trades.length - 1; i >= 0; i--) {
    const name = state.trades[i]?.platform?.trim();
    if (name) seen.add(name);
  }
  if (![...seen].some((p) => p.toLowerCase() === "moomoo")) seen.add("Moomoo");
  return [...seen];
}

/** What to pre-fill the Platform field with: whatever the last trade used. */
function lastUsedPlatform(state: WealthState): string {
  return state.trades[state.trades.length - 1]?.platform?.trim() || "Moomoo";
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
  const coverage = resolveExchangeCoverage(state.trades, records, state.dividends ?? []);
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
    const sides = sidesOf(record);
    const leg = sides ? ringgitLeg(sides) : null;
    if (!sides || !leg) return "";
    return '<tr>'
      + '<td>' + escapeHtml(record.date) + '</td>'
      + '<td>' + escapeHtml(`${sides.fromCurrency} → ${sides.toCurrency}`) + '</td>'
      // Statement amounts, so both columns keep two decimals: money() drops a
      // trailing .00 and made a MYR column of exact figures look rounded.
      + '<td>MYR ' + leg.myrAmount.toFixed(2) + '</td>'
      + '<td>' + escapeHtml(leg.currency) + ' ' + leg.foreignAmount.toFixed(2) + '</td>'
      + '<td>' + exchangeRateOf(record).toFixed(4) + '</td>'
      + '<td><button class="wu-btn wu-btn--ghost wu-btn--icon delete-exchange" data-id="' + escapeHtml(record.id) + '" type="button" aria-label="Delete conversion on ' + escapeHtml(record.date) + '">✕</button></td>'
      + '</tr>';
  }).join("");

  return `
    <article class="wu-card">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm"><span class="wu-label">Ringgit Cost Basis</span><h3 class="wu-card__title t-heading">Currency conversions</h3></div>
        <div class="wu-row wu-row--tight"><span class="t-caption t-faint">${records.length} records</span>${records.length > 0
          ? '<button class="wu-btn wu-btn--danger wu-btn--sm clear-exchanges" type="button">Clear all</button>'
          : ""}</div>
      </div>
      <div class="wu-stack">
        <p class="t-body-sm t-muted">${escapeHtml(conversionCoverageNote(state))}</p>
        <label class="wu-field-row"><span class="wu-field-row__label">Paste your broker's exchange history</span>
          <textarea class="wu-field" id="fxPaste" rows="4" placeholder="MYR&#10;USD&#10;Aug 9, 2026 22:06 MYT&#10;Completed&#10;4.85 USD&#10;20.00 MYR"></textarea>
        </label>
        <div class="wu-row"><button class="wu-btn wu-btn--primary wu-btn--sm" id="fxImport" type="button">Read conversions</button></div>
        <small class="t-caption t-faint">Select the whole list in your broker app and paste it here — headings and dates included. Re-pasting a range you have already added updates it instead of duplicating it.</small>
        <p id="fxImportStatus" class="wu-field-row__error" role="alert"></p>
        ${records.length > 0 ? `<details class="wu-details">
          <summary class="wu-details__summary"><span class="wu-row wu-row--tight"><strong class="t-subheading">Recorded conversions</strong><span class="t-caption t-faint">${records.length}</span></span></summary>
          <div class="wu-table-wrap">
            <table class="wu-table">
              <thead><tr><th>Date</th><th>Direction</th><th>MYR</th><th>Foreign</th><th>Rate</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </details>` : ""}
      </div>
    </article>`;
}

/*
 * T-3: the page opens on what the money is worth and where the next ringgit
 * goes. Everything that used to sit open — the trade form, the full history,
 * the conversion importer, the position table — is one tap away and keeps its
 * state here, so a re-render (a save, a delete, a price tick) does not snap it
 * shut under the user.
 */
/**
 * Suggested payouts, once the feeds have answered. Held here, not in
 * WealthState: a suggestion is a question, not a fact the user owns. Cleared
 * when a record is written so the list is rebuilt without the one just acted on.
 */
let dividendSuggestions: DividendSuggestion[] = [];
/**
 * What the current suggestions were worked out from. A signed-in page first
 * renders before the cloud copy of the state arrives, with no trades at all;
 * asking once and never again left a real account on that empty answer. So
 * the question is asked again whenever the trades or recorded dividends change.
 */
let dividendsRequestKey: string | null = null;
/** Whether the feeds have answered for the current key. */
let dividendsAnswered = false;

function dividendRequestKey(state: WealthState): string {
  const tickers = [...new Set(state.trades.map((trade) => trade.ticker))].sort().join(",");
  const latest = state.trades.reduce((newest, trade) => (trade.date > newest ? trade.date : newest), "");
  return `${state.trades.length}|${tickers}|${latest}|${(state.dividends ?? []).length}`;
}
/** The suggestion whose figures are open for editing, if any. */
let editingSuggestionId: string | null = null;

let tradeFormOpen = false;
let historyOpen = false;
let conversionsOpen = false;
let positionsOpen = false;

/** Rows the Recent activity card shows before "See all". */
const RECENT_LIMIT = 5;

/** Colours for the ticker discs, in holding order. */
const TICKER_COLORS = ["#3b6e96", "#3f937b", "#b08440", "#8a6fb0", "#a5453b", "#6f86a6"];

/** A figure without its currency prefix, for the tidy money layout. */
function amountOf(value: number): string {
  return money(value, "").trim();
}

/** A tile figure: small quiet currency, then the number. "--" when unknown. */
function moneyFigure(value: number | null, sign = false, toneClass = ""): string {
  if (value == null) return `<p class="wu-money wu-money--md"><span>${UNKNOWN}</span></p>`;
  const prefix = sign ? (value >= 0 ? "+" : "−") : "";
  return `<p class="wu-money wu-money--md${toneClass ? ` ${toneClass}` : ""}"><span class="wu-money__cur">MYR</span><span>${prefix}${amountOf(sign ? Math.abs(value) : value)}</span></p>`;
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
    return amountOf(holding.marketValueMyr);
  }
  return amountOf(holding.investedMyr);
}

function allocationHealthLabel(portfolio: PortfolioSnapshot): string {
  return portfolio.maxAbsoluteDrift <= 0.05 ? "Aligned" : portfolio.maxAbsoluteDrift <= 0.1 ? "Monitor" : "Rebalance";
}

function holdingRole(ticker: string): string {
  return ticker === "VOO" ? "Core market" : ticker === "QQQM" ? "Growth" : ticker === "VXUS" ? "International" : "Holding";
}

/** An amount in a named currency, statement style: "HKD 12,500". */
function localMoney(currency: string, value: number): string {
  return `${currency} ${amountOf(value)}`;
}

/**
 * The line under a holding's name. A US listing keeps its role; anywhere else
 * says where it trades and what it is worth there, because the value column
 * beside it is in ringgit. A Malaysian holding is already in ringgit, so it
 * shows its board lots instead.
 */
function holdingSubtitle(position: PortfolioHolding): string {
  if (position.market === "US") return holdingRole(position.ticker);
  if (position.currency === "MYR") return joinNotes(marketLabel(position.market), lotsText(position.market, position.units));
  const local = position.marketValueLocal ?? position.investedLocal;
  return joinNotes(marketLabel(position.market), localMoney(position.currency, local));
}

/** Currencies whose holdings are priced but have no rate to ringgit yet. */
function currenciesMissingRate(portfolio: PortfolioSnapshot): string[] {
  return portfolio.byCurrency
    .filter((group) => group.marketValueLocal !== null && group.rateToMyr === null)
    .map((group) => group.currency);
}

/*
 * The regions below carry every figure that moves with the live price: the
 * four figure tiles, the holdings, the next-contribution split, and the
 * Position Detail rows. They are pulled out as their own bodies so the
 * live-price poll can repaint just these (see patchPortfolioValuation) instead
 * of re-rendering the whole page — which was wiping whatever the user had
 * half-typed into the contribution form on every tick. None of them contains
 * an input or a bound control, so replacing their innerHTML needs no rebinding.
 */

/** Columns in the Position Detail table; group rows span all of them. */
const POSITION_COLUMNS = 11;

/** One Position Detail row, price-driven throughout. */
function positionRowHtml(position: PortfolioHolding): string {
  const driftSign = position.drift >= 0 ? "+" : "";
  // Market price, value and P&L come straight off the holding. A holding with
  // no usable quote shows "--" rather than being valued at zero.
  const pnlToneClass = position.unrealizedPnlMyr == null
    ? "" : position.unrealizedPnlMyr >= 0 ? "t-positive" : "t-negative";
  const driftToneClass = Math.abs(position.drift) > 0.08 ? "t-negative" : "";
  // Statement figures in the holding's own currency keep two decimals, as the
  // dollar columns always did.
  const local = (value: number | null): string => value == null
    ? UNKNOWN
    : `${escapeHtml(position.currency)} ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lots = lotsText(position.market, position.units);
  return '<tr>' +
    '<td><strong>' + escapeHtml(position.ticker) + '</strong></td>' +
    '<td>' + position.units.toFixed(position.currency === "USD" ? 5 : 0) + (lots ? ' · ' + lots : '') + '</td>' +
    '<td>' + local(position.averageCostLocal) + '</td>' +
    '<td>' + local(position.priceLocal) + '</td>' +
    '<td>' + local(position.investedLocal) + '</td>' +
    '<td>' + local(position.marketValueLocal) + '</td>' +
    '<td>' + money(position.investedMyr) + '</td>' +
    '<td>' + moneyOrUnknown(position.marketValueMyr) + '</td>' +
    '<td class="' + pnlToneClass + '">' + pnlText(position.unrealizedPnlMyr, position.unrealizedPnlPercentMyr) + '</td>' +
    '<td>' + percent(position.actualAllocation) + ' / ' + percent(position.targetAllocation) + '</td>' +
    '<td class="' + driftToneClass + '">' + driftSign + percent(position.drift, 1) + '</td>' +
    '</tr>';
}

/** "USD · 3 holdings · USD 1,141.25 → USD 1,175.54 · MYR 4,737.40" */
function currencyGroupRowHtml(group: CurrencySubtotal): string {
  const count = group.tickers.length;
  const value = group.marketValueLocal == null
    ? ""
    : ` → ${localMoney(group.currency, group.marketValueLocal)}`;
  const myr = group.currency === "MYR" || group.marketValueMyr == null ? "" : localMoney("MYR", group.marketValueMyr);
  const rate = group.currency === "MYR" || group.rateToMyr == null ? "" : `rate ${group.rateToMyr.toFixed(4)}`;
  const text = joinNotes(
    group.currency,
    `${count} ${count === 1 ? "holding" : "holdings"}`,
    `${localMoney(group.currency, group.investedLocal)}${value}`,
    myr,
    rate,
  );
  return `<tr class="wu-table__group"><td colspan="${POSITION_COLUMNS}">${escapeHtml(text)}</td></tr>`;
}

/**
 * Position Detail rows. With holdings in more than one currency they are
 * grouped by currency under a subtotal row; a single-currency portfolio has
 * nothing to group and reads as it always did. Targets not yet held follow.
 */
function positionRowsHtml(portfolio: PortfolioSnapshot): string {
  if (portfolio.byCurrency.length <= 1) return portfolio.holdings.map(positionRowHtml).join("");
  const grouped = portfolio.byCurrency.map((group) => currencyGroupRowHtml(group)
    + portfolio.holdings
      .filter((position) => position.units > 0 && position.currency === group.currency)
      .map(positionRowHtml).join(""));
  const notHeld = portfolio.holdings.filter((position) => position.units <= 0).map(positionRowHtml);
  return [...grouped, ...notHeld].join("");
}

/**
 * The Fees tile's note: what the return would have been with no trading
 * costs, because that gap is the broker's cut and nothing else on the page
 * shows it. Falls back to the count when there is no fee or no price.
 */
function feesNote(portfolio: PortfolioSnapshot, tradeCount: number): string {
  if (portfolio.feesInCostBasisMyr > 0.005 && portfolio.unrealizedPnlMyrExFees !== null) {
    const amount = portfolio.unrealizedPnlMyrExFees;
    const sign = amount >= 0 ? "+" : "−";
    const ratio = portfolio.unrealizedPnlPercentMyrExFees;
    return `Before fees ${sign}${amountOf(Math.abs(amount))}${ratio == null ? "" : ` (${sign}${percent(Math.abs(ratio), 2)})`}`;
  }
  return `Across ${tradeCount} ${tradeCount === 1 ? "contribution" : "contributions"}`;
}

/**
 * What a sale today would leave after the fees still to pay, because the
 * unrealised figure counts only the fees already paid to buy. Empty when there
 * is no estimate, so an unchecked broker never gets a made-up fee.
 */
function sellFeesNote(portfolio: PortfolioSnapshot): string {
  const fees = portfolio.estimatedSellFeesMyr;
  const after = portfolio.unrealizedPnlMyrAfterSellFees;
  if (fees === null || after === null) return "";
  return `If sold today ≈ ${after >= 0 ? "+" : "−"}${amountOf(Math.abs(after))} (est. sell fees ${amountOf(fees)})`;
}

/** Row 1 — the four figures. Market value, P&L and the fee-free return move with the price. */
function portfolioTilesBody(portfolio: PortfolioSnapshot, tradeCount: number): string {
  const heldCount = portfolio.holdings.filter((position) => position.units > 0).length;
  const holdingsText = `${heldCount} ${heldCount === 1 ? "holding" : "holdings"}`;
  // A complete valuation only needs its age; an incomplete one says what is missing.
  // Every holding priced, but a currency with no rate to ringgit leaves the
  // ringgit total unknown — say which, rather than showing a bare "--".
  const missingRate = currenciesMissingRate(portfolio);
  const valuationText = missingRate.length > 0 && portfolio.totalInvestmentValueMyr === null
    ? `No ${missingRate.join(" / ")} → MYR rate yet`
    : portfolio.valuationStatus === "complete"
      ? joinNotes(holdingsText, quoteAgeLabel(portfolio.valuedAt))
      : valuationNote(portfolio);
  const ratio = portfolio.unrealizedPnlPercentMyr;
  const returnChip = ratio == null
    ? ""
    : `<span class="wu-chip${ratio < 0 ? " wu-chip--negative" : ""}">${ratio >= 0 ? "+" : "−"}${percent(Math.abs(ratio), 1)}</span>`;
  const pnl = portfolio.unrealizedPnlMyr;
  const sellNote = sellFeesNote(portfolio);
  const sellNoteHtml = sellNote ? `<p class="wu-dash__note">${escapeHtml(sellNote)}</p>` : "";
  return `
        <section class="wu-card wu-dash__tile wu-portfolio-tile wu-valuation" data-valuation-status="${portfolio.valuationStatus}" aria-labelledby="pfValueLabel">
          <div class="wu-tc__top"><span class="wu-label" id="pfValueLabel">Market value</span>${returnChip}</div>
          ${moneyFigure(portfolio.totalInvestmentValueMyr)}
          <p class="wu-dash__note">${escapeHtml(valuationText)}</p>
        </section>
        <section class="wu-card wu-dash__tile wu-portfolio-tile" aria-labelledby="pfInvestedLabel">
          <div class="wu-tc__top"><span class="wu-label" id="pfInvestedLabel">Invested</span></div>
          ${moneyFigure(portfolio.totalInvestedMyr)}
          <p class="wu-dash__note">${heldCount > 0 ? "Capital contributed, at cost" : "No contributions recorded yet"}</p>
        </section>
        <section class="wu-card wu-dash__tile wu-portfolio-tile" aria-labelledby="pfUnrealisedLabel">
          <div class="wu-tc__top"><span class="wu-label" id="pfUnrealisedLabel">Unrealised</span></div>
          ${moneyFigure(pnl, true, pnl == null ? "" : pnl >= 0 ? "t-positive" : "t-negative")}
          <p class="wu-dash__note">Excludes realised gains</p>
        </section>
        <section class="wu-card wu-dash__tile wu-portfolio-tile" aria-labelledby="pfFeesLabel">
          <div class="wu-tc__top"><span class="wu-label" id="pfFeesLabel">Fees</span></div>
          ${moneyFigure(portfolio.feesInCostBasisMyr)}
          <p class="wu-dash__note">${escapeHtml(feesNote(portfolio, tradeCount))}</p>
          ${sellNoteHtml}
        </section>
        <section class="wu-card wu-dash__tile wu-portfolio-summary" aria-labelledby="pfSummaryLabel">
          <div class="wu-tc__top"><span class="wu-label" id="pfSummaryLabel">Market value</span>${returnChip}</div>
          ${moneyFigure(portfolio.totalInvestmentValueMyr)}
          <p class="wu-dash__note">${escapeHtml(joinNotes(`Invested ${amountOf(portfolio.totalInvestedMyr)}`, `fees ${amountOf(portfolio.feesInCostBasisMyr)}`, holdingsText))}</p>
          ${portfolio.valuationStatus === "complete" ? "" : `<p class="wu-dash__note">${escapeHtml(valuationNote(portfolio))}</p>`}
          ${portfolio.feesInCostBasisMyr > 0.005 && portfolio.unrealizedPnlMyrExFees !== null ? `<p class="wu-dash__note">${escapeHtml(feesNote(portfolio, tradeCount))}</p>` : ""}
          ${sellNoteHtml}
        </section>`;
}

/** Row 2 — one line per holding: weight against target, value, drift. */
function holdingsBody(portfolio: PortfolioSnapshot): string {
  const drift = portfolio.maxAbsoluteDrift;
  const chip = portfolio.holdings.length
    ? `<span class="wu-chip${drift > 0.05 ? " wu-chip--warning" : ""}">Largest drift ${percent(drift, 1)}</span>`
    : "";
  if (!portfolio.holdings.length) {
    return `<div class="wu-tc__top"><span class="wu-label" id="pfHoldingsLabel">Holdings</span></div>
        <p class="wu-empty">No portfolio positions yet. Record a contribution to establish your long-term allocation.</p>`;
  }
  return `<div class="wu-tc__top"><span class="wu-label" id="pfHoldingsLabel">Holdings</span>${chip}</div>
        ${portfolio.allocationBasis === "market" ? "" : `<p class="wu-dash__note">Weighted by cost — no live price yet</p>`}
        <div class="wu-hold-list">
          <div class="wu-hold wu-hold--head" aria-hidden="true"><span class="wu-hold__tick"></span><span class="wu-hold__name">ETF</span><span class="wu-hold__weight">Weight vs target</span><span class="wu-hold__value">Value</span></div>
          ${portfolio.holdings.map((position, index) => {
            const actual = Math.min(position.actualAllocation * 100, 100);
            const target = Math.min(position.targetAllocation * 100, 100);
            const driftTone = Math.abs(position.drift) > 0.08 ? "t-negative" : "t-faint";
            return `<div class="wu-hold">
            <span class="wu-hold__tick" style="background:${TICKER_COLORS[index % TICKER_COLORS.length]}" aria-hidden="true">${escapeHtml(position.ticker.slice(0, 4))}</span>
            <span class="wu-hold__name">${escapeHtml(position.ticker)}<small>${escapeHtml(holdingSubtitle(position))}</small></span>
            <span class="wu-hold__weight">
              <span class="wu-weight" role="img" aria-label="${percent(position.actualAllocation)} of portfolio, target ${percent(position.targetAllocation)}"><span style="width:${actual}%"></span><i style="left:${target}%"></i></span>
              <span class="wu-hold__meta"><span>${percent(position.actualAllocation)}</span><span>Target ${percent(position.targetAllocation)}</span></span>
            </span>
            <span class="wu-hold__value">${allocationAmount(portfolio, position)}<small class="${driftTone}">${position.drift >= 0 ? "+" : "−"}${percent(Math.abs(position.drift), 1)} drift</small></span>
          </div>`;
          }).join("")}
        </div>`;
}

/**
 * Whether the page shows the market / currency split. A portfolio in one
 * market and one currency has nothing to split — a lone "100%" bar only adds
 * a card — so the card appears once there is more than one of either.
 */
function showsExposure(portfolio: PortfolioSnapshot): boolean {
  const exposure = getPortfolioExposure(portfolio);
  return exposure.markets.length > 1 || exposure.currencies.length > 1;
}

/** Row 2b — where the money sits, by market and by currency. Moves with the price. */
function exposureBody(portfolio: PortfolioSnapshot): string {
  const exposure = getPortfolioExposure(portfolio);
  const bars = <K extends string>(slices: ExposureSlice<K>[], name: (key: K) => string): string =>
    `<ul class="wu-exposure__list">${slices.map((slice) => {
      const share = Math.min(Math.max(slice.share, 0), 1);
      return `<li><span>${escapeHtml(name(slice.key))}</span><span class="wu-weight" role="img" aria-label="${escapeHtml(name(slice.key))} ${percent(share, 1)}"><span style="width:${share * 100}%"></span></span><span>${percent(share, 1)}</span></li>`;
    }).join("")}</ul>`;
  const ringgit = exposure.currencies.find((slice) => slice.key === "MYR");
  const foreignShare = 1 - (ringgit?.share ?? 0);
  const riskNote = exposure.totalMyr > 0
    ? `${percent(foreignShare, 0)} moves with exchange rates${ringgit ? `; ${percent(ringgit.share, 0)} is in ringgit` : ""}.`
    : "";
  return `<div class="wu-tc__top"><span class="wu-label" id="pfExposureLabel">Where your money is</span><span class="wu-chip">${exposure.basis === "market" ? "By market value" : "By cost"}</span></div>
        <div class="wu-exposure">
          <div class="wu-stack wu-stack--sm"><span class="t-subheading">By market</span>${bars(exposure.markets, (key) => marketLabel(key as Market))}</div>
          <div class="wu-stack wu-stack--sm"><span class="t-subheading">By currency</span>${bars(exposure.currencies, (key) => key)}${riskNote ? `<p class="wu-dash__note">${escapeHtml(riskNote)}</p>` : ""}</div>
        </div>`;
}

/** An amount in its own currency, as a statement writes it. */
function payout(currency: string, value: number): string {
  return `${currency} ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The dividends card: what was received, and what the feeds say is still unrecorded. */
function dividendsBody(state: WealthState, portfolio: PortfolioSnapshot): string {
  const received = [...(state.dividends ?? [])]
    .filter((dividend) => dividend.status === "confirmed")
    .sort((a, b) => b.exDate.localeCompare(a.exDate));
  const suggestions = dividendSuggestions;

  const head = `<div class="wu-tc__top"><span class="wu-label" id="pfDividendsLabel">Dividends</span>${
    suggestions.length > 0
      ? `<span class="wu-chip wu-chip--warning">${suggestions.length} to confirm</span>`
      : received.length > 0 ? `<span class="wu-chip">${received.length} recorded</span>` : ""
  }</div>`;

  if (received.length === 0 && suggestions.length === 0) {
    return `${head}<p class="wu-empty">${dividendsAnswered
      ? "No payouts found for your holdings yet. They appear here as each ex-dividend date passes."
      : "Checking your holdings' payout history…"}</p>`;
  }

  const stats = received.length === 0 ? "" : `
        <div class="wu-dividend-stats">
          <div class="wu-stack wu-stack--sm"><span class="wu-label">Received (12 months)</span>${moneyFigure(portfolio.dividendsNetMyrLast12Months)}<p class="wu-dash__note">${received.length} ${received.length === 1 ? "payout" : "payouts"} recorded${portfolio.dividendsWithoutRate > 0 ? ` · ${portfolio.dividendsWithoutRate} without a rate to ringgit` : ""}</p></div>
          <div class="wu-stack wu-stack--sm"><span class="wu-label">Tax withheld (12 months)</span>${moneyFigure(portfolio.dividendsWithheldMyrLast12Months)}<p class="wu-dash__note">Taken before the money arrived</p></div>
          <div class="wu-stack wu-stack--sm"><span class="wu-label">Unrealised with dividends</span>${moneyFigure(portfolio.unrealizedPnlMyrWithDividends, true, portfolio.unrealizedPnlMyrWithDividends == null ? "" : portfolio.unrealizedPnlMyrWithDividends >= 0 ? "t-positive" : "t-negative")}<p class="wu-dash__note">${portfolio.unrealizedPnlPercentMyrWithDividends == null
            ? "Needs a live price"
            : `${percent(portfolio.unrealizedPnlPercentMyrWithDividends, 1)} with · ${portfolio.unrealizedPnlPercentMyr == null ? UNKNOWN : percent(portfolio.unrealizedPnlPercentMyr, 1)} without`}</p></div>
        </div>`;

  const editRow = (suggestion: DividendSuggestion): string => `
          <div class="wu-grid wu-grid--2 wu-dividend-edit">
            <label class="wu-field-row"><span class="wu-field-row__label">Pay date</span><input class="wu-field" type="date" id="divPayDate" value="${escapeHtml(suggestion.payDate)}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Gross ${escapeHtml(suggestion.currency)}</span><input class="wu-field" type="number" step="0.0001" min="0" id="divGross" value="${suggestion.gross.toFixed(4)}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Tax withheld ${escapeHtml(suggestion.currency)}</span><input class="wu-field" type="number" step="0.0001" min="0" id="divTax" value="${suggestion.withholdingTax.toFixed(4)}"></label>
            <div class="wu-row wu-field-row--wide"><button class="wu-btn wu-btn--primary wu-btn--sm div-save" data-id="${escapeHtml(suggestion.id)}" type="button">Save</button><button class="wu-btn wu-btn--ghost wu-btn--sm div-cancel" type="button">Cancel</button></div>
          </div>`;

  const suggestionList = suggestions.length === 0 ? "" : `
        <div class="wu-stack wu-stack--sm">
          <span class="t-subheading">To confirm</span>
          <p class="wu-dash__note">Worked out from each fund's payout history and the units you held before the ex-date. Check them against your statement.</p>
          <ul class="wu-ledger-list">${suggestions.map((suggestion) => `<li class="wu-ledger-row wu-ledger-row--plain wu-dividend">
            <span class="wu-ledger-row__title">${escapeHtml(suggestion.ticker)}<small>${escapeHtml(joinNotes(
              `ex ${shortDate(suggestion.exDate)}`,
              `${suggestion.units.toFixed(4)} × ${payout(suggestion.currency, suggestion.perShare)}`,
              suggestion.taxRate > 0 ? `tax ${percent(suggestion.taxRate, 0)}` : "no tax withheld",
            ))}</small>${suggestion.caution ? `<small class="wu-dividend__caution">${escapeHtml(suggestion.caution)}</small>` : ""}</span>
            <span class="wu-ledger-row__amount">${escapeHtml(payout(suggestion.currency, netDividend({ gross: suggestion.gross, withholdingTax: suggestion.withholdingTax })))}<small>${escapeHtml(suggestion.rateToMyr === undefined ? "no rate on file" : `≈ ${payout("MYR", netDividend({ gross: suggestion.gross, withholdingTax: suggestion.withholdingTax }) * suggestion.rateToMyr)}`)}</small></span>
            <span class="wu-row wu-row--tight wu-dividend__actions">
              <button class="wu-btn wu-btn--primary wu-btn--sm div-confirm" data-id="${escapeHtml(suggestion.id)}" type="button">Confirm</button>
              <button class="wu-btn wu-btn--ghost wu-btn--sm div-edit" data-id="${escapeHtml(suggestion.id)}" type="button">Edit</button>
              <button class="wu-btn wu-btn--ghost wu-btn--sm div-ignore" data-id="${escapeHtml(suggestion.id)}" type="button">Ignore</button>
            </span>
            ${editingSuggestionId === suggestion.id ? editRow(suggestion) : ""}
          </li>`).join("")}</ul>
        </div>`;

  const receivedList = received.length === 0 ? "" : `
        <details class="wu-details wu-details--inset">
          <summary class="wu-details__summary"><span class="wu-row wu-row--tight"><strong class="t-subheading">Received</strong><span class="wu-count">${received.length}</span></span></summary>
          <ul class="wu-ledger-list wu-dividend-received">${received.map((dividend) => {
            const rate = dividendRateToMyr(dividend, state.currencyExchanges ?? []);
            const net = netDividend(dividend);
            return `<li class="wu-ledger-row wu-dividend-received__row">
            <span class="wu-ledger-row__title">${escapeHtml(dividend.ticker)}<small>${escapeHtml(joinNotes(
              `ex ${shortDate(dividend.exDate)}`,
              dividend.withholdingTax > 0 ? `tax ${payout(dividend.currency, dividend.withholdingTax)}` : "no tax withheld",
              rate === null ? "no rate to ringgit" : "",
            ))}</small></span>
            <span class="wu-ledger-row__amount">${escapeHtml(payout(dividend.currency, net))}<small>${escapeHtml(rate === null ? UNKNOWN : `≈ ${payout("MYR", net * rate)}`)}</small></span>
            <button class="wu-btn wu-btn--ghost wu-btn--icon div-delete" data-id="${escapeHtml(dividend.id)}" type="button" aria-label="Remove this dividend">✕</button>
          </li>`;
          }).join("")}</ul>
        </details>`;

  return `${head}${stats}${suggestionList}${receivedList}`;
}

/** Row 3, left — where this month's contribution goes. Drift-driven, so it moves with the price. */
function nextContributionBody(state: WealthState, portfolio: PortfolioSnapshot): string {
  const plan = rebalanceContributions(state, portfolio);
  const lead = nextContributionLead(plan, portfolio.holdings);
  const health = allocationHealthLabel(portfolio);
  const b = (text: string): string => `<b>${escapeHtml(text)}</b>`;
  const list = (items: string[]): string => items.length <= 1
    ? items.map(b).join("")
    : `${items.slice(0, -1).map(b).join(", ")} and ${b(items[items.length - 1])}`;
  const sentence = lead.kind === "none"
    ? "No monthly contribution is set yet."
    : lead.kind === "one"
      ? `Put this month's ${b(money(lead.amount))} into ${b(lead.ticker)}${lead.onlyBelowTarget ? " — it's the only holding below target." : "."}`
      : `Split this month's ${b(money(lead.amount))} across ${list(lead.tickers)}.`;
  return `<div class="wu-tc__top"><span class="wu-label" id="pfNextLabel">Next contribution</span><span class="wu-chip${health === "Aligned" ? "" : " wu-chip--warning"}">${health}</span></div>
        <p class="wu-portfolio-lead">${sentence}</p>
        ${plan.length ? `<ul class="wu-facts wu-facts--plain">${plan.map((item) => `<li><span>${escapeHtml(item.ticker)}</span><span class="${item.amount > 0.005 ? "t-positive" : ""}">${item.amount > 0.005 ? "+" : ""}${amountOf(item.amount)}</span></li>`).join("")}</ul>` : ""}
        <p class="wu-dash__note wu-dash__actions">New money only — no selling required</p>`;
}

/** A trade's date the way the rest of the tidy pages write it: "1 Sep". */
function shortDate(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
}

export function portfolioTemplate(state: WealthState): string {
  const portfolio = getPortfolioSnapshot(state, new Date(), livePriceInputs());
  // Ringgit amounts as the portfolio costs them: a Hong Kong trade's MYR figure
  // comes from its HKD conversions, a Malaysian trade's is its own amount.
  const sortedTrades = tradesWithExchangeCost(state.trades, state.currencyExchanges ?? [], state.dividends ?? [])
    .sort((a, b) => b.date.localeCompare(a.date));
  const recentTrades = sortedTrades.slice(0, RECENT_LIMIT);
  const conversions = state.currencyExchanges ?? [];
  const coverage = conversions.length ? resolveExchangeCoverage(state.trades, conversions, state.dividends ?? []) : null;
  const coverageText = !coverage
    ? "Not recorded"
    : coverage.totalBuyUsd > 0 ? `${percent(Math.min(coverage.coverage, 1), 0)} covered` : `${conversions.length} recorded`;

  const tradeRows = sortedTrades
    .map((trade) => {
      const { currency, amount, price } = tradeAmounts(trade);
      const rate = currency === "MYR" ? 1 : currency === "USD" ? tradeExchangeRate(trade) : trade.exchangeRate ?? 0;
      return '<tr>' +
        '<td>' + escapeHtml(trade.date) + '</td>' +
        '<td>' + escapeHtml(trade.platform) + '</td>' +
        '<td><strong>' + escapeHtml(trade.ticker) + '</strong></td>' +
        '<td>' + escapeHtml(trade.type) + '</td>' +
        '<td>' + money(trade.amountMyr) + '</td>' +
        '<td>' + escapeHtml(currency) + ' ' + amount.toFixed(2) + '</td>' +
        '<td>' + escapeHtml(currency) + ' ' + price.toFixed(2) + '</td>' +
        '<td>' + (rate > 0 ? rate.toFixed(4) : UNKNOWN) + '</td>' +
        '<td>' + tradeUnits(trade).toFixed(5) + '</td>' +
        '<td><button class="wu-btn wu-btn--ghost wu-btn--icon delete-trade" data-id="' + escapeHtml(trade.id) + '" type="button" aria-label="Delete trade" title="Delete trade">✕</button></td>' +
        '</tr>';
    }).join("");

  const addButton = `<button class="wu-btn wu-btn--primary wu-btn--sm pf-add-toggle" type="button" aria-expanded="${tradeFormOpen}" aria-controls="pfEntryPanel">${tradeFormOpen ? "Close" : "+ Record trade"}</button>`;
  const importButton = `<label class="wu-btn wu-btn--secondary wu-btn--sm file-button">Import CSV<input class="pf-csv-input" type="file" accept=".csv" aria-label="Import broker CSV"></label>`;
  const footLink = (id: string, open: boolean, controls: string, title: string, note: string): string =>
    `<li><button id="${id}" type="button" aria-expanded="${open}" aria-controls="${controls}"><span>${title}<small>${escapeHtml(note)}</small></span><span aria-hidden="true">›</span></button></li>`;

  return `<div class="wu wu-portfolio-page">
    ${pageHeader({
      eyebrow: "Long-term Investment Portfolio",
      title: "Portfolio",
      sub: "Your holdings, what they're worth, and how far off target.",
      actions: `${importButton}${addButton}`,
    })}

    <div class="wu-dash">
      <!-- ROW 1 — the four figures, all the same size -->
      <div class="wu-dash__full wu-dash__tiles" id="pfTiles">${portfolioTilesBody(portfolio, state.trades.length)}</div>

      <!-- ROW 3 (left on desktop) — where this month's money goes; first on a phone -->
      <section class="wu-card wu-dash__half wu-stack wu-stack--sm" id="pfNextContribution" aria-labelledby="pfNextLabel">${nextContributionBody(state, portfolio)}</section>

      <!-- ROW 2 — every holding, one line each -->
      <section class="wu-card wu-dash__full wu-stack wu-stack--sm" id="pfHoldings" aria-labelledby="pfHoldingsLabel">${holdingsBody(portfolio)}</section>

      <!-- ROW 2b — by market and by currency, only when there is more than one -->
      <section class="wu-card wu-dash__full wu-stack wu-stack--sm" id="pfExposure" aria-labelledby="pfExposureLabel"${showsExposure(portfolio) ? "" : " hidden"}>${exposureBody(portfolio)}</section>

      <!-- ROW 2c — dividends received, and payouts waiting to be confirmed -->
      <section class="wu-card wu-dash__full wu-stack wu-stack--sm" id="pfDividends" aria-labelledby="pfDividendsLabel"${
        state.trades.length === 0 && (state.dividends ?? []).length === 0 ? " hidden" : ""
      }>${dividendsBody(state, portfolio)}</section>

      <!-- phone only: the page actions sit under the holdings, as in the preview -->
      <div class="wu-dash__full wu-portfolio-actions">${addButton.replace("wu-btn--sm", "wu-btn--sm wu-portfolio-actions__main")}${importButton}</div>

      <!-- ENTRY FORM — collapsed until asked for -->
      <section class="wu-card wu-dash__full wu-portfolio-entry wu-stack" id="pfEntryPanel" aria-labelledby="pfEntryLabel"${tradeFormOpen ? "" : " hidden"}>
        <div class="wu-tc__top"><span class="wu-label" id="pfEntryLabel">Record trade</span><button class="wu-btn wu-btn--ghost wu-btn--sm" id="pfEntryClose" type="button">Cancel</button></div>
        <form id="tradeForm" class="wu-grid wu-grid--2">
          <label class="wu-field-row"><span class="wu-field-row__label">Date</span><input class="wu-field" name="date" type="date" required></label>
          <label class="wu-field-row"><span class="wu-field-row__label">Platform</span><select class="wu-field" name="platform" id="platformSelect">${knownPlatforms(state).map((pf) => "<option" + (pf === lastUsedPlatform(state) ? " selected" : "") + ">" + escapeHtml(pf) + "</option>").join("")}<option value="__custom__">+ Custom</option></select></label>
          <div id="customPlatformWrap" class="wu-field-row--wide" style="display:none;"><label class="wu-field-row"><span class="wu-field-row__label">Custom Platform</span><input class="wu-field" name="customPlatform" id="customPlatformInput" type="text" placeholder="e.g. IBKR, Webull, Rakuten Trade"></label></div>
          <label class="wu-field-row"><span class="wu-field-row__label">Market</span><select class="wu-field" name="market" id="pfMarket">${MARKETS.map((info) => `<option value="${info.market}">${escapeHtml(info.label)}</option>`).join("")}</select></label>
          <label class="wu-field-row"><span class="wu-field-row__label">Currency</span><select class="wu-field" name="currency" id="pfCurrency" disabled><option>USD</option></select></label>
          <label class="wu-field-row"><span class="wu-field-row__label">Ticker</span><select class="wu-field" name="ticker" id="tickerSelect"><option>VOO</option><option>QQQM</option>${state.customTickers.map((t) => "<option>" + escapeHtml(t) + "</option>").join("")}<option value="__custom__">+ Custom</option></select></label>
          <div id="customTickerWrap" class="wu-field-row--wide" style="display:none;"><label class="wu-field-row"><span class="wu-field-row__label">Custom Ticker</span><input class="wu-field" name="customTicker" id="customTickerInput" type="text" placeholder="e.g. AAPL" style="text-transform:uppercase"></label><small class="t-caption t-faint">The market's suffix is added for you: 1155 on Malaysia becomes 1155.KL.</small></div>
          <label class="wu-field-row"><span class="wu-field-row__label">Type</span><select class="wu-field" name="type"><option>DCA</option><option>Dip Buy</option><option>Manual Buy</option><option>Sell</option></select></label>
          <label class="wu-field-row"><span class="wu-field-row__label">Filled Quantity</span><input class="wu-field" name="units" type="number" min="0" step="0.0001"><small class="t-caption t-faint" id="pfLotsHint" hidden></small></label>
          <label class="wu-field-row"><span class="wu-field-row__label">Price / Unit <span class="pf-cur">USD</span></span><input class="wu-field" name="price" type="number" min="0" step="0.0001"></label>
          <label class="wu-field-row"><span class="wu-field-row__label">Amount <span class="pf-cur">USD</span></span><input class="wu-field" name="amount" type="number" min="0" step="0.01"><small class="t-caption t-faint">Blank = price × quantity</small></label>
          <label class="wu-field-row" id="pfAmountMyrWrap"><span class="wu-field-row__label">Amount MYR</span><input class="wu-field" name="amountMyr" type="number" min="0" step="0.01"><small class="t-caption t-faint">What it cost in ringgit. Blank = today's rate; your recorded conversions replace it.</small></label>
          <div class="wu-field-row"><span class="wu-field-row__label">Fee</span><div class="wu-field-pair"><input class="wu-field" name="fee" type="number" min="0" step="0.01" aria-label="Fee"><select class="wu-field" name="feeCurrency" id="pfFeeCurrency" aria-label="Fee currency"><option>USD</option><option>MYR</option></select></div></div>
          <label class="wu-field-row"><span class="wu-field-row__label">Notes</span><input class="wu-field" name="notes" type="text" placeholder="Optional"></label>
          <p class="wu-field-row__error wu-field-row--wide" id="pfTradeError" role="alert"></p>
          <div class="wu-row wu-field-row--wide"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Record contribution</button></div>
        </form>
        <small class="t-caption t-faint">Importing instead? Moomoo and custom transaction CSV exports are supported.</small>
      </section>

      <!-- ROW 3 (right on desktop) — recent activity -->
      <section class="wu-card wu-dash__half wu-stack wu-stack--sm wu-portfolio-recent" aria-labelledby="pfRecentLabel">
        <div class="wu-tc__top"><span class="wu-label" id="pfRecentLabel">Recent activity</span></div>
        ${recentTrades.length === 0
          ? `<p class="wu-empty">No transactions yet. Record your first trade to begin tracking.</p>`
          : `<ul class="wu-ledger-list">${recentTrades.map((trade) => `<li class="wu-ledger-row wu-ledger-row--plain"><span class="wu-ledger-row__title">${escapeHtml(trade.ticker)}<small>${escapeHtml(joinNotes(trade.type, shortDate(trade.date), trade.platform))}</small></span><span class="wu-ledger-row__amount">${trade.type === "Sell" ? "−" : ""}${amountOf(trade.amountMyr)}</span></li>`).join("")}</ul>`}
        ${state.trades.length > 0
          ? `<button class="wu-btn wu-btn--ghost wu-btn--sm wu-self-end wu-portfolio-see-all" id="pfSeeAll" type="button" aria-expanded="${historyOpen}" aria-controls="pfHistoryPanel">${historyOpen ? "Hide full history" : `See all ${state.trades.length}`}</button>`
          : ""}
      </section>

      <!-- FULL HISTORY — every column, with delete and clear -->
      <section class="wu-card wu-dash__full wu-stack wu-stack--sm" id="pfHistoryPanel" aria-labelledby="pfHistoryLabel"${historyOpen ? "" : " hidden"}>
        <div class="wu-tc__top"><span class="wu-label" id="pfHistoryLabel">Contribution history · ${state.trades.length}</span>${state.trades.length > 0
          ? '<button class="wu-btn wu-btn--danger wu-btn--sm clear-trades" type="button">Clear all</button>'
          : ""}</div>
        <div class="wu-table-wrap">
          <table class="wu-table">
            <thead><tr><th>Date</th><th>Platform</th><th>Ticker</th><th>Type</th><th>Amount MYR</th><th>Amount</th><th>Price</th><th>FX</th><th>Units</th><th></th></tr></thead>
            <tbody>${tradeRows || `<tr><td colspan="10"><p class="wu-empty">No transactions yet. Add your first transaction to begin tracking.</p></td></tr>`}</tbody>
          </table>
        </div>
      </section>

      <!-- MORE — the ringgit cost basis and the per-holding numbers, one tap away -->
      <section class="wu-card wu-dash__full wu-dash__more wu-stack wu-stack--sm" aria-labelledby="pfMoreLabel">
        <span class="wu-label" id="pfMoreLabel">More detail</span>
        <ul class="wu-navlist wu-navlist--inline wu-portfolio-links">
          ${footLink("pfConversionsToggle", conversionsOpen, "pfConversionsPanel", "Currency conversions", coverageText)}
          ${footLink("pfPositionsToggle", positionsOpen, "pfPositionsPanel", "Position detail", `${portfolio.holdings.length} ${portfolio.holdings.length === 1 ? "holding" : "holdings"}`)}
        </ul>
      </section>

      <div class="wu-dash__full" id="pfConversionsPanel"${conversionsOpen ? "" : " hidden"}>${currencyConversionsPanel(state)}</div>

      <section class="wu-card wu-dash__full wu-stack wu-stack--sm" id="pfPositionsPanel" aria-labelledby="pfPositionsLabel"${positionsOpen ? "" : " hidden"}>
        <div class="wu-tc__top"><span class="wu-label" id="pfPositionsLabel">Position detail</span></div>
        <div class="wu-table-wrap">
          <table class="wu-table">
            <thead><tr><th>Ticker</th><th>Units</th><th>Avg Cost</th><th>Market Price</th><th>Invested</th><th>Value</th><th>Invested MYR</th><th>Value MYR</th><th>Unrealised P&amp;L</th><th>Actual / Target</th><th>Drift</th></tr></thead>
            <tbody id="pfPositionRows">${positionRowsHtml(portfolio)}</tbody>
          </table>
        </div>
      </section>
    </div>
  </div>`;
}

/**
 * Repaint only the price-driven regions of an already-rendered Portfolio page.
 *
 * The live-price poll used to re-render the whole #pageMount on every tick
 * (as often as every PRICE_POLL_INTERVAL_MS), which threw away whatever the
 * user had half-typed into the contribution form. These regions carry every
 * figure that moves with the price and contain no input or bound control, so
 * swapping their innerHTML is safe and needs no re-binding. The form, the CSV
 * import, the FX panel, the history and every open/closed panel are left
 * exactly as they are.
 */
export function patchPortfolioValuation(root: HTMLElement, state: WealthState): void {
  const portfolio = getPortfolioSnapshot(state, new Date(), livePriceInputs());
  const set = (id: string, html: string): void => {
    const el = root.querySelector<HTMLElement>("#" + id);
    if (el) el.innerHTML = html;
  };
  set("pfTiles", portfolioTilesBody(portfolio, state.trades.length));
  set("pfHoldings", holdingsBody(portfolio));
  set("pfExposure", exposureBody(portfolio));
  set("pfDividends", dividendsBody(state, portfolio));
  set("pfNextContribution", nextContributionBody(state, portfolio));
  set("pfPositionRows", positionRowsHtml(portfolio));
}

export function bindPortfolio(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  // Toggle custom ticker input
  const tickerSelect = root.querySelector<HTMLSelectElement>("#tickerSelect");
  const customWrap = root.querySelector<HTMLElement>("#customTickerWrap");
  tickerSelect?.addEventListener("change", () => {
    if (customWrap) customWrap.style.display = tickerSelect.value === "__custom__" ? "block" : "none";
    // A ticker already on file says where it trades.
    const marketField = root.querySelector<HTMLSelectElement>("#pfMarket");
    if (marketField && tickerSelect.value !== "__custom__") {
      marketField.value = marketOfTicker(tickerSelect.value);
      syncTradeFormMarket(root);
    }
  });
  root.querySelector<HTMLSelectElement>("#pfMarket")?.addEventListener("change", () => syncTradeFormMarket(root));
  root.querySelector<HTMLSelectElement>("#pfCurrency")?.addEventListener("change", () => syncTradeFormMarket(root));
  root.querySelector<HTMLInputElement>('#tradeForm input[name="units"]')
    ?.addEventListener("input", () => syncTradeFormMarket(root));
  syncTradeFormMarket(root);

  // Same "+ Custom" reveal for the broker.
  const platformSelect = root.querySelector<HTMLSelectElement>("#platformSelect");
  const customPlatformWrap = root.querySelector<HTMLElement>("#customPlatformWrap");
  platformSelect?.addEventListener("change", () => {
    if (customPlatformWrap) customPlatformWrap.style.display = platformSelect.value === "__custom__" ? "block" : "none";
  });

  // Applied after the selects are bound so the custom-input reveal it performs
  // is not undone by a later change event.
  if (pendingTradePrefill) {
    const panel = root.querySelector<HTMLElement>("#pfEntryPanel");
    if (panel) panel.hidden = false;
    applyTradePrefill(root, pendingTradePrefill);
    pendingTradePrefill = null;
  }

  // Dividend suggestions: asked for whenever what they depend on changes, then
  // painted in place. Failure is silent — the card says nothing is waiting.
  const repaintDividends = (): void => {
    const card = root.querySelector<HTMLElement>("#pfDividends");
    if (card) card.innerHTML = dividendsBody(state, getPortfolioSnapshot(state, new Date(), livePriceInputs()));
  };
  const requestKey = dividendRequestKey(state);
  if (requestKey !== dividendsRequestKey) {
    dividendsRequestKey = requestKey;
    dividendsAnswered = false;
    // An answer for a state that has since changed is dropped, not painted.
    const settle = (list: DividendSuggestion[]): void => {
      if (dividendsRequestKey !== requestKey) return;
      dividendSuggestions = list;
      dividendsAnswered = true;
      repaintDividends();
    };
    void loadDividendSuggestions(state).then(settle).catch(() => settle([]));
  }

  const recordDividend = (dividend: Dividend, label: string): void => {
    editingSuggestionId = null;
    dividendSuggestions = dividendSuggestions.filter((suggestion) => suggestion.id !== dividend.id);
    const next = {
      ...state,
      dividends: [...(state.dividends ?? []).filter((item) => item.id !== dividend.id), dividend],
    };
    setState(next, label);
    rerender(root, next, setState, "portfolio", navigate);
  };
  const suggestionFor = (id: string | undefined): DividendSuggestion | undefined =>
    dividendSuggestions.find((suggestion) => suggestion.id === id);

  // One delegated handler on the card, because its contents are repainted
  // whenever suggestions arrive or a price refreshes — buttons bound
  // individually would lose their listeners on the first repaint.
  root.querySelector<HTMLElement>("#pfDividends")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-id], button.div-cancel");
    if (!button) return;
    const id = button.dataset.id;

    if (button.classList.contains("div-confirm")) {
      const suggestion = suggestionFor(id);
      if (suggestion) recordDividend(dividendFromSuggestion(suggestion), "Recorded a dividend");
      return;
    }
    if (button.classList.contains("div-ignore")) {
      const suggestion = suggestionFor(id);
      if (suggestion) recordDividend(dismissedFromSuggestion(suggestion), "Ignored a suggested dividend");
      return;
    }
    if (button.classList.contains("div-edit")) {
      editingSuggestionId = id ?? null;
      repaintDividends();
      return;
    }
    if (button.classList.contains("div-cancel")) {
      editingSuggestionId = null;
      repaintDividends();
      return;
    }
    if (button.classList.contains("div-save")) {
      const suggestion = suggestionFor(id);
      if (!suggestion) return;
      const value = (fieldId: string): string => root.querySelector<HTMLInputElement>("#" + fieldId)?.value ?? "";
      const gross = Number(value("divGross"));
      const tax = Number(value("divTax"));
      // The figures on the statement win, but tax above gross is not a statement.
      if (!(gross > 0) || !(tax >= 0) || tax > gross) {
        const field = root.querySelector<HTMLInputElement>("#divTax");
        field?.setCustomValidity("Tax cannot be more than the gross payout.");
        field?.reportValidity();
        return;
      }
      recordDividend(dividendFromSuggestion(suggestion, {
        payDate: value("divPayDate") || suggestion.payDate,
        gross,
        withholdingTax: tax,
      }), "Recorded a dividend");
      return;
    }
    if (button.classList.contains("div-delete")) {
      const dividend = (state.dividends ?? []).find((item) => item.id === id);
      if (!dividend) return;
      if (!confirm(`Remove the ${dividend.ticker} dividend with ex-date ${dividend.exDate}?

It will be suggested again if the feed still carries it.`)) return;
      const next = { ...state, dividends: (state.dividends ?? []).filter((item) => item.id !== id) };
      setState(next, "Removed a dividend");
      rerender(root, next, setState, "portfolio", navigate);
    }
  });

  root.querySelector<HTMLFormElement>("#tradeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    // A disabled select is left out of FormData; the currency it shows still counts.
    const currencyField = form.elements.namedItem("currency");
    const data = new FormData(form);
    const error = root.querySelector<HTMLElement>("#pfTradeError");
    let tickerInput = String(data.get("ticker") ?? "");
    if (tickerInput === "__custom__") {
      tickerInput = String(data.get("customTicker") ?? "");
      if (!tickerInput.trim()) return;
    }
    let platform = String(data.get("platform") ?? "");
    if (platform === "__custom__") platform = String(data.get("customPlatform") ?? "").trim();
    if (!platform) platform = lastUsedPlatform(state);
    const marketValue = String(data.get("market") ?? "US");
    const market: Market = isMarket(marketValue) ? marketValue : "US";
    const currency = currencyField instanceof HTMLSelectElement ? currencyField.value : currenciesFor(market)[0];

    // Today's rate, only needed when the ringgit amount was left blank.
    let rate: number | null = currency === "MYR" ? 1 : null;
    if (rate === null && !(Number(data.get("amountMyr")) > 0)) {
      rate = currency === "USD"
        ? getUsdToMyr()
        : livePriceInputs().ratesToMyr?.get(currency)
          ?? (await fetchRatesToMyr([currency], state.currencyExchanges).catch(() => new Map<string, number>())).get(currency)
          ?? null;
    }

    const trade = tradeFromEntry({
      id: createId("trade"),
      date: String(data.get("date") ?? ""),
      platform,
      ticker: tickerInput,
      market,
      currency,
      type: String(data.get("type")) as TradeType,
      amount: Number(data.get("amount")) || 0,
      price: Number(data.get("price")) || 0,
      units: Number(data.get("units")) || 0,
      amountMyr: Number(data.get("amountMyr")) || 0,
      fee: Number(data.get("fee")) || 0,
      feeCurrency: String(data.get("feeCurrency") ?? "MYR"),
      notes: String(data.get("notes") ?? ""),
    }, rate);
    if (!trade) {
      if (error) error.textContent = "Enter the amount, or the price and quantity, so the trade has a value.";
      return;
    }
    const ticker = trade.ticker;
    // Save custom ticker to memory if new
    const customTickers = state.customTickers.includes(ticker)
      ? state.customTickers
      : (ticker !== "VOO" && ticker !== "QQQM")
        ? [...state.customTickers, ticker]
        : state.customTickers;
    const next = { ...state, trades: [...state.trades, trade], customTickers };
    tradeFormOpen = false;
    setState(next);
    rerender(root, next, setState, "portfolio", navigate);
  });

  // The same import sits in the header (desktop) and under the holdings (phone).
  root.querySelectorAll<HTMLInputElement>(".pf-csv-input").forEach((csvInput) => csvInput.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const records = recordsFromCsv(await file.text(), lastUsedPlatform(state));
    const next = { ...state, trades: [...state.trades, ...records] };
    setState(next);
    rerender(root, next, setState, "portfolio", navigate);
  }));

  // T-3: the form, the full history and the two detail panels each open behind
  // a control. Toggling one re-renders in place and keeps the reader where
  // they were; opening one brings it into view.
  const reopen = (focusId?: string): void => {
    const scrollPosition = { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 };
    rerender(root, state, setState, "portfolio", navigate);
    const restore = () => {
      window.scrollTo(scrollPosition.x, scrollPosition.y);
      document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
    };
    restore();
    requestAnimationFrame(() => {
      restore();
      if (focusId) root.querySelector<HTMLElement>("#" + focusId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };
  root.querySelectorAll<HTMLButtonElement>(".pf-add-toggle").forEach((button) => button.addEventListener("click", () => {
    tradeFormOpen = !tradeFormOpen;
    reopen(tradeFormOpen ? "pfEntryPanel" : undefined);
  }));
  root.querySelector<HTMLButtonElement>("#pfEntryClose")?.addEventListener("click", () => {
    tradeFormOpen = false;
    reopen();
  });
  root.querySelector<HTMLButtonElement>("#pfSeeAll")?.addEventListener("click", () => {
    historyOpen = !historyOpen;
    reopen(historyOpen ? "pfHistoryPanel" : undefined);
  });
  root.querySelector<HTMLButtonElement>("#pfConversionsToggle")?.addEventListener("click", () => {
    conversionsOpen = !conversionsOpen;
    reopen(conversionsOpen ? "pfConversionsPanel" : undefined);
  });
  root.querySelector<HTMLButtonElement>("#pfPositionsToggle")?.addEventListener("click", () => {
    positionsOpen = !positionsOpen;
    reopen(positionsOpen ? "pfPositionsPanel" : undefined);
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
    const myr = intoUsd.reduce((sum, record) => sum + (record.myrAmount ?? 0), 0);
    const usd = intoUsd.reduce((sum, record) => sum + (record.usdAmount ?? 0), 0);
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
      const sides = sidesOf(record);
      const leg = sides ? ringgitLeg(sides) : null;
      if (!leg) return;
      const confirmed = confirm(
        `Delete the ${record.date} conversion of ${money(leg.myrAmount)} and ${leg.currency} ${leg.foreignAmount.toFixed(2)}?\n\n` +
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
