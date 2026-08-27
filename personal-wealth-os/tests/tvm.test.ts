import assert from "node:assert/strict";
import { test } from "./testHarness";
import {
  calculateFutureValue,
  calculateInflationAdjustedValue,
  calculateMonthlyContribution,
  calculateTimeToGoal,
  roundMoney,
  MAX_AMOUNT,
  MAX_YEARS,
} from "../src/tvm";
import { calculateInvestmentGrowth } from "../src/calculator/investmentGrowth";

const close = (actual: number, expected: number, tolerance: number, label = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label} expected ~${expected}, got ${actual} (tolerance ${tolerance})`);

// --- A. Future Value -------------------------------------------------------

test("tvm/FV: normal case matches the closed-form annuity", () => {
  // PV 1000 @ 8%/yr for 10y with 100/month.
  const result = calculateFutureValue({ currentAmount: 1000, monthlyContribution: 100, annualReturnPercent: 8, years: 10 });
  assert.ok(result.ok);
  const i = 0.08 / 12, n = 120, f = Math.pow(1 + i, n);
  close(result.value!.futureValue, 1000 * f + 100 * ((f - 1) / i), 0.02, "future value");
  assert.equal(result.value!.totalContributed, 1000 + 100 * 120);
  close(result.value!.investmentGrowth, result.value!.futureValue - result.value!.totalContributed, 0.01);
  assert.equal(result.value!.months, 120);
});

test("tvm/FV: zero return means the balance is exactly what was put in", () => {
  const result = calculateFutureValue({ currentAmount: 1000, monthlyContribution: 100, annualReturnPercent: 0, years: 10 });
  assert.ok(result.ok);
  assert.equal(result.value!.futureValue, 13000);
  assert.equal(result.value!.totalContributed, 13000);
  assert.equal(result.value!.investmentGrowth, 0, "no growth without a return");
});

test("tvm/FV: zero contribution compounds the starting amount only", () => {
  const result = calculateFutureValue({ currentAmount: 1000, monthlyContribution: 0, annualReturnPercent: 12, years: 1 });
  assert.ok(result.ok);
  close(result.value!.futureValue, 1000 * Math.pow(1 + 0.01, 12), 0.01);
  assert.equal(result.value!.totalContributed, 1000);
});

test("tvm/FV: zero years returns the starting amount untouched", () => {
  const result = calculateFutureValue({ currentAmount: 5000, monthlyContribution: 300, annualReturnPercent: 8, years: 0 });
  assert.ok(result.ok);
  assert.equal(result.value!.futureValue, 5000);
  assert.equal(result.value!.totalContributed, 5000);
  assert.equal(result.value!.investmentGrowth, 0);
});

test("tvm/FV: agrees with the existing investment-growth calculator", () => {
  // Same convention: monthly compounding, end-of-period contributions.
  // Values chosen to survive that calculator's own input normalisation.
  const input = { currentAmount: 1000, monthlyContribution: 100, annualReturnPercent: 8, years: 10 };
  const tvm = calculateFutureValue(input);
  const existing = calculateInvestmentGrowth({
    initialDeposit: input.currentAmount,
    years: input.years,
    annualReturnPercent: input.annualReturnPercent,
    compoundingFrequency: "monthly",
    contributionAmount: input.monthlyContribution,
    contributionFrequency: "monthly",
  });
  assert.ok(tvm.ok);
  close(tvm.value!.futureValue, existing.totalBalance, 0.02, "closed form vs iteration");
  close(tvm.value!.totalContributed, existing.totalPrincipal, 0.02, "contributed vs principal");
});

test("tvm/FV: a negative return shrinks the balance without breaking", () => {
  const result = calculateFutureValue({ currentAmount: 10000, monthlyContribution: 0, annualReturnPercent: -12, years: 1 });
  assert.ok(result.ok);
  assert.ok(result.value!.futureValue < 10000);
  assert.ok(result.value!.investmentGrowth < 0, "a loss is reported as negative growth");
  assert.ok(Number.isFinite(result.value!.futureValue));
});

// --- B. Required Monthly Contribution --------------------------------------

test("tvm/PMT: normal case inverts the future-value formula", () => {
  const result = calculateMonthlyContribution({ currentAmount: 1000, targetAmount: 50000, annualReturnPercent: 8, years: 10 });
  assert.ok(result.ok);
  const pmt = result.value!.requiredMonthlyContribution;
  // Feeding it back through FV should land on the target.
  const back = calculateFutureValue({ currentAmount: 1000, monthlyContribution: pmt, annualReturnPercent: 8, years: 10 });
  assert.ok(back.ok);
  close(back.value!.futureValue, 50000, 1, "round-trip");
});

test("tvm/PMT: zero return splits the shortfall evenly across the months", () => {
  const result = calculateMonthlyContribution({ currentAmount: 1000, targetAmount: 13000, annualReturnPercent: 0, years: 10 });
  assert.ok(result.ok);
  assert.equal(result.value!.requiredMonthlyContribution, 100, "(13000-1000)/120");
  assert.equal(result.value!.estimatedInvestmentGrowth, 0);
});

test("tvm/PMT: an already-sufficient starting amount requires nothing", () => {
  const result = calculateMonthlyContribution({ currentAmount: 100000, targetAmount: 5000, annualReturnPercent: 8, years: 10 });
  assert.ok(result.ok);
  assert.equal(result.value!.requiredMonthlyContribution, 0);
  assert.equal(result.value!.alreadyOnTrack, true);
});

test("tvm/PMT: zero years is rejected rather than dividing by zero", () => {
  const result = calculateMonthlyContribution({ currentAmount: 1000, targetAmount: 5000, annualReturnPercent: 8, years: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === "years"));
});

// --- C. Time to Goal -------------------------------------------------------

test("tvm/NPER: normal case round-trips through future value", () => {
  const result = calculateTimeToGoal({ currentAmount: 1000, monthlyContribution: 100, targetAmount: 20000, annualReturnPercent: 8 });
  assert.ok(result.ok);
  assert.ok(result.value!.months > 0);
  assert.ok(result.value!.futureValueAtTarget >= 20000, "the reported value must actually meet the goal");
  assert.equal(result.value!.alreadyReached, false);
});

test("tvm/NPER: zero return divides the shortfall by the contribution", () => {
  const result = calculateTimeToGoal({ currentAmount: 0, monthlyContribution: 100, targetAmount: 1200, annualReturnPercent: 0 });
  assert.ok(result.ok);
  assert.equal(result.value!.months, 12);
  assert.equal(result.value!.years, 1);
});

test("tvm/NPER: an already-reached goal returns zero months", () => {
  const result = calculateTimeToGoal({ currentAmount: 50000, monthlyContribution: 100, targetAmount: 20000, annualReturnPercent: 8 });
  assert.ok(result.ok);
  assert.equal(result.value!.months, 0);
  assert.equal(result.value!.years, 0);
  assert.equal(result.value!.alreadyReached, true);
});

test("tvm/NPER: an impossible goal reports it instead of inventing a number", () => {
  // No contribution and no growth: the balance never moves.
  const result = calculateTimeToGoal({ currentAmount: 1000, monthlyContribution: 0, targetAmount: 50000, annualReturnPercent: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
  assert.ok(result.errors[0].message.toLowerCase().includes("cannot be reached"));
});

test("tvm/NPER: a goal beyond the horizon is reported, not silently truncated", () => {
  const result = calculateTimeToGoal({ currentAmount: 0, monthlyContribution: 1, targetAmount: MAX_AMOUNT, annualReturnPercent: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].message.includes(String(MAX_YEARS)));
});

test("tvm/NPER: a shrinking balance cannot reach a higher target", () => {
  const result = calculateTimeToGoal({ currentAmount: 1000, monthlyContribution: 0, targetAmount: 5000, annualReturnPercent: -10 });
  assert.equal(result.ok, false);
});

// --- D. Inflation ----------------------------------------------------------

test("tvm/inflation: normal case discounts by the compounded rate", () => {
  const result = calculateInflationAdjustedValue({ futureAmount: 100000, inflationRatePercent: 3, years: 10 });
  assert.ok(result.ok);
  close(result.value!.todaysPurchasingPower, 100000 / Math.pow(1.03, 10), 0.01);
  assert.equal(result.value!.inflationAdjustedValue, result.value!.todaysPurchasingPower);
  close(result.value!.purchasingPowerLoss, 100000 - result.value!.todaysPurchasingPower, 0.01);
  assert.ok(result.value!.purchasingPowerLossPercent > 0 && result.value!.purchasingPowerLossPercent < 1);
});

test("tvm/inflation: zero inflation preserves purchasing power exactly", () => {
  const result = calculateInflationAdjustedValue({ futureAmount: 100000, inflationRatePercent: 0, years: 10 });
  assert.ok(result.ok);
  assert.equal(result.value!.todaysPurchasingPower, 100000);
  assert.equal(result.value!.purchasingPowerLoss, 0);
  assert.equal(result.value!.purchasingPowerLossPercent, 0);
});

test("tvm/inflation: zero years leaves the amount unchanged", () => {
  const result = calculateInflationAdjustedValue({ futureAmount: 5000, inflationRatePercent: 5, years: 0 });
  assert.ok(result.ok);
  assert.equal(result.value!.todaysPurchasingPower, 5000);
});

test("tvm/inflation: deflation increases purchasing power", () => {
  const result = calculateInflationAdjustedValue({ futureAmount: 1000, inflationRatePercent: -5, years: 5 });
  assert.ok(result.ok);
  assert.ok(result.value!.todaysPurchasingPower > 1000);
  assert.ok(result.value!.purchasingPowerLoss < 0);
});

test("tvm/inflation: -100% inflation is rejected instead of dividing by zero", () => {
  const result = calculateInflationAdjustedValue({ futureAmount: 1000, inflationRatePercent: -100, years: 5 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === "inflationRatePercent"));
});

// --- Validation ------------------------------------------------------------

test("tvm/validation: negative amounts are rejected with a field-labelled message", () => {
  const result = calculateFutureValue({ currentAmount: -100, monthlyContribution: 100, annualReturnPercent: 8, years: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
  assert.equal(result.errors[0].field, "currentAmount");
  assert.ok(result.errors[0].message.length > 0);
});

test("tvm/validation: NaN input is rejected", () => {
  const result = calculateFutureValue({ currentAmount: Number.NaN, monthlyContribution: 100, annualReturnPercent: 8, years: 10 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === "currentAmount"));
});

test("tvm/validation: Infinity input is rejected", () => {
  for (const value of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = calculateFutureValue({ currentAmount: value, monthlyContribution: 0, annualReturnPercent: 8, years: 10 });
    assert.equal(result.ok, false, `${value} should be rejected`);
  }
});

test("tvm/validation: values beyond the supported range are rejected, not clamped", () => {
  const tooBig = calculateFutureValue({ currentAmount: MAX_AMOUNT * 10, monthlyContribution: 0, annualReturnPercent: 8, years: 10 });
  assert.equal(tooBig.ok, false);
  const tooLong = calculateFutureValue({ currentAmount: 100, monthlyContribution: 0, annualReturnPercent: 8, years: MAX_YEARS + 1 });
  assert.equal(tooLong.ok, false);
  const tooHot = calculateFutureValue({ currentAmount: 100, monthlyContribution: 0, annualReturnPercent: 1000, years: 10 });
  assert.equal(tooHot.ok, false);
});

test("tvm/validation: every invalid field is reported, not just the first", () => {
  const result = calculateFutureValue({ currentAmount: -1, monthlyContribution: -1, annualReturnPercent: 8, years: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test("tvm/validation: a failed result never carries a value", () => {
  const result = calculateTimeToGoal({ currentAmount: 0, monthlyContribution: 0, targetAmount: 100, annualReturnPercent: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
});

// --- Rounding and purity ---------------------------------------------------

test("tvm/rounding: monetary output has no floating-point garbage", () => {
  const result = calculateFutureValue({ currentAmount: 0.1, monthlyContribution: 0.2, annualReturnPercent: 7, years: 3 });
  assert.ok(result.ok);
  for (const value of [result.value!.futureValue, result.value!.totalContributed, result.value!.investmentGrowth]) {
    const decimals = (String(value).split(".")[1] ?? "").length;
    assert.ok(decimals <= 2, `${value} has more than 2 decimal places`);
  }
});

test("tvm/rounding: roundMoney is stable and finite", () => {
  assert.equal(roundMoney(10.005), 10.01);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(Number.NaN), 0);
  assert.equal(roundMoney(Number.POSITIVE_INFINITY), 0);
});

test("tvm: no result ever contains NaN, Infinity or undefined", () => {
  const results = [
    calculateFutureValue({ currentAmount: 1000, monthlyContribution: 100, annualReturnPercent: 8, years: 10 }),
    calculateFutureValue({ currentAmount: 0, monthlyContribution: 0, annualReturnPercent: 0, years: 0 }),
    calculateMonthlyContribution({ currentAmount: 0, targetAmount: 100000, annualReturnPercent: 5, years: 20 }),
    calculateTimeToGoal({ currentAmount: 500, monthlyContribution: 250, targetAmount: 100000, annualReturnPercent: 6 }),
    calculateInflationAdjustedValue({ futureAmount: 250000, inflationRatePercent: 3.5, years: 25 }),
  ];
  for (const result of results) {
    assert.ok(result.ok, "fixture should be valid");
    for (const [key, value] of Object.entries(result.value!)) {
      if (typeof value === "boolean") continue; // flags are legitimately boolean
      assert.equal(typeof value, "number", `${key} is not a number`);
      assert.ok(Number.isFinite(value as number), `${key} is not finite`);
    }
  }
});

test("tvm: calculations are pure and do not mutate their input", () => {
  const fv = { currentAmount: 1000, monthlyContribution: 100, annualReturnPercent: 8, years: 10 };
  const pmt = { currentAmount: 1000, targetAmount: 50000, annualReturnPercent: 8, years: 10 };
  const nper = { currentAmount: 1000, monthlyContribution: 100, targetAmount: 20000, annualReturnPercent: 8 };
  const inf = { futureAmount: 100000, inflationRatePercent: 3, years: 10 };
  const snapshots = [fv, pmt, nper, inf].map((o) => JSON.stringify(o));

  calculateFutureValue(fv);
  calculateMonthlyContribution(pmt);
  calculateTimeToGoal(nper);
  calculateInflationAdjustedValue(inf);

  [fv, pmt, nper, inf].forEach((o, i) => assert.equal(JSON.stringify(o), snapshots[i], "input was mutated"));
});

test("tvm: calculations are deterministic", () => {
  const input = { currentAmount: 1234.56, monthlyContribution: 250, annualReturnPercent: 7.5, years: 15 };
  assert.deepEqual(calculateFutureValue(input), calculateFutureValue(input));
});

test("tvm: calculations work from plain objects alone, with no app state", () => {
  // TVM must stay a standalone planning tool: no WealthState, no globals.
  // Passing bare literals and getting valid results demonstrates that.
  const results = [
    calculateFutureValue({ currentAmount: 1, monthlyContribution: 1, annualReturnPercent: 1, years: 1 }),
    calculateMonthlyContribution({ currentAmount: 1, targetAmount: 2, annualReturnPercent: 1, years: 1 }),
    calculateTimeToGoal({ currentAmount: 1, monthlyContribution: 1, targetAmount: 2, annualReturnPercent: 1 }),
    calculateInflationAdjustedValue({ futureAmount: 1, inflationRatePercent: 1, years: 1 }),
  ];
  for (const result of results) assert.equal(result.ok, true);
});

// --- Five-variable solver ---------------------------------------------------

import {
  solveTvm,
  periodicRate,
  annualRateFromPeriodic,
  PERIODS_PER_YEAR,
  type TvmSolveInput,
} from "../src/tvm";

/** A consistent set: PV -1000, PMT -100, 8%/yr monthly, 120 periods. */
function baseSolve(overrides: Partial<TvmSolveInput> = {}): TvmSolveInput {
  return {
    presentValue: -1000,
    payment: -100,
    futureValue: 0,
    annualRatePercent: 8,
    periods: 120,
    frequency: "monthly",
    timing: "end",
    rateKind: "nominal",
    ...overrides,
  };
}

test("solver: solves FV from the other four", () => {
  const r = solveTvm("futureValue", baseSolve());
  assert.ok(r.ok);
  const i = 0.08 / 12, n = 120, f = Math.pow(1 + i, n);
  close(r.value!.value, 1000 * f + 100 * ((f - 1) / i), 0.02, "FV");
});

test("solver: solves PV, and it round-trips back to the original FV", () => {
  const fv = solveTvm("futureValue", baseSolve());
  assert.ok(fv.ok);
  const back = solveTvm("presentValue", baseSolve({ futureValue: fv.value!.value }));
  assert.ok(back.ok);
  close(back.value!.value, -1000, 0.02, "PV round-trip");
});

test("solver: solves PMT, and it round-trips", () => {
  const fv = solveTvm("futureValue", baseSolve());
  assert.ok(fv.ok);
  const back = solveTvm("payment", baseSolve({ futureValue: fv.value!.value }));
  assert.ok(back.ok);
  close(back.value!.value, -100, 0.02, "PMT round-trip");
});

test("solver: solves N, and it round-trips", () => {
  const fv = solveTvm("futureValue", baseSolve());
  assert.ok(fv.ok);
  const back = solveTvm("periods", baseSolve({ futureValue: fv.value!.value }));
  assert.ok(back.ok);
  close(back.value!.value, 120, 0.01, "N round-trip");
});

test("solver: solves the rate numerically, and it round-trips", () => {
  const fv = solveTvm("futureValue", baseSolve());
  assert.ok(fv.ok);
  const back = solveTvm("annualRatePercent", baseSolve({ futureValue: fv.value!.value }));
  assert.ok(back.ok);
  close(back.value!.value, 8, 0.001, "rate round-trip");
});

test("solver: rate solving handles a plain doubling with no payments", () => {
  // 1000 grows to 2000 over 10 years, annually compounded -> ~7.177%
  const r = solveTvm("annualRatePercent", {
    presentValue: -1000, payment: 0, futureValue: 2000,
    annualRatePercent: 0, periods: 10,
    frequency: "annual", timing: "end", rateKind: "nominal",
  });
  assert.ok(r.ok);
  close(r.value!.value, (Math.pow(2, 1 / 10) - 1) * 100, 0.001, "implied rate");
});

test("solver: beginning-of-period payments are worth more than end-of-period", () => {
  const end = solveTvm("futureValue", baseSolve({ timing: "end" }));
  const begin = solveTvm("futureValue", baseSolve({ timing: "beginning" }));
  assert.ok(end.ok && begin.ok);
  assert.ok(begin.value!.value > end.value!.value, "annuity due accrues one extra period of growth");
  // Exactly one extra period of growth on the annuity portion.
  const i = 0.08 / 12;
  const annuityEnd = end.value!.value - 1000 * Math.pow(1 + i, 120);
  const annuityBegin = begin.value!.value - 1000 * Math.pow(1 + i, 120);
  close(annuityBegin, annuityEnd * (1 + i), 0.05, "due vs ordinary");
});

test("solver: zero rate is handled without dividing by zero", () => {
  const r = solveTvm("futureValue", baseSolve({ annualRatePercent: 0 }));
  assert.ok(r.ok);
  assert.equal(r.value!.value, 1000 + 100 * 120, "no growth, just the sum of cash flows");
});

test("solver: zero rate solving for N divides the shortfall by the payment", () => {
  const r = solveTvm("periods", {
    presentValue: 0, payment: -100, futureValue: 1200,
    annualRatePercent: 0, periods: 1,
    frequency: "monthly", timing: "end", rateKind: "nominal",
  });
  assert.ok(r.ok);
  close(r.value!.value, 12, 1e-9);
});

test("solver: compounding frequency changes the periodic rate", () => {
  assert.equal(periodicRate(12, "monthly", "nominal"), 0.01);
  assert.equal(periodicRate(12, "quarterly", "nominal"), 0.03);
  assert.equal(periodicRate(12, "annual", "nominal"), 0.12);
  assert.equal(PERIODS_PER_YEAR.daily, 365);
});

test("solver: effective and nominal quoting differ as expected", () => {
  // 12% effective annual, compounded monthly -> periodic rate below 1%.
  const effective = periodicRate(12, "monthly", "effective");
  const nominal = periodicRate(12, "monthly", "nominal");
  assert.ok(effective < nominal);
  close(Math.pow(1 + effective, 12) - 1, 0.12, 1e-12, "effective round-trip");
  close(annualRateFromPeriodic(effective, "monthly", "effective"), 12, 1e-9);
  close(annualRateFromPeriodic(nominal, "monthly", "nominal"), 12, 1e-9);
});

test("solver: an unreachable N is reported instead of returning a fake number", () => {
  // Everything positive: nothing is ever paid in, so FV is never reached.
  const r = solveTvm("periods", {
    presentValue: 1000, payment: 100, futureValue: 5000,
    annualRatePercent: 5, periods: 1,
    frequency: "monthly", timing: "end", rateKind: "nominal",
  });
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.ok(r.errors[0].message.toLowerCase().includes("sign"));
});

test("solver: an unsolvable rate is reported", () => {
  // No rate reconciles all-negative cash flows with a negative future value.
  const r = solveTvm("annualRatePercent", {
    presentValue: -1000, payment: -100, futureValue: -5000,
    annualRatePercent: 0, periods: 120,
    frequency: "monthly", timing: "end", rateKind: "nominal",
  });
  assert.equal(r.ok, false);
});

test("solver: invalid inputs are rejected per field", () => {
  const r = solveTvm("futureValue", baseSolve({ presentValue: Number.NaN, periods: 0 }));
  assert.equal(r.ok, false);
  const fields = r.errors.map((e) => e.field);
  assert.ok(fields.includes("presentValue"));
  assert.ok(fields.includes("periods"));
});

test("solver: the variable being solved is not itself validated", () => {
  // periods is garbage but we are solving for it, so it must be ignored.
  const r = solveTvm("periods", baseSolve({ periods: Number.NaN, futureValue: 20000 }));
  assert.ok(r.ok, "solving for a field should not validate that field");
});

test("solver: result reports all five variables plus totals", () => {
  const r = solveTvm("futureValue", baseSolve());
  assert.ok(r.ok);
  const v = r.value!;
  assert.equal(v.variable, "futureValue");
  assert.equal(v.presentValue, -1000);
  assert.equal(v.payment, -100);
  assert.equal(v.periods, 120);
  assert.equal(v.totalPayments, -100 * 120);
  for (const n of [v.presentValue, v.payment, v.futureValue, v.annualRatePercent, v.periods, v.totalPayments, v.totalInterest]) {
    assert.ok(Number.isFinite(n));
  }
});

test("solver: is pure and deterministic", () => {
  const input = baseSolve();
  const snapshot = JSON.stringify(input);
  const a = solveTvm("futureValue", input);
  const b = solveTvm("futureValue", input);
  assert.equal(JSON.stringify(input), snapshot, "input must not be mutated");
  assert.deepEqual(a, b);
});

test("solver: no result contains NaN or Infinity", () => {
  for (const variable of ["presentValue", "payment", "futureValue", "periods", "annualRatePercent"] as const) {
    const fv = solveTvm("futureValue", baseSolve());
    assert.ok(fv.ok);
    const r = solveTvm(variable, baseSolve({ futureValue: fv.value!.value }));
    assert.ok(r.ok, `${variable} should solve`);
    for (const [key, value] of Object.entries(r.value!)) {
      if (typeof value !== "number") continue;
      assert.ok(Number.isFinite(value), `${variable}.${key} is not finite`);
    }
  }
});
