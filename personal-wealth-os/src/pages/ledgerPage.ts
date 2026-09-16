/**
 * Ledger page — the transaction form, the filtered history, and the category
 * and account managers.
 *
 * Balances, type subtotals and category breakdowns come from getLedgerSnapshot,
 * the canonical model; only the filtered transaction list follows the user's
 * own arbitrary range/type/category filter and stays on the raw path.
 *
 * The page carries real cross-render state — the active filter, which panels
 * are expanded, the row being edited, a draft of the entry form kept across a
 * type switch, and a flag that suppresses the amount-field autofocus after an
 * in-place refresh. All of it was module-level state in ui.ts and is
 * module-level here, with the same lifetime: it lives until the tab closes.
 */

import type { LedgerAccountType, LedgerFundingSource, LedgerTransaction, LedgerTransactionType, WealthState } from "../models";
import type { LedgerDraft } from "../components/assistant/assistantTypes";
import { createId } from "../state";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import {
  categoryTotals,
  filterLedgerTransactions,
  ledgerTotals,
  monthlyLedgerTotals,
  normalizeLedgerAmount,
  openingFunds,
  type AccountBalance,
  type LedgerFilters,
} from "../ledger";
import { getLedgerSnapshot } from "../ledgerSummary";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

let ledgerFilters: LedgerFilters = { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "", fundingSource: "all" };
let ledgerEditingId = "";
let ledgerEntryType: LedgerTransactionType = "expense";
let suppressLedgerAmountFocus = false;
let ledgerEntryDraft = {
  amount: "",
  accountId: "",
  fromAccountId: "",
  toAccountId: "",
  date: "",
  note: "",
  /** Only ever set by the assistant; a hand-driven type switch leaves it "". */
  categoryId: "",
  fundingSource: "personal" as LedgerFundingSource,
};
// Collapsed by default (PLAN.md T-2): the page opens on what happened, not
// on a form. Opening any of these is a per-session preference, like the
// panels below.
let ledgerEntryOpen = false;
let ledgerFilterOpen = false;
let ledgerRecentExpanded = false;
let ledgerHistoryOpen = false;
let ledgerCategoriesOpen = false;
let ledgerAccountsOpen = false;

const ledgerAccountGroupsOpen: Record<LedgerAccountType, boolean> = {
  bank: true,
  wallet: true,
  investment: true,
};

function resetLedgerEntry(): void {
  ledgerEditingId = "";
  ledgerEntryType = "expense";
  ledgerEntryDraft = {
    amount: "",
    accountId: "",
    fromAccountId: "",
    toAccountId: "",
    date: "",
    note: "",
    categoryId: "",
    fundingSource: "personal",
  };
}

/**
 * Pre-fill the entry form from an assistant draft.
 *
 * Writes the same module draft a type switch already uses, so the next render
 * of ledgerTemplate picks it up — no DOM poking, and the form behaves exactly
 * as if the user had typed it. Nothing is recorded: the user still presses
 * Save, and every validation on that path still runs.
 *
 * The caller navigates to "ledger" after this.
 */
export function applyLedgerDraft(draft: LedgerDraft): void {
  ledgerEditingId = "";
  ledgerEntryType = draft.type;
  ledgerEntryDraft = {
    amount: String(draft.amount),
    accountId: draft.accountId ?? "",
    fromAccountId: "",
    toAccountId: "",
    date: draft.date,
    note: draft.note,
    categoryId: draft.categoryId ?? "",
    fundingSource: "personal",
  };
  // The assistant filled the form, so it has to be on screen.
  ledgerEntryOpen = true;
  // The amount is already filled, so stealing focus to it would only put the
  // caret in a field the user is meant to be checking, not retyping.
  suppressLedgerAmountFocus = true;
}

function localDateValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function ledgerTemplate(state: WealthState): string {
  const filtered = filterLedgerTransactions(state.ledgerTransactions, ledgerFilters, new Date(), state.ledgerCategories, state.ledgerAccounts);
  // Totals here follow the user's own filter (arbitrary range/type/category),
  // so they deliberately stay on the raw path rather than the canonical model.
  const totals = ledgerTotals(filtered);
  const totalOpeningFunds = openingFunds(state.ledgerAccounts);
  // Account balances and type totals are canonical ledger facts.
  const ledger = getLedgerSnapshot(state);
  const liquidNetAssets = ledger.accountTypeBalances.bank + ledger.accountTypeBalances.wallet;
  const totalNetAssets = liquidNetAssets + ledger.accountTypeBalances.investment;
  const editing = state.ledgerTransactions.find((transaction) => transaction.id === ledgerEditingId);
  const entryType = editing?.type ?? ledgerEntryType;
  const entryCategories = state.ledgerCategories.filter((category) => category.type === entryType);
  const balances = ledger.accountBalances;
  const accountTypeMeta = (type: LedgerAccountType): { label: string; emptyLabel: string; icon: string } => {
    if (type === "bank") return { label: "Bank account", emptyLabel: "bank accounts", icon: "🏦" };
    if (type === "wallet") return { label: "E-wallet", emptyLabel: "e-wallets", icon: "👛" };
    return { label: "Investment account", emptyLabel: "investment accounts", icon: "📈" };
  };
  const money2 = (value: number): string => `<span class="t-num ${value < 0 ? "wu-metric__value--negative" : ""}">${value < 0 ? "−" : ""}${money(Math.abs(value))}</span>`;
  const accountName = (id?: string): string => state.ledgerAccounts.find((account) => account.id === id)?.name ?? "Unknown account";
  const accountOptions = (selected?: string): string => state.ledgerAccounts.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === selected ? " selected" : ""}>${escapeHtml((account.icon ?? accountTypeMeta(account.type).icon) + " " + account.name)}</option>`).join("");
  const accountIds = new Set(state.ledgerAccounts.map((account) => account.id));
  const defaultAccountId = state.ledgerAccounts[0]?.id ?? "";
  const selectedAccountId = accountIds.has(editing?.accountId ?? ledgerEntryDraft.accountId) ? editing?.accountId ?? ledgerEntryDraft.accountId : defaultAccountId;
  const requestedFromAccountId = editing?.fromAccountId ?? ledgerEntryDraft.fromAccountId;
  const selectedFromAccountId = accountIds.has(requestedFromAccountId) ? requestedFromAccountId : defaultAccountId;
  const requestedToAccountId = editing?.toAccountId ?? ledgerEntryDraft.toAccountId;
  const selectedToAccountId = accountIds.has(requestedToAccountId) && requestedToAccountId !== selectedFromAccountId
    ? requestedToAccountId
    : state.ledgerAccounts.find((account) => account.id !== selectedFromAccountId)?.id ?? "";
  // Only an assistant draft sets this. When it names a category that exists for
  // this entry type, that chip is pre-selected instead of the first one.
  const draftCategoryId = entryCategories.some((category) => category.id === ledgerEntryDraft.categoryId)
    ? ledgerEntryDraft.categoryId
    : "";
  const transferUnavailable = entryType === "transfer" && state.ledgerAccounts.length < 2;
  const entryAmount = editing ? String(editing.amount) : ledgerEntryDraft.amount;
  const entryDate = editing?.date ? localDateValue(editing.date) : ledgerEntryDraft.date || localDateValue();
  const entryNote = editing?.note ?? ledgerEntryDraft.note;
  const entryFundingSource: LedgerFundingSource = (editing?.fundingSource ?? ledgerEntryDraft.fundingSource) === "sponsored" ? "sponsored" : "personal";
  // Category Share breaks down where the user's OWN money went, so sponsored/
  // earmarked transactions (money that passed through but was never theirs to
  // budget) are excluded here — unlike the raw Income/Expenses cards above,
  // which deliberately show full cash flow.
  const personalExpenseTransactions = filtered.filter((transaction) => transaction.fundingSource !== "sponsored");
  const expenses = categoryTotals(personalExpenseTransactions, state.ledgerCategories, "expense");
  const personalExpenseTotal = ledgerTotals(personalExpenseTransactions).expense;
  const monthly = monthlyLedgerTotals(state.ledgerTransactions, new Date().getFullYear());
  const categoryOptions = state.ledgerCategories.map((category) => `<option value="${escapeHtml(category.id)}"${ledgerFilters.categoryId === category.id ? " selected" : ""}>${escapeHtml(category.icon + " " + category.label)}</option>`).join("");
  const transactionRows = filtered.map((transaction) => {
    const category = state.ledgerCategories.find((item) => item.id === transaction.categoryId);
    const title = transaction.type === "transfer" ? `${accountName(transaction.fromAccountId)} → ${accountName(transaction.toAccountId)}` : category?.label ?? "Unknown category";
    const accountMeta = transaction.type === "transfer" ? "Transfer" : accountName(transaction.accountId);
    const icon = transaction.type === "transfer" ? "↔" : category?.icon ?? "•";
    const amountPrefix = transaction.type === "income" ? "+" : transaction.type === "expense" ? "−" : "↔ ";
    const amountTone = transaction.type === "income" ? " wu-metric__value--positive" : transaction.type === "expense" ? " wu-metric__value--negative" : "";
    const sponsoredBadge = transaction.fundingSource === "sponsored" ? ' <span class="wu-badge wu-badge--neutral">Sponsored</span>' : "";
    return `<div class="wu-list__row"><span class="wu-row wu-row--tight"><span aria-hidden="true">${escapeHtml(icon)}</span><span class="wu-stack wu-stack--sm"><strong class="t-subheading">${escapeHtml(title)}${sponsoredBadge}</strong><span class="t-caption t-faint">${new Date(transaction.date).toLocaleDateString()} &middot; ${escapeHtml(accountMeta)}${transaction.note ? " &middot; " + escapeHtml(transaction.note) : ""}</span></span></span><strong class="t-num${amountTone}">${amountPrefix}${money(transaction.amount)}</strong><button class="wu-btn wu-btn--ghost wu-btn--icon edit-ledger" data-id="${escapeHtml(transaction.id)}" type="button" aria-label="Edit transaction">✎</button><button class="wu-btn wu-btn--ghost wu-btn--icon delete-ledger" data-id="${escapeHtml(transaction.id)}" type="button" aria-label="Delete transaction">✕</button></div>`;
  }).join("");

  const presetLabel: Record<string, string> = { today: "Today", week: "This week", month: "This month", year: "This year", custom: "Custom" };
  const entryOpen = ledgerEntryOpen || Boolean(editing);

  // One row per transaction: what it was, then the short facts, then the
  // amount. Long explanations and badges are gone (PLAN.md T-2).
  const transactionRow = (transaction: LedgerTransaction): string => {
    const category = state.ledgerCategories.find((item) => item.id === transaction.categoryId);
    const title = transaction.type === "transfer"
      ? `${accountName(transaction.fromAccountId)} → ${accountName(transaction.toAccountId)}`
      : transaction.note || category?.label || "Transaction";
    const facts = [
      transaction.type === "transfer" ? "Transfer" : category?.label ?? "Uncategorised",
      new Date(transaction.date).toLocaleDateString("en-MY", { day: "numeric", month: "short" }),
      transaction.type === "transfer" ? "" : accountName(transaction.accountId),
      transaction.fundingSource === "sponsored" ? "Sponsored" : "",
    ].filter(Boolean).join(" · ");
    const prefix = transaction.type === "income" ? "+" : transaction.type === "expense" ? "−" : "↔ ";
    const tone = transaction.type === "income" ? " t-positive" : transaction.type === "expense" ? " t-negative" : "";
    return `<li class="wu-ledger-row">
      <span class="wu-ledger-row__title">${escapeHtml(title)}<small>${escapeHtml(facts)}</small></span>
      <span class="wu-ledger-row__amount${tone}">${prefix}${money(transaction.amount, "").trim()}</span>
      <span class="wu-row wu-row--tight">
        <button class="wu-btn wu-btn--ghost wu-btn--icon edit-ledger" data-id="${escapeHtml(transaction.id)}" type="button" aria-label="Edit transaction">✎</button>
        <button class="wu-btn wu-btn--ghost wu-btn--icon delete-ledger" data-id="${escapeHtml(transaction.id)}" type="button" aria-label="Delete transaction">✕</button>
      </span>
    </li>`;
  };
  const RECENT_LIMIT = 5;
  const netTotal = totals.income - totals.expense;
  const keptShare = totals.income > 0 ? Math.min(Math.max(netTotal / totals.income, 0), 1) : 0;
  const shown = ledgerRecentExpanded ? filtered : filtered.slice(0, RECENT_LIMIT);
  const amountOf = (value: number): string => money(value, "").trim();

  // Where this month's spending went, as one bar instead of a donut: the top
  // four categories, then everything else.
  const topCategories = expenses.slice(0, 4);
  const otherTotal = expenses.slice(4).reduce((sum, item) => sum + item.amount, 0);
  const categoryPalette = ["var(--accent)", "var(--highlight)", "var(--slate, #6f86a6)", "var(--negative)"];
  const thisMonthIndex = new Date().getMonth();
  const monthLabel = (month: number): string => new Date(2000, month, 1).toLocaleDateString("en-MY", { month: "short" });
  const lastThree = monthly.slice(Math.max(0, thisMonthIndex - 2), thisMonthIndex + 1);
  const lastThreeMax = Math.max(...lastThree.flatMap((item) => [item.income, item.expense]), 1);

  return `<div class="wu ledger-page">
    ${pageHeader({
      eyebrow: "Everyday Money",
      title: "Ledger",
      sub: "Record income and spending, see where the money goes.",
      actions: `<div class="wu-segmented">${(["today", "week", "month", "year", "custom"] as const).map((preset) => `<button type="button" data-preset="${preset}" class="wu-segmented__option${ledgerFilters.preset === preset ? " is-active" : ""}">${presetLabel[preset]}</button>`).join("")}</div>
        <button class="wu-btn wu-btn--secondary wu-btn--sm" id="ledgerFilterToggle" type="button" aria-expanded="${ledgerFilterOpen}" aria-controls="ledgerFilterForm">${ledgerFilterOpen ? "Hide filter" : "Filter"}</button>
        <button class="wu-btn wu-btn--primary wu-btn--sm" id="ledgerAddToggle" type="button" aria-expanded="${entryOpen}" aria-controls="ledgerEntryPanel">${entryOpen ? "Close" : "+ Add transaction"}</button>`,
    })}

    <div class="wu-dash wu-dash--start">
      <!-- ENTRY FORM — collapsed until asked for, or while editing -->
      <section class="wu-card wu-dash__full wu-ledger-entry" id="ledgerEntryPanel"${entryOpen ? "" : " hidden"}>
        <div class="wu-tc__top">
          <span class="wu-label">${editing ? "Edit transaction" : "Add transaction"}</span>
          ${editing ? '<button id="cancelLedgerEdit" class="wu-btn wu-btn--ghost wu-btn--sm" type="button">Cancel</button>' : ""}
        </div>
        <form id="ledgerForm" class="wu-stack">
          <input name="id" type="hidden" value="${escapeHtml(editing?.id ?? "")}">
          <div class="wu-segmented" role="group" aria-label="Transaction type">
            <button type="button" data-ledger-type="expense" class="wu-segmented__option${entryType === "expense" ? " is-active" : ""}">&minus; Expense</button>
            <button type="button" data-ledger-type="income" class="wu-segmented__option${entryType === "income" ? " is-active" : ""}">+ Income</button>
            <button type="button" data-ledger-type="transfer" class="wu-segmented__option${entryType === "transfer" ? " is-active" : ""}">&harr; Transfer</button>
          </div>
          <input name="type" type="hidden" value="${entryType}">
          <label class="wu-field-row"><span class="wu-field-row__label">Amount (MYR)</span><input id="ledgerAmount" class="wu-field" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${escapeHtml(entryAmount)}" placeholder="0.00"></label>
          ${entryType === "transfer"
            ? `<div class="wu-grid wu-grid--2"><label class="wu-field-row"><span class="wu-field-row__label">From account</span><select class="wu-field" name="fromAccountId" required>${accountOptions(selectedFromAccountId)}</select></label><label class="wu-field-row"><span class="wu-field-row__label">To account</span><select class="wu-field" name="toAccountId" required>${accountOptions(selectedToAccountId)}</select></label></div>`
            : `<label class="wu-field-row"><span class="wu-field-row__label">Account</span><select class="wu-field" name="accountId" required>${accountOptions(selectedAccountId)}</select></label>
          <fieldset class="wu-fieldset"><legend class="wu-field-row__label">Category</legend><div class="wu-row wu-row--tight">${entryCategories.map((category, index) => `<label class="wu-chip"><input name="categoryId" type="radio" value="${escapeHtml(category.id)}"${category.id === editing?.categoryId || (!editing && (draftCategoryId ? category.id === draftCategoryId : index === 0)) ? " checked" : ""}><span>${escapeHtml(category.icon)} ${escapeHtml(category.label)}</span></label>`).join("")}</div></fieldset>
          <label class="wu-switch"><input type="checkbox" name="fundingSource" value="sponsored"${entryFundingSource === "sponsored" ? " checked" : ""}><span class="wu-switch__track"></span><span class="wu-switch__label">Sponsored / earmarked money — not part of my budget</span></label>`}
          <details class="wu-details"${editing ? " open" : ""}><summary class="wu-details__summary"><span class="t-subheading">Date &amp; note</span></summary><div class="wu-grid wu-grid--2"><label class="wu-field-row"><span class="wu-field-row__label">Date</span><input class="wu-field" name="date" type="date" required value="${entryDate}"></label><label class="wu-field-row"><span class="wu-field-row__label">Note</span><input class="wu-field" name="note" maxlength="500" value="${escapeHtml(entryNote)}" placeholder="Optional"></label></div></details>
          <p id="ledgerFormError" class="wu-field-row__error" role="alert">${transferUnavailable ? "Add at least two accounts before recording a transfer." : ""}</p>
          <button class="wu-btn wu-btn--primary wu-btn--block" type="submit"${transferUnavailable ? " disabled" : ""}>${editing ? "Save Changes" : "Save Transaction"}</button>
        </form>
      </section>

      <!-- FILTER — one panel, shared by the figures and the list below -->
      <form id="ledgerFilterForm" class="wu-card wu-dash__full wu-stack wu-stack--sm"${ledgerFilterOpen ? "" : " hidden"}>
        <div class="wu-grid wu-grid--wide wu-ledger-filter-fields ${ledgerFilters.preset === "custom" ? "show-custom" : ""}">
              <label class="wu-field-row custom-date"><span class="wu-field-row__label">From</span><input class="wu-field" name="startDate" type="date" value="${ledgerFilters.startDate}"></label>
              <label class="wu-field-row custom-date"><span class="wu-field-row__label">To</span><input class="wu-field" name="endDate" type="date" value="${ledgerFilters.endDate}"></label>
              <label class="wu-field-row"><span class="wu-field-row__label">Type</span><select class="wu-field" name="type"><option value="all">All types</option><option value="expense"${ledgerFilters.type === "expense" ? " selected" : ""}>Expense</option><option value="income"${ledgerFilters.type === "income" ? " selected" : ""}>Income</option><option value="transfer"${ledgerFilters.type === "transfer" ? " selected" : ""}>Transfer</option></select></label>
              <label class="wu-field-row"><span class="wu-field-row__label">Funding</span><select class="wu-field" name="fundingSource"><option value="all">All funding</option><option value="personal"${ledgerFilters.fundingSource === "personal" ? " selected" : ""}>Personal only</option><option value="sponsored"${ledgerFilters.fundingSource === "sponsored" ? " selected" : ""}>Sponsored only</option></select></label>
              <label class="wu-field-row"><span class="wu-field-row__label">Category</span><select class="wu-field" name="categoryId"><option value="">All categories</option>${categoryOptions}</select></label>
              <label class="wu-field-row"><span class="wu-field-row__label">Search</span><input class="wu-field" name="query" type="search" value="${escapeHtml(ledgerFilters.query)}" placeholder="Note, category, account"></label>
              <div class="wu-row wu-self-end"><button class="wu-btn wu-btn--ghost wu-btn--sm" id="resetLedgerFilters" type="button">Reset</button></div>
            </div>
      </form>

      <!-- ROW 1 — the period's four figures, all the same size -->
      <div class="wu-dash__full wu-dash__tiles">
        <section class="wu-card wu-dash__tile" aria-labelledby="ledgerIncomeLabel">
          <div class="wu-tc__top"><span class="wu-label" id="ledgerIncomeLabel">Income</span></div>
          <p class="wu-money wu-money--md t-positive"><span class="wu-money__cur">MYR</span><span>${amountOf(totals.income)}</span></p>
          <p class="wu-dash__note">${escapeHtml(presetLabel[ledgerFilters.preset] ?? "Selected range")}</p>
        </section>
        <section class="wu-card wu-dash__tile" aria-labelledby="ledgerSpentLabel">
          <div class="wu-tc__top"><span class="wu-label" id="ledgerSpentLabel">Spent</span></div>
          <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(totals.expense)}</span></p>
          <p class="wu-dash__note">${personalExpenseTotal < totals.expense ? `${amountOf(totals.expense - personalExpenseTotal)} sponsored` : "All personal money"}</p>
        </section>
        <section class="wu-card wu-dash__tile" aria-labelledby="ledgerNetLabel">
          <div class="wu-tc__top"><span class="wu-label" id="ledgerNetLabel">Net</span></div>
          <p class="wu-money wu-money--md ${netTotal >= 0 ? "t-positive" : "t-negative"}"><span class="wu-money__cur">MYR</span><span>${netTotal >= 0 ? "+" : "−"}${amountOf(Math.abs(netTotal))}</span></p>
          <p class="wu-dash__note">${totals.income > 0 ? `${Math.round(keptShare * 100)}% of income kept` : "No income recorded yet"}</p>
          <div class="wu-bar" role="progressbar" aria-valuenow="${Math.round(keptShare * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Share of income kept">
            <span class="wu-bar__fill" style="width:${Math.round(keptShare * 100)}%"></span>
          </div>
        </section>
        <section class="wu-card wu-dash__tile" aria-labelledby="ledgerAssetsLabel">
          <div class="wu-tc__top"><span class="wu-label" id="ledgerAssetsLabel">Net assets</span><span class="wu-chip wu-chip--muted">Liquid ${amountOf(liquidNetAssets)}</span></div>
          <p class="wu-money wu-money--md"><span class="wu-money__cur">MYR</span><span>${amountOf(totalNetAssets)}</span></p>
          <p class="wu-dash__note">Across ${state.ledgerAccounts.length} ${state.ledgerAccounts.length === 1 ? "account" : "accounts"}</p>
        </section>
      </div>

      <!-- ROW 2 — recent transactions | spending and trend -->
      <section class="wu-card wu-dash__half wu-stack wu-stack--sm" aria-labelledby="ledgerRecentLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ledgerRecentLabel">Recent transactions</span></div>
        ${filtered.length === 0
          ? `<p class="wu-empty">No transactions match this filter yet.</p>`
          : `<ul class="wu-ledger-list">${shown.map(transactionRow).join("")}</ul>`}
        ${filtered.length > RECENT_LIMIT
          ? `<button class="wu-btn wu-btn--ghost wu-btn--sm wu-self-end" id="ledgerSeeAll" type="button">${ledgerRecentExpanded ? "Show less" : `See all ${filtered.length}`}</button>`
          : ""}
      </section>

      
      <div class="wu-dash__half wu-stack wu-stack--sm">
        <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ledgerCategoryLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ledgerCategoryLabel">Spending by category</span><span class="wu-chip wu-chip--muted">${amountOf(personalExpenseTotal)} personal</span></div>
        ${personalExpenseTotal > 0 ? `
          <div class="wu-split" aria-hidden="true">
            ${topCategories.map((item, index) => `<span style="flex:${Math.max(item.amount, 0.01)};background:${categoryPalette[index]}"></span>`).join("")}
            ${otherTotal > 0 ? `<span style="flex:${otherTotal};background:var(--text-faint)"></span>` : ""}
          </div>
          <ul class="wu-cat-rows">
            ${topCategories.map((item, index) => `<li><i style="background:${categoryPalette[index]}"></i><span>${escapeHtml(item.category.icon ?? "")} ${escapeHtml(item.category.label)}</span><span><b>${amountOf(item.amount)}</b><small>${Math.round(item.share * 100)}%</small></span></li>`).join("")}
            ${otherTotal > 0 ? `<li><i style="background:var(--text-faint)"></i><span>Other categories</span><span><b>${amountOf(otherTotal)}</b><small>${Math.round((otherTotal / personalExpenseTotal) * 100)}%</small></span></li>` : ""}
          </ul>
          ${totals.expense > personalExpenseTotal ? `<p class="wu-dash__note">${amountOf(totals.expense - personalExpenseTotal)} sponsored money is not counted here</p>` : ""}
        ` : `<p class="wu-dash__note">No personal spending recorded in this period.</p>`}
      </section>
        <section class="wu-card wu-stack wu-stack--sm" aria-labelledby="ledgerTrendLabel">
        <div class="wu-tc__top"><span class="wu-label" id="ledgerTrendLabel">Last 3 months</span></div>
        <div class="wu-minibars">
          ${lastThree.map((item) => `<div class="wu-minibars__month">
            <div class="wu-minibars__pair">
              <i style="height:${Math.round((item.income / lastThreeMax) * 100)}%;background:var(--accent)" title="Income ${amountOf(item.income)}"></i>
              <i style="height:${Math.round((item.expense / lastThreeMax) * 100)}%;background:var(--highlight)" title="Spent ${amountOf(item.expense)}"></i>
            </div>
            <small>${monthLabel(item.month)}</small>
          </div>`).join("")}
        </div>
        <div class="wu-legend"><span><i style="background:var(--accent)"></i>Income</span><span><i style="background:var(--highlight)"></i>Spent</span></div>
      </section>
      </div>

      <!-- ROW 3 — every account, grouped -->
      <section class="wu-card wu-dash__full wu-stack wu-stack--sm" aria-labelledby="ledgerAccountsLabel2">
        <div class="wu-tc__top"><span class="wu-label" id="ledgerAccountsLabel2">Accounts</span><span class="wu-chip wu-chip--muted">Opening ${amountOf(totalOpeningFunds)}</span></div>
        <!-- Grouped by kind and laid out across the card: a flat list of a
             dozen accounts is a long scroll that says nothing about which
             money is spendable. -->
        <div class="wu-acct-groups">
          ${(["bank", "wallet", "investment"] as const).map((type) => {
            const group = balances.filter(({ account }) => account.type === type);
            if (group.length === 0) return "";
            const subtotal = group.reduce((sum, item) => sum + item.balance, 0);
            const meta = accountTypeMeta(type);
            return `<section class="wu-acct-group" aria-label="${escapeHtml(meta.label)}">
              <div class="wu-acct-group__head">
                <span class="wu-label">${escapeHtml(meta.icon)} ${escapeHtml(type === "bank" ? "Bank" : type === "wallet" ? "E-wallet" : "Investment")}</span>
                <span class="wu-acct-group__total${subtotal < 0 ? " t-negative" : ""}">${subtotal < 0 ? "−" : ""}${amountOf(Math.abs(subtotal))}</span>
              </div>
              <ul class="wu-facts wu-facts--plain">
                ${group.map(({ account, balance }: AccountBalance) => `<li><span>${escapeHtml(account.icon ?? meta.icon)} ${escapeHtml(account.name)}</span><span class="${balance < 0 ? "t-negative" : ""}">${balance < 0 ? "−" : ""}${amountOf(Math.abs(balance))}</span></li>`).join("")}
              </ul>
      </section>`;
          }).join("")}
        </div>
        <p class="wu-dash__note">${state.ledgerAccounts.length} ${state.ledgerAccounts.length === 1 ? "account" : "accounts"}</p>
      </section>

      
      
      <!-- MANAGERS — history, categories and accounts stay, collapsed -->
      <div class="wu-dash__full wu-stack wu-stack--sm">
        <details id="ledgerHistoryPanel" class="wu-details"${ledgerHistoryOpen ? " open" : ""}><summary class="wu-details__summary"><span class="wu-row wu-row--tight"><strong class="t-heading">History</strong><span class="t-caption t-faint">${filtered.length} records</span></span></summary><div class="wu-stack wu-stack--sm">${transactionRows || `<p class="wu-empty">No transactions match this view. Add your first record above.</p>`}</div></details>
        <details id="ledgerCategoriesPanel" class="wu-details"${ledgerCategoriesOpen ? " open" : ""}><summary class="wu-details__summary"><span class="wu-row wu-row--tight"><strong class="t-heading">Category Manager</strong><span class="t-caption t-faint">${state.ledgerCategories.length} categories</span></span></summary><div class="wu-stack">
          <form id="ledgerCategoryForm" class="wu-grid wu-grid--2">
            <label class="wu-field-row"><span class="wu-field-row__label">Icon</span><input class="wu-field" name="icon" maxlength="12" value="✨" required></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Label</span><input class="wu-field" name="label" maxlength="40" placeholder="Category name" required></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Type</span><select class="wu-field" name="type"><option value="expense">Expense</option><option value="income">Income</option></select></label>
            <div class="wu-row wu-self-end"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Add Category</button></div>
          </form>
          <ul class="wu-list">${state.ledgerCategories.map((category) => `<li class="wu-list__row"><span>${escapeHtml(category.icon)} ${escapeHtml(category.label)} &middot; ${category.type}</span><button class="wu-btn wu-btn--ghost wu-btn--sm edit-category" data-id="${escapeHtml(category.id)}" type="button">Edit</button><button class="wu-btn wu-btn--ghost wu-btn--icon delete-category" data-id="${escapeHtml(category.id)}" type="button" aria-label="Delete ${escapeHtml(category.label)}">&times;</button></li>`).join("")}</ul>
        </div></details>
        <details id="ledgerAccountsPanel" class="wu-details"${ledgerAccountsOpen ? " open" : ""}><summary class="wu-details__summary"><span class="wu-row wu-row--tight"><strong class="t-heading">Account Manager</strong><span class="t-caption t-faint">${state.ledgerAccounts.length} accounts</span></span></summary><div class="wu-stack">
          <form id="ledgerAccountForm" class="wu-grid wu-grid--2">
            <label class="wu-field-row"><span class="wu-field-row__label">Icon</span><input class="wu-field" name="icon" maxlength="12" value="🏦" required></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Name</span><input class="wu-field" name="name" maxlength="40" placeholder="Account name" required></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Type</span><select class="wu-field" name="type"><option value="bank">Bank</option><option value="wallet">Wallet</option><option value="investment">Investment</option></select></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Opening balance (MYR)</span><input class="wu-field" name="openingBalance" type="number" min="0" step="0.01" value="0" required></label>
            <div class="wu-row wu-field-row--wide"><button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Add Account</button></div>
          </form>
          <p id="ledgerAccountError" class="wu-field-row__error" role="alert"></p>
          <div class="wu-stack wu-stack--sm">${balances.map(({ account, balance }) => `<div class="wu-card wu-card--inset wu-card--pad-sm"><div class="wu-stack wu-stack--sm"><div class="wu-row wu-row--between"><div class="wu-stack wu-stack--sm"><strong class="t-subheading">${escapeHtml(account.icon ?? "•")} ${escapeHtml(account.name)}</strong><span class="t-caption t-faint">${accountTypeMeta(account.type).label}</span></div><div class="wu-row wu-row--tight"><button class="wu-btn wu-btn--ghost wu-btn--sm edit-account" data-id="${escapeHtml(account.id)}" type="button" aria-label="Edit ${escapeHtml(account.name)}">Edit</button><button class="wu-btn wu-btn--ghost wu-btn--icon delete-account" data-id="${escapeHtml(account.id)}" type="button" aria-label="Delete ${escapeHtml(account.name)}">&times;</button></div></div><div class="wu-row wu-row--between"><span class="t-caption t-muted">Opening ${money(account.openingBalance)}</span><span class="t-caption t-muted">Current ${money2(balance)}</span></div>${account.type === "investment" ? `<label class="wu-switch account-portfolio-link"><input type="checkbox" class="toggle-portfolio-link" data-id="${escapeHtml(account.id)}"${account.holdsTrackedPortfolio ? " checked" : ""}><span class="wu-switch__track"></span><span class="wu-switch__label">This account holds my tracked portfolio</span></label>` : ""}</div></div>`).join("")}</div>
        </div></details>
      </div>
    </div>`;
}

export function bindLedger(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const refresh = (next = state, label?: string, preserveScroll = false) => {
    const anchorTop = preserveScroll
      ? root.querySelector<HTMLElement>(".ledger-filters")?.getBoundingClientRect().top
      : undefined;
    const scrollPosition = preserveScroll
      ? { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 }
      : null;
    if (preserveScroll) suppressLedgerAmountFocus = true;
    if (next !== state) setState(next, label);
    rerender(root, next, setState, "ledger", navigate);
    if (!scrollPosition) return;

    const restoreScroll = () => {
      const nextAnchorTop = root.querySelector<HTMLElement>(".ledger-filters")?.getBoundingClientRect().top;
      if (anchorTop !== undefined && nextAnchorTop !== undefined) {
        window.scrollBy(0, nextAnchorTop - anchorTop);
      } else {
        window.scrollTo(scrollPosition.x, scrollPosition.y);
        document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
      }
    };
    restoreScroll();
    requestAnimationFrame(() => {
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    });
  };

  root.querySelector<HTMLDetailsElement>("#ledgerHistoryPanel")?.addEventListener("toggle", (event) => {
    ledgerHistoryOpen = (event.currentTarget as HTMLDetailsElement).open;
  });
  root.querySelector<HTMLDetailsElement>("#ledgerCategoriesPanel")?.addEventListener("toggle", (event) => {
    ledgerCategoriesOpen = (event.currentTarget as HTMLDetailsElement).open;
  });
  root.querySelector<HTMLDetailsElement>("#ledgerAccountsPanel")?.addEventListener("toggle", (event) => {
    ledgerAccountsOpen = (event.currentTarget as HTMLDetailsElement).open;
  });
  root.querySelectorAll<HTMLDetailsElement>("[data-ledger-account-group]").forEach((group) => {
    group.addEventListener("toggle", () => {
      const type = group.dataset.ledgerAccountGroup as LedgerAccountType | undefined;
      if (type) ledgerAccountGroupsOpen[type] = group.open;
    });
  });

  if (suppressLedgerAmountFocus) {
    suppressLedgerAmountFocus = false;
  } else {
    root.querySelector<HTMLInputElement>("#ledgerAmount")?.focus({ preventScroll: true });
  }
  root.querySelectorAll<HTMLButtonElement>("[data-ledger-type]").forEach((button) => button.addEventListener("click", () => {
    const type = button.dataset.ledgerType as LedgerTransactionType;
    const form = root.querySelector<HTMLFormElement>("#ledgerForm");
    ledgerEntryDraft = {
      amount: (form?.elements.namedItem("amount") as HTMLInputElement | null)?.value ?? "",
      accountId: (form?.elements.namedItem("accountId") as HTMLSelectElement | null)?.value ?? ledgerEntryDraft.accountId,
      fromAccountId: (form?.elements.namedItem("fromAccountId") as HTMLSelectElement | null)?.value ?? ledgerEntryDraft.fromAccountId,
      toAccountId: (form?.elements.namedItem("toAccountId") as HTMLSelectElement | null)?.value ?? ledgerEntryDraft.toAccountId,
      date: (form?.elements.namedItem("date") as HTMLInputElement | null)?.value ?? "",
      note: (form?.elements.namedItem("note") as HTMLInputElement | null)?.value ?? "",
      // Categories are per type, so the old selection cannot carry over.
      categoryId: "",
      fundingSource: (form?.elements.namedItem("fundingSource") as HTMLInputElement | null)?.checked ? "sponsored" : "personal",
    };
    ledgerEditingId = "";
    ledgerEntryType = type;
    rerender(root, { ...state, ledgerTransactions: state.ledgerTransactions }, setState, "ledger", navigate);
  }));

  root.querySelector<HTMLFormElement>("#ledgerForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const amount = normalizeLedgerAmount(String(data.get("amount") ?? ""));
    const type = String(data.get("type")) as LedgerTransactionType;
    const categoryId = String(data.get("categoryId") ?? "");
    const accountId = String(data.get("accountId") ?? "");
    const fromAccountId = String(data.get("fromAccountId") ?? "");
    const toAccountId = String(data.get("toAccountId") ?? "");
    const dateValue = String(data.get("date") ?? "");
    const date = new Date(`${dateValue}T00:00:00`);
    const error = root.querySelector<HTMLElement>("#ledgerFormError");
    const accountIds = new Set(state.ledgerAccounts.map((account) => account.id));
    const categoryValid = type === "transfer" || state.ledgerCategories.some((category) => category.id === categoryId && category.type === type);
    const accountValid = type === "transfer" ? accountIds.has(fromAccountId) && accountIds.has(toAccountId) && fromAccountId !== toAccountId : accountIds.has(accountId);
    if (!amount || !["income", "expense", "transfer"].includes(type) || !categoryValid || !accountValid || !Number.isFinite(date.getTime())) {
      if (error) {
        error.textContent = type === "transfer" && state.ledgerAccounts.length < 2
          ? "Add at least two accounts before recording a transfer."
          : type === "transfer" && fromAccountId === toAccountId
            ? "Choose two different accounts for a transfer."
            : "Enter a positive amount, valid date, and valid account details.";
      }
      return;
    }
    const id = String(data.get("id") || createId("ledger"));
    const note = String(data.get("note") ?? "").trim().slice(0, 500);
    const fundingSource: LedgerFundingSource | undefined = type !== "transfer" && data.get("fundingSource") === "sponsored" ? "sponsored" : undefined;
    const transaction: LedgerTransaction = type === "transfer"
      ? { id, amount, type, fromAccountId, toAccountId, date: date.toISOString(), ...(note ? { note } : {}) }
      : { id, amount, type, categoryId, accountId, date: date.toISOString(), ...(note ? { note } : {}), ...(fundingSource ? { fundingSource } : {}) };
    const exists = state.ledgerTransactions.some((item) => item.id === id);
    const ledgerTransactions = exists ? state.ledgerTransactions.map((item) => item.id === id ? transaction : item) : [...state.ledgerTransactions, transaction];
    resetLedgerEntry();
    // Saved: the form folds away again, so the page returns to what happened.
    ledgerEntryOpen = false;
    refresh({ ...state, ledgerTransactions }, exists ? "Edit ledger transaction" : "Add ledger transaction");
  });

  root.querySelectorAll<HTMLButtonElement>(".edit-ledger").forEach((button) => button.addEventListener("click", () => {
    ledgerEditingId = button.dataset.id ?? "";
    ledgerEntryOpen = true;
    refresh();
  }));
  root.querySelector<HTMLButtonElement>("#cancelLedgerEdit")?.addEventListener("click", () => {
    resetLedgerEntry();
    ledgerEntryOpen = false;
    refresh();
  });

  // T-2: the form, the filter and the rest of the list each sit behind a
  // control, so the page opens on what happened rather than on a form.
  root.querySelector<HTMLButtonElement>("#ledgerAddToggle")?.addEventListener("click", () => {
    if (ledgerEntryOpen || ledgerEditingId) {
      resetLedgerEntry();
      ledgerEntryOpen = false;
    } else {
      ledgerEntryOpen = true;
    }
    refresh();
  });
  root.querySelector<HTMLButtonElement>("#ledgerFilterToggle")?.addEventListener("click", () => {
    ledgerFilterOpen = !ledgerFilterOpen;
    refresh(state, undefined, true);
  });
  root.querySelector<HTMLButtonElement>("#ledgerSeeAll")?.addEventListener("click", () => {
    ledgerRecentExpanded = !ledgerRecentExpanded;
    refresh(state, undefined, true);
  });
  root.querySelectorAll<HTMLButtonElement>(".delete-ledger").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    if (!id || !confirm("Delete this transaction? A snapshot will be saved first.")) return;
    refresh({ ...state, ledgerTransactions: state.ledgerTransactions.filter((item) => item.id !== id) }, "Delete ledger transaction");
  }));

  const applyFilters = () => {
    const form = root.querySelector<HTMLFormElement>("#ledgerFilterForm");
    if (!form) return;
    const data = new FormData(form);
    ledgerFilters = { ...ledgerFilters, startDate: String(data.get("startDate") ?? ""), endDate: String(data.get("endDate") ?? ""), type: String(data.get("type")) as LedgerFilters["type"], categoryId: String(data.get("categoryId") ?? ""), query: String(data.get("query") ?? ""), fundingSource: String(data.get("fundingSource") ?? "all") as LedgerFilters["fundingSource"] };
    refresh(state, undefined, true);
  };
  root.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => button.addEventListener("click", () => { ledgerFilters.preset = button.dataset.preset as LedgerFilters["preset"]; applyFilters(); }));
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#ledgerFilterForm input, #ledgerFilterForm select").forEach((field) => field.addEventListener("change", applyFilters));
  root.querySelector<HTMLInputElement>('#ledgerFilterForm input[name="query"]')?.addEventListener("search", applyFilters);
  root.querySelector<HTMLButtonElement>("#resetLedgerFilters")?.addEventListener("click", () => { ledgerFilters = { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "", fundingSource: "all" }; refresh(state, undefined, true); });

  root.querySelector<HTMLFormElement>("#ledgerCategoryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const label = String(data.get("label") ?? "").trim().slice(0, 40);
    const icon = String(data.get("icon") ?? "").trim().slice(0, 12) || "•";
    const type = String(data.get("type")) as LedgerTransactionType;
    if (!label || !["income", "expense"].includes(type)) return;
    refresh({ ...state, ledgerCategories: [...state.ledgerCategories, { id: createId("category"), label, icon, type }] }, "Add ledger category");
  });
  root.querySelectorAll<HTMLButtonElement>(".edit-category").forEach((button) => button.addEventListener("click", () => {
    const category = state.ledgerCategories.find((item) => item.id === button.dataset.id);
    if (!category) return;
    const label = prompt("Category label", category.label)?.trim();
    if (!label) return;
    const icon = prompt("Category icon", category.icon)?.trim() || "•";
    refresh({ ...state, ledgerCategories: state.ledgerCategories.map((item) => item.id === category.id ? { ...item, label: label.slice(0, 40), icon: icon.slice(0, 12) } : item) }, "Edit ledger category");
  }));
  root.querySelectorAll<HTMLButtonElement>(".delete-category").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    if (!id) return;
    if (state.ledgerTransactions.some((transaction) => transaction.categoryId === id)) { alert("This category is used by existing transactions. Reassign or delete those transactions first."); return; }
    if (!confirm("Delete this unused category?")) return;
    refresh({ ...state, ledgerCategories: state.ledgerCategories.filter((category) => category.id !== id) }, "Delete ledger category");
  }));

  root.querySelector<HTMLFormElement>("#ledgerAccountForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const name = String(data.get("name") ?? "").trim().slice(0, 40);
    const icon = String(data.get("icon") ?? "").trim().slice(0, 12) || "•";
    const type = String(data.get("type")) as LedgerAccountType;
    const openingBalance = Number(data.get("openingBalance"));
    const error = root.querySelector<HTMLElement>("#ledgerAccountError");
    if (!name || !["bank", "wallet", "investment"].includes(type) || !Number.isFinite(openingBalance) || openingBalance < 0) {
      if (error) error.textContent = "Enter a name, valid type, and non-negative opening balance.";
      return;
    }
    refresh({ ...state, ledgerAccounts: [...state.ledgerAccounts, { id: createId("account"), name, icon, type, openingBalance: Math.round((openingBalance + Number.EPSILON) * 100) / 100 }] }, "Add ledger account");
  });
  root.querySelectorAll<HTMLButtonElement>(".edit-account").forEach((button) => button.addEventListener("click", () => {
    const account = state.ledgerAccounts.find((item) => item.id === button.dataset.id);
    if (!account) return;
    const name = prompt("Account name", account.name)?.trim();
    if (!name) return;
    const fallbackIcon = account.type === "bank" ? "🏦" : account.type === "wallet" ? "👛" : "📈";
    const icon = prompt("Account icon", account.icon ?? fallbackIcon)?.trim() || "•";
    const openingInput = prompt("Opening balance (MYR)", String(account.openingBalance));
    if (openingInput === null) return;
    const openingBalance = Number(openingInput);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) { alert("Opening balance must be a non-negative number."); return; }
    refresh({ ...state, ledgerAccounts: state.ledgerAccounts.map((item) => item.id === account.id ? { ...item, name: name.slice(0, 40), icon: icon.slice(0, 12), openingBalance: Math.round((openingBalance + Number.EPSILON) * 100) / 100 } : item) }, "Edit ledger account");
  }));
  // Mark an investment account as holding the tracked portfolio, so net worth
  // takes its value from the portfolio's market price instead of counting the
  // recorded balance on top of the holdings it already represents.
  root.querySelectorAll<HTMLInputElement>(".toggle-portfolio-link").forEach((input) => input.addEventListener("change", () => {
    const account = state.ledgerAccounts.find((item) => item.id === input.dataset.id);
    if (!account) return;
    const linked = input.checked;
    refresh({
      ...state,
      ledgerAccounts: state.ledgerAccounts.map((item) => {
        if (item.id !== account.id) return item;
        const { holdsTrackedPortfolio: _was, ...rest } = item;
        return linked ? { ...rest, holdsTrackedPortfolio: true } : rest;
      }),
    }, linked ? "Linked account to portfolio" : "Unlinked account from portfolio");
  }));

  root.querySelectorAll<HTMLButtonElement>(".delete-account").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.id;
    if (!id) return;
    const referenced = state.ledgerTransactions.some((transaction) => transaction.accountId === id || transaction.fromAccountId === id || transaction.toAccountId === id);
    if (referenced) { alert("This account is used by existing transactions. Reassign or delete those transactions first."); return; }
    if (state.ledgerAccounts.length <= 1) { alert("Keep at least one account so income and expenses have a valid destination."); return; }
    if (!confirm("Delete this unused account?")) return;
    refresh({ ...state, ledgerAccounts: state.ledgerAccounts.filter((account) => account.id !== id) }, "Delete ledger account");
  }));
}
