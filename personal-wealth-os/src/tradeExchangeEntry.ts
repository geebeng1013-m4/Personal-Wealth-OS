import type { CurrencyExchange, Trade, WealthState } from "./models";
import { exchangeId } from "./exchangeImport";
import { normalizeTradeMarket, sidesOf } from "./tradeCurrency";
import { MAX_CURRENCY_EXCHANGES, tradesWithExchangeCost } from "./currencyExchange";

export interface TradeExchangeInput {
  date: string;
  myrAmount: string;
  usdAmount: string;
}

type ExchangeEntryResult =
  | { ok: true; exchange: CurrencyExchange }
  | { ok: false; field: keyof TradeExchangeInput; error: string };

function moneyInput(text: string): number | null {
  const raw = text.trim();
  const value = Number(raw);
  return /^\d+(?:\.\d{1,2})?$/.test(raw) && Number.isFinite(value) && value > 0
    && Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) / 100 : null;
}

export function isCalendarDay(day: string): boolean {
  const timestamp = Date.parse(day + "T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === day;
}

/** Actual MYR→USD settlement, optionally only the shortfall of a mixed-currency buy. */
export function exchangeFromTrade(
  trade: Trade,
  input: TradeExchangeInput,
  existing: CurrencyExchange[],
  today: string,
): ExchangeEntryResult {
  const normalized = normalizeTradeMarket(trade);
  if (normalized.currency !== "USD" || trade.type === "Sell") {
    return { ok: false, field: "usdAmount", error: "Record an exchange with a USD buy, not a sale or a trade in another currency." };
  }
  if (!Number.isFinite(normalized.amount) || !(Number(normalized.amount) > 0)) {
    return { ok: false, field: "usdAmount", error: "This buy needs a valid USD amount before an exchange can be linked to it." };
  }
  const myrAmount = moneyInput(input.myrAmount);
  const usdAmount = moneyInput(input.usdAmount);
  if (myrAmount === null) return { ok: false, field: "myrAmount", error: "Enter the actual MYR paid, greater than zero, with at most two decimal places." };
  if (usdAmount === null) return { ok: false, field: "usdAmount", error: "Enter the actual USD received, greater than zero, with at most two decimal places." };
  const feeUsd = normalized.feeCurrency === "USD" ? normalized.fee ?? 0 : 0;
  if (usdAmount > (normalized.amount ?? 0) + feeUsd + 0.005) {
    return { ok: false, field: "usdAmount", error: "USD received cannot exceed this buy's USD amount plus its USD fee. For an exchange covering multiple buys, use exchange history instead." };
  }
  const tradeDay = trade.date.slice(0, 10);
  if (!isCalendarDay(input.date) || !isCalendarDay(tradeDay) || input.date > today || input.date < tradeDay) {
    return { ok: false, field: "date", error: "Choose the actual exchange date, on or after the trade date and no later than today." };
  }
  if (existing.some((exchange) => exchange.tradeId === trade.id)) {
    return { ok: false, field: "date", error: "This trade already has a recorded settlement. Check exchange history before adding another." };
  }
  // Use the paste importer's fingerprint, so the same statement subsequently
  // pasted into history updates this record instead of counting the cash twice.
  const id = exchangeId(input.date, myrAmount, usdAmount);
  const matching = existing.filter((exchange) => {
    const sides = sidesOf(exchange);
    return exchange.date === input.date && sides?.fromCurrency === "MYR" && sides.toCurrency === "USD"
      && sides.fromAmount === myrAmount && sides.toAmount === usdAmount;
  });
  const previous = matching.find((exchange) => !exchange.tradeId) ?? matching[0];
  if (previous?.tradeId) {
    return { ok: false, field: "date", error: "An exchange with these details is already linked to another trade. Check the statement before adding it." };
  }
  if (!previous && existing.length >= MAX_CURRENCY_EXCHANGES) {
    return { ok: false, field: "date", error: "Exchange history is at its record limit. Export and review it before adding another conversion." };
  }
  return { ok: true, exchange: {
    ...(previous ?? {}), id: previous?.id ?? id, date: input.date, tradeId: trade.id,
    direction: "myr-to-usd", myrAmount, usdAmount,
  } };
}

/** One immutable update for the buy and its exchange; never touches Ledger accounts or transactions. */
export function withTradeAndExchange(state: WealthState, trade: Trade, exchange?: CurrencyExchange): WealthState {
  const next = {
    ...state,
    trades: [...state.trades, trade],
    currencyExchanges: state.currencyExchanges,
  };
  return exchange ? withExchangeForTrade(next, trade.id, exchange) : next;
}

/** Store the resolved cost on the linked trade too, for export and older readers. */
export function withExchangeForTrade(state: WealthState, tradeId: string, exchange: CurrencyExchange): WealthState {
  const currencyExchanges = withRecordedExchange(state.currencyExchanges, exchange);
  const priced = tradesWithExchangeCost(state.trades, currencyExchanges, state.dividends).find((trade) => trade.id === tradeId);
  return { ...state, currencyExchanges, trades: state.trades.map((trade) => trade.id === tradeId && priced ? priced : trade) };
}

export function withRecordedExchange(existing: CurrencyExchange[], exchange: CurrencyExchange): CurrencyExchange[] {
  return [...existing.filter((record) => record.id !== exchange.id), exchange]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Removing a trade leaves its real conversion as unlinked history. */
export function withoutExchangeLinks(exchanges: CurrencyExchange[], tradeIds: ReadonlySet<string>): CurrencyExchange[] {
  return exchanges.map((exchange) => {
    if (!exchange.tradeId || !tradeIds.has(exchange.tradeId)) return exchange;
    const { tradeId: _removed, ...unlinked } = exchange;
    return unlinked;
  });
}
