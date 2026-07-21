import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, CircleDollarSign, Percent, Repeat2, TrendingUp, WalletCards } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import {
  calculateInvestmentGrowth,
  normalizeMoney,
  normalizeReturnPercent,
  normalizeYears,
  type CompoundingFrequency,
  type ContributionFrequency,
} from "./investmentGrowth";

const currency = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  maximumFractionDigits: 0,
});

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
        <span>Principal contributed</span>
        <strong>{currency.format(principal)}</strong>
      </div>
      <div className="calc-chart-tooltip-row">
        <span className="calc-chart-key calc-chart-key-interest" />
        <span>Interest earned</span>
        <strong>{currency.format(interest)}</strong>
      </div>
      <div className="calc-chart-tooltip-total">
        <span>Total balance</span>
        <strong>{currency.format(principal + interest)}</strong>
      </div>
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  icon: React.ReactNode;
  suffix?: string;
  normalize: (value: number) => number;
  onChange: (value: number) => void;
}

function NumberField({ id, label, value, min, max, step, icon, suffix, normalize, onChange }: NumberFieldProps) {
  const [draftValue, setDraftValue] = useState(String(value));
  const isEditing = useRef(false);

  useEffect(() => {
    if (!isEditing.current) setDraftValue(String(value));
  }, [value]);

  return (
    <label htmlFor={id} className="calc-block">
      <span className="calc-label">{label}</span>
      <span className="calc-relative calc-block">
        <span className="calc-pointer-events-none calc-absolute calc-left-3 calc-top-1/2 calc-flex -calc-translate-y-1/2 calc-items-center calc-text-slate-500">{icon}</span>
        <input
          id={id}
          className="calc-field calc-pl-10 calc-pr-24"
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
        {suffix ? <span className="calc-pointer-events-none calc-absolute calc-right-8 calc-top-1/2 -calc-translate-y-1/2 calc-text-xs calc-font-semibold calc-text-slate-500">{suffix}</span> : null}
      </span>
    </label>
  );
}

function SelectField<T extends string>({ id, label, value, icon, options, onChange }: {
  id: string;
  label: string;
  value: T;
  icon: React.ReactNode;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label htmlFor={id} className="calc-block">
      <span className="calc-label">{label}</span>
      <span className="calc-relative calc-block">
        <span className="calc-pointer-events-none calc-absolute calc-left-3 calc-top-1/2 calc-z-10 -calc-translate-y-1/2 calc-text-slate-500">{icon}</span>
        <select id={id} className="calc-field calc-select-field calc-pl-10" value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </span>
    </label>
  );
}

