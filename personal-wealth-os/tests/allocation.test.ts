import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  allocateIncome,
  allocateMonth,
  cashMonths,
  essentialMonthlyNeed,
  getAllocationRow,
  normalizePercentSteps,
  percentTotal,
  validatePlan,
  type AllocationPlan,
} from "../src/allocation";

/**
 * The waterfall exists so that a month with less money coming in still covers
 * living costs first, and so that a gig worker paid weekly ends the month in
 * the same place as someone paid once. Both are behaviours a plain percentage
 * split gets wrong, so both are pinned here.
 */

/** Variable income: living costs first, then the rest split. */
const variable: AllocationPlan = {
  steps: [
    { id: "survival", name: "Survival", kind: "fill", value: 1500 },
    { id: "growth", name: "Growth", kind: "pct", value: 60 },
    { id: "freedom", name: "Freedom", kind: "pct", value: 40 },
  ],
  overflowStepId: "growth",
};

/** Fixed income: every layer is a fixed amount, the rest overflows. */
const fixed: AllocationPlan = {
  steps: [
    { id: "survival", name: "Survival", kind: "fill", value: 1800 },
    { id: "growth", name: "Growth", kind: "fill", value: 600 },
    { id: "freedom", name: "Freedom", kind: "fill", value: 300 },
  ],
  overflowStepId: "growth",
};

const got = (result: ReturnType<typeof allocateMonth>, id: string) => getAllocationRow(result, id)!.got;

test("allocation: a full month fills the essential layer, then splits the rest", () => {
  const result = allocateMonth(variable, 3000);
  assert.equal(got(result, "survival"), 1500);
  assert.equal(got(result, "growth"), 900); // 60% of the 1,500 left
  assert.equal(got(result, "freedom"), 600); // 40% of the same 1,500
  assert.equal(result.shortfall, 0);
  assert.equal(result.unassigned, 0);
});

test("allocation: percentages divide one pot, they do not compound", () => {
  // If Freedom took 40% of what Growth left, it would get 240, not 600.
  const result = allocateMonth(variable, 3000);
  assert.equal(got(result, "growth") + got(result, "freedom"), 1500);
});

test("allocation: a thin month fills what it can and leaves the rest at zero", () => {
  const result = allocateMonth(variable, 1000);
  assert.equal(got(result, "survival"), 1000);
  assert.equal(got(result, "growth"), 0);
  assert.equal(got(result, "freedom"), 0);
  // The gap is reported, not covered — the caller decides what may fund it.
  assert.equal(result.shortfall, 500);
});

test("allocation: money surviving the last step goes to the overflow step", () => {
  const result = allocateMonth(fixed, 3000);
  assert.equal(got(result, "survival"), 1800);
  assert.equal(got(result, "freedom"), 300);
  assert.equal(got(result, "growth"), 900); // 600 by rule + 300 overflow
  assert.equal(getAllocationRow(result, "growth")!.overflow, 300);
  assert.equal(result.unassigned, 0);
});

test("allocation: with no overflow step the remainder is reported, not hidden", () => {
  const result = allocateMonth({ ...fixed, overflowStepId: undefined }, 3000);
  assert.equal(result.unassigned, 300);
  assert.equal(getAllocationRow(result, "growth")!.got, 600);
});

test("allocation: a gross step takes its share of everything that came in", () => {
  // Tax withholding: 15% of the month's income, whatever the layers below need.
  const withTax: AllocationPlan = {
    steps: [
      { id: "tax", name: "Tax", kind: "gross", value: 15 },
      ...variable.steps,
    ],
    overflowStepId: "growth",
  };
  const good = allocateMonth(withTax, 4000);
  assert.equal(got(good, "tax"), 600);
  assert.equal(got(good, "survival"), 1500);

  // A thin month still withholds its share — that is the point of the kind.
  const thin = allocateMonth(withTax, 1000);
  assert.equal(got(thin, "tax"), 150);
  assert.equal(got(thin, "survival"), 850);
  assert.equal(thin.shortfall, 650);
});

