/**
 * Time Value of Money — a standalone, deterministic planning calculator.
 *
 * Scope: INPUT → calculation → RESULT. Nothing else.
 *   - No WealthState, no Ledger, no Portfolio, no Advisor, no market data.
 *   - No persistence, no network, no AI.
 *   - Pure: the same input always produces the same output.
 *
 * These are hypothetical projections built entirely from the user's own
 * assumptions. They are not advice and must never be presented as fact.
 *
 * ── The solver ────────────────────────────────────────────────────────────
 * Standard five-variable TVM solver (PV, PMT, FV, rate, periods): supply any
 * four and solve for the fifth. It uses the conventional signed cash-flow
 * equation, the same one financial calculators and spreadsheets use:
 *
 *     PV·(1+i)^n  +  PMT·(1 + i·type)·((1+i)^n − 1)/i  +  FV  =  0
 *
 *   i    periodic rate      n     number of periods
 *   type 1 when payments are made at the BEGINNING of each period, else 0
 *
 * Cash-flow signs matter: money you pay in is negative, money you receive is
 * positive. Without that convention the five variables cannot be solved
 * consistently against one another.
 *
 * Every closed form below divides by i, so each has an explicit zero-rate
 * branch. Rate has no closed form and is solved numerically by bisection.
 */

/** Upper bound on money inputs, to keep results finite and meaningful. */
export const MAX_AMOUNT = 1_000_000_000_000;
/** Upper bound on periods. */
export const MAX_PERIODS = 1200; // 100 years of monthly periods
/** Annual rates outside this band are rejected as input errors. */
export const MAX_RATE_PERCENT = 1000;
/** Upper bound on years, for the inflation tool. */
export const MAX_YEARS = 100;

export type PaymentTiming = "end" | "beginning";
export type RateKind = "nominal" | "effective";

export type CompoundingFrequency = "annual" | "semiannual" | "quarterly" | "monthly" | "daily";

/** Compounding periods per year. */
export const PERIODS_PER_YEAR: Record<CompoundingFrequency, number> = {
  annual: 1,
  semiannual: 2,
  quarterly: 4,
  monthly: 12,
  daily: 365,
};

export const COMPOUNDING_LABELS: Record<CompoundingFrequency, string> = {
  annual: "Annually",
  semiannual: "Semi-annually",
  quarterly: "Quarterly",
  monthly: "Monthly",
  daily: "Daily",
};

/** The five solvable variables. */
export type TvmVariable = "presentValue" | "payment" | "futureValue" | "annualRatePercent" | "periods";

export interface TvmValidationError {
  /** Which input the message belongs to, so the UI can label it. */
  field: string;
  message: string;
}

/** Every calculation returns this envelope; `ok` gates the payload. */
export type TvmResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; value: null; errors: TvmValidationError[] };

function ok<T>(value: T): TvmResult<T> {
  return { ok: true, value, errors: [] };
}

function fail<T>(errors: TvmValidationError[]): TvmResult<T> {
  return { ok: false, value: null, errors };
}

/** Round to cents. Keeps monetary output stable and free of float noise. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Validate one numeric input. Never coerces or silently clamps — an
 * out-of-range value is reported so the user can correct it.
 */
function checkNumber(
  value: number,
  field: string,
  label: string,
  { min, max, allowZero = true }: { min: number; max: number; allowZero?: boolean },
  errors: TvmValidationError[],
): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push({ field, message: `${label} must be a number.` });
    return;
  }
  if (!Number.isFinite(value)) {
    errors.push({ field, message: `${label} must be a finite number.` });
    return;
  }
  if (value < min) {
    errors.push({ field, message: `${label} cannot be less than ${min.toLocaleString("en-MY")}.` });
    return;
  }
  if (value > max) {
    errors.push({ field, message: `${label} cannot be more than ${max.toLocaleString("en-MY")}.` });
    return;
  }
  if (!allowZero && value === 0) {
    errors.push({ field, message: `${label} must be greater than zero.` });
  }
}

// --- Rate conversion --------------------------------------------------------

