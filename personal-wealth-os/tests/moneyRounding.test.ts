import assert from "node:assert/strict";
import { test } from "./testHarness";
import { accountBalances, accountTypeBalance, categoryTotals, ledgerTotals, openingFunds } from "../src/ledger";
import { monthlyClose } from "../src/financialHealth";
import { getPlanExecution } from "../src/financialHealthSummary";
import { migrateState } from "../src/state";
import type { LedgerAccount, LedgerTransaction, Trade } from "../src/models";

/**
 * Money is summed in binary floating point, where 757.89 is really
 * 757.88999999999998635758. Adding a few dozen such amounts drifts into the
 * thirteenth decimal, and the drift reaches the screen: a real August of the
 * user's ledger put 757.8900000000002 and 681.3999999999999 into the Monthly
 * Review's number inputs, which would have been saved to the review on submit.
 *
 * These tests use amounts that actually drift. A tidy fixture would pass
 * whether or not the rounding exists, which is how this got shipped.
 */

const tx = (
  id: string, type: LedgerTransaction["type"], amount: number, date = "2026-08-05T16:00:00.000Z",
): LedgerTransaction => ({ id, type, amount, date, categoryId: "c", accountId: "a" } as LedgerTransaction);

/** The user's real August income and expense amounts — these are what drifted. */
const AUGUST_INCOME = [220, 110, 15, 90, 14, 20, 100, 15, 25, 11.73, 24.47, 8.5,
  0.04, 0.04, 0.09, 0.05, 0.12, 0.11, 0.07, 0.07, 0.04, 0.08];
const AUGUST_EXPENSE = [1.7, 2, 13.65, 14.9, 14, 19, 4, 2, 15, 5.35, 19.15, 30,
  13.9, 56.55, 14.65, 13, 1.99, 4.8, 6.95, 8.5, 14, 1.9, 16, 19, 49.02, 4, 4, 7,
  13.4, 7, 3.5, 8, 6.77, 90, 11.5, 3, 6, 55.62, 23.4, 1, 6];

test("rounding: a month of real ledger amounts totals to the cent", () => {
  const transactions = [
    ...AUGUST_INCOME.map((amount, i) => tx(`i${i}`, "income", amount)),
    ...AUGUST_EXPENSE.map((amount, i) => tx(`e${i}`, "expense", amount)),
  ];
  const totals = ledgerTotals(transactions);

  // The property that matters: no figure carries more than two decimals.
  for (const [label, value] of Object.entries(totals)) {
    assert.equal(value, Math.round(value * 100) / 100, `${label} = ${value}`);
  }
  // And the drift really is present in the naive sum, so this is a live guard.
  const naive = AUGUST_INCOME.reduce((sum, x) => sum + x, 0);
  assert.notEqual(naive, Math.round(naive * 100) / 100, "the fixture must actually drift");
});

test("rounding: the balance agrees with income minus expense, to the cent", () => {
  // Rounding the three independently could leave balance a cent away from the
  // subtraction a reader does in their head.
  const totals = ledgerTotals([
    ...AUGUST_INCOME.map((amount, i) => tx(`i${i}`, "income", amount)),
    ...AUGUST_EXPENSE.map((amount, i) => tx(`e${i}`, "expense", amount)),
  ]);
  assert.equal(totals.balance, Math.round((totals.income - totals.expense) * 100) / 100);
});

test("rounding: an empty ledger is zero, not negative zero or NaN", () => {
  const totals = ledgerTotals([]);
  assert.equal(totals.income, 0);
  assert.equal(totals.expense, 0);
  assert.equal(totals.balance, 0);
  assert.ok(Object.is(totals.balance, 0), "not -0");
});

// --- Contributions ---------------------------------------------------------

const drifting: Trade[] = [
  { id: "a", date: "2026-08-12", platform: "moomoo", ticker: "VOO", type: "DCA",
    amountMyr: 0.1, amountUsd: 0.02, priceUsd: 700, units: 0.0001, feeMyr: 0.2 },
  { id: "b", date: "2026-08-12", platform: "moomoo", ticker: "QQQM", type: "DCA",
    amountMyr: 0.1, amountUsd: 0.02, priceUsd: 300, units: 0.0003, feeMyr: 0.2 },
  { id: "c", date: "2026-08-13", platform: "moomoo", ticker: "VOO", type: "DCA",
    amountMyr: 0.1, amountUsd: 0.02, priceUsd: 700, units: 0.0001, feeMyr: 0.2 },
];

const stateWithTrades = () => migrateState({
  deviceId: "device-rounding",
  trades: drifting,
  dca: { monthly: 100, targets: { VOO: 0.7, QQQM: 0.3 } },
} as never);

test("rounding: this month's contribution total is clean money", () => {
  // 0.1 + 0.2 repeated is the textbook drift, and this figure is displayed as
  // money and divided by the monthly target.
  const naive = drifting.reduce((sum, t) => sum + t.amountMyr + t.feeMyr, 0);
  assert.notEqual(naive, Math.round(naive * 100) / 100, "the fixture must actually drift");

  const plan = getPlanExecution(stateWithTrades(), new Date(2026, 7, 20));
  assert.equal(plan.actualAmount, Math.round(plan.actualAmount * 100) / 100);
  assert.equal(plan.actualAmount, 0.9);
});

