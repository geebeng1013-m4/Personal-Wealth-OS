import assert from "node:assert/strict";
import { test } from "./testHarness";
import { accountBalances, accountTypeBalance } from "../src/ledger";
import { getLedgerSnapshot, sumPositiveBalances } from "../src/ledgerSummary";
import { portfolioSummary, calculatePositionCostBasis, type PositionCostBasis } from "../src/rules";
import { getPortfolioSnapshot } from "../src/portfolioSummary";
import { cloneDefaultState, migrateState } from "../src/state";
import type { WealthState } from "../src/models";

const NOW = new Date(2026, 7, 15, 12, 0, 0);

/**
 * Step 17 regression net.
 *
 * Two primitives were being recomputed inside the read model that already had
 * the answer: accountBalances() ran five times per LedgerSnapshot, and each
 * ticker's cost basis was computed twice per PortfolioSnapshot. Both now accept
 * the already-computed result.
 *
 * These tests pin the two things that make that safe: the answer is identical
 * either way, and the passed-in value is genuinely used.
 */

// --- Ledger balances -------------------------------------------------------

test("reuse: accountTypeBalance is identical with and without injected balances", () => {
  for (const state of [cloneDefaultState(), overdrawnState(), emptyLedgerState()]) {
    const balances = accountBalances(state.ledgerTransactions, state.ledgerAccounts);
    for (const type of ["bank", "wallet", "investment"] as const) {
      assert.equal(
        accountTypeBalance(state.ledgerTransactions, state.ledgerAccounts, type, balances),
        accountTypeBalance(state.ledgerTransactions, state.ledgerAccounts, type),
        `${type} drifted`,
      );
    }
  }
});

test("reuse: sumPositiveBalances is identical with and without injected balances", () => {
  for (const state of [cloneDefaultState(), overdrawnState(), emptyLedgerState()]) {
    const balances = accountBalances(state.ledgerTransactions, state.ledgerAccounts);
    assert.equal(
      sumPositiveBalances(state.ledgerTransactions, state.ledgerAccounts, balances),
      sumPositiveBalances(state.ledgerTransactions, state.ledgerAccounts),
    );
  }
});

test("reuse: the injected balances are what the totals are computed from", () => {
  // If the parameter were ignored and the primitive recomputed internally, the
  // doctored numbers below would not show up.
  const state = cloneDefaultState();
  const balances = accountBalances(state.ledgerTransactions, state.ledgerAccounts)
    .map((entry) => ({ ...entry, balance: entry.account.type === "bank" ? 1000 : 0 }));
  const bankCount = balances.filter((b) => b.account.type === "bank").length;
  assert.ok(bankCount > 0, "fixture has a bank account");
  assert.equal(accountTypeBalance(state.ledgerTransactions, state.ledgerAccounts, "bank", balances), bankCount * 1000);
  assert.equal(sumPositiveBalances(state.ledgerTransactions, state.ledgerAccounts, balances), bankCount * 1000);
});

test("reuse: an overdraft still counts against its type but never as an asset", () => {
  // The one edge case where the two totals deliberately disagree: overdrafts
  // reduce the type balance but are floored out of total assets.
  const state = overdrawnState();
  assert.equal(state.ledgerTransactions.length, 1, "fixture transaction survived validation");
  const snapshot = getLedgerSnapshot(state, NOW);
  const bankBalance = snapshot.accountBalances
    .filter(({ account }) => account.id === "a-bank")
    .reduce((sum, { balance }) => sum + balance, 0);
  assert.equal(bankBalance, -400, "100 opening minus a 500 expense");
  assert.equal(
    snapshot.totalPositiveBalance,
    snapshot.accountBalances.reduce((sum, { balance }) => sum + Math.max(balance, 0), 0),
    "a negative balance is not a negative asset",
  );
  assert.ok(snapshot.totalPositiveBalance >= 0, "total assets never go negative");
});