export function InvestmentGrowthCalculator() {
  const [initialDeposit, setInitialDeposit] = useState(10_000);
  const [years, setYears] = useState(20);
  const [annualReturnPercent, setAnnualReturnPercent] = useState(7);
  const [compoundingFrequency, setCompoundingFrequency] = useState<CompoundingFrequency>("monthly");
  const [contributionAmount, setContributionAmount] = useState(500);
  const [contributionFrequency, setContributionFrequency] = useState<ContributionFrequency>("monthly");

  const result = useMemo(() => calculateInvestmentGrowth({
    initialDeposit,
    years,
    annualReturnPercent,
    compoundingFrequency,
    contributionAmount,
    contributionFrequency,
  }), [initialDeposit, years, annualReturnPercent, compoundingFrequency, contributionAmount, contributionFrequency]);

  const yearTicks = useMemo(() => Array.from({ length: years + 1 }, (_, year) => year * 12), [years]);

  return (
    <div className="calc-grid calc-gap-4 lg:calc-grid-cols-[minmax(280px,0.36fr)_minmax(0,0.64fr)]">
      <section className="calc-card calc-self-start" aria-labelledby="calculatorInputsTitle">
        <div className="calc-mb-6">
          <p className="calc-mb-2 calc-text-xs calc-font-bold calc-uppercase calc-tracking-[0.18em] calc-text-emerald-500">Growth assumptions</p>
          <h3 id="calculatorInputsTitle" className="calc-m-0 calc-text-xl calc-font-bold">Investment inputs</h3>
          <p className="calc-mt-2 calc-text-sm calc-leading-6" style={{ color: "var(--ink-2)" }}>Model regular contributions and compound growth in MYR. Estimates are planning aids, not guaranteed returns.</p>
        </div>

        <div className="calc-grid calc-gap-5">
          <NumberField id="initialDeposit" label="Initial deposit" value={initialDeposit} min={0} max={1_000_000_000_000} step={5} icon={<CircleDollarSign size={17} />} suffix="MYR" normalize={normalizeMoney} onChange={setInitialDeposit} />
          <NumberField id="investmentYears" label="Investment period" value={years} min={1} max={60} step={1} icon={<CalendarRange size={17} />} suffix="YEARS" normalize={normalizeYears} onChange={setYears} />
          <NumberField id="annualReturn" label="Annual return" value={annualReturnPercent} min={0} max={100} step={0.1} icon={<Percent size={17} />} suffix="%" normalize={normalizeReturnPercent} onChange={setAnnualReturnPercent} />
          <SelectField id="compounding" label="Compounding" value={compoundingFrequency} icon={<Repeat2 size={17} />} options={[{ value: "monthly", label: "Monthly" }, { value: "annually", label: "Annually" }]} onChange={setCompoundingFrequency} />
          <NumberField id="contributionAmount" label="Contribution amount" value={contributionAmount} min={0} max={1_000_000_000_000} step={5} icon={<WalletCards size={17} />} suffix="MYR" normalize={normalizeMoney} onChange={setContributionAmount} />
          <SelectField id="contributionFrequency" label="Contribution frequency" value={contributionFrequency} icon={<TrendingUp size={17} />} options={[{ value: "monthly", label: "Monthly" }, { value: "annually", label: "Annually" }]} onChange={setContributionFrequency} />
        </div>
      </section>

      <section className="calc-card calc-min-w-0" aria-labelledby="growthProjectionTitle">
        <div className="calc-flex calc-flex-col calc-gap-4 sm:calc-flex-row sm:calc-items-end sm:calc-justify-between">
          <div>
            <p className="calc-mb-2 calc-text-xs calc-font-bold calc-uppercase calc-tracking-[0.18em] calc-text-blue-500">Projected value</p>
            <h3 id="growthProjectionTitle" className="calc-m-0 calc-text-3xl calc-font-extrabold calc-tracking-tight sm:calc-text-4xl">{currency.format(result.totalBalance)}</h3>
            <p className="calc-mt-2 calc-text-sm" style={{ color: "var(--ink-2)" }}>Estimated balance after {years} {years === 1 ? "year" : "years"}</p>
          </div>
          <div className="calc-grid calc-grid-cols-2 calc-gap-3">
            <div className="calc-rounded-xl calc-border calc-border-blue-500/20 calc-bg-blue-500/10 calc-p-3">
              <span className="calc-block calc-text-xs calc-text-blue-500">Principal</span>
              <strong className="calc-mt-1 calc-block calc-text-base">{currency.format(result.totalPrincipal)}</strong>
            </div>
            <div className="calc-rounded-xl calc-border calc-border-emerald-500/20 calc-bg-emerald-500/10 calc-p-3">
              <span className="calc-block calc-text-xs calc-text-emerald-500">Interest</span>
              <strong className="calc-mt-1 calc-block calc-text-base">{currency.format(result.totalInterest)}</strong>
            </div>
          </div>
        </div>

        <div className="calc-chart-panel calc-mt-7">
          <div className="calc-chart-header">
            <div>
              <span className="calc-chart-eyebrow">Growth composition</span>
              <strong className="calc-chart-heading">Principal &amp; compound return</strong>
            </div>
            <div className="calc-chart-legend" aria-label="Chart legend">
              <span><i className="calc-chart-legend-mark calc-chart-legend-principal" />Principal contributed</span>
              <span><i className="calc-chart-legend-mark calc-chart-legend-interest" />Interest earned</span>
            </div>
          </div>

          <div className="calc-chart-canvas" role="img" aria-label="Projected principal and interest growth by year">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={result.points} margin={{ top: 12, right: 10, left: 4, bottom: 2 }}>
              <defs>
                <linearGradient id="principalFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} /><stop offset="55%" stopColor="#3b82f6" stopOpacity={0.18} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
                <linearGradient id="interestFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.44} /><stop offset="55%" stopColor="#22c55e" stopOpacity={0.16} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="month" type="number" domain={[0, years * 12]} ticks={yearTicks} stroke="var(--ink-3)" tickLine={false} axisLine={false} tickFormatter={(value: number) => value === 0 ? "0" : `${value / 12}Y`} minTickGap={30} />
              <YAxis stroke="var(--ink-3)" tickLine={false} axisLine={false} tickFormatter={compactMoney} width={52} />
              <Tooltip content={GrowthTooltip} cursor={{ stroke: "var(--chart-cursor)", strokeWidth: 1, strokeDasharray: "4 4" }} />
              <Area type="monotone" dataKey="principal" name="principal" stackId="growth" stroke="#3b82f6" fill="url(#principalFill)" strokeWidth={3} activeDot={{ r: 5, strokeWidth: 2, fill: "#101820" }} />
              <Area type="monotone" dataKey="interest" name="interest" stackId="growth" stroke="#22c55e" fill="url(#interestFill)" strokeWidth={3} activeDot={{ r: 5, strokeWidth: 2, fill: "#101820" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
}