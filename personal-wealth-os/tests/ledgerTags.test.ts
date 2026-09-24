import assert from "node:assert/strict";
import { test } from "./testHarness";
import { categoryDrift, ledgerTagsByCategory } from "../src/ledgerTags";
import type { LedgerTransaction } from "../src/models";

const NOW = new Date("2026-09-24T00:00:00.000Z");

/** Days before NOW, so a fixture reads as "three days ago" not as a timestamp. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

let sequence = 0;
function expense(note: string, categoryId: string, overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  sequence += 1;
  return {
    id: `t-${sequence}`,
    type: "expense",
    amount: 5,
    date: daysAgo(1),
    note,
    categoryId,
    accountId: "acc-tng",
    ...overrides,
  };
}

function tags(transactions: LedgerTransaction[], categoryId: string, options = {}) {
  return ledgerTagsByCategory(transactions, { now: NOW, ...options }).get(categoryId) ?? [];
}

// --- nothing to offer -------------------------------------------------------

test("tags: no transactions means no tags, not an empty strip per category", () => {
  assert.equal(ledgerTagsByCategory([], { now: NOW }).size, 0);
});

test("tags: a category with only unusable rows is absent entirely", () => {
  const rows = [
    expense("   ", "food"),
    expense("no category", "", { categoryId: "" }),
    { ...expense("income row", "food"), type: "income" as const },
    { ...expense("transfer row", "food"), type: "transfer" as const },
  ];
  assert.equal(ledgerTagsByCategory(rows, { now: NOW }).size, 0);
});

// --- category scoping -------------------------------------------------------

test("tags: tags belong to the category they were recorded under", () => {
  const rows = [
    expense("toll-kemuning", "transport"),
    expense("toll-kemuning", "transport"),
    expense("chagee-boya", "food"),
    expense("chagee-boya", "food"),
  ];
  const result = ledgerTagsByCategory(rows, { now: NOW });
  assert.deepEqual(result.get("transport")?.map((tag) => tag.value), ["toll-kemuning"]);
  assert.deepEqual(result.get("food")?.map((tag) => tag.value), ["chagee-boya"]);
});

test("tags: a stray miscategorised note ranks below that category's regulars", () => {
  // Two accidental Food tolls against a genuine Food regular: the real one
  // must come first, so a slip cannot take over the front of the strip.
  const rows = [
    ...Array.from({ length: 6 }, () => expense("bbt2 kopitiam-kopi ice", "food")),
    expense("toll-sunway", "food"),
    expense("toll-sunway", "food"),
  ];
  assert.equal(tags(rows, "food")[0]?.value, "bbt2 kopitiam-kopi ice");
});

// --- the two sources --------------------------------------------------------

test("tags: a note used twice is offered", () => {
  const rows = [expense("spotify", "fun"), expense("spotify", "fun")];
  assert.deepEqual(tags(rows, "fun").map((tag) => tag.value), ["spotify"]);
});

test("tags: a one-off is still offered while it is recent", () => {
  // The cold-start half: nothing has repeated yet on day two, but what was
  // recorded yesterday is exactly what is likely to be recorded again.
  const rows = [expense("lee n jay-checkup", "health")];
  assert.deepEqual(tags(rows, "health").map((tag) => tag.value), ["lee n jay-checkup"]);
});

test("tags: an old one-off falls off once newer ones crowd it out", () => {
  const rows = [
    expense("forgotten shop-thing", "food", { date: daysAgo(40) }),
    ...["a", "b", "c"].map((name) => expense(`${name}-x`, "food", { date: daysAgo(2) })),
  ];
  const values = tags(rows, "food", { recentPerCategory: 3 }).map((tag) => tag.value);
  assert.ok(!values.includes("forgotten shop-thing"), values.join(", "));
});

test("tags: a repeat survives even when it is not among the most recent", () => {
  const rows = [
    expense("toll-kemuning", "transport", { date: daysAgo(30) }),
    expense("toll-kemuning", "transport", { date: daysAgo(29) }),
    ...["a", "b", "c"].map((name) => expense(`${name}-x`, "transport", { date: daysAgo(1) })),
  ];
  const values = tags(rows, "transport", { recentPerCategory: 3 }).map((tag) => tag.value);
  assert.ok(values.includes("toll-kemuning"), values.join(", "));
});

test("tags: anything older than the window is ignored", () => {
  const rows = [
    expense("ancient-thing", "food", { date: daysAgo(200) }),
    expense("ancient-thing", "food", { date: daysAgo(199) }),
  ];
  assert.deepEqual(tags(rows, "food"), []);
});

test("tags: a future-dated row is ignored rather than ranked first", () => {
  const rows = [
    expense("tomorrow-thing", "food", { date: daysAgo(-3) }),
    expense("tomorrow-thing", "food", { date: daysAgo(-2) }),
  ];
  assert.deepEqual(tags(rows, "food"), []);
});

test("tags: an unparseable date drops that row, not the whole category", () => {
  const rows = [
    expense("broken", "food", { date: "not a date" }),
    expense("chagee-boya", "food"),
    expense("chagee-boya", "food"),
  ];
  assert.deepEqual(tags(rows, "food").map((tag) => tag.value), ["chagee-boya"]);
});

// --- full notes and merchant prefixes ---------------------------------------

test("tags: a merchant written with varying detail also gets a prefix tag", () => {
  const rows = [
    expense("bbt2 kopitiam-kopi ice", "food"),
    expense("bbt2 kopitiam-kopi ice", "food"),
    expense("bbt2 kopitiam-malamian", "food"),
  ];
  const result = tags(rows, "food");
  assert.deepEqual(
    result.map((tag) => `${tag.value}|${tag.kind}`),
    ["bbt2 kopitiam-|prefix", "bbt2 kopitiam-kopi ice|full", "bbt2 kopitiam-malamian|full"],
  );
});

test("tags: a merchant always written the same way gets no prefix duplicate", () => {
  // "cline-wealthup" five times: "cline-" would fill strictly less of the same
  // note and sit right beside it.
  const rows = Array.from({ length: 5 }, () => expense("cline-wealthup", "learning"));
  assert.deepEqual(tags(rows, "learning").map((tag) => tag.kind), ["full"]);
});

test("tags: a prefix tag ends with the separator so the caret lands after it", () => {
  const rows = [
    expense("chagee-boya", "food"),
    expense("chagee-boya", "food"),
    expense("chagee-dahongpao", "food"),
  ];
  const prefix = tags(rows, "food").find((tag) => tag.kind === "prefix");
  assert.equal(prefix?.value, "chagee-");
});

test("tags: a note without a separator produces no prefix tag", () => {
  const rows = [expense("parking", "transport"), expense("parking", "transport")];
  assert.deepEqual(tags(rows, "transport").map((tag) => tag.kind), ["full"]);
});

// --- what a tag carries -----------------------------------------------------

test("tags: the account is the one used most with that note", () => {
  const rows = [
    expense("bbt2 kopitiam-sausage", "food", { accountId: "acc-tng" }),
    expense("bbt2 kopitiam-sausage", "food", { accountId: "acc-tng" }),
    expense("bbt2 kopitiam-sausage", "food", { accountId: "acc-cash" }),
  ];
  assert.equal(tags(rows, "food")[0]?.accountId, "acc-tng");
});

test("tags: a note never recorded against an account carries none", () => {
  const rows = [
    expense("mystery-thing", "food", { accountId: undefined }),
    expense("mystery-thing", "food", { accountId: undefined }),
  ];
  assert.equal(tags(rows, "food")[0]?.accountId, undefined);
});

test("tags: the amount hint comes from the most recent use", () => {
  const rows = [
    expense("toll-kemuning", "transport", { amount: 4, date: daysAgo(9) }),
    expense("toll-kemuning", "transport", { amount: 2, date: daysAgo(1) }),
  ];
  assert.equal(tags(rows, "transport")[0]?.lastAmount, 2);
});

test("tags: an invalid amount leaves the hint out instead of showing NaN", () => {
  const rows = [
    expense("odd-row", "food", { amount: 3, date: daysAgo(5) }),
    expense("odd-row", "food", { amount: Number.NaN, date: daysAgo(1) }),
  ];
  assert.equal(tags(rows, "food")[0]?.lastAmount, undefined);
});

test("tags: the label follows the newest spelling of the same note", () => {
  // Written "Toll-Kemuning" at first, "toll-kemuning" since; the habit as it
  // stands now is what the strip should show.
  const rows = [
    expense("Toll-Kemuning", "transport", { date: daysAgo(20) }),
    expense("toll-kemuning", "transport", { date: daysAgo(2) }),
  ];
  const result = tags(rows, "transport");
  assert.equal(result.length, 1, "case and spacing alone must not split a tag");
  assert.equal(result[0]?.value, "toll-kemuning");
  assert.equal(result[0]?.count, 2);
});

// --- ordering ---------------------------------------------------------------

test("tags: the most used comes first, and ties fall to the most recent", () => {
  const rows = [
    ...Array.from({ length: 3 }, () => expense("often-x", "food", { date: daysAgo(10) })),
    expense("tie-older", "food", { date: daysAgo(8) }),
    expense("tie-older", "food", { date: daysAgo(7) }),
    expense("tie-newer", "food", { date: daysAgo(3) }),
    expense("tie-newer", "food", { date: daysAgo(2) }),
  ];
  assert.deepEqual(
    tags(rows, "food").filter((tag) => tag.kind === "full").map((tag) => tag.value),
    ["often-x", "tie-newer", "tie-older"],
  );
});

test("tags: the same input always gives the same order", () => {
  const rows = [
    expense("a-one", "food", { date: daysAgo(4) }),
    expense("a-one", "food", { date: daysAgo(4) }),
    expense("b-two", "food", { date: daysAgo(4) }),
    expense("b-two", "food", { date: daysAgo(4) }),
  ];
  const first = tags(rows, "food").map((tag) => tag.value);
  const second = tags([...rows].reverse(), "food").map((tag) => tag.value);
  assert.deepEqual(first, second);
});

// --- category drift ---------------------------------------------------------

function settled(merchant: string, categoryId: string, times: number, stray = 0, strayCategoryId = "other"): LedgerTransaction[] {
  return [
    ...Array.from({ length: times }, () => expense(`${merchant}-thing`, categoryId)),
    ...Array.from({ length: stray }, () => expense(`${merchant}-thing`, strayCategoryId)),
  ];
}

test("drift: a merchant with a settled home says so when filed elsewhere", () => {
  // "toll" went to Transport 17 of 19 times in the real ledger this is drawn from.
  const result = categoryDrift(settled("toll", "transport", 17, 2, "food"), "toll-sunway", "food", { now: NOW });
  assert.equal(result?.categoryId, "transport");
  assert.equal(result?.uses, 19);
  assert.equal(result?.underExpected, 17);
});

test("drift: nothing is said when the entry already agrees", () => {
  assert.equal(categoryDrift(settled("toll", "transport", 17, 2, "food"), "toll-sunway", "transport", { now: NOW }), null);
});

test("drift: a genuinely mixed merchant is left alone", () => {
  // "chagee": 4 Food to 2 Other. A nudge here would be wrong a third of the time.
  assert.equal(categoryDrift(settled("chagee", "food", 4, 2), "chagee-boya", "other", { now: NOW }), null);
});

test("drift: too few uses to have a habit yet", () => {
  // "weige" is 2 and 2 — four rows cannot establish anything.
  assert.equal(categoryDrift(settled("weige", "food", 2, 2), "weige-chicken rice", "other", { now: NOW }), null);
  // Even a perfect run stays quiet until there is enough of it.
  assert.equal(categoryDrift(settled("newshop", "food", 4), "newshop-x", "other", { now: NOW }), null);
  assert.ok(categoryDrift(settled("newshop", "food", 5), "newshop-x", "other", { now: NOW }));
});

test("drift: a note with no merchant half still matches on the whole note", () => {
  const rows = Array.from({ length: 5 }, () => expense("parking", "transport"));
  assert.equal(categoryDrift(rows, "parking", "food", { now: NOW })?.categoryId, "transport");
});

test("drift: an unknown merchant, an empty note or no category say nothing", () => {
  const rows = settled("toll", "transport", 17);
  assert.equal(categoryDrift(rows, "somewhere new-x", "food", { now: NOW }), null);
  assert.equal(categoryDrift(rows, "   ", "food", { now: NOW }), null);
  assert.equal(categoryDrift(rows, "toll-sunway", "", { now: NOW }), null);
});

test("drift: the row being edited does not vote on its own category", () => {
  const rows = settled("toll", "transport", 5);
  const target = rows[0] as LedgerTransaction;
  // Four left is under the threshold, so excluding the row silences the hint.
  assert.equal(categoryDrift(rows, "toll-x", "food", { now: NOW, excludeTransactionId: target.id }), null);
});

test("drift: history outside the window does not count", () => {
  const rows = Array.from({ length: 6 }, () => expense("toll-kemuning", "transport", { date: daysAgo(200) }));
  assert.equal(categoryDrift(rows, "toll-kemuning", "food", { now: NOW }), null);
});