/** Periodic rate from an annual rate, honouring nominal vs effective quoting. */
export function periodicRate(annualRatePercent: number, frequency: CompoundingFrequency, kind: RateKind): number {
  const m = PERIODS_PER_YEAR[frequency];
  const annual = annualRatePercent / 100;
  return kind === "nominal" ? annual / m : Math.pow(1 + annual, 1 / m) - 1;
}

/** Annual rate from a periodic rate, in the requested quoting convention. */
export function annualRateFromPeriodic(rate: number, frequency: CompoundingFrequency, kind: RateKind): number {
  const m = PERIODS_PER_YEAR[frequency];
  return kind === "nominal" ? rate * m * 100 : (Math.pow(1 + rate, m) - 1) * 100;
}

// --- Core solver ------------------------------------------------------------

export interface TvmSolveInput {
  presentValue: number;
  payment: number;
  futureValue: number;
  annualRatePercent: number;
  periods: number;
  frequency: CompoundingFrequency;
  timing: PaymentTiming;
  rateKind: RateKind;
}

export interface TvmSolveResult {
  /** Which variable was solved. */
  variable: TvmVariable;
  /** The solved value, in the same units as that variable's input. */
  value: number;
  /** All five variables after solving, so the UI can show a complete picture. */
  presentValue: number;
  payment: number;
  futureValue: number;
  annualRatePercent: number;
  periods: number;
  /** Sum of every payment: PMT × n. */
  totalPayments: number;
  /**
   * Interest / growth implied by the solved set:
   * FV + PV + totalPayments under the signed convention.
   */
  totalInterest: number;
  /** Periodic rate actually used. */
  periodicRate: number;
}

/** (1+i)^n, guarding the zero-rate case. */
function growthFactor(rate: number, periods: number): number {
  return rate === 0 ? 1 : Math.pow(1 + rate, periods);
}

/** Annuity factor (1 + i·type)·((1+i)^n − 1)/i, with the i→0 limit of n. */
function annuityFactor(rate: number, periods: number, timing: PaymentTiming): number {
  if (rate === 0) return periods;
  const due = timing === "beginning" ? 1 + rate : 1;
  return due * ((Math.pow(1 + rate, periods) - 1) / rate);
}

/** The TVM equation residual. Zero when the five variables are consistent. */
function residual(rate: number, input: Omit<TvmSolveInput, "annualRatePercent">): number {
  return input.presentValue * growthFactor(rate, input.periods)
    + input.payment * annuityFactor(rate, input.periods, input.timing)
    + input.futureValue;
}

function buildResult(
  variable: TvmVariable,
  solved: number,
  input: TvmSolveInput,
  rate: number,
): TvmResult<TvmSolveResult> {
  if (!Number.isFinite(solved)) {
    return fail([{ field: variable, message: "These inputs cannot be solved. Check the values and try again." }]);
  }

  const merged: TvmSolveInput = { ...input, [variable]: solved } as TvmSolveInput;
  const totalPayments = merged.payment * merged.periods;
  return ok({
    variable,
    value: variable === "periods"
      ? Math.round(solved * 1e6) / 1e6
      : variable === "annualRatePercent"
        ? Math.round(solved * 1e6) / 1e6
        : roundMoney(solved),
    presentValue: roundMoney(merged.presentValue),
    payment: roundMoney(merged.payment),
    futureValue: roundMoney(merged.futureValue),
    annualRatePercent: Math.round(merged.annualRatePercent * 1e6) / 1e6,
    periods: Math.round(merged.periods * 1e6) / 1e6,
    totalPayments: roundMoney(totalPayments),
    totalInterest: roundMoney(merged.futureValue + merged.presentValue + totalPayments),
    periodicRate: rate,
  });
}

