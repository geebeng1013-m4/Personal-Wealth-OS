import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import {
  calculateInvestmentGrowth,
  normalizeMoney,
  normalizeReturnPercent,
  normalizeYears,
  type CompoundingFrequency,
  type ContributionFrequency,
} from "./investmentGrowth";

/*
 * T-6d: the calculator speaks the app's own layout — figure tiles, a result
 * card, list-row inputs and a chart card — instead of its own Tailwind look.
 * Desktop: four figures, then Inputs beside Growth. Phone: the result, the
 * chart, then the inputs. The arithmetic is unchanged (investmentGrowth.ts).
 */

const DEFAULTS = {
  initialDeposit: 10_000,
  years: 20,
  annualReturnPercent: 7,
  compoundingFrequency: "monthly" as CompoundingFrequency,
  contributionAmount: 500,
  contributionFrequency: "monthly" as ContributionFrequency,
};

/** Whole ringgit, no currency prefix: the page sets "MYR" small beside it. */
const whole = new Intl.NumberFormat("en-MY", { maximumFractionDigits: 0 });
const amount = (value: number): string => whole.format(value);

function compactMoney(value: number): string {
  return new Intl.NumberFormat("en-MY", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatInvestmentDuration(month: number): string {
  if (month === 0) return "Starting point";
  const completeYears = Math.floor(month / 12);
  const remainingMonths = month % 12;
  if (remainingMonths === 0) return completeYears === 1 ? "Year 1" : `Year ${completeYears}`;
  if (completeYears === 0) return `Month ${remainingMonths}`;
  return `Year ${completeYears} · Month ${remainingMonths}`;
}

function GrowthTooltip({ active, label, payload }: TooltipContentProps) {
  if (!active || !payload.length || typeof label !== "number") return null;

  const principal = Number(payload.find((entry) => entry.dataKey === "principal")?.value ?? 0);
  const interest = Number(payload.find((entry) => entry.dataKey === "interest")?.value ?? 0);

  return (
    <div className="calc-chart-tooltip">
      <div className="calc-chart-tooltip-title">{formatInvestmentDuration(label)}</div>
      <div className="calc-chart-tooltip-row">
        <span className="calc-chart-key calc-chart-key-principal" />
        <span>You put in</span>
        <strong>MYR {amount(principal)}</strong>
      </div>
      <div className="calc-chart-tooltip-row">
        <span className="calc-chart-key calc-chart-key-interest" />
        <span>Interest</span>
        <strong>MYR {amount(interest)}</strong>
      </div>
      <div className="calc-chart-tooltip-total">
        <span>Balance</span>
        <strong>MYR {amount(principal + interest)}</strong>
      </div>
    </div>
  );
}

interface NumberRowProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  normalize: (value: number) => number;
  onChange: (value: number) => void;
}

/** One input row: label on the left, the number typed straight in on the right. */
function NumberRow({ id, label, value, min, max, step, unit, normalize, onChange }: NumberRowProps) {
  const [draftValue, setDraftValue] = useState(String(value));
  const isEditing = useRef(false);

  useEffect(() => {
    if (!isEditing.current) setDraftValue(String(value));
  }, [value]);

  return (
    <li className="wu-tvm-row wu-tvm-row--plain">
      <label className="wu-tvm-row__label" htmlFor={id}>{label}</label>
      <span className="wu-tvm-row__input">
        <input
          id={id}
          className="wu-field"
          type="number"
          inputMode="decimal"
          value={draftValue}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            setDraftValue(event.currentTarget.value);
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
          onFocus={() => {
            isEditing.current = true;
          }}
          onBlur={(event) => {
            isEditing.current = false;
            const normalized = normalize(event.currentTarget.valueAsNumber);
            setDraftValue(String(normalized));
            onChange(normalized);
          }}
        />
        <span className="wu-tvm-row__unit" aria-hidden="true">{unit}</span>
      </span>
    </li>
  );
}

/** Monthly / Annually as a two-way choice. */
function ChoiceRow<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <li className="wu-tvm-row wu-tvm-row--option">
      <span className="wu-tvm-row__label">{label}</span>
      <div className="wu-segmented wu-tvm-choice" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`wu-segmented__option${option.value === value ? " is-active" : ""}`}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </li>
  );
}

const FREQUENCIES: Array<{ value: "monthly" | "annually"; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "annually", label: "Annually" },
];