test("rounding: the monthly close reports clean money too", () => {
  const close = monthlyClose(stateWithTrades(), "2026-08");
  assert.equal(close.dcaInvested, Math.round(close.dcaInvested * 100) / 100);
  assert.equal(close.dcaInvested, 0.9);
});

test("rounding: rounding never turns a real contribution into nothing", () => {
  // A cent is still a contribution; only sub-cent noise should vanish.
  const state = migrateState({
    deviceId: "device-rounding-small",
    trades: [{ id: "s", date: "2026-08-12", platform: "moomoo", ticker: "VOO", type: "DCA",
      amountMyr: 0.01, amountUsd: 0.002, priceUsd: 700, units: 0.00001, feeMyr: 0 }],
    dca: { monthly: 100, targets: { VOO: 1 } },
  } as never);
  const plan = getPlanExecution(state, new Date(2026, 7, 20));
  assert.equal(plan.actualAmount, 0.01);
  assert.equal(plan.hasActual, true);
});

/**
 * Account balances drift too, and they are read against a real wallet app.
 *
 * The first rounding pass fixed ledgerTotals and left the balance accumulators
 * alone. They have the same defect for the same reason, and one more consequence:
 * the Account Balances panel is where a user reconciles the app against Touch 'n
 * Go or a bank statement, so a figure that is not exact to the cent is a figure
 * that cannot do its job.
 *
 * The fixture is a real TNG e-wallet history — one opening balance and 119
 * amounts — which accumulates to 202.37999999999903 without the fix.
 */

const TNG_OPENING = 620.87;
const TNG_INCOME = [30, 30, 100, 0.08, 20, 19, 14, 0.09, 0.07, 0.11, 1.99, 0.07, 15,
  0.12, 14, 0.05, 15, 90, 0.09, 0.04, 220, 0.04, 110, 0.04, 0.04, 0.05, 50, 0.03,
  30, 100, 0.05, 9.5, 0.07, 0.06, 0.04, 0.05, 220, 63, 0.05, 9.3, 0.05, 9.3];
const TNG_EXPENSE = [8.5, 20.35, 98.5, 22.3, 11.5, 6.77, 64, 3.5, 7, 49.02, 4, 4, 7,
  13.4, 10.4, 19, 1.9, 16, 14, 72, 6.95, 1.99, 14.65, 56.55, 13.9, 50, 15, 5.35,
  19.15, 30, 4, 2, 1.7, 2, 13.65, 14.9, 14, 6, 4, 2, 54, 55.62, 6, 110, 1, 23.4,
  8.5, 143.57, 3.5, 26.6, 98.5, 4, 2.1, 2, 2, 14.75, 1.97, 8, 7.7, 7, 57.73, 4, 6,
  16.2, 7.5, 10, 4, 3, 11.7, 3, 25, 19, 10, 62.5, 9.3, 13.5, 9.3, 7];

const wallet: LedgerAccount = { id: "tng", name: "TNG ewallet", type: "wallet", openingBalance: TNG_OPENING };
const spare: LedgerAccount = { id: "ryt", name: "Ryt bank", type: "bank", openingBalance: 0 };

const walletTx = (): LedgerTransaction[] => [
  ...TNG_INCOME.map((amount, i) => ({ id: `wi${i}`, type: "income", amount,
    date: "2026-08-05T16:00:00.000Z", categoryId: "c", accountId: "tng" } as LedgerTransaction)),
  ...TNG_EXPENSE.map((amount, i) => ({ id: `we${i}`, type: "expense", amount,
    date: "2026-08-05T16:00:00.000Z", categoryId: "c", accountId: "tng" } as LedgerTransaction)),
];

test("rounding: an account balance is exact to the cent", () => {
  // The fixture must really drift, or this test proves nothing.
  let naive = TNG_OPENING;
  TNG_INCOME.forEach((a) => { naive += a; });
  TNG_EXPENSE.forEach((a) => { naive -= a; });
  assert.notEqual(naive, Math.round(naive * 100) / 100, "the fixture must actually drift");

  const [balance] = accountBalances(walletTx(), [wallet]);
  assert.equal(balance.balance, Math.round(balance.balance * 100) / 100);
  assert.equal(balance.balance, 202.38);
});

test("rounding: a group total equals the sum of the accounts shown under it", () => {
  // The panel prints both. If they disagree by a cent the user cannot reconcile
  // either one, because neither is the number their wallet app shows.
  const transactions = walletTx();
  const accounts = [wallet, spare];
  const each = accountBalances(transactions, accounts).filter(({ account }) => account.type === "wallet");
  const group = accountTypeBalance(transactions, accounts, "wallet");
  assert.equal(group, Math.round(group * 100) / 100);
  assert.equal(group, Math.round(each.reduce((sum, { balance }) => sum + balance, 0) * 100) / 100);
});

test("rounding: opening funds and category totals are clean", () => {
  const funds = openingFunds([wallet, spare, { id: "x", name: "x", type: "bank", openingBalance: 0.07 }]);
  assert.equal(funds, Math.round(funds * 100) / 100);

  const categories = [{ id: "c", name: "Food", type: "expense", icon: "🍜" }] as never;
  const [row] = categoryTotals(walletTx(), categories, "expense");
  assert.equal(row.amount, Math.round(row.amount * 100) / 100);
});