/** Shared validation for the four inputs that are always required. */
function validateCommon(input: TvmSolveInput, solveFor: TvmVariable, errors: TvmValidationError[]): void {
  if (solveFor !== "presentValue") {
    checkNumber(input.presentValue, "presentValue", "Present value", { min: -MAX_AMOUNT, max: MAX_AMOUNT }, errors);
  }
  if (solveFor !== "payment") {
    checkNumber(input.payment, "payment", "Payment", { min: -MAX_AMOUNT, max: MAX_AMOUNT }, errors);
  }
  if (solveFor !== "futureValue") {
    checkNumber(input.futureValue, "futureValue", "Future value", { min: -MAX_AMOUNT, max: MAX_AMOUNT }, errors);
  }
  if (solveFor !== "annualRatePercent") {
    checkNumber(input.annualRatePercent, "annualRatePercent", "Annual rate", { min: -MAX_RATE_PERCENT, max: MAX_RATE_PERCENT }, errors);
  }
  if (solveFor !== "periods") {
    checkNumber(input.periods, "periods", "Periods", { min: 0, max: MAX_PERIODS, allowZero: false }, errors);
  }
}

/**
 * Solve the TVM equation for one variable, given the other four.
 * Pure and deterministic.
 */
export function solveTvm(solveFor: TvmVariable, input: TvmSolveInput): TvmResult<TvmSolveResult> {
  const errors: TvmValidationError[] = [];
  validateCommon(input, solveFor, errors);
  if (errors.length > 0) return fail(errors);

  const rate = periodicRate(input.annualRatePercent, input.frequency, input.rateKind);

  switch (solveFor) {
    case "futureValue": {
      const fv = -(input.presentValue * growthFactor(rate, input.periods)
        + input.payment * annuityFactor(rate, input.periods, input.timing));
      return buildResult("futureValue", fv, input, rate);
    }

    case "presentValue": {
      const factor = growthFactor(rate, input.periods);
      if (factor === 0) {
        return fail([{ field: "annualRatePercent", message: "This rate makes the calculation impossible." }]);
      }
      const pv = -(input.payment * annuityFactor(rate, input.periods, input.timing) + input.futureValue) / factor;
      return buildResult("presentValue", pv, input, rate);
    }

    case "payment": {
      const factor = annuityFactor(rate, input.periods, input.timing);
      if (factor === 0) {
        return fail([{ field: "periods", message: "Periods must be greater than zero to solve for a payment." }]);
      }
      const pmt = -(input.presentValue * growthFactor(rate, input.periods) + input.futureValue) / factor;
      return buildResult("payment", pmt, input, rate);
    }

    case "periods": {
      if (rate === 0) {
        if (input.payment === 0) {
          return fail([{ field: "payment", message: "With a 0% rate and no payment, the balance never changes, so no number of periods reaches the future value." }]);
        }
        const n = -(input.presentValue + input.futureValue) / input.payment;
        if (n <= 0) {
          return fail([{ field: "periods", message: "These inputs are never reached. Check the signs: money paid in should be negative." }]);
        }
        return buildResult("periods", n, input, rate);
      }
      const due = input.timing === "beginning" ? 1 + rate : 1;
      const k = input.payment * due / rate;
      const denominator = input.presentValue + k;
      const numerator = k - input.futureValue;
      if (denominator === 0 || numerator / denominator <= 0) {
        return fail([{ field: "periods", message: "These inputs are never reached. Check the signs: money paid in should be negative." }]);
      }
      const n = Math.log(numerator / denominator) / Math.log(1 + rate);
      if (!Number.isFinite(n) || n <= 0) {
        return fail([{ field: "periods", message: "These inputs are never reached. Check the signs: money paid in should be negative." }]);
      }
      if (n > MAX_PERIODS) {
        return fail([{ field: "periods", message: `This would take more than ${MAX_PERIODS} periods. Try a larger payment or rate.` }]);
      }
      return buildResult("periods", n, input, rate);
    }

    case "annualRatePercent": {
      const solvedRate = solvePeriodicRate(input);
      if (solvedRate === null) {
        return fail([{
          field: "annualRatePercent",
          message: "No rate satisfies these values. Check the signs: money paid in should be negative and money received positive.",
        }]);
      }
      const annual = annualRateFromPeriodic(solvedRate, input.frequency, input.rateKind);
      if (Math.abs(annual) > MAX_RATE_PERCENT) {
        return fail([{ field: "annualRatePercent", message: "The implied rate is outside the supported range." }]);
      }
      return buildResult("annualRatePercent", annual, { ...input, annualRatePercent: annual }, solvedRate);
    }
  }
}

