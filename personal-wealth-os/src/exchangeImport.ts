/**
 * Reading currency conversions out of a broker's exchange history.
 *
 * There is no CSV export for these records — the broker shows them only as a
 * list on screen — so the input this has to cope with is whatever a user gets
 * from selecting that list and copying it. That text is a flat run of lines
 * with no delimiters and no header:
 *
 *   MYR
 *   USD
 *   Aug 9, 2026 22:06 MYT
 *   Completed
 *   4.85 USD
 *   20.00 MYR
 *
 * The first two lines are the direction (from, then to), and the two amounts
 * are listed received-first. Rather than trust that ordering, each amount is
 * matched to its own currency label, so a record still reads correctly if the
 * broker ever swaps the two lines around.
 *
 * IDS ARE DERIVED FROM THE CONTENT
 *
 * A conversion has no reference number here, and pasting the same history twice
 * is the normal way to add the few records made since last time. So the id is a
 * fingerprint of the record itself: re-pasting an overlapping range replaces
 * rather than duplicates, and the ringgit cost basis does not silently double.
 *
 * Pure: text in, records out. No fetching, no clock, no persistence.
 */
import type { CurrencyExchange, ExchangeDirection } from "./models";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Aug 9, 2026 22:06 MYT" → "2026-08-09". Null when the line is not a date. */
function parseDate(line: string): string | null {
  const match = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(line.trim());
  if (!match) return null;
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

/** "20.00 MYR" or "MYR 20.00" → { amount, currency }. Null when neither. */
function parseAmount(line: string): { amount: number; currency: string } | null {
  const text = line.trim();
  const trailing = /^([\d,]+(?:\.\d+)?)\s*(MYR|USD)$/i.exec(text);
  const leading = /^(MYR|USD)\s*([\d,]+(?:\.\d+)?)$/i.exec(text);
  const raw = trailing ? trailing[1] : leading ? leading[2] : null;
  const currency = trailing ? trailing[2] : leading ? leading[1] : null;
  if (raw === null || currency === null) return null;
  const amount = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: currency.toUpperCase() };
}

function isCurrencyLine(line: string): boolean {
  const text = line.trim().toUpperCase();
  return text === "MYR" || text === "USD";
}

/**
 * A stable id for a conversion, from the facts that identify it.
 *
 * Two genuinely separate conversions of the same size on the same day would
 * collide, so a counter separates them — and stays stable as long as the paste
 * covers them in the same order, which it does, being a statement.
 */
function exchangeId(date: string, myr: number, usd: number, occurrence: number): string {
  const suffix = occurrence > 0 ? `-${occurrence + 1}` : "";
  return `fx-${date}-${myr.toFixed(2)}-${usd.toFixed(2)}${suffix}`;
}

/**
 * Parse a pasted exchange history into conversion records.
 *
 * Anything that is not a complete, completed conversion is skipped rather than
 * guessed at: a half-parsed record here would put an invented rate onto a real
 * holding, which is the whole failure this feature exists to end. Records come
 * back oldest-first, since the broker lists them newest-first.
 */
export function exchangesFromText(text: string): CurrencyExchange[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const records: CurrencyExchange[] = [];
  const seenCounts = new Map<string, number>();

  for (let index = 0; index < lines.length; index++) {
    const date = parseDate(lines[index]);
    if (date === null) continue;

    // Direction sits on the two lines above the date.
    const from = lines[index - 2];
    const to = lines[index - 1];
    if (from === undefined || to === undefined) continue;
    if (!isCurrencyLine(from) || !isCurrencyLine(to)) continue;
    const direction: ExchangeDirection = from.toUpperCase() === "MYR" ? "myr-to-usd" : "usd-to-myr";

    // The two amounts follow, possibly after a status line. Only completed
    // conversions moved any money.
    let myrAmount = 0;
    let usdAmount = 0;
    let status = "";
    for (let scan = index + 1; scan < lines.length && scan <= index + 5; scan++) {
      // A new record has started; this one is incomplete.
      if (parseDate(lines[scan]) !== null) break;
      const amount = parseAmount(lines[scan]);
      if (amount === null) {
        if (!isCurrencyLine(lines[scan])) status = lines[scan].toLowerCase();
        continue;
      }
      if (amount.currency === "MYR" && myrAmount === 0) myrAmount = amount.amount;
      if (amount.currency === "USD" && usdAmount === 0) usdAmount = amount.amount;
      if (myrAmount > 0 && usdAmount > 0) break;
    }

    if (myrAmount <= 0 || usdAmount <= 0) continue;
    if (status !== "" && !status.startsWith("completed")) continue;

    const occurrence = seenCounts.get(`${date}|${myrAmount}|${usdAmount}`) ?? 0;
    seenCounts.set(`${date}|${myrAmount}|${usdAmount}`, occurrence + 1);
    records.push({
      id: exchangeId(date, myrAmount, usdAmount, occurrence),
      date,
      direction,
      myrAmount,
      usdAmount,
    });
  }

  return records.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/**
 * Merge freshly parsed records into the stored ones.
 *
 * Content-derived ids make this an upsert: a paste that overlaps what is
 * already stored updates those records instead of adding a second copy of the
 * same money.
 */
export function mergeExchanges(
  existing: CurrencyExchange[],
  incoming: CurrencyExchange[],
): CurrencyExchange[] {
  const byId = new Map(existing.map((record) => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
