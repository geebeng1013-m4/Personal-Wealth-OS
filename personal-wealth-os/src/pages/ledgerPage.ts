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

import type { LedgerAccountType, LedgerTransaction, LedgerTransactionType, WealthState } from "../models";
import { createId } from "../state";
import { money, percent } from "../rules";
import { escapeHtml } from "../html";
import { leakInsightStrip } from "../components/leakInsightStrip";
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

let ledgerFilters: LedgerFilters = { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "" };
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
};
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
  };
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
  const accountGroup = (type: LedgerAccountType, title: string, icon: string): string => {
    const groupBalances = balances.filter(({ account }) => account.type === type);
    const subtotal = groupBalances.reduce((sum, { balance }) => sum + balance, 0);
    const meta = accountTypeMeta(type);
    const rows = groupBalances.map(({ account, balance }: AccountBalance) => `<li class="wu-list__row"><span>${escapeHtml(account.icon ?? icon)} ${escapeHtml(account.name)} &middot; ${meta.label}</span><strong>${money2(balance)}</strong></li>`).join("");
    return `<details class="wu-details ledger-account-group" data-ledger-account-group="${type}"${ledgerAccountGroupsOpen[type] ? " open" : ""}><summary class="wu-details__summary"><span class="wu-row wu-row--tight">${icon} <strong class="t-subheading">${title}</strong><span class="t-caption t-faint">${groupBalances.length} ${groupBalances.length === 1 ? "account" : "accounts"}</span></span><strong>${money2(subtotal)}</strong></summary><ul class="wu-list">${rows || `<li class="wu-list__row"><span class="t-faint">No ${meta.emptyLabel} added.</span></li>`}</ul></details>`;
  };
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
  const transferUnavailable = entryType === "transfer" && state.ledgerAccounts.length < 2;
  const entryAmount = editing ? String(editing.amount) : ledgerEntryDraft.amount;
  const entryDate = editing?.date ? localDateValue(editing.date) : ledgerEntryDraft.date || localDateValue();
  const entryNote = editing?.note ?? ledgerEntryDraft.note;
  const expenses = categoryTotals(filtered, state.ledgerCategories, "expense");
  const palette = ["#ef6461", "#f59e0b", "#8b5cf6", "#3b82f6", "#14b8a6", "#ec4899", "#84cc16"];
  let angle = 0;
  const donut = expenses.length ? expenses.map((item, index) => {
    const start = angle;
    angle += item.share * 360;
    return `${palette[index % palette.length]} ${start.toFixed(1)}deg ${angle.toFixed(1)}deg`;
  }).join(",") : "var(--border) 0deg 360deg";
  const maxCategory = Math.max(...expenses.map((item) => item.amount), 1);
  const monthly = monthlyLedgerTotals(state.ledgerTransactions, new Date().getFullYear());
  const monthlyMax = Math.max(...monthly.flatMap((item) => [item.income, item.expense]), 1);
  const categoryOptions = state.ledgerCategories.map((category) => `<option value="${escapeHtml(category.id)}"${ledgerFilters.categoryId === category.id ? " selected" : ""}>${escapeHtml(category.icon + " " + category.label)}</option>`).join("");
  const transactionRows = filtered.map((transaction) => {
    const category = state.ledgerCategories.find((item) => item.id === transaction.categoryId);
    const title = transaction.type === "transfer" ? `${accountName(transaction.fromAccountId)} → ${accountName(transaction.toAccountId)}` : category?.label ?? "Unknown category";
    const accountMeta = transaction.type === "transfer" ? "Transfer" : accountName(transaction.accountId);
    const icon = transaction.type === "transfer" ? "↔" : category?.icon ?? "•";
    const amountPrefix = transaction.type === "income" ? "+" : transaction.type === "expense" ? "−" : "↔ ";
    const amountTone = transaction.type === "income" ? " wu-metric__value--positive" : transaction.type === "expense" ? " wu-metric__value--negative" : "";
    return `<div class="wu-list__row"><span class="wu-row wu-row--tight"><span aria-hidden="true">${escapeHtml(icon)}</span><span class="wu-stack wu-stack--sm"><strong class="t-subheading">${escapeHtml(title)}</strong><span class="t-caption t-faint">${new Date(transaction.date).toLocaleDateString()} &middot; ${escapeHtml(accountMeta)}${transaction.note ? " &middot; " + escapeHtml(transaction.note) : ""}</span></span></span><strong class="t-num${amountTone}">${amountPrefix}${money(transaction.amount)}</strong><button class="wu-btn wu-btn--ghost wu-btn--icon edit-ledger" data-id="${escapeHtml(transaction.id)}" type="button" aria-label="Edit transaction">✎</button><button class="wu-btn wu-btn--ghost wu-btn--icon delete-ledger" data-id="${escapeHtml(transaction.id)}" type="button" aria-label="Delete transaction">✕</button></div>`;
  }).join("");

  const presetLabel: Record<string, string> = { today: "Today", week: "This week", month: "This month", year: "This year", custom: "Custom" };

  return `<div class="wu ledger-page">
    ${pageHeader({
      eyebrow: "Everyday Money",
      title: "Ledger",
      sub: "Capture income, expenses, and account transfers, then understand where your money goes.",
    })}
    ${leakInsightStrip(state, ["duplicate", "fee", "subscription"], "Transaction check")}
    <div class="wu-ledger-layout">
      <article class="wu-card wu-ledger-entry">
        <div class="wu-card__header">
          <h3 class="wu-card__title t-heading">${editing ? "Edit Transaction" : "Add Transaction"}</h3>
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
          <fieldset class="wu-fieldset"><legend class="wu-field-row__label">Category</legend><div class="wu-row wu-row--tight">${entryCategories.map((category, index) => `<label class="wu-chip"><input name="categoryId" type="radio" value="${escapeHtml(category.id)}"${category.id === editing?.categoryId || (!editing && index === 0) ? " checked" : ""}><span>${escapeHtml(category.icon)} ${escapeHtml(category.label)}</span></label>`).join("")}</div></fieldset>`}
          <details class="wu-details"${editing ? " open" : ""}><summary class="wu-details__summary"><span class="t-subheading">Date &amp; note</span></summary><div class="wu-grid wu-grid--2"><label class="wu-field-row"><span class="wu-field-row__label">Date</span><input class="wu-field" name="date" type="date" required value="${entryDate}"></label><label class="wu-field-row"><span class="wu-field-row__label">Note</span><input class="wu-field" name="note" maxlength="500" value="${escapeHtml(entryNote)}" placeholder="Optional"></label></div></details>
          <p id="ledgerFormError" class="wu-field-row__error" role="alert">${transferUnavailable ? "Add at least two accounts before recording a transfer." : ""}</p>
          <button class="wu-btn wu-btn--primary wu-btn--block" type="submit"${transferUnavailable ? " disabled" : ""}>${editing ? "Save Changes" : "Save Transaction"}</button>
        </form>
      </article>
      <div class="wu-stack wu-stack--lg">
        <div class="wu-grid wu-grid--wide">
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Opening Funds</span><span class="wu-metric__value t-num">${money(totalOpeningFunds)}</span><span class="wu-metric__note t-caption">Starting balance across all accounts</span></div></div>
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Income</span><span class="wu-metric__value t-num wu-metric__value--positive">+${money(totals.income)}</span><span class="wu-metric__note t-caption">In the selected period</span></div></div>
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Expenses</span><span class="wu-metric__value t-num wu-metric__value--negative">&minus;${money(totals.expense)}</span><span class="wu-metric__note t-caption">In the selected period</span></div></div>
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Total Net Assets</span><span class="wu-metric__value t-num${totalNetAssets < 0 ? " wu-metric__value--negative" : ""}">${totalNetAssets < 0 ? "−" : ""}${money(Math.abs(totalNetAssets))}</span><span class="wu-metric__note t-caption">Bank + E-wallet + Investment</span></div></div>
          <div class="wu-card wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Liquid Net Assets</span><span class="wu-metric__value t-num${liquidNetAssets < 0 ? " wu-metric__value--negative" : ""}">${liquidNetAssets < 0 ? "−" : ""}${money(Math.abs(liquidNetAssets))}</span><span class="wu-metric__note t-caption">Bank + E-wallet, Investment excluded</span></div></div>
        </div>
        <article class="wu-card">
          <div class="wu-card__header">
            <div class="wu-stack wu-stack--sm"><span class="wu-label">Cash Locations</span><h3 class="wu-card__title t-heading">Account Balances</h3></div>
            <div class="wu-metric wu-metric--end"><span class="wu-metric__label wu-label">Total Net Assets</span><span class="wu-metric__value t-num${totalNetAssets < 0 ? " wu-metric__value--negative" : ""}">${totalNetAssets < 0 ? "−" : ""}${money(Math.abs(totalNetAssets))}</span></div>
          </div>
          <div class="wu-stack wu-stack--sm">${accountGroup("bank", "Bank", "🏦")}${accountGroup("wallet", "E-wallet", "👛")}${accountGroup("investment", "Investment", "📈")}</div>
        </article>
        <article class="wu-card ledger-filters">
          <form id="ledgerFilterForm" class="wu-stack">
            <div class="wu-segmented">${(["today", "week", "month", "year", "custom"] as const).map((preset) => `<button type="button" data-preset="${preset}" class="wu-segmented__option${ledgerFilters.preset === preset ? " is-active" : ""}">${presetLabel[preset]}</button>`).join("")}</div>
            <div class="wu-grid wu-grid--wide wu-ledger-filter-fields ${ledgerFilters.preset === "custom" ? "show-custom" : ""}">
              <label class="wu-field-row custom-date"><span class="wu-field-row__label">From</span><input class="wu-field" name="startDate" type="date" value="${ledgerFilters.startDate}"></label>
              <label class="wu-field-row custom-date"><span class="wu-field-row__label">To</span><input class="wu-field" name="endDate" type="date" value="${ledgerFilters.endDate}"></label>
              <label class="wu-field-row"><span class="wu-field-row__label">Type</span><select class="wu-field" name="type"><option value="all">All types</option><option value="expense"${ledgerFilters.type === "expense" ? " selected" : ""}>Expense</option><option value="income"${ledgerFilters.type === "income" ? " selected" : ""}>Income</option><option value="transfer"${ledgerFilters.type === "transfer" ? " selected" : ""}>Transfer</option></select></label>
              <label class="wu-field-row"><span class="wu-field-row__label">Category</span><select class="wu-field" name="categoryId"><option value="">All categories</option>${categoryOptions}</select></label>
              <label class="wu-field-row"><span class="wu-field-row__label">Search</span><input class="wu-field" name="query" type="search" value="${escapeHtml(ledgerFilters.query)}" placeholder="Note, category, account"></label>
              <div class="wu-row wu-self-end"><button class="wu-btn wu-btn--ghost wu-btn--sm" id="resetLedgerFilters" type="button">Reset</button></div>
            </div>
          </form>
        </article>
        <div class="wu-grid wu-grid--2">
          <article class="wu-card"><div class="wu-card__header"><h3 class="wu-card__title t-heading">Category Share</h3></div>${expenses.length ? `<div class="ledger-donut-wrap"><div class="ledger-donut" style="background:conic-gradient(${donut})"><span>${money(totals.expense)}</span></div><div class="ledger-legend">${expenses.map((item, index) => `<div><i style="background:${palette[index % palette.length]}"></i><span>${escapeHtml(item.category.icon + " " + item.category.label)}</span><strong>${percent(item.share, 1)}</strong></div>`).join("")}</div></div><div class="ledger-bars">${expenses.map((item, index) => `<div><span>${escapeHtml(item.category.label)}</span><div><i style="width:${(item.amount / maxCategory) * 100}%;background:${palette[index % palette.length]}"></i></div><strong>${money(item.amount)}</strong></div>`).join("")}</div>` : `<p class="wu-empty">No expense data in this period.</p>`}</article>
          <article class="wu-card"><div class="wu-card__header"><h3 class="wu-card__title t-heading">Monthly Income vs Expense</h3></div><div class="monthly-chart">${monthly.map((item) => `<div class="month-column"><div class="month-bars"><i class="income" style="height:${Math.max(item.income / monthlyMax * 100, item.income ? 3 : 0)}%" title="Income ${money(item.income)}"></i><i class="expense" style="height:${Math.max(item.expense / monthlyMax * 100, item.expense ? 3 : 0)}%" title="Expense ${money(item.expense)}"></i></div><small>${new Date(2000, item.month).toLocaleString("en", { month: "short" }).slice(0, 1)}</small></div>`).join("")}</div><div class="chart-key"><span><i class="income"></i>Income</span><span><i class="expense"></i>Expense</span></div></article>
        </div>
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
    const transaction: LedgerTransaction = type === "transfer"
      ? { id, amount, type, fromAccountId, toAccountId, date: date.toISOString(), ...(note ? { note } : {}) }
      : { id, amount, type, categoryId, accountId, date: date.toISOString(), ...(note ? { note } : {}) };
    const exists = state.ledgerTransactions.some((item) => item.id === id);
    const ledgerTransactions = exists ? state.ledgerTransactions.map((item) => item.id === id ? transaction : item) : [...state.ledgerTransactions, transaction];
    resetLedgerEntry();
    refresh({ ...state, ledgerTransactions }, exists ? "Edit ledger transaction" : "Add ledger transaction");
  });

  root.querySelectorAll<HTMLButtonElement>(".edit-ledger").forEach((button) => button.addEventListener("click", () => {
    ledgerEditingId = button.dataset.id ?? "";
    refresh();
  }));
  root.querySelector<HTMLButtonElement>("#cancelLedgerEdit")?.addEventListener("click", () => {
    resetLedgerEntry();
    refresh();
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
    ledgerFilters = { ...ledgerFilters, startDate: String(data.get("startDate") ?? ""), endDate: String(data.get("endDate") ?? ""), type: String(data.get("type")) as LedgerFilters["type"], categoryId: String(data.get("categoryId") ?? ""), query: String(data.get("query") ?? "") };
    refresh(state, undefined, true);
  };
  root.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => button.addEventListener("click", () => { ledgerFilters.preset = button.dataset.preset as LedgerFilters["preset"]; applyFilters(); }));
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#ledgerFilterForm input, #ledgerFilterForm select").forEach((field) => field.addEventListener("change", applyFilters));
  root.querySelector<HTMLInputElement>('#ledgerFilterForm input[name="query"]')?.addEventListener("search", applyFilters);
  root.querySelector<HTMLButtonElement>("#resetLedgerFilters")?.addEventListener("click", () => { ledgerFilters = { preset: "month", startDate: "", endDate: "", type: "all", categoryId: "", query: "" }; refresh(state, undefined, true); });

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