test("reuse: LedgerSnapshot balances still equal the standalone primitives", () => {
  for (const state of [cloneDefaultState(), overdrawnState(), emptyLedgerState()]) {
    const snapshot = getLedgerSnapshot(state, NOW);
    assert.deepEqual(snapshot.accountBalances, accountBalances(state.ledgerTransactions, state.ledgerAccounts));
    assert.equal(snapshot.totalPositiveBalance, sumPositiveBalances(state.ledgerTransactions, state.ledgerAccounts));
    for (const type of ["bank", "wallet", "investment"] as const) {
      assert.equal(
        snapshot.accountTypeBalances[type],
        accountTypeBalance(state.ledgerTransactions, state.ledgerAccounts, type),
      );
    }
  }
});

// --- Portfolio cost basis --------------------------------------------------

test("reuse: portfolioSummary is identical with and without a cost-basis map", () => {
  for (const state of [cloneDefaultState(), noTradesState()]) {
    assert.deepEqual(portfolioSummary(state, new Map()), portfolioSummary(state));
  }
});

test("reuse: the returned cost-basis map matches the primitive per ticker", () => {
  const state = cloneDefaultState();
  const costBases = new Map<string, PositionCostBasis>();
  const summary = portfolioSummary(state, costBases);
  assert.ok(summary.positions.length > 0, "fixture has positions");
  for (const position of summary.positions) {
    assert.deepEqual(
      costBases.get(position.ticker),
      calculatePositionCostBasis(state.trades, position.ticker),
      `${position.ticker} cost basis drifted`,
    );
  }
  assert.equal(costBases.size, summary.positions.length, "one entry per position, no extras");
});

test("reuse: PortfolioSnapshot P&L still equals the standalone primitive", () => {
  for (const state of [cloneDefaultState(), noTradesState()]) {
    const snapshot = getPortfolioSnapshot(state);
    for (const holding of snapshot.holdings) {
      const costBasis = calculatePositionCostBasis(state.trades, holding.ticker);
      assert.equal(holding.realizedPnlMyr, costBasis.realizedPnlMyr, `${holding.ticker} realised MYR`);
      assert.equal(holding.realizedPnlUsd, costBasis.realizedPnlUsd, `${holding.ticker} realised USD`);
      assert.equal(holding.feesMyr, costBasis.feesMyr, `${holding.ticker} fees`);
    }
    // And the snapshot totals still agree with the primitive it composes.
    assert.equal(snapshot.totalInvestedMyr, portfolioSummary(state).totalInvestedMyr);
    assert.equal(snapshot.maxAbsoluteDrift, portfolioSummary(state).maxAbsoluteDrift);
  }
});

test("reuse: a pre-seeded cost basis is used rather than recomputed", () => {
  // Proves the map is read, not merely written — which is what removes the
  // second computation.
  const state = cloneDefaultState();
  const ticker = state.trades[0]!.ticker;
  const doctored: PositionCostBasis = {
    ...calculatePositionCostBasis(state.trades, ticker),
    costBasisMyr: 999999,
  };
  const summary = portfolioSummary(state, new Map([[ticker, doctored]]));
  const position = summary.positions.find((p) => p.ticker === ticker);
  assert.equal(position?.investedMyr, 999999, "the seeded cost basis was ignored");
});

// --- Nothing else moved ----------------------------------------------------

test("reuse: snapshots are unchanged and the state is never mutated", () => {
  const state = cloneDefaultState();
  const serialized = JSON.stringify(state);
  const ledger = getLedgerSnapshot(state, NOW);
  const portfolio = getPortfolioSnapshot(state);
  assert.deepEqual(getLedgerSnapshot(state, NOW), ledger, "ledger snapshot is not deterministic");
  assert.deepEqual(getPortfolioSnapshot(state), portfolio, "portfolio snapshot is not deterministic");
  assert.equal(JSON.stringify(state), serialized, "state was mutated");
});

function overdrawnState(): WealthState {
  return migrateState({
    deviceId: "s17",
    ledgerAccounts: [{ id: "a-bank", name: "Bank", type: "bank", openingBalance: 100 }],
    ledgerTransactions: [
      { id: "t1", date: "2026-08-05T00:00:00.000Z", amount: 500, type: "expense", accountId: "a-bank", categoryId: "expense-food" },
    ],
  });
}

function emptyLedgerState(): WealthState {
  return migrateState({ deviceId: "s17b", ledgerAccounts: [], ledgerTransactions: [] });
}

function noTradesState(): WealthState {
  return migrateState({ deviceId: "s17c", trades: [] });
}
