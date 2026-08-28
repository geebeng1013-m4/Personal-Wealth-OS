import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  buildAssetHistory,
  findDrawdowns,
  holdingOutcome,
  triggerHistory,
  type PricePoint,
} from "../src/drawdowns";

/**
 * The Context panel exists to answer "has this happened before, and what
 * happened next". Every number it shows is computed here, so these tests care
 * about the shapes that mislead: a decline still under way, a series too short
 * to measure, and the difference between a dip and a drawdown.
 */

const DAY = 86_400_000;
const series = (closes: number[], startAt = Date.UTC(2020, 0, 1)): PricePoint[] =>
  closes.map((close, index) => ({ time: startAt + index * DAY, close }));

// --- Drawdowns -------------------------------------------------------------

test("drawdown: a fall and full recovery is one completed episode", () => {
  const [dd, ...rest] = findDrawdowns(series([100, 90, 80, 90, 100, 105]));
  assert.equal(rest.length, 0);
  assert.ok(Math.abs(dd.depth - -0.20) < 1e-9);
  assert.equal(dd.daysToTrough, 2);
  assert.equal(dd.daysToRecover, 2);
  assert.ok(dd.recoveredAt !== null);
});

test("drawdown: a decline still under water reports no recovery, not a fast one", () => {
  // The episode a holder is most likely sitting in. Dropping it, or dating its
  // recovery to the last close, would flatter the record exactly where it
  // matters most.
  const [dd] = findDrawdowns(series([100, 90, 70, 75, 80]));
  assert.ok(Math.abs(dd.depth - -0.30) < 1e-9);
  assert.equal(dd.recoveredAt, null);
  assert.equal(dd.daysToRecover, null);
});

test("drawdown: a dip shallower than the threshold is not an episode", () => {
  assert.deepEqual(findDrawdowns(series([100, 95, 92, 100, 110]), 0.10), []);
  assert.equal(findDrawdowns(series([100, 95, 92, 100, 110]), 0.05).length, 1);
});

test("drawdown: a new high closes one episode and starts the clock again", () => {
  const found = findDrawdowns(series([100, 80, 100, 120, 96, 120]));
  assert.equal(found.length, 2);
  assert.ok(Math.abs(found[0].depth - -0.20) < 1e-9);
  assert.ok(Math.abs(found[1].depth - -0.20) < 1e-9);
  // Non-overlapping: the second starts at the higher peak, not the first one.
  assert.ok(found[1].startedAt > found[0].recoveredAt!);
});

test("drawdown: depth is measured from the peak, not from the start of the file", () => {
  // A series that rises before it falls must not report the fall against its
  // opening price.
  const [dd] = findDrawdowns(series([100, 200, 150]));
  assert.ok(Math.abs(dd.depth - -0.25) < 1e-9, `${dd.depth}`);
});

test("drawdown: an empty or flat series has nothing to report", () => {
  assert.deepEqual(findDrawdowns([]), []);
  assert.deepEqual(findDrawdowns(series([100, 100, 100])), []);
});

// --- Holding outcomes ------------------------------------------------------

test("holding: outcomes are measured across every start date the window fits", () => {
  const outcome = holdingOutcome(series([1, 2, 3, 4, 5, 6]), 1, 2);
  assert.ok(outcome !== null);
  assert.equal(outcome.samples, 4);       // starts at index 0..3, span 2
  assert.equal(outcome.lossRate, 0);
  // Windows are 1->3, 2->4, 3->5, 4->6; the weakest is the last of them.
  assert.ok(Math.abs(outcome.worst - (6 / 4 - 1)) < 1e-9);
  assert.ok(Math.abs(outcome.best - (3 / 1 - 1)) < 1e-9);
});

test("holding: a series too short for one window reports nothing, not zero", () => {
  // A loss rate computed from no samples would read as "never lost money".
  assert.equal(holdingOutcome(series([1, 2, 3]), 5, 252), null);
  assert.equal(holdingOutcome(series([1, 2, 3]), 1, 10), null);
});

