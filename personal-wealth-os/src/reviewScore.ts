/**
 * Monthly review scores and saving a review.
 *
 * The discipline score is shown out of 10. monthlyClose computes it out of 100,
 * and reviews saved before T-5c hold that 0–100 figure, while the demo history
 * was written out of 10 — so a stored score above 10 is read as out of 100.
 * A score of exactly 10 or less is already out of 10.
 */

import type { WealthState } from "./models";

type Review = WealthState["reviews"][number];

/** A stored score (either scale) as a number out of 10, to one decimal. */
export function scoreOutOfTen(raw: number): number {
  const value = Number.isFinite(raw) ? (raw > 10 ? raw / 10 : raw) : 0;
  return Math.round(Math.max(0, Math.min(10, value)) * 10) / 10;
}

/** "9", "8.5" — the number before "/10". */
export function formatScore(raw: number): string {
  const value = scoreOutOfTen(raw);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Save a review. A month already on record is replaced where it stands
 * instead of being listed twice; a new month goes to the top.
 */
export function upsertReview(reviews: Review[], review: Review): { reviews: Review[]; replaced: boolean } {
  const index = reviews.findIndex((item) => item.month === review.month);
  if (index === -1) return { reviews: [review, ...reviews], replaced: false };
  const next = [...reviews];
  next[index] = review;
  return { reviews: next, replaced: true };
}