test("allocation: the essential layer is the first fill step, not simply the first step", () => {
  const withTax: AllocationPlan = {
    steps: [
      { id: "tax", name: "Tax", kind: "gross", value: 15 },
      { id: "survival", name: "Survival", kind: "fill", value: 1500 },
    ],
  };
  assert.equal(essentialMonthlyNeed(withTax), 1500);
  assert.equal(allocateMonth(withTax, 1000).shortfall, 650);
});

test("allocation: four weekly payments end the month where one payment would", () => {
  // The case a per-arrival percentage split gets wrong: 60% of each MYR 400
  // leaves Survival at 960 by month end, and the money is already invested.
  let soFar = 0;
  let survival = 0;
  let growth = 0;
  for (let week = 0; week < 4; week += 1) {
    const result = allocateIncome(variable, soFar, 400);
    survival += getAllocationRow(result, "survival")!.added;
    growth += getAllocationRow(result, "growth")!.added;
    soFar = result.income;
  }
  assert.equal(soFar, 1600);
  assert.equal(survival, 1500);
  assert.equal(growth, 60); // 60% of the 100 that survived, not 60% of 1,600

  const oneGo = allocateMonth(variable, 1600);
  assert.equal(got(oneGo, "survival"), survival);
  assert.equal(got(oneGo, "growth"), growth);
});

test("allocation: a fixed base plus variable income equals the same total in one go", () => {
  // Mixed income needs no second engine: the base arrives first and the
  // freelance work continues from wherever the waterfall stopped.
  const base = allocateIncome(variable, 0, 1200);
  assert.equal(getAllocationRow(base, "survival")!.got, 1200);
  assert.equal(base.shortfall, 300);

  const rest = allocateIncome(variable, base.income, 1800);
  assert.equal(rest.shortfall, 0);

  const oneGo = allocateMonth(variable, 3000);
  assert.deepEqual(rest.rows.map((row) => row.got), oneGo.rows.map((row) => row.got));
});

test("allocation: added reports this arrival, got reports the month", () => {
  const first = allocateIncome(variable, 0, 1000);
  const second = allocateIncome(variable, first.income, 800);
  const survival = getAllocationRow(second, "survival")!;
  assert.equal(survival.got, 1500); // the month
  assert.equal(survival.added, 500); // this payment's part of it
  assert.equal(getAllocationRow(second, "growth")!.added, 180); // 60% of 300
});

test("allocation: percentages over 100 starve the steps at the bottom", () => {
  const greedy: AllocationPlan = {
    steps: [
      { id: "survival", name: "Survival", kind: "fill", value: 1500 },
      { id: "growth", name: "Growth", kind: "pct", value: 80 },
      { id: "freedom", name: "Freedom", kind: "pct", value: 50 },
    ],
  };
  const result = allocateMonth(greedy, 3000);
  assert.equal(got(result, "growth"), 1200); // 80% of 1,500
  assert.equal(got(result, "freedom"), 300); // asked 750, only 300 was left
  assert.equal(getAllocationRow(result, "freedom")!.want, 750);
  assert.equal(result.unassigned, 0);
});

test("allocation: percentages under 100 leave money for the overflow step", () => {
  const shy: AllocationPlan = {
    steps: [
      { id: "survival", name: "Survival", kind: "fill", value: 1500 },
      { id: "growth", name: "Growth", kind: "pct", value: 60 },
      { id: "freedom", name: "Freedom", kind: "pct", value: 20 },
    ],
  };
  const loose = allocateMonth(shy, 3000);
  assert.equal(loose.unassigned, 300); // 20% of 1,500 never claimed

  const caught = allocateMonth({ ...shy, overflowStepId: "growth" }, 3000);
  assert.equal(caught.unassigned, 0);
  assert.equal(got(caught, "growth"), 1200);
});

test("allocation: zero income allocates nothing and reports the whole essential need", () => {
  const result = allocateMonth(variable, 0);
  assert.deepEqual(result.rows.map((row) => row.got), [0, 0, 0]);
  assert.equal(result.shortfall, 1500);
  assert.equal(result.unassigned, 0);
});

