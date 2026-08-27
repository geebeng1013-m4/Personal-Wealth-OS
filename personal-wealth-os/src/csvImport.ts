// CSV trade-import parsing — split out of ui.ts since it's pure data
// transformation with no DOM dependency (see moomoo Universal Account exports
// and the simple fallback CSV format below).
import { createId } from "./state";
import { getUsdToMyr } from "./market";
import type { Trade, TradeType, Ticker } from "./models";

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

export function recordsFromCsv(text: string): Trade[] {
  const [headers = [], ...rows] = parseCsv(stripBom(text));
  const normalized = headers.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  const get = (row: string[], names: string[]) => {
    const idx = normalized.findIndex((h) => names.includes(h));
    return idx >= 0 ? row[idx] ?? "" : "";
  };

  // Detect Moomoo Universal Account format by checking for "Symbol" and "Side" columns
  const isMoomooFormat = normalized.includes("symbol") && normalized.includes("side");

  if (isMoomooFormat) {
    const USD_TO_MYR = getUsdToMyr(); // dynamic rate, prefetched in main.ts
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
        const fillPrice = parseMoomooFillPrice(get(row, ["filled@avg price"]))
          || Number(get(row, ["order price"]))
          || 0;
        const fillQty = Number(get(row, ["fill qty"])) || 0;
        const totalFeesUsd = Number(get(row, ["total"]))
          || (Number(get(row, ["platform fees"])) || 0) + (Number(get(row, ["stamp duty"])) || 0);

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
          ...(fillQty > 0 ? { units: fillQty } : {}),
          feeMyr: Math.round(totalFeesUsd * USD_TO_MYR * 100) / 100,
          exchangeRate: USD_TO_MYR,
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
        units: Number(get(row, ["units", "fill qty", "quantity"])) || undefined,
        type: (get(row, ["type"]) || "DCA") as TradeType,
        feeMyr: Number(get(row, ["fee", "fee myr"])) || 0,
        exchangeRate: Number(get(row, ["exchange rate", "fx rate", "usd/myr"])) || (Number(get(row, ["amount (usd)", "amount usd"])) > 0 ? Number(get(row, ["amount(rm)", "amount myr", "total(rm)"])) / Number(get(row, ["amount (usd)", "amount usd"])) : getUsdToMyr()),
      };
    })
    .filter((trade): trade is Trade => trade !== null);
}
