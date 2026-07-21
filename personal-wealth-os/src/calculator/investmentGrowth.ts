export type CompoundingFrequency = "monthly" | "annually";
export type ContributionFrequency = "monthly" | "annually";

export interface InvestmentGrowthInput {
  initialDeposit: number;
  years: number;
  annualReturnPercent: number;
  compoundingFrequency: CompoundingFrequency;
  contributionAmount: number;
  contributionFrequency: ContributionFrequency;
}

export interface InvestmentGrowthPoint {
  month: number;
  balance: number;
  principal: number;
  interest: number;
}

export interface InvestmentGrowthResult {
  points: InvestmentGrowthPoint[];
  totalBalance: number;
  totalPrincipal: number;
  totalInterest: number;
}

const MAX_MONEY = 1_000_000_000_000;

function finiteInRange(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeMoney(value: number): number {
  const safe = finiteInRange(value, 0, MAX_MONEY);
  return Math.round(safe / 5) * 5;
}

export function normalizeYears(value: number): number {
  return Math.round(finiteInRange(value, 1, 60));
}

export function normalizeReturnPercent(value: number): number {
  return Math.round(finiteInRange(value, 0, 100) * 10) / 10;
}

export function calculateInvestmentGrowth(input: InvestmentGrowthInput): InvestmentGrowthResult {
  const initialDeposit = normalizeMoney(input.initialDeposit);
  const contributionAmount = normalizeMoney(input.contributionAmount);
  const years = normalizeYears(input.years);
  const months = years * 12;
  const annualReturn = normalizeReturnPercent(input.annualReturnPercent) / 100;
  const periodsPerYear = input.compoundingFrequency === "monthly" ? 12 : 1;
  const monthlyRate = Math.pow(1 + annualReturn / periodsPerYear, periodsPerYear / 12) - 1;

  let balance = initialDeposit;
  let principal = initialDeposit;
  const points: InvestmentGrowthPoint[] = [{ month: 0, balance, principal, interest: 0 }];

  for (let month = 1; month <= months; month += 1) {
    balance *= 1 + monthlyRate;

    const shouldContribute = input.contributionFrequency === "monthly" || month % 12 === 0;
    if (shouldContribute) {
      balance += contributionAmount;
      principal += contributionAmount;
    }

    points.push({
      month,
      balance,
      principal,
      interest: Math.max(0, balance - principal),
    });
  }

  return {
    points,
    totalBalance: balance,
    totalPrincipal: principal,
    totalInterest: Math.max(0, balance - principal),
  };
}