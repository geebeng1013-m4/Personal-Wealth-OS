/**
 * Turning the model's answer into a form draft.
 *
 * Every function here is pure and total. The model is prompted for one JSON
 * action object, but a free model returns prose, fences, or a near-miss shape
 * often enough that leniency has to be built in rather than hoped for: the
 * extractor strips fences and takes the first balanced object, and the
 * validator then checks every field against the real WealthState.
 *
 * The rule the whole file is built around: a field that cannot be read
 * confidently is DROPPED and named in `unresolved`, never guessed. A dropped
 * field falls back to the form's own default, which the user sees and can fix.
 * A guessed one would be a wrong number the user has no reason to look at.
 */

import type { LedgerCategory, TradeType, WealthState } from "../../models";
import type { AssistantDraft, DraftResult, LedgerDraft, TradeDraft } from "./assistantTypes";

const TRADE_TYPES: readonly TradeType[] = ["DCA", "Dip Buy", "Manual Buy", "Sell"];

/** Tickers the portfolio form always offers, on top of the user's custom ones. */
const BUILT_IN_TICKERS = ["VOO", "QQQM"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Find the first complete JSON object in a block of text.
 *
 * Scans for a balanced `{...}` while respecting string literals and escapes, so
 * a brace inside a note ("dinner {with friends}") does not end the object
 * early. Markdown fences and any prose around the object are ignored.
 *
 * Returns the parsed value, or null when there is no readable object.
 */
export function extractJsonObject(text: string): unknown | null {
  if (typeof text !== "string") return null;

  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * A usable money/quantity figure, or undefined.
 *
 * Accepts a number or a numeric string (the model sometimes quotes them), and
 * tolerates thousands separators and a currency prefix, because those show up
 * even when the prompt forbids them. Rejects zero, negatives and anything
 * non-finite: a trade or an entry of zero is not something the user asked to
 * record, and a negative would flip the meaning of the form.
 */
export function toPositiveNumber(value: unknown): number | undefined {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const cleaned = value.replace(/[,\s]/g, "").replace(/^(?:RM|MYR|USD|\$)/i, "");
    if (cleaned.length === 0) return undefined;
    n = Number(cleaned);
  } else {
    return undefined;
  }
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Whether a figure the model proposed actually appears in what the user wrote.
 *
 * This is the guard that stops fabricated money reaching a form, and it exists
 * because the model was caught doing exactly that: told "bought 500 usd of VOO
 * at 520.50", it invented a USD/MYR rate of 4.40, filled amountMyr with 2200,
 * and noted in the record that the rate was "estimated". A guessed ringgit cost
 * silently rewrites the cost basis behind a holding — the one number this app
 * exists to keep honest — and it does so in a field the user has no reason to
 * re-check. The same reasoning covers a units count derived by dividing amount
 * by price: arithmetic the model was not asked for is still a figure the user
 * never stated.
 *
 * So: a number the user did not say does not get filled in. It is dropped, and
 * the confirmation card names it, which is how the user learns to supply it.
 *
 * Matching is deliberately literal. Thousands separators are normalised away,
 * both the plain and the two-decimal spelling are tried ("12.5" and "12.50"),
 * and a match must sit on a digit boundary so "3" is not found inside "30".
 */
export function figureAppearsIn(value: number, sourceText: string): boolean {
  if (!Number.isFinite(value)) return false;
  const haystack = sourceText.replace(/[,_]/g, "");

  const spellings = new Set<string>([String(value), value.toFixed(2)]);
  // An integer written by the user as "500.00" is still the figure 500.
  if (Number.isInteger(value)) spellings.add(value.toFixed(0));

  for (const spelling of spellings) {
    const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![\\d.])${escaped}(?![\\d])`).test(haystack)) return true;
  }
  return false;
}

/**
 * A figure that is both usable AND traceable to the user's own words.
 *
 * `label` names the field for the "left blank" list on the confirmation card.
 */
function statedNumber(
  value: unknown,
  sourceText: string,
  label: string,
  dropped: string[],
): number | undefined {
  const parsed = toPositiveNumber(value);
  if (parsed === undefined) return undefined;
  if (figureAppearsIn(parsed, sourceText)) return parsed;
  dropped.push(label);
  return undefined;
}

function toText(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLength);
}

/** Today in the local timezone, as YYYY-MM-DD — the same shape a date input uses. */
export function localDateKey(now: Date): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * A calendar date the form can accept, or undefined.
 *
 * Must be YYYY-MM-DD, must be a real date (2026-02-31 is not), and must sit
 * within a year either side of today. The window is what catches a model that
 * resolved "last Friday" against its own training cut-off instead of the date
 * it was given — a 2024 entry silently filed under this month's spending is
 * exactly the kind of quiet wrongness this assistant must not produce.
 */
export function toDateKey(value: unknown, now: Date): string | undefined {
  const text = toText(value, 10);
  if (text === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;

  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }

  const yearMs = 365 * 24 * 60 * 60 * 1000;
  if (Math.abs(parsed.getTime() - now.getTime()) > yearMs) return undefined;

  return text;
}

/** Strip a leading emoji/icon and collapse whitespace, for name comparison. */
function comparable(value: string): string {
  return value.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "").trim().toLowerCase();
}

/**
 * Match a model-supplied name against a list of real records.
 *
 * Exact (case- and icon-insensitive) first, then a containment match in either
 * direction so "food" finds "Food & Drink" and "Maybank savings" finds
 * "Maybank". A containment match is only accepted when exactly one record
 * matches — two candidates mean we do not actually know which one was meant.
 */
export function matchByName<T>(name: string, items: readonly T[], nameOf: (item: T) => string): T | undefined {
  const needle = comparable(name);
  if (needle.length === 0) return undefined;

  const exact = items.filter((item) => comparable(nameOf(item)) === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact[0];

  const partial = items.filter((item) => {
    const hay = comparable(nameOf(item));
    return hay.length > 0 && (hay.includes(needle) || needle.includes(hay));
  });
  return partial.length === 1 ? partial[0] : undefined;
}

function buildLedgerDraft(object: Record<string, unknown>, state: WealthState, now: Date, sourceText: string): DraftResult {
  const rawType = toText(object.type, 20)?.toLowerCase();
  const type = rawType === "income" ? "income" : rawType === "expense" ? "expense" : undefined;
  if (type === undefined) {
    return { ok: false, reason: "I could not tell whether that was money in or money out." };
  }

  const amount = toPositiveNumber(object.amount);
  if (amount === undefined) {
    return { ok: false, reason: "I could not read an amount from that." };
  }
  // The amount IS the entry. An amount the user never said is not a field to
  // leave blank — it means the whole reading is wrong, so refuse it outright.
  if (!figureAppearsIn(amount, sourceText)) {
    return { ok: false, reason: "I could not find that amount in what you told me. Say the figure and I will fill it in." };
  }

  const unresolved: string[] = [];

  let categoryId: string | undefined;
  let categoryLabel: string | undefined;
  const categoryName = toText(object.category, 60);
  if (categoryName !== undefined) {
    const candidates: LedgerCategory[] = state.ledgerCategories.filter((category) => category.type === type);
    const match = matchByName(categoryName, candidates, (category) => category.label);
    if (match) {
      categoryId = match.id;
      categoryLabel = match.label;
    } else {
      categoryLabel = categoryName;
      unresolved.push(`category "${categoryName}"`);
    }
  }

  let accountId: string | undefined;
  let accountName: string | undefined;
  const accountRaw = toText(object.account, 60);
  if (accountRaw !== undefined) {
    const match = matchByName(accountRaw, state.ledgerAccounts, (account) => account.name);
    if (match) {
      accountId = match.id;
      accountName = match.name;
    } else {
      unresolved.push(`account "${accountRaw}"`);
    }
  }

  const draft: LedgerDraft = {
    kind: "ledger",
    type,
    amount,
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(categoryLabel !== undefined ? { categoryLabel } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
    ...(accountName !== undefined ? { accountName } : {}),
    date: toDateKey(object.date, now) ?? localDateKey(now),
    note: toText(object.note, 200) ?? "",
    unresolved,
    dropped: [],
  };
  return { ok: true, draft };
}

function buildTradeDraft(
  object: Record<string, unknown>,
  state: WealthState,
  now: Date,
  platforms: readonly string[],
  sourceText: string,
): DraftResult {
  const tickerRaw = toText(object.ticker, 20);
  if (tickerRaw === undefined) {
    return { ok: false, reason: "I could not tell which holding that was about." };
  }
  const ticker = tickerRaw.toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  if (ticker.length === 0) {
    return { ok: false, reason: "I could not read a valid ticker from that." };
  }

  const unresolved: string[] = [];

  const knownTickers = [...BUILT_IN_TICKERS, ...state.customTickers];
  const isCustomTicker = !knownTickers.some((known) => known.toUpperCase() === ticker);

  const typeRaw = toText(object.tradeType ?? object.type, 20);
  let tradeType: TradeType = "Manual Buy";
  if (typeRaw !== undefined) {
    const match = TRADE_TYPES.find((candidate) => candidate.toLowerCase() === typeRaw.toLowerCase());
    if (match) {
      tradeType = match;
    } else {
      unresolved.push(`trade type "${typeRaw}"`);
    }
  }

  const platformRaw = toText(object.platform, 60);
  let platform = platforms[0] ?? "Moomoo";
  let isCustomPlatform = false;
  if (platformRaw !== undefined) {
    const match = matchByName(platformRaw, platforms, (name) => name);
    if (match !== undefined) {
      platform = match;
    } else {
      platform = platformRaw;
      isCustomPlatform = true;
    }
  }

  // Every figure on a trade must be one the user actually said. This is where
  // an invented exchange-rate conversion gets thrown away instead of becoming
  // a holding's ringgit cost basis.
  const dropped: string[] = [];
  const amountMyr = statedNumber(object.amountMyr, sourceText, "MYR amount", dropped);
  const amountUsd = statedNumber(object.amountUsd, sourceText, "USD amount", dropped);
  const priceUsd = statedNumber(object.priceUsd, sourceText, "unit price", dropped);
  const units = statedNumber(object.units, sourceText, "quantity", dropped);
  const feeMyr = statedNumber(object.feeMyr, sourceText, "fee", dropped);

  if (amountMyr === undefined && amountUsd === undefined && units === undefined) {
    return { ok: false, reason: "I need at least an amount or a quantity to record a trade." };
  }

  const draft: TradeDraft = {
    kind: "trade",
    ticker,
    isCustomTicker,
    tradeType,
    platform,
    isCustomPlatform,
    date: toDateKey(object.date, now) ?? localDateKey(now),
    ...(amountMyr !== undefined ? { amountMyr } : {}),
    ...(amountUsd !== undefined ? { amountUsd } : {}),
    ...(priceUsd !== undefined ? { priceUsd } : {}),
    ...(units !== undefined ? { units } : {}),
    ...(feeMyr !== undefined ? { feeMyr } : {}),
    // The model likes to explain its own arithmetic here ("MYR estimated at
    // ~4.40"), which would be filed as if the user had written it.
    notes: toText(object.notes ?? object.note, 200) ?? "",
    unresolved,
    dropped,
  };
  return { ok: true, draft };
}

export interface ParseActionInput {
  /** The model's raw reply. */
  reply: string;
  /** What the user actually typed. Every figure is checked against this. */
  sourceText: string;
  state: WealthState;
  now: Date;
  /**
   * Passed in rather than derived here, so the assistant proposes a broker from
   * exactly the list the Portfolio form will accept.
   */
  platforms: readonly string[];
}

/** Read the model's reply as one action, resolved against the live state. */
export function parseAssistantAction({ reply, sourceText, state, now, platforms }: ParseActionInput): DraftResult {
  const parsed = extractJsonObject(reply);
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "I could not read that as something to record." };
  }

  const action = toText(parsed.action, 40)?.toLowerCase();

  if (action === "none" || action === undefined) {
    const reason = toText(parsed.reason, 200);
    return { ok: false, reason: reason ?? "I could not tell what to record from that." };
  }
  if (action === "ledger.entry") return buildLedgerDraft(parsed, state, now, sourceText);
  if (action === "portfolio.trade") return buildTradeDraft(parsed, state, now, platforms, sourceText);

  return { ok: false, reason: "That is not something I can record yet." };
}

/** Two decimals, grouped — matches how the app writes money elsewhere. */
function money(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * One line describing what will be filled in, for the confirmation card.
 *
 * States only what the draft actually carries. A field the model omitted is
 * absent here too, so the card never implies a value the form will not receive.
 */
export function describeDraft(draft: AssistantDraft): string {
  if (draft.kind === "ledger") {
    const parts = [
      draft.type === "income" ? "Income" : "Expense",
      money(draft.amount, "MYR"),
    ];
    if (draft.categoryLabel) parts.push(draft.categoryLabel);
    if (draft.accountName) parts.push(draft.accountName);
    parts.push(draft.date);
    if (draft.note) parts.push(`"${draft.note}"`);
    return parts.join(" · ");
  }

  const parts = [draft.tradeType, draft.ticker];
  if (draft.units !== undefined) parts.push(`${draft.units} units`);
  if (draft.amountUsd !== undefined) parts.push(money(draft.amountUsd, "USD"));
  if (draft.amountMyr !== undefined) parts.push(money(draft.amountMyr, "MYR"));
  if (draft.priceUsd !== undefined) parts.push(`@ ${money(draft.priceUsd, "USD")}`);
  if (draft.feeMyr !== undefined) parts.push(`fee ${money(draft.feeMyr, "MYR")}`);
  parts.push(draft.platform);
  parts.push(draft.date);
  return parts.join(" · ");
}

/** Which page a draft pre-fills. */
export function draftPage(draft: AssistantDraft): "ledger" | "portfolio" {
  return draft.kind === "ledger" ? "ledger" : "portfolio";
}
