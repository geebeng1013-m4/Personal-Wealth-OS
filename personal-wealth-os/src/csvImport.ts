// CSV trade-import parsing — split out of ui.ts since it's pure data
// transformation with no DOM dependency (see moomoo Universal Account exports
// and the simple fallback CSV format below).
import { createId } from "./state";
import { getUsdToMyr } from "./market";
import type { Trade, TradeType, Ticker } from "./models";
import { ImportValidationError, validateImportedTrade } from "./importValidation";
import { tradeAmounts } from "./tradeCurrency";
import { tradeUnits } from "./rules";

function parseCsv(text: string, strict = false): string[][] {
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
  if (quoted && strict) throw new ImportValidationError("CSV", "Unclosed quoted field.");
  row.push(current.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseMoomooDate(raw: string): string {
  // "Jun 26, 2026 00:00:00 ET" or "May 12, 2026 10:52:00 ET"
  const match = raw.match(/^(\w+ \d+), (\d{4}) (\d{2}:\d{2}:\d{2}) ET$/);
  if (!match) return raw;
  const d = new Date(`${match[1]}, ${match[2]} ${match[3]} GMT-0400`);
  if (isNaN(d.getTime())) return raw;
  return d.toISOString();
}

function parseMoomooFillPrice(raw: string): number {
  const separatorIndex = raw.lastIndexOf("@");
  const price = Number(separatorIndex >= 0 ? raw.slice(separatorIndex + 1) : raw);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

/**
 * Strip a leading UTF-8 BOM, however it arrived: the real U+FEFF character, or
 * the "ï»¿" mojibake left behind when a tool double-encodes it (this is what
 * Moomoo's own CSV export produces, at least on some platforms/versions).
 * Left in place it contaminates the first header cell ("Side" becomes
 * "ï»¿Side"), Moomoo-format detection silently fails, and the import produces
 * zero trades with no error — a real file from a real account exhibited
 * exactly this.
 */
function stripBom(text: string): string {
  return text.replace(/^﻿/, "").replace(/^ï»¿/, "");
}

/**
 * @param fallbackPlatform stamped on rows of a non-Moomoo ("custom") CSV that
 *   carry no Platform column. A genuine Moomoo export is always "moomoo".
 */
export function recordsFromCsv(text: string, fallbackPlatform = "moomoo", strict = false): Trade[] {
  const [headers = [], ...rows] = parseCsv(stripBom(text), strict);
  const normalized = headers.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  const get = (row: string[], names: string[]) => {
    const idx = normalized.findIndex((h) => names.includes(h));
    return idx >= 0 ? row[idx] ?? "" : "";
  };

  // Detect Moomoo Universal Account format by checking for "Symbol" and "Side" columns
  const isMoomooFormat = normalized.includes("symbol") && normalized.includes("side");
  if (strict && (!rows.length || (!isMoomooFormat && (!normalized.includes("ticker") || !normalized.includes("date"))))) {
    throw new ImportValidationError("CSV", "No supported trade rows were found.");
  }
  const rowNumbers = new Map(rows.map((row, index) => [row, index + 2]));
  const numeric = (row: string[], names: string[]): number => {
    const raw = get(row, names).trim();
    if (!raw || raw === "--") return 0;
    const normalized = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, "") : raw;
    const value = Number(normalized);
    if (strict && (!Number.isFinite(value) || value < 0)) throw new ImportValidationError(`CSV[${rowNumbers.get(row)}].${names[0]}`, "Expected a finite non-negative number.");
    return Number.isFinite(value) ? value : 0;
  };
  const checked = (trade: Trade, row: string[]): Trade => {
    if (strict) validateImportedTrade(trade, `CSV[${rowNumbers.get(row)}]`);
    return trade;
  };

  if (isMoomooFormat) {
    // KNOWN LIMITATION: one rate for the whole file.
    //
    // Moomoo's order export is pure USD — it has no FX column, because the
    // ringgit conversion happens in a separate currency-exchange record. So
    // every row here is converted at the live rate on the day of the import,
    // not the rate that applied on the day of the trade. A file spanning eight
    // months of DCA comes out as if all of it settled this morning.
    //
    // The consequence is visible: the MYR cost basis (and therefore the MYR
    // return) shifts depending on WHEN the user imported, while the USD figures
    // stay exact because units and prices come straight off the CSV. Treat the
    // USD side as the truth and the MYR side as an approximation until each
    // trade carries its own historical rate.
    const USD_TO_MYR = getUsdToMyr(); // dynamic rate, prefetched in main.ts
    return rows
      .filter((row) => {
        const status = get(row, ["status"]).toLowerCase();
        return status === "filled"; // only import filled orders
      })
      .map((row): Trade | null => {
        const ticker = get(row, ["symbol"]).toUpperCase();
        if (!ticker) {
          if (strict) throw new ImportValidationError(`CSV[${rowNumbers.get(row)}].ticker`, "Invalid ticker.");
          return null;
        }

        const side = get(row, ["side"]).toLowerCase();
        if (strict && side !== "buy" && side !== "sell") throw new ImportValidationError(`CSV[${rowNumbers.get(row)}].side`, "Unsupported trade type.");
        const fillPrice = parseMoomooFillPrice(get(row, ["filled@avg price"]))
          || Number(get(row, ["order price"]))
          || 0;
        const combinedFill = get(row, ["filled@avg price"]);
        const fillQty = numeric(row, ["fill qty"])
          || (combinedFill.includes("@") ? Number(combinedFill.split("@")[0]) : 0);
        // Order Amount can be the requested budget rather than the actual fill.
        // Short exports omit Fill Qty/Amount but retain quantity@price.
        const fillAmountUsd = numeric(row, ["fill amount"])
          || (fillQty > 0 && fillPrice > 0 ? Math.round(fillQty * fillPrice * 100) / 100 : 0)
          || Number(get(row, ["order amount"])) || 0;
        if (![fillPrice, fillQty, fillAmountUsd].every(Number.isFinite)
          || fillPrice <= 0 || fillQty < 0 || fillAmountUsd <= 0) {
          if (strict) throw new ImportValidationError(`CSV[${rowNumbers.get(row)}]`, "A trade needs a positive amount and a quantity or price.");
          return null;
        }
        const totalFeesUsd = numeric(row, ["total"])
          || numeric(row, ["platform fees"]) + numeric(row, ["stamp duty"]);

        // Determine trade type from side
        let tradeType: TradeType = "DCA";
        if (side === "sell") {
          tradeType = "Sell";
        }

        return checked({
          id: createId("csv"),
          date: parseMoomooDate(get(row, ["order time"])),
          platform: "moomoo",
          ticker: ticker as Ticker,
          type: tradeType,
          amountMyr: Math.round(fillAmountUsd * USD_TO_MYR * 100) / 100,
          amountUsd: Math.round(fillAmountUsd * 100) / 100,
          priceUsd: Math.round(fillPrice * 100) / 100,
          ...(fillQty > 0 ? { units: fillQty } : {}),
          feeMyr: Math.round(totalFeesUsd * USD_TO_MYR * 100) / 100,
          fee: totalFeesUsd,
          feeCurrency: "USD",
          exchangeRate: USD_TO_MYR,
        }, row);
      })
      .filter((trade): trade is Trade => trade !== null);
  }

  // Fallback: original simple CSV format
  return rows
    .map((row): Trade | null => {
      const ticker = get(row, ["ticker"]).toUpperCase();
      if (!ticker) {
        if (strict) throw new ImportValidationError(`CSV[${rowNumbers.get(row)}].ticker`, "Invalid ticker.");
        return null;
      }
      return checked({
        id: createId("csv"),
        date: get(row, ["date"]),
        platform: get(row, ["platform"]) || fallbackPlatform,
        ticker: ticker as Ticker,
        amountMyr: numeric(row, ["amount(rm)", "amount myr", "total(rm)"]),
        amountUsd: numeric(row, ["amount (usd)", "amount usd"]),
        priceUsd: numeric(row, ["price/unit (usd)", "price usd"]),
        units: numeric(row, ["units", "fill qty", "quantity"]) || undefined,
        type: (get(row, ["type"]) || "DCA") as TradeType,
        feeMyr: numeric(row, ["fee", "fee myr"]),
        exchangeRate: numeric(row, ["exchange rate", "fx rate", "usd/myr"]) || (numeric(row, ["amount (usd)", "amount usd"]) > 0 && numeric(row, ["amount(rm)", "amount myr", "total(rm)"]) > 0 ? numeric(row, ["amount(rm)", "amount myr", "total(rm)"]) / numeric(row, ["amount (usd)", "amount usd"]) : getUsdToMyr()),
      }, row);
    })
    .filter((trade): trade is Trade => trade !== null);
}

export interface CsvImportPreview {
  newTrades: Trade[];
  suspectedDuplicates: Trade[];
}

/** FX and MYR fees can change after a real settlement is recorded. Compare
 * the execution in its original currency, not today's converted cost. */
function executionKey(trade: Trade): string {
  const { currency, amount, price } = tradeAmounts(trade);
  const parsed = Date.parse(trade.date.replace(/\//g, "-"));
  const date = Number.isFinite(parsed) ? new Date(parsed).toISOString() : trade.date;
  return JSON.stringify([trade.platform.trim().toLowerCase(), trade.ticker.trim().toUpperCase(),
    trade.type === "Sell" ? "Sell" : "Buy", date, currency,
    Number(amount.toPrecision(12)), Number(price.toPrecision(12)), Number(tradeUnits(trade).toPrecision(12))]);
}

/** Match occurrences, rather than a Set: two equal fills in one file can be
 * two genuine orders. Only their already-recorded occurrences are suspects. */
export function previewCsvTrades(existing: readonly Trade[], incoming: readonly Trade[]): CsvImportPreview {
  const remaining = new Map<string, number>();
  existing.forEach((trade) => { const key = executionKey(trade); remaining.set(key, (remaining.get(key) ?? 0) + 1); });
  const preview: CsvImportPreview = { newTrades: [], suspectedDuplicates: [] };
  for (const trade of incoming) {
    const key = executionKey(trade);
    const count = remaining.get(key) ?? 0;
    if (count > 0) { remaining.set(key, count - 1); preview.suspectedDuplicates.push(trade); }
    else preview.newTrades.push(trade);
  }
  return preview;
}
