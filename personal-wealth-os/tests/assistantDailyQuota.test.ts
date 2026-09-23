import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  DAILY_LIMITS,
  bearerToken,
  countsFrom,
  dayKeyFor,
  decideQuota,
  nextResetAt,
  usageDocId,
} from "../functions/src/quota";
import { resolveCors } from "../functions/src/cors";

/** 2026-09-23 09:00 Malaysia time (01:00 UTC) — well inside a local day. */
const MORNING = Date.UTC(2026, 8, 23, 1, 0, 0);
/** 2026-09-23 23:30 Malaysia time (15:30 UTC) — late in the same local day. */
const LATE = Date.UTC(2026, 8, 23, 15, 30, 0);

// --- the day is Malaysia's, not UTC --------------------------------------

test("quota: the day key follows Malaysian time, so a local evening is still today", () => {
  assert.equal(dayKeyFor(MORNING), "2026-09-23");
  assert.equal(dayKeyFor(LATE), "2026-09-23", "23:30 local is not tomorrow yet");
});

test("quota: the local evening after UTC midnight is already the next day", () => {
  // 2026-09-23 17:00 UTC = 2026-09-24 01:00 in Malaysia.
  assert.equal(dayKeyFor(Date.UTC(2026, 8, 23, 17, 0, 0)), "2026-09-24");
});

test("quota: the reset is the next local midnight, and it is always ahead", () => {
  const reset = nextResetAt(MORNING);
  assert.equal(reset, Date.UTC(2026, 8, 23, 16, 0, 0), "midnight in Malaysia = 16:00 UTC");
  assert.ok(reset > MORNING);
  assert.ok(nextResetAt(LATE) > LATE, "still ahead half an hour before midnight");
  assert.equal(dayKeyFor(nextResetAt(MORNING)), "2026-09-24", "the reset opens the next day");
});

test("quota: the document id is one account's one day", () => {
  assert.equal(usageDocId("abc123", MORNING), "abc123_2026-09-23");
  assert.notEqual(usageDocId("abc123", MORNING), usageDocId("xyz789", MORNING));
});

// --- reading a stored document, which is untrusted like any other input ---

test("quota: a missing document or missing field counts as nothing used", () => {
  for (const data of [undefined, null, {}, { help: undefined }, "nonsense", 42]) {
    assert.deepEqual(countsFrom(data), { help: 0, fill: 0 }, JSON.stringify(data));
  }
});

test("quota: a value that is not a sane count reads as 0, never as unlimited", () => {
  for (const bad of ["12", -3, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
    assert.equal(countsFrom({ help: bad }).help, 0, String(bad));
  }
  assert.equal(countsFrom({ help: 7.9 }).help, 7, "a fraction floors, it does not round up");
});

test("quota: the two modes are counted separately", () => {
  assert.deepEqual(countsFrom({ help: 4, fill: 9 }), { help: 4, fill: 9 });
});

// --- the decision ---------------------------------------------------------

test("quota: a fresh day allows the turn and reports what is left", () => {
  const decision = decideQuota(undefined, "help", MORNING);
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.equal(decision.limit, DAILY_LIMITS.help);
  assert.equal(decision.remaining, DAILY_LIMITS.help - 1, "this turn is the one being spent");
});

test("quota: the last turn inside the limit is allowed, the next is not", () => {
  const last = decideQuota({ help: DAILY_LIMITS.help - 1 }, "help", MORNING);
  assert.equal(last.allowed, true);
  if (last.allowed) assert.equal(last.remaining, 0);

  const over = decideQuota({ help: DAILY_LIMITS.help }, "help", MORNING);
  assert.equal(over.allowed, false);
  if (over.allowed) return;
  assert.equal(over.resetAt, nextResetAt(MORNING), "it says when it comes back");
});

test("quota: a count above the limit stays refused, it does not wrap round", () => {
  assert.equal(decideQuota({ help: DAILY_LIMITS.help + 500 }, "help", MORNING).allowed, false);
});

test("quota: running out of Ask does not stop Record", () => {
  const data = { help: DAILY_LIMITS.help, fill: 0 };
  assert.equal(decideQuota(data, "help", MORNING).allowed, false);
  assert.equal(decideQuota(data, "fill", MORNING).allowed, true, "recording is a separate bucket");
});

test("quota: yesterday's count does not follow the account into today", () => {
  // The count lives in a document keyed by day, so a new day reads nothing.
  assert.notEqual(usageDocId("u1", MORNING), usageDocId("u1", nextResetAt(MORNING)));
  assert.equal(decideQuota(undefined, "help", nextResetAt(MORNING)).allowed, true);
});

// --- the token header -----------------------------------------------------

test("quota: a bearer token is read from either capitalisation, trimmed", () => {
  assert.equal(bearerToken({ authorization: "Bearer abc.def.ghi" }), "abc.def.ghi");
  assert.equal(bearerToken({ Authorization: "bearer  abc.def.ghi  " }), "abc.def.ghi");
  assert.equal(bearerToken({ authorization: ["Bearer first", "Bearer second"] }), "first");
});

test("quota: anything that is not a bearer token reads as no token at all", () => {
  for (const bad of [{}, { authorization: "" }, { authorization: "Basic abc" }, { authorization: "Bearer" }, { authorization: "Bearer   " }, { authorization: undefined }]) {
    assert.equal(bearerToken(bad), "", JSON.stringify(bad));
  }
});

test("quota: CORS lets the Authorization header through, or no token ever arrives", () => {
  const decision = resolveCors("https://wealthup.cc");
  assert.match(decision.headers["Access-Control-Allow-Headers"], /Authorization/);
  assert.match(decision.headers["Access-Control-Allow-Headers"], /Content-Type/);
});