/**
 * Numerically solve the periodic rate — the one variable with no closed form.
 * Brackets a sign change over a wide range, then bisects. Bisection is chosen
 * over Newton because it cannot diverge once a bracket is found.
 */
function solvePeriodicRate(input: TvmSolveInput): number | null {
  const rest = {
    presentValue: input.presentValue,
    payment: input.payment,
    futureValue: input.futureValue,
    periods: input.periods,
    frequency: input.frequency,
    timing: input.timing,
    rateKind: input.rateKind,
  };

  // The zero-rate case is exact, not iterative.
  const atZero = residual(0, rest);
  if (Math.abs(atZero) < 1e-9) return 0;

  // Scan for a sign change. Rates below -100% per period are meaningless.
  const lower = -0.999999;
  const upper = 10; // 1000% per period, far past any real scenario
  const steps = 400;
  let previousRate = lower;
  let previousValue = residual(previousRate, rest);

  for (let step = 1; step <= steps; step += 1) {
    const currentRate = lower + (upper - lower) * (step / steps);
    const currentValue = residual(currentRate, rest);
    if (!Number.isFinite(currentValue)) {
      previousRate = currentRate;
      previousValue = currentValue;
      continue;
    }
    if (Number.isFinite(previousValue) && previousValue === 0) return previousRate;
    if (Number.isFinite(previousValue) && Math.sign(previousValue) !== Math.sign(currentValue)) {
      // Bisect inside the bracket.
      let low = previousRate;
      let high = currentRate;
      let lowValue = previousValue;
      for (let iteration = 0; iteration < 200; iteration += 1) {
        const mid = (low + high) / 2;
        const midValue = residual(mid, rest);
        if (!Number.isFinite(midValue)) break;
        if (Math.abs(midValue) < 1e-10 || (high - low) < 1e-14) return mid;
        if (Math.sign(midValue) === Math.sign(lowValue)) {
          low = mid;
          lowValue = midValue;
        } else {
          high = mid;
        }
      }
      return (low + high) / 2;
    }
    previousRate = currentRate;
    previousValue = currentValue;
  }
  return null;
}

// --- Inflation (standalone tool, not part of the five-variable solver) ------

export interface InflationInput {
  futureAmount: number;
  inflationRatePercent: number;
  years: number;
}

export interface InflationResult {
  /** What the future amount is worth in today's money. */
  todaysPurchasingPower: number;
  /** Alias kept explicit for the UI; same figure as todaysPurchasingPower. */
  inflationAdjustedValue: number;
  /** futureAmount − todaysPurchasingPower. */
  purchasingPowerLoss: number;
  /** Loss as a fraction of the future amount, 0 when the amount is 0. */
  purchasingPowerLossPercent: number;
}

export function calculateInflationAdjustedValue(input: InflationInput): TvmResult<InflationResult> {
  const errors: TvmValidationError[] = [];
  checkNumber(input.futureAmount, "futureAmount", "Future amount", { min: 0, max: MAX_AMOUNT }, errors);
  checkNumber(input.inflationRatePercent, "inflationRatePercent", "Inflation rate", { min: -100, max: 100 }, errors);
  checkNumber(input.years, "years", "Years", { min: 0, max: MAX_YEARS }, errors);
  if (errors.length > 0) return fail(errors);

  const rate = input.inflationRatePercent / 100;
  // Guard the degenerate -100% case, where the divisor collapses to zero.
  if (1 + rate <= 0) {
    return fail([{ field: "inflationRatePercent", message: "Inflation rate must be greater than -100%." }]);
  }

  const todaysValue = input.futureAmount / Math.pow(1 + rate, input.years);
  if (!Number.isFinite(todaysValue)) {
    return fail([{ field: "years", message: "These inputs produce a value that cannot be calculated." }]);
  }

  const loss = input.futureAmount - todaysValue;
  return ok({
    todaysPurchasingPower: roundMoney(todaysValue),
    inflationAdjustedValue: roundMoney(todaysValue),
    purchasingPowerLoss: roundMoney(loss),
    purchasingPowerLossPercent: input.futureAmount > 0 ? loss / input.futureAmount : 0,
  });
}