test("allocation: negative and non-finite figures are treated as nothing", () => {
  assert.equal(allocateMonth(variable, -500).income, 0);
  assert.equal(allocateIncome(variable, -100, 3000).income, 3000);
  const broken: AllocationPlan = {
    steps: [{ id: "survival", name: "Survival", kind: "fill", value: Number.NaN }],
  };
  assert.equal(allocateMonth(broken, 1000).rows[0].got, 0);
});

test("allocation: an empty plan leaves every ringgit unassigned", () => {
  const result = allocateMonth({ steps: [] }, 2000);
  assert.deepEqual(result.rows, []);
  assert.equal(result.unassigned, 2000);
  assert.equal(result.shortfall, 0);
});

test("allocation: a single layer takes what it asks for and no more", () => {
  const solo: AllocationPlan = {
    steps: [{ id: "survival", name: "Survival", kind: "fill", value: 1500 }],
  };
  const result = allocateMonth(solo, 2000);
  assert.equal(result.rows[0].got, 1500);
  assert.equal(result.unassigned, 500);
});

test("allocation: cash cover is measured against the essential layer", () => {
  assert.equal(essentialMonthlyNeed(variable), 1500);
  assert.equal(cashMonths(3000, variable), 2);
  assert.equal(cashMonths(-50, variable), 0);
  // No essential layer means the question has no answer, not an infinite one.
  assert.equal(cashMonths(3000, { steps: [{ id: "a", name: "A", kind: "pct", value: 100 }] }), 0);
});

test("allocation: validatePlan reports what is wrong without wording it", () => {
  assert.deepEqual(validatePlan(variable), []);
  assert.deepEqual(validatePlan({ steps: [] }), [{ code: "no-steps" }]);

  const codes = (plan: AllocationPlan) => validatePlan(plan).map((warning) => warning.code);
  assert.deepEqual(codes({ ...variable, overflowStepId: "gone" }), ["no-overflow-step"]);
  assert.ok(codes({
    steps: [
      { id: "growth", name: "Growth", kind: "pct", value: 60 },
      { id: "freedom", name: "Freedom", kind: "pct", value: 30 },
    ],
    overflowStepId: "growth",
  }).includes("essential-is-percent"));

  const short = validatePlan({
    steps: [
      { id: "survival", name: "Survival", kind: "fill", value: 1500 },
      { id: "growth", name: "Growth", kind: "pct", value: 95 },
    ],
    overflowStepId: "growth",
  });
  assert.deepEqual(short, [{ code: "percent-total-not-100", value: 95 }]);

  assert.ok(codes({
    steps: [
      { id: "same", name: "One", kind: "fill", value: 100 },
      { id: "same", name: "Two", kind: "fill", value: -50 },
    ],
    overflowStepId: "same",
  }).includes("duplicate-step-id"));
});

test("allocation: normalizing keeps the shape of the split and leaves fills alone", () => {
  const skewed: AllocationPlan = {
    steps: [
      { id: "survival", name: "Survival", kind: "fill", value: 1500 },
      { id: "growth", name: "Growth", kind: "pct", value: 60 },
      { id: "freedom", name: "Freedom", kind: "pct", value: 20 },
    ],
    overflowStepId: "growth",
  };
  const fixedUp = normalizePercentSteps(skewed);
  assert.equal(percentTotal(fixedUp), 100);
  assert.equal(fixedUp.steps[0].value, 1500); // fills untouched
  assert.equal(fixedUp.steps[1].value, 75);
  assert.equal(fixedUp.steps[2].value, 25);
  // The original plan is not mutated.
  assert.equal(skewed.steps[1].value, 60);
  // Nothing to scale stays as it is rather than dividing by zero.
  assert.deepEqual(normalizePercentSteps({ steps: [] }).steps, []);
});

test("allocation: the same inputs always give the same result", () => {
  const once = allocateMonth(variable, 2750);
  const twice = allocateMonth(variable, 2750);
  assert.deepEqual(once, twice);
});
