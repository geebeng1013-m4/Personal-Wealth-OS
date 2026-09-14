/**
 * What the assistant is told about the user, and when.
 *
 * Two separate things get called "context", and keeping them apart is the whole
 * point of this module:
 *
 *   VOCABULARY — the names of the user's categories, accounts, tickers and
 *   brokers, plus today's date. No amounts, no balances. Sent in Record mode
 *   only, because "log RM50 on food" cannot be turned into a form entry without
 *   knowing that a category called Food exists. The feature does not work
 *   without it, so it is not optional, and the privacy notice says so plainly.
 *
 *   FIGURES — net worth, this month's income and spending, emergency-fund
 *   progress, goal progress. Sent in Ask mode ONLY when the user has turned
 *   figure sharing on. Off by default, and off is a real default: with it off
 *   nothing numeric about the user leaves the browser.
 *
 * Both are built here, both are pure functions of state, and both are capped so
 * a long account list cannot crowd out the conversation itself.
 */

import type { WealthState } from "../../models";
import { emergencyRatio } from "../../rules";
import { getPortfolioSnapshot } from "../../portfolioSummary";
import { getLedgerSnapshot } from "../../ledgerSummary";
import { getBudgetSnapshot } from "../../budgetSummary";
import { getGoalsSnapshot } from "../../goalSummary";
import { localDateKey } from "./assistantActions";

/** Must stay under MAX_CONTEXT_CHARS in functions/src/openrouterRequest.ts. */
export const MAX_CONTEXT_CHARS = 4000;

/** Long lists are trimmed rather than truncated mid-name. */
const MAX_CATEGORIES = 40;
const MAX_ACCOUNTS = 20;
const MAX_TICKERS = 20;
const MAX_PLATFORMS = 10;
const MAX_GOALS = 8;

function list(values: readonly string[], limit: number): string {
  const kept = values.filter((value) => value.trim().length > 0).slice(0, limit);
  return kept.length > 0 ? kept.join(", ") : "(none on file)";
}

function money(value: number): string {
  return `MYR ${Math.round(value).toLocaleString("en-MY")}`;
}

/**
 * Names only — the lists the model must choose from to fill a form.
 *
 * Deliberately excludes every figure: an account appears by name, never with
 * its balance.
 */
export function buildVocabularyContext(
  state: WealthState,
  now: Date,
  platforms: readonly string[],
): string {
  const expenseCategories = state.ledgerCategories.filter((category) => category.type === "expense").map((category) => category.label);
  const incomeCategories = state.ledgerCategories.filter((category) => category.type === "income").map((category) => category.label);
  const accounts = state.ledgerAccounts.map((account) => account.name);
  const tickers = ["VOO", "QQQM", ...state.customTickers];

  return [
    `Today is ${localDateKey(now)}.`,
    `Expense categories: ${list(expenseCategories, MAX_CATEGORIES)}`,
    `Income categories: ${list(incomeCategories, MAX_CATEGORIES)}`,
    `Accounts: ${list(accounts, MAX_ACCOUNTS)}`,
    `Tickers: ${list(tickers, MAX_TICKERS)}`,
    `Brokers: ${list(platforms, MAX_PLATFORMS)}`,
  ].join("\n");
}

/**
 * A small figures summary, for when the user has opted in.
 *
 * Rounded whole ringgit and whole percents: enough for the model to answer
 * "am I on track", not a transaction-level export. Nothing here identifies a
 * merchant, a counterparty or an individual transaction.
 */
export function buildFiguresContext(state: WealthState, now: Date): string {
  const ledger = getLedgerSnapshot(state, now);
  const portfolio = getPortfolioSnapshot(state);
  const budget = getBudgetSnapshot(state, now);
  const goals = getGoalsSnapshot(state);

  const lines = [
    `Base currency: ${state.profile.baseCurrency}.`,
    `Cash in accounts: ${money(ledger.totalPositiveBalance)}.`,
    `Invested capital: ${money(portfolio.totalInvestedMyr)} across ${portfolio.holdings.length} holdings.`,
    `This month — income ${money(ledger.currentMonth.income)}, spending ${money(ledger.currentMonth.expenses)}, surplus ${money(ledger.currentMonth.surplus)}.`,
    `Planned monthly surplus: ${money(budget.plannedSurplus)}.`,
    `Emergency fund: ${Math.round(emergencyRatio(state) * 100)}% of target.`,
    `Monthly DCA: ${money(state.dca.monthly)}.`,
  ];

  const goalLines = goals.ordered
    .slice(0, MAX_GOALS)
    .map((goal) => `  - ${goal.label}: ${Math.round(goal.progress * 100)}% funded`);
  if (goalLines.length > 0) lines.push("Goals:", ...goalLines);

  return lines.join("\n");
}

export interface ContextOptions {
  mode: "help" | "fill";
  /** The user's opt-in for sending figures in Ask mode. */
  shareFigures: boolean;
  platforms: readonly string[];
}

/**
 * The context string for one request, or "" when there is nothing to send.
 *
 * Record mode always carries the vocabulary and never the figures — filling a
 * form needs names, not balances. Ask mode carries the figures only on opt-in,
 * and the date either way so "this month" means the right month.
 */
export function buildAssistantContext(state: WealthState, now: Date, options: ContextOptions): string {
  const parts: string[] = [];

  if (options.mode === "fill") {
    parts.push(buildVocabularyContext(state, now, options.platforms));
  } else {
    parts.push(`Today is ${localDateKey(now)}.`);
    if (options.shareFigures) parts.push(buildFiguresContext(state, now));
  }

  const text = parts.join("\n");
  return text.length > MAX_CONTEXT_CHARS ? text.slice(0, MAX_CONTEXT_CHARS) : text;
}