test("holding: the loss rate counts only genuine losses", () => {
  const outcome = holdingOutcome(series([100, 50, 100, 200]), 1, 1);
  assert.ok(outcome !== null);
  // 100→50 loss, 50→100 gain, 100→200 gain.
  assert.equal(outcome.samples, 3);
  assert.ok(Math.abs(outcome.lossRate - 1 / 3) < 1e-9);
});

// --- Trigger history -------------------------------------------------------

test("trigger: a threshold counts only declines that actually reached it", () => {
  const drawdowns = findDrawdowns(series([100, 88, 100, 78, 100, 70, 100]), 0.10);
  assert.equal(triggerHistory(drawdowns, 0.10).occurrences, 3);
  assert.equal(triggerHistory(drawdowns, 0.15).occurrences, 2);
  assert.equal(triggerHistory(drawdowns, 0.25).occurrences, 1);
  assert.equal(triggerHistory(drawdowns, 0.40).occurrences, 0);
});

test("trigger: a threshold never reached has no recovery time to report", () => {
  const drawdowns = findDrawdowns(series([100, 85, 100]), 0.10);
  const history = triggerHistory(drawdowns, 0.50);
  assert.equal(history.occurrences, 0);
  assert.equal(history.medianRecoveryDays, null);
});

test("trigger: an unrecovered episode counts as an occurrence but not as a recovery", () => {
  const drawdowns = findDrawdowns(series([100, 60, 65]), 0.10);
  const history = triggerHistory(drawdowns, 0.10);
  assert.equal(history.occurrences, 1);
  assert.equal(history.medianRecoveryDays, null, "it has not recovered, so it times nothing");
});

// --- Assembly --------------------------------------------------------------

test("history: junk points are dropped and the rest is put in order", () => {
  const messy: PricePoint[] = [
    { time: Date.UTC(2020, 0, 3), close: 90 },
    { time: Date.UTC(2020, 0, 1), close: 100 },
    { time: Date.UTC(2020, 0, 2), close: Number.NaN },
    { time: Number.NaN, close: 50 },
    { time: Date.UTC(2020, 0, 4), close: 0 },
  ];
  const history = buildAssetHistory(messy, { threshold: 0.05 });
  assert.ok(history !== null);
  assert.equal(history.observations, 2);
  assert.ok(history.firstAt < history.lastAt);
});

test("history: too little data is null rather than a confident nothing", () => {
  assert.equal(buildAssetHistory([]), null);
  assert.equal(buildAssetHistory([{ time: 1, close: 100 }]), null);
});

test("history: the current drawdown is distance below the high, and never positive", () => {
  const atHigh = buildAssetHistory(series([100, 80, 120]))!;
  assert.equal(atHigh.currentDrawdown, 0);
  const belowHigh = buildAssetHistory(series([100, 120, 90]))!;
  assert.ok(Math.abs(belowHigh.currentDrawdown - -0.25) < 1e-9);
});

test("history: the real shape of the last decade survives the pipeline", () => {
  // A compressed stand-in for VOO's record: five declines past 10%, the worst
  // a third of the fund's value, all of them recovered. What the panel must not
  // do is lose one, or merge two into a single longer one.
  const path = [
    ...Array.from({ length: 40 }, (_, i) => 100 + i),      // rise to 139
    ...Array.from({ length: 20 }, (_, i) => 139 - i * 2.5), // fall to ~91 (-34%)
    ...Array.from({ length: 60 }, (_, i) => 91 + i),        // recover past 139
  ];
  const history = buildAssetHistory(series(path), { threshold: 0.10, holdingYears: [1] })!;
  assert.equal(history.drawdowns.length, 1);
  assert.ok(history.drawdowns[0].depth < -0.30);
  assert.ok(history.drawdowns[0].recoveredAt !== null);
  assert.equal(history.currentDrawdown, 0, "it ends at a new high");
});
