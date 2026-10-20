import type { Trade, WealthState } from "./models";
import { isCurrencyCode, isMarket, sidesOf } from "./tradeCurrency";
import { validateFinancialRule } from "./financialRules";
import { validateDividend } from "./dividends";

type RecordValue = Record<string, unknown>;

export class ImportValidationError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Import rejected at ${path}: ${reason}`);
    this.name = "ImportValidationError";
  }
}

function reject(path: string, reason: string): never { throw new ImportValidationError(path, reason); }
function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(path, "Expected an object.");
  return value as RecordValue;
}
function number(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) reject(path, "Expected a finite non-negative number.");
  return value;
}
function text(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== "string" || (nonempty && !value.trim())) reject(path, "Expected text.");
  return value;
}
function fields(value: RecordValue, path: string, numbers = "", strings = "", booleans = ""): void {
  for (const key of numbers.split(" ").filter(Boolean)) if (key in value) number(value[key], `${path}.${key}`);
  for (const key of strings.split(" ").filter(Boolean)) if (key in value) text(value[key], `${path}.${key}`);
  for (const key of booleans.split(" ").filter(Boolean)) if (key in value && typeof value[key] !== "boolean") reject(`${path}.${key}`, "Expected true or false.");
}
function choice(value: RecordValue, key: string, choices: readonly unknown[], path: string): void {
  if (key in value && !choices.includes(value[key])) reject(`${path}.${key}`, "Unsupported value.");
}
function mapNumbers(value: unknown, path: string, max?: number): void {
  for (const [key, item] of Object.entries(record(value, path))) {
    if (!/^[A-Z0-9._^:-]{1,20}$/.test(key)) reject(path, "Invalid ticker.");
    if (number(item, `${path}.${key}`) > (max ?? Infinity)) reject(`${path}.${key}`, "Value is out of range.");
  }
}

/** Validate the calendar, not just Date.parse's rollover of e.g. February 30. */
export function isImportDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60
    && Number.isFinite(Date.parse(value.replace(/\//g, "-")));
}

export function validateImportedTrade(value: unknown, path: string): asserts value is Trade {
  const item = record(value, path);
  for (const key of ["id", "platform", "ticker"]) text(item[key], `${path}.${key}`, true);
  if (!/^[A-Z0-9._^:-]{1,20}$/.test(String(item.ticker))) reject(`${path}.ticker`, "Invalid ticker.");
  if (!isImportDate(item.date)) reject(`${path}.date`, "Invalid calendar date.");
  if (!["DCA", "Dip Buy", "Manual Buy", "Sell"].includes(String(item.type))) reject(`${path}.type`, "Unsupported trade type.");
  for (const key of ["amountMyr", "amountUsd", "priceUsd", "feeMyr"]) number(item[key], `${path}.${key}`);
  fields(item, path, "units exchangeRate amount price fee", "notes currency feeCurrency");
  if (item.exchangeRate === 0) reject(`${path}.exchangeRate`, "Expected a positive exchange rate.");
  if (item.market !== undefined && !isMarket(item.market)) reject(`${path}.market`, "Unsupported market.");
  for (const key of ["currency", "feeCurrency"]) if (item[key] !== undefined && !isCurrencyCode(item[key])) reject(`${path}.${key}`, "Invalid currency code.");
  const currency = item.currency ?? "USD";
  const amount = currency === "USD" ? item.amountUsd : item.amount;
  const price = currency === "USD" ? item.priceUsd : item.price;
  if (!(typeof amount === "number" && amount > 0)
    || !(typeof item.units === "number" && item.units > 0) && !(typeof price === "number" && price > 0)) {
    reject(path, "A trade needs a positive amount and a quantity or price.");
  }
}

/** Strict only at the file boundary; old local/cloud migration remains unchanged. */
export function validateBackup(value: unknown, currentVersion: number): asserts value is Partial<WealthState> {
  const input = record(value, "file");
  if (!Number.isInteger(input.version) || Number(input.version) < 1 || Number(input.version) > currentVersion) {
    reject("version", "Missing or unsupported backup version.");
  }
  if (!["profile", "cashflow", "trades", "goals", "ledgerAccounts", "buckets", "ledger", "transactions", "ledgerTransactions", "ledgerEntries", "liabilities"].some((key) => key in input)) {
    reject("file", "This is not a WealthUp backup.");
  }
  // No non-finite value, even inside an older/unknown optional block, may be
  // admitted by JSON numbers such as 1e309. Do not coerce strings into money.
  const walk = (item: unknown, path: string, depth = 0): void => {
    if (depth > 50) reject(path, "The backup is nested too deeply.");
    if (typeof item === "number" && !Number.isFinite(item)) reject(path, "Expected a finite non-negative number.");
    if (Array.isArray(item)) item.forEach((entry, index) => walk(entry, `${path}[${index}]`, depth + 1));
    else if (item && typeof item === "object") for (const [key, entry] of Object.entries(item)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) reject(path, "Unsupported property.");
      walk(entry, `${path}.${key}`, depth + 1);
    }
  };
  walk(input, "file");
  fields(input, "file", "updatedAt lastSyncedAt", "deviceId financialGoal ruleNoteTitle ruleNotes overviewGoalId", "onboardingDone homeActionDismissed");
  const block = (key: string, numbers: string, strings = "", booleans = ""): RecordValue | undefined => {
    if (!(key in input)) return undefined;
    const item = record(input[key], key);
    fields(item, key, numbers, strings, booleans);
    return item;
  };
  const profile = block("profile", "age investmentHorizonYears", "name stage riskTolerance baseCurrency");
  if (profile) { choice(profile, "riskTolerance", ["High", "Medium", "Low"], "profile"); choice(profile, "baseCurrency", ["MYR", "USD"], "profile"); }
  block("cashflow", "allowance transport food otherFixed irregularIncome");
  block("emergency", "current target annualYield monthlyTopUp");
  const dca = block("dca", "monthly");
  if (dca?.targets !== undefined) mapNumbers(dca.targets, "dca.targets", 1);
  const opportunity = block("opportunity", "total used");
  if (opportunity?.allocation !== undefined) mapNumbers(opportunity.allocation, "opportunity.allocation");
  block("privacy", "", "", "maskAmounts requireExportConfirmation");
  block("visitActivity", "", "lastActiveOn previousActiveOn returnedOn dismissedOn");
  block("checkins", "", "weeklyCheckedOn", "payPromptAnswered");
  if (input.onboardingAnswers !== undefined && input.onboardingAnswers !== null) {
    fields(record(input.onboardingAnswers, "onboardingAnswers"), "onboardingAnswers", "monthlyIncome monthlySpending cashInBank goalAmount debtRate debtMonthsLeft", "goalName answeredAt");
  }
  const list = (value: unknown, path: string, check: (item: RecordValue, path: string) => void): void => {
    if (!Array.isArray(value)) reject(path, "Expected a list.");
    const ids = new Set<string>();
    value.forEach((entry, index) => {
      const at = `${path}[${index}]`;
      const item = record(entry, at);
      if (item.id !== undefined) {
        const id = text(item.id, `${at}.id`, true);
        if (ids.has(id)) reject(`${at}.id`, "Duplicate record ID.");
        ids.add(id);
      }
      check(item, at);
    });
  };
  const date = (item: RecordValue, key: string, path: string): void => {
    if (!isImportDate(item[key])) reject(`${path}.${key}`, "Invalid calendar date.");
  };
  const schemas: Record<string, [string, string, string?]> = {
    buckets: ["amount", "id name label cadence note"],
    goals: ["current target monthlyContribution spentAmount", "id name label note accountId spentAt"],
    ledgerAccounts: ["openingBalance", "id name type icon color", "holdsTrackedPortfolio"],
    ledgerCategories: ["", "id label icon type"],
    liabilities: ["balance annualRate minimumPayment", "id name kind endMonth", "paidInFull"],
    recurringTransactions: ["amount dayOfMonth", "id label type accountId", "active"],
    netWorthSnapshots: ["assets liabilities", "id date"],
    reviews: ["income spending disciplineScore", "id month notes", "dcaDone"],
    ruleNotesList: ["createdAt", "id title body"],
    actionRecords: ["createdAt completedAt", "id recommendationId action status"],
  };
  for (const [key, [numbers, strings, booleans = ""]] of Object.entries(schemas)) if (key in input) {
    list(input[key], key, (item, path) => {
      fields(item, path, numbers, strings, booleans);
      for (const name of ["id", ...strings.split(" ").filter((field) => ["name", "label", "notes", "note", "body", "title"].includes(field))]) {
        // Legacy buckets can lack a label/note; migration supplies these.
        if (name === "id" || ["goals", "reviews"].includes(key)) text(item[name], `${path}.${name}`, name === "id");
      }
      if (key === "goals") {
        for (const field of ["current", "target", "monthlyContribution"]) number(item[field], `${path}.${field}`);
        if (item.spentAt !== undefined) date(item, "spentAt", path);
      }
      if (["buckets", "liabilities", "recurringTransactions", "netWorthSnapshots", "reviews"].includes(key)) {
        for (const field of numbers.split(" ").filter((field) => field !== "spentAmount")) number(item[field], `${path}.${field}`);
      }
      if (["ledgerAccounts", "liabilities"].includes(key)) text(item.name, `${path}.name`, true);
      if (key === "ledgerAccounts" && item.type === undefined) reject(path, "Unsupported value.");
      if (key === "ledgerCategories") {
        text(item.label, `${path}.label`, true); text(item.icon, `${path}.icon`);
        if (item.type === undefined) reject(path, "Unsupported value.");
      }
      if (key === "recurringTransactions") {
        text(item.label, `${path}.label`);
        if (!(Number(item.amount) > 0) || !Number.isInteger(item.dayOfMonth) || Number(item.dayOfMonth) < 1 || Number(item.dayOfMonth) > 31 || item.type === undefined) reject(path, "Value is out of range.");
      }
      if (key === "reviews" && (typeof item.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month))) reject(path, "Invalid calendar date.");
      if (key === "netWorthSnapshots") date(item, "date", path);
      if (key === "ledgerAccounts") choice(item, "type", ["bank", "wallet", "investment"], path);
      if (key === "ledgerCategories" || key === "recurringTransactions") choice(item, "type", ["income", "expense", ...(key === "ledgerCategories" ? ["transfer"] : [])], path);
    });
  }
  if ("trades" in input) list(input.trades, "trades", validateImportedTrade);
  if (opportunity && "tranches" in opportunity) list(opportunity.tranches, "opportunity.tranches", (item, path) => {
    fields(item, path, "drawdown percent amount", "", "deployed");
    for (const key of ["drawdown", "percent", "amount"]) number(item[key], `${path}.${key}`);
    if (Number(item.drawdown) <= 0 || Number(item.drawdown) > 100 || Number(item.percent) > 1) reject(path, "Value is out of range.");
  });
  if ("currencyExchanges" in input) list(input.currencyExchanges, "currencyExchanges", (item, path) => {
    date(item, "date", path);
    fields(item, path, "myrAmount usdAmount fromAmount toAmount", "id tradeId direction fromCurrency toCurrency notes");
    if (!sidesOf(item)) reject(path, "Invalid currency conversion.");
  });
  if ("dividends" in input) list(input.dividends, "dividends", (item, path) => {
    fields(item, path, "gross withholdingTax units perShare rateToMyr", "id ticker currency status notes");
    date(item, "exDate", path);
    if (item.payDate !== undefined) date(item, "payDate", path);
    if (!validateDividend(item) || (item.currency !== undefined && !isCurrencyCode(item.currency))) reject(path, "Invalid dividend amounts or currency.");
    choice(item, "status", ["confirmed", "dismissed"], path);
  });
  if ("financialRules" in input) list(input.financialRules, "financialRules", (item, path) => {
    if (!validateFinancialRule(item)) reject(path, "Invalid financial rule.");
  });
  if ("allocation" in input) {
    const allocation = record(input.allocation, "allocation");
    choice(allocation, "incomeType", ["fixed", "variable"], "allocation");
    list(allocation.steps, "allocation.steps", (item, path) => {
      text(item.name, `${path}.name`); number(item.value, `${path}.value`);
      choice(item, "kind", ["fill", "gross", "pct"], path);
    });
  }
  if ("monthPlans" in input) for (const [month, plan] of Object.entries(record(input.monthPlans, "monthPlans"))) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) reject("monthPlans", "Invalid calendar date.");
    number(record(plan, `monthPlans.${month}`).expectedIncome, `monthPlans.${month}.expectedIncome`);
  }
  const ledgerList = (value: unknown, path: string): void => {
    if (!Array.isArray(value)) {
      const container = record(value, path);
      if ("transactions" in container) ledgerList(container.transactions, `${path}.transactions`);
      else if ("entries" in container) ledgerList(container.entries, `${path}.entries`);
      else reject(path, "Expected a list.");
      return;
    }
    list(value, path, (item, at) => {
      text(item.id, `${at}.id`, true);
      number(item.amount, `${at}.amount`); date(item, "date", at);
      fields(item, at, "", "note categoryId accountId fromAccountId toAccountId");
      if (!(Number(item.amount) > 0) || !["income", "expense", "transfer"].includes(String(item.type))) reject(at, "Invalid ledger transaction.");
    });
  };
  for (const key of ["ledgerTransactions", "transactions", "ledgerEntries"]) if (key in input) ledgerList(input[key], key);
  if ("ledger" in input) {
    const legacy = record(input.ledger, "ledger");
    for (const key of ["transactions", "entries"]) if (key in legacy) ledgerList(legacy[key], `ledger.${key}`);
  }
  for (const key of ["customTickers", "hiddenRuleIds"]) if (key in input) {
    if (!Array.isArray(input[key]) || !input[key].every((item: unknown) => typeof item === "string")) reject(key, "Expected a list of text values.");
  }
}

/** Migration is deliberately tolerant for local recovery. A file import must
 * instead stop if that tolerance would quietly drop a supplied record. */
export function validateMigratedBackup(input: Partial<WealthState>, migrated: WealthState): void {
  const source = input as RecordValue;
  const result = migrated as unknown as RecordValue;
  const preserved = (before: unknown, after: unknown, path: string): void => {
    if (!Array.isArray(before) || !Array.isArray(after)) return;
    const ids = new Set(after.map((item: RecordValue) => item.id));
    if (after.length < before.length || before.some((item: RecordValue) => !ids.has(item.id))) reject(path, "Some records could not be restored. Nothing was imported.");
  };
  for (const key of ["buckets", "ledgerAccounts", "ledgerCategories", "trades", "goals", "liabilities", "recurringTransactions", "netWorthSnapshots", "reviews", "ruleNotesList", "actionRecords", "currencyExchanges", "dividends", "financialRules"]) {
    preserved(source[key], result[key], key);
  }
  const legacy = source.ledger as RecordValue | undefined;
  let ledger = source.ledgerTransactions ?? source.transactions ?? source.ledgerEntries ?? legacy?.transactions ?? legacy?.entries;
  if (ledger && !Array.isArray(ledger)) {
    const container = ledger as RecordValue;
    ledger = container.transactions ?? container.entries;
  }
  preserved(ledger, migrated.ledgerTransactions, "ledgerTransactions");
}
