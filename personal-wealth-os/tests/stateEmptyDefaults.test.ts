import assert from "node:assert/strict";
import { test } from "./testHarness";
import { loadState, migrateState, STORAGE_KEY } from "../src/state";
import type { Trade, WealthState } from "../src/models";

/**
 * What a missing block is worth.
 *
 * migrateState is the only door into the app: local load, imported file and
 * cloud document all pass through it. When a block is absent it has to be
 * filled with something, and the something must be EMPTY — not the sample
 * figures the demo state carries. A file that never mentioned an emergency
 * fund must not come back saying the fund is complete at MYR 4,000.
 *
 * These are the figures that must never appear on their own:
 *   emergency 4000/4000 · cashflow 880/400/320 · dca 100 a month, 70/30
 *   opportunity 400 with three tranches · the six sample buckets
 *   profile "Student Investor", 19
 *
 * migrateState calls deviceId() -> localStorage when input.deviceId is
 * missing, and there is no localStorage in Node, so every fixture supplies a
 * deviceId explicitly.
 */

/** The smallest thing a caller can hand over: a state with nothing in it. */
const nothing = (): WealthState => migrateState({ deviceId: "device-1" });

test("migrateState: an empty input gets an empty emergency fund, not the sample 4,000", () => {
  const result = nothing();
  assert.equal(result.emergency.current, 0, "a fund nobody recorded holds nothing");
  assert.equal(result.emergency.target, 0, "and is not already complete");
  assert.equal(result.emergency.monthlyTopUp, 0);
  assert.equal(result.emergency.annualYield, 0, "a yield nobody typed is not 3.5%");
});

test("migrateState: an empty input gets no spending, not the sample 880 / 400 / 320", () => {
  const { cashflow } = nothing();
  assert.deepEqual(
    { ...cashflow },
    { allowance: 0, transport: 0, food: 0, otherFixed: 0, irregularIncome: 0 },
    "every figure here is money the user says they get or spend; none of it can be invented",
  );
});

test("migrateState: an empty input gets no DCA plan, not 100 a month split 70/30", () => {
  const { dca } = nothing();
  assert.equal(dca.monthly, 0);
  assert.equal(dca.targets.VOO, 0, "a target allocation is a decision, not a default");
  assert.equal(dca.targets.QQQM, 0);
});

test("migrateState: an empty input gets no bear-market reserve, not 400 in three tranches", () => {
  const { opportunity } = nothing();
  assert.equal(opportunity.total, 0);
  assert.equal(opportunity.used, 0);
  assert.equal(opportunity.allocation.VOO, 0);
  assert.equal(opportunity.allocation.QQQM, 0);
  assert.deepEqual(opportunity.tranches, [], "a dip-buy ladder nobody set up has no steps");
});

test("migrateState: an empty input gets no buckets, not the six sample layers", () => {
  const result = nothing();
  assert.deepEqual(result.buckets, [], "the Budget page reads these — sample layers would be a whole fake page");
  assert.deepEqual(result.allocation.steps, [], "and the plan derived from them has no steps either");
});

test("migrateState: an empty input gets an empty profile, not 'Student Investor', 19", () => {
  const { profile } = nothing();
  assert.equal(profile.name, "");
  assert.equal(profile.age, 0);
  assert.equal(profile.stage, "");
  assert.equal(profile.baseCurrency, "MYR", "currency is structural, not a figure about the user");
});

test("migrateState: a half-filled block is not topped up from the sample figures", () => {
  // The likely case in real life: an older export carries the amount saved but
  // not the target. The target must stay unset rather than become 4,000, which
  // would silently render this fund 12.5% complete.
  const result = migrateState({ deviceId: "device-1", emergency: { current: 500 } as WealthState["emergency"] });
  assert.equal(result.emergency.current, 500, "what was given is kept");
  assert.equal(result.emergency.target, 0, "what was not given stays empty");

  const partialDca = migrateState({ deviceId: "device-1", dca: { monthly: 300 } as WealthState["dca"] });
  assert.equal(partialDca.dca.monthly, 300);
  assert.equal(partialDca.dca.targets.VOO, 0, "a monthly amount says nothing about the split");
});

