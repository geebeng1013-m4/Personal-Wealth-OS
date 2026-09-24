/**
 * Quick-entry tags — the notes you already wrote, offered back to you.
 *
 * Every expense in this ledger carries a note, written as `merchant-detail`
 * ("bbt2 kopitiam-kopi ice"). Those notes repeat: a handful of shops account
 * for most rows. So the fastest way to record the next one is not to type it
 * again but to tap what you typed before.
 *
 * TAGS BELONG TO A CATEGORY
 *
 * The strip is shown under the note field once a category is picked, so the
 * tags are grouped per category: picking Transport offers toll and parking,
 * picking Food offers the kopitiam. Two things follow from that. The list
 * stays short — the busiest category here has around a dozen tags, most have
 * two or three. And a one-off miscategorisation cannot take over: a note filed
 * under the wrong category twice ranks below that category's real regulars and
 * never reaches the front of the strip.
 *
 * TWO KINDS OF TAG
 *
 * A "full" tag is a whole note that repeated ("toll-kemuning"): tapping it
 * fills the note completely. A "prefix" tag is just the merchant, ending in
 * the separator ("chagee-"): tapping it fills the half you always write and
 * leaves the caret after the dash for the half that changes. Full notes alone
 * would cover fewer rows; merchants alone would always leave typing to do.
 * Both are ranked together by how often they were used.
 *
 * A prefix tag is only worth offering when the merchant was written with two
 * or more different details. When every visit to a shop carries the same note,
 * the full tag already fills it and the prefix would be a strictly worse
 * duplicate sitting next to it.
 *
 * COUNTS ARE FOR RANKING, NOT FOR DISPLAY
 *
 * `count` orders the strip. It is deliberately not part of the label: the tag
 * shows what will be written into the note and nothing else.
 *
 * Pure: transactions in, tags out. No DOM, no storage, no clock of its own —
 * the caller passes `now`, so the same input always gives the same output.
 */
import type { LedgerTransaction } from "./models";

/** The separator this ledger's notes use between merchant and detail. */
const SEPARATOR = "-";

export interface LedgerTag {
  /**
   * What goes into the note field when the tag is tapped. A prefix tag ends
   * with the separator, which is also how the UI can tell the two apart
   * without reading `kind`.
   */
  value: string;
  kind: "full" | "prefix";
  categoryId: string;
  /** The account used most often with this tag; undefined when never set. */
  accountId?: string;
  /**
   * The amount of the most recent transaction behind this tag. A hint the UI
   * may show — never pre-filled into the form, because an amount that is
   * almost right is worse than an empty field.
   */
  lastAmount?: number;
  /** How many transactions back this tag. Ranking input, not a label. */
  count: number;
  /** ISO date of the most recent transaction behind this tag. */
  lastUsed: string;
}

export interface LedgerTagOptions {
  /** Defaults to the current time. Passed in so results stay reproducible. */
  now?: Date;
  /**
   * How far back to look. A merchant visited twice last year is no longer a
   * regular, and an unbounded window would keep it on the strip forever.
   */
  windowDays?: number;
  /**
   * Besides the repeats, this many of the most recently used notes per
   * category are offered as well. Without it a fresh ledger shows nothing for
   * days — nothing has repeated yet — while "what you recorded yesterday" is
   * useful immediately. Recency alone degrades as the list of merchants grows,
   * so the two sources are merged rather than swapped.
   */
  recentPerCategory?: number;
}

const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_RECENT_PER_CATEGORY = 8;
/** Below this a note has not repeated, so only recency can offer it. */
const REPEAT_THRESHOLD = 2;

interface Aggregate {
  value: string;
  count: number;
  lastUsed: string;
  lastUsedAt: number;
  lastAmount?: number;
  accounts: Map<string, number>;
  /** Distinct full notes seen under a merchant; only meaningful for prefixes. */
  variants: Set<string>;
}

