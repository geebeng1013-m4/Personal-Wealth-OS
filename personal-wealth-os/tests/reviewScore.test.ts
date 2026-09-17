import assert from "node:assert/strict";
import { test } from "./testHarness";
import { formatScore, scoreOutOfTen, upsertReview } from "../src/reviewScore";

/**
 * T-5c: review scores read out of 10, whichever scale they were saved on, and
 * saving a month that is already on record replaces it instead of listing it
 * twice.
 */

const review = (month: string, score: number, notes = "") => ({
  id: `review-${month}-${score}`, month, income: 2800, spending: 1400, dcaDone: true, disciplineScore: score, notes,
});

test("review score: an out-of-10 score stays as it is", () => {
  assert.equal(scoreOutOfTen(9), 9);
  assert.equal(scoreOutOfTen(10), 10);
  assert.equal(formatScore(8.5), "8.5");
});

test("review score: a 0–100 score from the calculation reads out of 10", () => {
  assert.equal(scoreOutOfTen(88), 8.8);
  assert.equal(scoreOutOfTen(100), 10);
  assert.equal(formatScore(90), "9");
});

test("review score: nonsense never escapes the 0–10 range", () => {
  assert.equal(scoreOutOfTen(-4), 0);
  assert.equal(scoreOutOfTen(Number.NaN), 0);
  assert.equal(scoreOutOfTen(250), 10);
});

test("save review: a new month goes to the top", () => {
  const { reviews, replaced } = upsertReview([review("2026-07", 10)], review("2026-08", 9));
  assert.equal(replaced, false);
  assert.deepEqual(reviews.map((item) => item.month), ["2026-08", "2026-07"]);
});

test("save review: the same month is replaced in place, not listed twice", () => {
  const start = [review("2026-08", 9, "first"), review("2026-07", 10)];
  const { reviews, replaced } = upsertReview(start, review("2026-08", 7, "second"));
  assert.equal(replaced, true);
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].notes, "second");
  assert.equal(reviews[1].month, "2026-07");
});