test("migrateState: figures that were given are returned exactly, block by block", () => {
  // The guard on the other side: this fix must change nothing for data that is
  // already complete. Every block below is one the fix touches.
  const given = {
    deviceId: "device-1",
    profile: { name: "Real Person", age: 27, stage: "Working", riskTolerance: "Medium", investmentHorizonYears: 12, baseCurrency: "MYR" },
    cashflow: { allowance: 3200, transport: 250, food: 600, otherFixed: 120, irregularIncome: 80 },
    emergency: { current: 7200, target: 9000, annualYield: 0.028, monthlyTopUp: 300 },
    dca: { monthly: 450, targets: { VOO: 0.55, QQQM: 0.25, VXUS: 0.2 } },
    opportunity: { total: 1500, used: 500, allocation: { VOO: 900, QQQM: 600 }, tranches: [{ drawdown: 12, percent: 0.4, amount: 600, deployed: true }] },
    buckets: [{ id: "rent", name: "Rent", label: "Rent", amount: 900, cadence: "monthly" as const, note: "" }],
  } as unknown as Partial<WealthState>;
  const result = migrateState(given);

  assert.deepEqual({ ...result.profile }, { ...given.profile });
  assert.deepEqual({ ...result.cashflow }, { ...given.cashflow });
  assert.deepEqual({ ...result.emergency }, { ...given.emergency });
  assert.equal(result.dca.monthly, 450);
  assert.equal(result.dca.targets.VXUS, 0.2, "a target for a symbol the sample never mentions survives");
  assert.equal(result.opportunity.total, 1500);
  assert.deepEqual(result.opportunity.tranches, given.opportunity?.tranches);
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0]?.id, "rent");
});

test("migrateState: the legacy seed portfolio is still restored from the sample trades", () => {
  // The one place the sample data is deliberate: a pre-v15 state holding the
  // exact 18 seeded trades is topped back up to the full set. Filling absent
  // blocks with empty values must not disturb it.
  const seeded: Trade[] = Array.from({ length: 18 }, (_, index) => ({
    id: `csv-${String(index + 1).padStart(3, "0")}`,
    date: "2026-01-01",
    platform: "moomoo",
    ticker: index === 17 ? "QQQM" : "VOO",
    type: "DCA",
    amountMyr: 10,
    amountUsd: index === 0 ? 5.04 : index === 17 ? 0.06 : 1,
    priceUsd: 100,
    units: 0.1,
    feeMyr: 1,
  })) as unknown as Trade[];
  const result = migrateState({ deviceId: "device-1", version: 14, trades: seeded } as Partial<WealthState>);
  assert.ok(result.trades.length > 18, "the seeded portfolio is completed from the sample set");
  assert.ok(result.trades.some((trade) => trade.id === "csv-022"), "including the trades recorded after the seed");
});

test("loadState: a device with nothing stored opens empty, not on the sample portfolio", () => {
  // What a real user meets on a new phone: signed in, nothing saved here yet,
  // and main.ts renders this copy while the cloud document is still loading.
  localStorage.clear();
  const state = loadState("new-device-user");
  assert.deepEqual(state.trades, [], "22 sample trades would be someone else's portfolio");
  assert.deepEqual(state.goals, []);
  assert.deepEqual(state.buckets, []);
  assert.equal(state.emergency.current, 0);
  assert.equal(state.dca.monthly, 0);
  localStorage.clear();
});

test("loadState: an unreadable stored state opens empty and keeps the stored text", () => {
  // The state is unreadable, not absent. Opening empty is safe; throwing away
  // the raw text would not be, so loadState only reads.
  localStorage.clear();
  const key = `${STORAGE_KEY}-corrupt-user`;
  localStorage.setItem(key, "{not json at all");
  const state = loadState("corrupt-user");
  assert.equal(state.emergency.current, 0, "and not the sample fund");
  assert.deepEqual(state.trades, []);
  assert.equal(localStorage.getItem(key), "{not json at all", "the unreadable copy is still there to recover");
  localStorage.clear();
});