/** Notes differing only in case or spacing are the same note. */
function normalizeNote(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "bbt2 kopitiam-kopi ice" → "bbt2 kopitiam". Empty when there is no merchant. */
function merchantOf(note: string): string {
  const index = note.indexOf(SEPARATOR);
  return index > 0 ? note.slice(0, index).trim() : "";
}

function usableRow(transaction: LedgerTransaction): boolean {
  return (
    transaction.type === "expense" &&
    typeof transaction.categoryId === "string" &&
    transaction.categoryId.length > 0 &&
    typeof transaction.note === "string" &&
    transaction.note.trim().length > 0
  );
}

function record(bucket: Map<string, Aggregate>, key: string, value: string, transaction: LedgerTransaction, at: number, variant: string): void {
  let entry = bucket.get(key);
  if (!entry) {
    entry = { value, count: 0, lastUsed: transaction.date, lastUsedAt: -Infinity, accounts: new Map(), variants: new Set() };
    bucket.set(key, entry);
  }
  entry.count += 1;
  entry.variants.add(variant);
  if (transaction.accountId) {
    entry.accounts.set(transaction.accountId, (entry.accounts.get(transaction.accountId) ?? 0) + 1);
  }
  // The newest row wins the spelling shown, the amount hint and the date: when
  // a merchant's name is written a new way, the strip should follow the habit
  // as it is now rather than how it started.
  if (at >= entry.lastUsedAt) {
    entry.lastUsedAt = at;
    entry.lastUsed = transaction.date;
    entry.value = value;
    const amount = Number(transaction.amount);
    entry.lastAmount = Number.isFinite(amount) && amount > 0 ? amount : undefined;
  }
}

function mostUsedAccount(accounts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [accountId, count] of accounts) {
    if (count > bestCount) {
      best = accountId;
      bestCount = count;
    }
  }
  return best;
}

function toTag(entry: Aggregate, kind: LedgerTag["kind"], categoryId: string): LedgerTag {
  const accountId = mostUsedAccount(entry.accounts);
  return {
    value: entry.value,
    kind,
    categoryId,
    ...(accountId ? { accountId } : {}),
    ...(entry.lastAmount === undefined ? {} : { lastAmount: entry.lastAmount }),
    count: entry.count,
    lastUsed: entry.lastUsed,
  };
}

/** Most used first; ties broken by most recent, then by text so it is stable. */
function byRank(a: LedgerTag, b: LedgerTag): number {
  if (b.count !== a.count) return b.count - a.count;
  const recency = Date.parse(b.lastUsed) - Date.parse(a.lastUsed);
  if (recency !== 0 && Number.isFinite(recency)) return recency;
  return a.value.localeCompare(b.value);
}

/**
 * The quick-entry tags for each category, best first.
 *
 * Returns every tag worth offering; how many of them fit on screen — and what
 * goes behind a "more" control — is the caller's decision.
 */
export function ledgerTagsByCategory(
  transactions: readonly LedgerTransaction[],
  options: LedgerTagOptions = {},
): Map<string, LedgerTag[]> {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const recentPerCategory = options.recentPerCategory ?? DEFAULT_RECENT_PER_CATEGORY;
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const fullByCategory = new Map<string, Map<string, Aggregate>>();
  const prefixByCategory = new Map<string, Map<string, Aggregate>>();

  for (const transaction of transactions) {
    if (!usableRow(transaction)) continue;
    const at = Date.parse(transaction.date);
    // An unparseable date cannot be ranked or windowed, and guessing one would
    // put the row in the wrong place; skipping it loses one tag, not the strip.
    if (!Number.isFinite(at) || at < cutoff || at > now.getTime()) continue;

    const categoryId = transaction.categoryId as string;
    const note = (transaction.note as string).trim();
    const normalized = normalizeNote(note);

    let fullBucket = fullByCategory.get(categoryId);
    if (!fullBucket) fullByCategory.set(categoryId, (fullBucket = new Map()));
    record(fullBucket, normalized, note, transaction, at, normalized);

    const merchant = merchantOf(note);
    if (!merchant) continue;
    let prefixBucket = prefixByCategory.get(categoryId);
    if (!prefixBucket) prefixByCategory.set(categoryId, (prefixBucket = new Map()));
    record(prefixBucket, normalizeNote(merchant), `${merchant}${SEPARATOR}`, transaction, at, normalized);
  }

  const result = new Map<string, LedgerTag[]>();
  for (const [categoryId, fullBucket] of fullByCategory) {
    const chosen = new Map<string, LedgerTag>();

    // Source one: notes that repeated.
    for (const entry of fullBucket.values()) {
      if (entry.count >= REPEAT_THRESHOLD) chosen.set(entry.value, toTag(entry, "full", categoryId));
    }

    // Source two: the most recent notes, repeated or not.
    const recent = [...fullBucket.values()]
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, recentPerCategory);
    for (const entry of recent) {
      if (!chosen.has(entry.value)) chosen.set(entry.value, toTag(entry, "full", categoryId));
    }

    // Merchants, but only where the detail actually varies.
    for (const entry of prefixByCategory.get(categoryId)?.values() ?? []) {
      if (entry.count < REPEAT_THRESHOLD || entry.variants.size < 2) continue;
      if (!chosen.has(entry.value)) chosen.set(entry.value, toTag(entry, "prefix", categoryId));
    }

    const tags = [...chosen.values()].sort(byRank);
    if (tags.length > 0) result.set(categoryId, tags);
  }

  return result;
}
