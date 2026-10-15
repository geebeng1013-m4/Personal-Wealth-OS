import assert from "node:assert/strict";
import { test } from "./testHarness";
import { emptyState, migrateState } from "../src/state";
import { updateOpportunityTranches } from "../src/opportunityTranches";
import { getFinancialRule } from "../src/financialRules";

function fixture() {
  return { ...emptyState(), opportunity: {
    total: 400, used: 0, allocation: { VOO: 200, QQQM: 200 },
    tranches: [
      { drawdown: 10, amount: 80, percent: 0.2, deployed: false },
      { drawdown: 15, amount: 120, percent: 0.3, deployed: false },
      { drawdown: 20, amount: 200, percent: 0.5, deployed: false },
    ],
  } };
}
const entries = () => [{ drawdown: "10", amount: "80" }, { drawdown: "15", amount: "120" }, { drawdown: "20", amount: "200" }];

test("dip-buy editor: saves amounts and thresholds, sorted with matching structured rules", () => {
  const state = fixture();
  const input = entries();
  input[0] = { drawdown: "25", amount: "60.50" };
  const result = updateOpportunityTranches(state, input);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.state.opportunity.tranches.map(t => t.drawdown), [15, 20, 25]);
  assert.equal(result.state.opportunity.tranches[2].amount, 60.5);
  assert.equal(result.state.opportunity.tranches[2].percent, 60.5 / 400);
  assert.deepEqual(getFinancialRule(result.state, "opportunity-reserve-deployment")?.tranches, result.state.opportunity.tranches.map(t => ({ drawdown: t.drawdown, percent: t.percent })));
  assert.equal(state.opportunity.tranches[0].drawdown, 10);
  assert.deepEqual(result.state.opportunity.allocation, state.opportunity.allocation);
});

test("dip-buy editor: deployed steps and used money are retained", () => {
  const state = fixture();
  state.opportunity.used = 80;
  state.opportunity.tranches[0].deployed = true;
  const input = entries(); input[1].amount = "100";
  const result = updateOpportunityTranches(state, input);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.state.opportunity.tranches[0], state.opportunity.tranches[0]);
  assert.equal(result.state.opportunity.used, 80);
  for (const field of ["amount", "drawdown"] as const) {
    const tampered = entries(); tampered[0][field] = "12";
    assert.equal(updateOpportunityTranches(state, tampered).ok, false);
  }
});

test("dip-buy editor: rejects invalid, blank, nonfinite and sub-cent amounts", () => {
  for (const amount of ["", " ", "0", "-1", "NaN", "Infinity", "1e2", "0.001", "9007199254740992", "abc"]) {
    const input = entries(); input[1].amount = amount;
    assert.equal(updateOpportunityTranches(fixture(), input).ok, false, amount);
  }
});

test("dip-buy editor: rejects out-of-range or duplicate drawdowns", () => {
  for (const drawdown of ["", "0", "-10", "101", "Infinity", "10", "15.001"]) {
    const input = entries(); input[1].drawdown = drawdown;
    assert.equal(updateOpportunityTranches(fixture(), input).ok, false, drawdown);
  }
});

test("dip-buy editor: planned total cannot exceed reserve", () => {
  const input = entries(); input[2].amount = "200.01";
  assert.equal(updateOpportunityTranches(fixture(), input).ok, false);
  assert.equal(updateOpportunityTranches(fixture(), entries()).ok, true);
});

test("dip-buy editor: pending total also respects reserve already used elsewhere", () => {
  const state = fixture(); state.opportunity.used = 100;
  assert.equal(updateOpportunityTranches(state, entries()).ok, false);
  const input = entries(); input[2].amount = "100";
  assert.equal(updateOpportunityTranches(state, input).ok, true);
});

test("dip-buy editor: invalid reserves and changed step counts are rejected", () => {
  for (const total of [0, -1, Infinity, NaN]) {
    const state = fixture(); state.opportunity.total = total;
    assert.equal(updateOpportunityTranches(state, entries()).ok, false);
  }
  assert.equal(updateOpportunityTranches(fixture(), []).ok, false);
  assert.equal(updateOpportunityTranches(fixture(), entries().slice(1)).ok, false);
});

test("dip-buy editor: decimal money and deployed flags survive export and migration", () => {
  const state = fixture(); state.opportunity.used = 80; state.opportunity.tranches[0].deployed = true;
  const input = entries(); input[1] = { drawdown: "15.25", amount: "119.99" };
  const result = updateOpportunityTranches(state, input);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(migrateState(JSON.parse(JSON.stringify(result.state))).opportunity, result.state.opportunity);
});