export function InvestmentGrowthCalculator() {
  const [initialDeposit, setInitialDeposit] = useState(DEFAULTS.initialDeposit);
  const [years, setYears] = useState(DEFAULTS.years);
  const [annualReturnPercent, setAnnualReturnPercent] = useState(DEFAULTS.annualReturnPercent);
  const [compoundingFrequency, setCompoundingFrequency] = useState<CompoundingFrequency>(DEFAULTS.compoundingFrequency);
  const [contributionAmount, setContributionAmount] = useState(DEFAULTS.contributionAmount);
  const [contributionFrequency, setContributionFrequency] = useState<ContributionFrequency>(DEFAULTS.contributionFrequency);

  const result = useMemo(() => calculateInvestmentGrowth({
    initialDeposit,
    years,
    annualReturnPercent,
    compoundingFrequency,
    contributionAmount,
    contributionFrequency,
  }), [initialDeposit, years, annualReturnPercent, compoundingFrequency, contributionAmount, contributionFrequency]);

  const reset = (): void => {
    setInitialDeposit(DEFAULTS.initialDeposit);
    setYears(DEFAULTS.years);
    setAnnualReturnPercent(DEFAULTS.annualReturnPercent);
    setCompoundingFrequency(DEFAULTS.compoundingFrequency);
    setContributionAmount(DEFAULTS.contributionAmount);
    setContributionFrequency(DEFAULTS.contributionFrequency);
  };

  // The page header's Reset (desktop) sits outside this component; wire it here.
  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>("#growthReset");
    button?.addEventListener("click", reset);
    return () => button?.removeEventListener("click", reset);
  });

  const yearTicks = useMemo(() => {
    const every = years <= 10 ? 2 : years <= 30 ? 5 : 10;
    const ticks: number[] = [];
    for (let year = 0; year <= years; year += every) ticks.push(year * 12);
    return ticks;
  }, [years]);

  const growthShare = result.totalBalance > 0 ? Math.round((result.totalInterest / result.totalBalance) * 100) : 0;
  const cadence = contributionFrequency === "monthly" ? "a month" : "a year";
  const hasSplit = result.totalPrincipal > 0 || result.totalInterest > 0;
  const split = hasSplit ? (
    <div className="wu-split wu-tvm-split" aria-hidden="true">
      <span style={{ flex: Math.max(result.totalPrincipal, 0.001), background: "var(--highlight)" }} />
      <span style={{ flex: Math.max(result.totalInterest, 0.001), background: "var(--accent)" }} />
    </div>
  ) : null;

  return (
    <div className="wu wu-growth">
      <div className="wu-dash">
        {/* ROW 1 (desktop) — four figures */}
        <div className="wu-dash__full wu-dash__tiles wu-growth-tiles">
          <section className="wu-card wu-dash__tile" aria-labelledby="growthValueLabel">
            <div className="wu-tc__top"><span className="wu-label" id="growthValueLabel">Projected value</span></div>
            <p className="wu-money wu-money--md"><span className="wu-money__cur">MYR</span><span>{amount(result.totalBalance)}</span></p>
            <p className="wu-dash__note">In {years} {years === 1 ? "year" : "years"} at {annualReturnPercent}% a year</p>
          </section>
          <section className="wu-card wu-dash__tile" aria-labelledby="growthInLabel">
            <div className="wu-tc__top"><span className="wu-label" id="growthInLabel">You put in</span></div>
            <p className="wu-money wu-money--md"><span className="wu-money__cur">MYR</span><span>{amount(result.totalPrincipal)}</span></p>
            <p className="wu-dash__note">{amount(initialDeposit)} now + {amount(contributionAmount)} {cadence}</p>
          </section>
          <section className="wu-card wu-dash__tile" aria-labelledby="growthInterestLabel">
            <div className="wu-tc__top"><span className="wu-label" id="growthInterestLabel">Interest</span></div>
            <p className="wu-money wu-money--md t-positive"><span className="wu-money__cur">MYR</span><span>+{amount(result.totalInterest)}</span></p>
            <p className="wu-dash__note">Growth on top of what you put in</p>
          </section>
          <section className="wu-card wu-dash__tile" aria-labelledby="growthShareLabel">
            <div className="wu-tc__top"><span className="wu-label" id="growthShareLabel">Growth share</span></div>
            <p className="wu-money wu-money--md"><span>{growthShare}%</span></p>
            <p className="wu-dash__note">Of the final balance is interest</p>
            {split}
          </section>
        </div>

        {/* phone — the result leads */}
        <section className="wu-card wu-dash__full wu-stack wu-stack--sm wu-growth-result" aria-labelledby="growthResultLabel">
          <div className="wu-tc__top"><span className="wu-label" id="growthResultLabel">Projected value</span><span className="wu-chip">+{amount(result.totalInterest)} interest</span></div>
          <p className="wu-money"><span className="wu-money__cur">MYR</span><span>{amount(result.totalBalance)}</span></p>
          {split}
          <div className="wu-legend">
            <span><i style={{ background: "var(--highlight)" }} />You put in <b>{amount(result.totalPrincipal)}</b></span>
            <span><i style={{ background: "var(--accent)" }} />Interest <b>{amount(result.totalInterest)}</b></span>
          </div>
          <p className="wu-dash__note">After {years} {years === 1 ? "year" : "years"} at {annualReturnPercent}% a year, {compoundingFrequency} compounding.</p>
        </section>

        {/* ROW 2 — inputs | growth */}
        <section className="wu-card wu-dash__half wu-stack wu-stack--sm wu-growth-inputs" aria-labelledby="growthInputsLabel">
          <div className="wu-tc__top"><span className="wu-label" id="growthInputsLabel">Inputs</span><button type="button" className="wu-btn wu-btn--ghost wu-btn--sm wu-growth-reset-phone" onClick={reset}>Reset</button></div>
          <ul className="wu-tvm-rows">
            <NumberRow id="initialDeposit" label="Initial deposit" value={initialDeposit} min={0} max={1_000_000_000_000} step={5} unit="MYR" normalize={normalizeMoney} onChange={setInitialDeposit} />
            <NumberRow id="contributionAmount" label="Contribution" value={contributionAmount} min={0} max={1_000_000_000_000} step={5} unit="MYR" normalize={normalizeMoney} onChange={setContributionAmount} />
            <ChoiceRow label="Contribute" value={contributionFrequency} options={FREQUENCIES} onChange={setContributionFrequency} />
            <NumberRow id="annualReturn" label="Annual return" value={annualReturnPercent} min={0} max={100} step={0.1} unit="%" normalize={normalizeReturnPercent} onChange={setAnnualReturnPercent} />
            <NumberRow id="investmentYears" label="Years" value={years} min={1} max={60} step={1} unit="yrs" normalize={normalizeYears} onChange={setYears} />
            <ChoiceRow label="Compounding" value={compoundingFrequency} options={FREQUENCIES} onChange={setCompoundingFrequency} />
          </ul>
        </section>

        <section className="wu-card wu-dash__half wu-stack wu-stack--sm wu-growth-chart" aria-labelledby="growthChartLabel">
          <div className="wu-tc__top"><span className="wu-label" id="growthChartLabel">Growth</span><span className="wu-chip wu-chip--muted">{years} {years === 1 ? "year" : "years"}</span></div>
          <div className="wu-growth-canvas" role="img" aria-label="Projected principal and interest growth by year">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={result.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="principalFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--highlight)" stopOpacity={0.42} /><stop offset="100%" stopColor="var(--highlight)" stopOpacity={0.08} /></linearGradient>
                  <linearGradient id="interestFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0.08} /></linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="month" type="number" domain={[0, years * 12]} ticks={yearTicks} stroke="var(--text-faint)" tickLine={false} axisLine={false} tickFormatter={(value: number) => value === 0 ? "0" : `${value / 12}Y`} fontSize={11} />
                <YAxis stroke="var(--text-faint)" tickLine={false} axisLine={false} tickFormatter={compactMoney} width={44} fontSize={11} />
                <Tooltip content={GrowthTooltip} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "4 4" }} />
                <Area type="monotone" dataKey="principal" name="principal" stackId="growth" stroke="var(--highlight)" fill="url(#principalFill)" strokeWidth={2} activeDot={{ r: 4, strokeWidth: 2, fill: "var(--surface-bg)" }} />
                <Area type="monotone" dataKey="interest" name="interest" stackId="growth" stroke="var(--accent)" fill="url(#interestFill)" strokeWidth={2} activeDot={{ r: 4, strokeWidth: 2, fill: "var(--surface-bg)" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="wu-legend">
            <span><i style={{ background: "var(--highlight)" }} />You put in</span>
            <span><i style={{ background: "var(--accent)" }} />Interest</span>
          </div>
          <p className="wu-dash__note wu-dash__actions">Estimates from your own assumptions — planning aids, not guaranteed returns.</p>
        </section>
      </div>
    </div>
  );
}