// --- Convenience wrappers ---------------------------------------------------
//
// These express the common planning questions in "all positive" terms, which
// is friendlier than signed cash flows. They delegate to the solver above so
// there is exactly one implementation of the TVM maths.

export interface FutureValueInput {
  currentAmount: number;
  monthlyContribution: number;
  annualReturnPercent: number;
  years: number;
}

export interface FutureValueResult {
  futureValue: number;
  /** Starting amount plus every contribution — the money the user puts in. */
  totalContributed: number;
  /** futureValue − totalContributed. Negative if the return is negative. */
  investmentGrowth: number;
  months: number;
}

export function calculateFutureValue(input: FutureValueInput): TvmResult<FutureValueResult> {
  const errors: TvmValidationError[] = [];
  checkNumber(input.currentAmount, "currentAmount", "Current amount", { min: 0, max: MAX_AMOUNT }, errors);
  checkNumber(input.monthlyContribution, "monthlyContribution", "Monthly contribution", { min: 0, max: MAX_AMOUNT }, errors);
  checkNumber(input.annualReturnPercent, "annualReturnPercent", "Annual return", { min: -100, max: 100 }, errors);
  checkNumber(input.years, "years", "Investment period", { min: 0, max: MAX_YEARS }, errors);
  if (errors.length > 0) return fail(errors);

  const months = Math.round(input.years * 12);
  if (months === 0) {
    return ok({
      futureValue: roundMoney(input.currentAmount),
      totalContributed: roundMoney(input.currentAmount),
      investmentGrowth: 0,
      months: 0,
    });
  }

  // Money in is negative, so the resulting future value comes back positive.
  const solved = solveTvm("futureValue", {
    presentValue: -input.currentAmount,
    payment: -input.monthlyContribution,
    futureValue: 0,
    annualRatePercent: input.annualReturnPercent,
    periods: months,
    frequency: "monthly",
    timing: "end",
    rateKind: "nominal",
  });
  if (!solved.ok) return fail(solved.errors);

  const futureValue = solved.value.futureValue;
  const totalContributed = input.currentAmount + input.monthlyContribution * months;
  return ok({
    futureValue: roundMoney(futureValue),
    totalContributed: roundMoney(totalContributed),
    investmentGrowth: roundMoney(futureValue - totalContributed),
    months,
  });
}

export interface MonthlyContributionInput {
  currentAmount: number;
  targetAmount: number;
  annualReturnPercent: number;
  years: number;
}

export interface MonthlyContributionResult {
  requiredMonthlyContribution: number;
  totalFutureContribution: number;
  estimatedInvestmentGrowth: number;
  months: number;
  /** True when the starting amount already grows past the target unaided. */
  alreadyOnTrack: boolean;
}

export function calculateMonthlyContribution(input: MonthlyContributionInput): TvmResult<MonthlyContributionResult> {
  const errors: TvmValidationError[] = [];
  checkNumber(input.currentAmount, "currentAmount", "Current amount", { min: 0, max: MAX_AMOUNT }, errors);
  checkNumber(input.targetAmount, "targetAmount", "Target amount", { min: 0, max: MAX_AMOUNT }, errors);
  checkNumber(input.annualReturnPercent, "annualReturnPercent", "Annual return", { min: -100, max: 100 }, errors);
  checkNumber(input.years, "years", "Investment period", { min: 0, max: MAX_YEARS, allowZero: false }, errors);
  if (errors.length > 0) return fail(errors);

  const months = Math.round(input.years * 12);
  if (months <= 0) {
    return fail([{ field: "years", message: "Investment period must be at least one month." }]);
  }

  const rate = periodicRate(input.annualReturnPercent, "monthly", "nominal");
  const grownCurrent = input.currentAmount * growthFactor(rate, months);

  // The starting amount alone already reaches the target.
  if (input.targetAmount - grownCurrent <= 0) {
    return ok({
      requiredMonthlyContribution: 0,
      totalFutureContribution: roundMoney(input.currentAmount),
      estimatedInvestmentGrowth: roundMoney(grownCurrent - input.currentAmount),
      months,
      alreadyOnTrack: true,
    });
  }

  const solved = solveTvm("payment", {
    presentValue: -input.currentAmount,
    payment: 0,
    futureValue: input.targetAmount,
    annualRatePercent: input.annualReturnPercent,
    periods: months,
    frequency: "monthly",
    timing: "end",
    rateKind: "nominal",
  });
  if (!solved.ok) return fail(solved.errors);

  // Solver returns a negative payment (money out); present it as positive.
  const required = -solved.value.payment;
  const totalFutureContribution = input.currentAmount + required * months;
  return ok({
    requiredMonthlyContribution: roundMoney(required),
    totalFutureContribution: roundMoney(totalFutureContribution),
    estimatedInvestmentGrowth: roundMoney(input.targetAmount - totalFutureContribution),
    months,
    alreadyOnTrack: false,
  });
}

