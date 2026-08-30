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
  const accountGroup = (type: LedgerAccountType, title: string, icon: string): string => {
    const groupBalances = balances.filter(({ account }) => account.type === type);
    const subtotal = groupBalances.reduce((sum, { balance }) => sum + balance, 0);
    const meta = accountTypeMeta(type);
    const rows = groupBalances.map(({ account, balance }: AccountBalance) => `<div class="ledger-account-row"><div class="ledger-account-copy"><span class="ledger-account-icon" aria-hidden="true">${escapeHtml(account.icon ?? icon)}</span><div><strong>${escapeHtml(account.name)}</strong><small>${meta.label}</small></div></div><strong class="ledger-account-balance ${balance >= 0 ? "income" : "expense"}">${balance < 0 ? "−" : ""}${money(Math.abs(balance))}</strong></div>`).join("");
    return `<details class="ledger-account-group ledger-account-group-${type}" data-ledger-account-group="${type}"${ledgerAccountGroupsOpen[type] ? " open" : ""}><summary><div class="ledger-account-group-title"><span class="ledger-account-group-icon" aria-hidden="true">${icon}</span><div><h4>${title}</h4><small>${groupBalances.length} ${groupBalances.length === 1 ? "account" : "accounts"}</small></div></div><div class="ledger-account-group-total"><strong class="${subtotal >= 0 ? "income" : "expense"}">${subtotal < 0 ? "−" : ""}${money(Math.abs(subtotal))}</strong><span class="ledger-account-group-switch" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="m4 6 4 4 4-4" /></svg></span></div></summary><div class="ledger-account-list">${rows || `<p class="empty-state">No ${meta.emptyLabel} added.</p>`}</div></details>`;
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
  }).join(",") : "var(--surface-2) 0deg 360deg";
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
    return `<article class="ledger-row"><div class="ledger-row-icon">${escapeHtml(icon)}</div><div class="ledger-row-copy"><strong>${escapeHtml(title)}</strong><small>${new Date(transaction.date).toLocaleDateString()} · ${escapeHtml(accountMeta)}${transaction.note ? " · " + escapeHtml(transaction.note) : ""}</small></div><strong class="ledger-amount ${transaction.type}">${amountPrefix}${money(transaction.amount)}</strong><div class="ledger-row-actions"><button class="icon-button edit-ledger" data-id="${escapeHtml(transaction.id)}" aria-label="Edit transaction">✎</button><button class="icon-button danger delete-ledger" data-id="${escapeHtml(transaction.id)}" aria-label="Delete transaction">✕</button></div></article>`;
  }).join("");

  return `<div class="section-title"><span class="eyebrow">Everyday Money</span><h3>Ledger</h3><p>Capture income, expenses, and account transfers, then understand where your money goes.</p></div>
    ${leakInsightStrip(state, ["duplicate", "fee", "subscription"], "Transaction check")}
    <div class="ledger-layout">
      <article class="card panel ledger-entry"><div class="panel-head"><div><span class="eyebrow">Quick Entry</span><h3>${editing ? "Edit Transaction" : "Add Transaction"}</h3></div>${editing ? '<button id="cancelLedgerEdit" class="secondary-button" type="button">Cancel</button>' : ""}</div>
        <form id="ledgerForm"><input name="id" type="hidden" value="${escapeHtml(editing?.id ?? "")}"><div class="ledger-type-toggle" role="group" aria-label="Transaction type"><button type="button" data-ledger-type="expense" class="${entryType === "expense" ? "active expense" : ""}">− Expense</button><button type="button" data-ledger-type="income" class="${entryType === "income" ? "active income" : ""}">+ Income</button><button type="button" data-ledger-type="transfer" class="${entryType === "transfer" ? "active transfer" : ""}">↔ Transfer</button></div><input name="type" type="hidden" value="${entryType}">
          <label class="ledger-amount-input"><span>Amount (MYR)</span><input id="ledgerAmount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${escapeHtml(entryAmount)}" placeholder="0.00"></label>
          ${entryType === "transfer" ? `<div class="ledger-account-fields"><label>From account<select name="fromAccountId" required>${accountOptions(selectedFromAccountId)}</select></label><label>To account<select name="toAccountId" required>${accountOptions(selectedToAccountId)}</select></label></div>` : `<label class="ledger-account-select">Account<select name="accountId" required>${accountOptions(selectedAccountId)}</select></label><fieldset class="category-picker"><legend>Category</legend>${entryCategories.map((category, index) => `<label><input name="categoryId" type="radio" value="${escapeHtml(category.id)}"${category.id === editing?.categoryId || (!editing && index === 0) ? " checked" : ""}><span><b>${escapeHtml(category.icon)}</b>${escapeHtml(category.label)}</span></label>`).join("")}</fieldset>`}
          <details class="ledger-more"${editing ? " open" : ""}><summary>Date & note</summary><div class="form-grid"><label>Date<input name="date" type="date" required value="${entryDate}"></label><label>Note<input name="note" maxlength="500" value="${escapeHtml(entryNote)}" placeholder="Optional"></label></div></details><p id="ledgerFormError" class="form-error" role="alert">${transferUnavailable ? "Add at least two accounts before recording a transfer." : ""}</p><button class="primary-button ledger-save" type="submit"${transferUnavailable ? " disabled" : ""}>${editing ? "Save Changes" : "Save Transaction"}</button>
        </form>
      </article>
      <div class="ledger-main">
        <div class="ledger-summary"><article class="card"><span>Opening Funds</span><strong>${money(totalOpeningFunds)}</strong><small>Starting balance across all accounts</small></article><article class="card"><span>Income</span><strong class="income">+${money(totals.income)}</strong><small>Income in the selected period</small></article><article class="card"><span>Expenses</span><strong class="expense">−${money(totals.expense)}</strong><small>Expenses in the selected period</small></article><article class="card"><span>Total Net Assets</span><strong class="${totalNetAssets >= 0 ? "income" : "expense"}">${totalNetAssets < 0 ? "−" : ""}${money(Math.abs(totalNetAssets))}</strong><small>Bank + E-wallet + Investment</small></article><article class="card"><span>Liquid Net Assets</span><strong class="${liquidNetAssets >= 0 ? "income" : "expense"}">${liquidNetAssets < 0 ? "−" : ""}${money(Math.abs(liquidNetAssets))}</strong><small>Bank + E-wallet · Investment excluded</small></article></div>
        <article class="card ledger-account-summary"><div class="ledger-account-summary-head"><div><span class="eyebrow">Cash Locations</span><h3>Account Balances</h3><p>Opening balances adjusted by income, expenses, and transfers.</p></div><div><small>Total Net Assets</small><strong class="${totalNetAssets >= 0 ? "income" : "expense"}">${totalNetAssets < 0 ? "−" : ""}${money(Math.abs(totalNetAssets))}</strong></div></div><div class="ledger-account-columns">${accountGroup("bank", "Bank", "🏦")}${accountGroup("wallet", "E-wallet", "👛")}${accountGroup("investment", "Investment", "📈")}</div></article>
        <article class="card panel ledger-filters"><form id="ledgerFilterForm"><div class="filter-presets">${(["today", "week", "month", "year", "custom"] as const).map((preset) => `<button type="button" data-preset="${preset}" class="${ledgerFilters.preset === preset ? "active" : ""}">${preset === "today" ? "Today" : preset === "week" ? "This week" : preset === "month" ? "This month" : preset === "year" ? "This year" : "Custom"}</button>`).join("")}</div><div class="ledger-filter-fields ${ledgerFilters.preset === "custom" ? "show-custom" : ""}"><label class="custom-date">From<input name="startDate" type="date" value="${ledgerFilters.startDate}"></label><label class="custom-date">To<input name="endDate" type="date" value="${ledgerFilters.endDate}"></label><label>Type<select name="type"><option value="all">All types</option><option value="expense"${ledgerFilters.type === "expense" ? " selected" : ""}>Expense</option><option value="income"${ledgerFilters.type === "income" ? " selected" : ""}>Income</option><option value="transfer"${ledgerFilters.type === "transfer" ? " selected" : ""}>Transfer</option></select></label><label>Category<select name="categoryId"><option value="">All categories</option>${categoryOptions}</select></label><label>Search<input name="query" type="search" value="${escapeHtml(ledgerFilters.query)}" placeholder="Note, category, account"></label><button class="secondary-button" id="resetLedgerFilters" type="button">Reset</button></div></form></article>
        <div class="ledger-report-grid"><article class="card panel"><div class="panel-head"><div><span class="eyebrow">Expense Mix</span><h3>Category Share</h3></div></div>${expenses.length ? `<div class="ledger-donut-wrap"><div class="ledger-donut" style="background:conic-gradient(${donut})"><span>${money(totals.expense)}</span></div><div class="ledger-legend">${expenses.map((item, index) => `<div><i style="background:${palette[index % palette.length]}"></i><span>${escapeHtml(item.category.icon + " " + item.category.label)}</span><strong>${percent(item.share, 1)}</strong></div>`).join("")}</div></div><div class="ledger-bars">${expenses.map((item, index) => `<div><span>${escapeHtml(item.category.label)}</span><div><i style="width:${(item.amount / maxCategory) * 100}%;background:${palette[index % palette.length]}"></i></div><strong>${money(item.amount)}</strong></div>`).join("")}</div>` : '<p class="empty-state">No expense data in this period.</p>'}</article>
          <article class="card panel"><div class="panel-head"><div><span class="eyebrow">Annual Overview</span><h3>Monthly Income vs Expense</h3></div></div><div class="monthly-chart">${monthly.map((item) => `<div class="month-column"><div class="month-bars"><i class="income" style="height:${Math.max(item.income / monthlyMax * 100, item.income ? 3 : 0)}%" title="Income ${money(item.income)}"></i><i class="expense" style="height:${Math.max(item.expense / monthlyMax * 100, item.expense ? 3 : 0)}%" title="Expense ${money(item.expense)}"></i></div><small>${new Date(2000, item.month).toLocaleString("en", { month: "short" }).slice(0, 1)}</small></div>`).join("")}</div><div class="chart-key"><span><i class="income"></i>Income</span><span><i class="expense"></i>Expense</span></div></article></div>
        <details id="ledgerHistoryPanel" class="card panel ledger-collapsible"${ledgerHistoryOpen ? " open" : ""}><summary><div><span class="eyebrow">Transactions</span><h3>History</h3></div><span class="ledger-collapsible-meta">${filtered.length} records</span></summary><div class="ledger-collapsible-content"><div class="ledger-list">${transactionRows || '<p class="empty-state">No transactions match this view. Add your first record above.</p>'}</div></div></details>
        <details id="ledgerCategoriesPanel" class="card panel ledger-collapsible"${ledgerCategoriesOpen ? " open" : ""}><summary><div><span class="eyebrow">Custom Labels</span><h3>Category Manager</h3></div><span class="ledger-collapsible-meta">${state.ledgerCategories.length} categories</span></summary><div class="ledger-collapsible-content"><form id="ledgerCategoryForm" class="category-form"><label>Icon<input name="icon" maxlength="12" value="✨" required></label><label>Label<input name="label" maxlength="40" placeholder="Category name" required></label><label>Type<select name="type"><option value="expense">Expense</option><option value="income">Income</option></select></label><button class="primary-button" type="submit">Add Category</button></form><div class="category-manager">${state.ledgerCategories.map((category) => `<div><span>${escapeHtml(category.icon)} ${escapeHtml(category.label)} <small>${category.type}</small></span><button class="secondary-button edit-category" data-id="${escapeHtml(category.id)}" type="button">Edit</button><button class="icon-button danger delete-category" data-id="${escapeHtml(category.id)}" aria-label="Delete ${escapeHtml(category.label)}">✕</button></div>`).join("")}</div></div></details>
        <details id="ledgerAccountsPanel" class="card panel ledger-collapsible"${ledgerAccountsOpen ? " open" : ""}><summary><div><span class="eyebrow">Cash Locations</span><h3>Account Manager</h3></div><span class="ledger-collapsible-meta">${state.ledgerAccounts.length} accounts</span></summary><div class="ledger-collapsible-content"><form id="ledgerAccountForm" class="category-form"><label>Icon<input name="icon" maxlength="12" value="🏦" required></label><label>Name<input name="name" maxlength="40" placeholder="Account name" required></label><label>Type<select name="type"><option value="bank">Bank</option><option value="wallet">Wallet</option><option value="investment">Investment</option></select></label><label>Opening balance (MYR)<input name="openingBalance" type="number" min="0" step="0.01" value="0" required></label><button class="primary-button" type="submit">Add Account</button></form><p id="ledgerAccountError" class="form-error" role="alert"></p><div class="ledger-account-manager">${balances.map(({ account, balance }) => `<article class="ledger-managed-account"><header><div class="ledger-managed-account-title"><span class="ledger-managed-account-icon" aria-hidden="true">${escapeHtml(account.icon ?? "•")}</span><div><strong>${escapeHtml(account.name)}</strong><small>${accountTypeMeta(account.type).label}</small></div></div><div class="ledger-managed-account-actions"><button class="secondary-button edit-account" data-id="${escapeHtml(account.id)}" type="button" aria-label="Edit ${escapeHtml(account.name)}">Edit</button><button class="icon-button danger delete-account" data-id="${escapeHtml(account.id)}" type="button" aria-label="Delete ${escapeHtml(account.name)}">✕</button></div></header><div class="ledger-managed-account-balances"><div><small>Opening balance</small><strong>${money(account.openingBalance)}</strong></div><div><small>Current balance</small><strong class="${balance >= 0 ? "income" : "expense"}">${balance < 0 ? "−" : ""}${money(Math.abs(balance))}</strong></div></div>${account.type === "investment" ? `<label class="account-portfolio-link"><input type="checkbox" class="toggle-portfolio-link" data-id="${escapeHtml(account.id)}"${account.holdsTrackedPortfolio ? " checked" : ""}><span>This account holds my tracked portfolio<small>${account.holdsTrackedPortfolio ? "Net worth uses the portfolio's market value for this account instead of the balance above, so the same money is not counted twice." : "Tick this if the balance above is the value of the shares recorded in Portfolio. Leave it off for brokerage cash or money-market funds."}</small></span></label>` : ""}</article>`).join("")}</div></div></details>
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