export interface TimeToGoalInput {
  currentAmount: number;
  monthlyContribution: number;
  targetAmount: number;
  annualReturnPercent: number;
}

export interface TimeToGoalResult {
  months: number;
  years: number;
  /** Value at the month the target is first met or exceeded. */
  futureValueAtTarget: number;
  totalContributed: number;
  alreadyReached: boolean;
}

export function calculateTimeToGoal(input: TimeToGoalInput): TvmResult<TimeToGoalResult> {
  const errors: TvmValidationError[] = [];
  checkNumber(input.currentAmount, "currentAmount", "Current amount", { min: 0, max: MAX_AMOUNT }, errors);
  checkNumber(input.monthlyContribution, "monthlyContribution", "Monthly contribution", { min: 0, max: MAX_AMOUNT }, errors);
  checkNumber(input.targetAmount, "targetAmount", "Target amount", { min: 0, max: MAX_AMOUNT }, errors);
  checkNumber(input.annualReturnPercent, "annualReturnPercent", "Annual return", { min: -100, max: 100 }, errors);
  if (errors.length > 0) return fail(errors);

  // Already there — no projection needed.
  if (input.currentAmount >= input.targetAmount) {
    return ok({
      months: 0,
      years: 0,
      futureValueAtTarget: roundMoney(input.currentAmount),
      totalContributed: roundMoney(input.currentAmount),
      alreadyReached: true,
    });
  }

  const rate = periodicRate(input.annualReturnPercent, "monthly", "nominal");
  // Unreachable: nothing is being added and the balance cannot grow.
  if (input.monthlyContribution <= 0 && rate <= 0) {
    return fail([{
      field: "monthlyContribution",
      message: "This goal cannot be reached. With no monthly contribution and no growth, the balance never increases.",
    }]);
  }

  const solved = solveTvm("periods", {
    presentValue: -input.currentAmount,
    payment: -input.monthlyContribution,
    futureValue: input.targetAmount,
    annualRatePercent: input.annualReturnPercent,
    periods: 1, // ignored when solving for periods
    frequency: "monthly",
    timing: "end",
    rateKind: "nominal",
  });
  if (!solved.ok) {
    return fail([{
      field: "monthlyContribution",
      message: solved.errors[0]?.message.includes("more than")
        ? `This goal would take over ${MAX_YEARS} years. Try increasing the monthly contribution.`
        : "This goal cannot be reached with these inputs. Try increasing the monthly contribution.",
    }]);
  }

  const wholeMonths = Math.ceil(solved.value.periods);
  if (wholeMonths > MAX_YEARS * 12) {
    return fail([{
      field: "monthlyContribution",
      message: `This goal would take over ${MAX_YEARS} years. Try increasing the monthly contribution.`,
    }]);
  }

  // Value at the month the target is actually met (contributions are whole months).
  const projected = calculateFutureValue({
    currentAmount: input.currentAmount,
    monthlyContribution: input.monthlyContribution,
    annualReturnPercent: input.annualReturnPercent,
    years: wholeMonths / 12,
  });
  if (!projected.ok) return fail(projected.errors);

  return ok({
    months: wholeMonths,
    years: Math.round((wholeMonths / 12) * 10) / 10,
    futureValueAtTarget: projected.value.futureValue,
    totalContributed: projected.value.totalContributed,
    alreadyReached: false,
  });
}
