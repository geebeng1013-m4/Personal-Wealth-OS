import assert from "node:assert/strict";
import { test } from "./testHarness";
import { nextContributionLead } from "../src/nextContribution";

/**
 * T-3: Portfolio's "Next contribution" card leads with one sentence. These pin
 * that the sentence only restates the plan — it never invents a split or claims
 * a holding is "the only one below target" when it is not.
 */

test("next contribution: all of it into one holding that is the only one below target", () => {
  const lead = nextContributionLead(
    [{ ticker: "VOO", amount: 0 }, { ticker: "QQQM", amount: 0 }, { ticker: "VXUS", amount: 300 }],
    [{ ticker: "VOO", drift: 0.087 }, { ticker: "QQQM", drift: 0.023 }, { ticker: "VXUS", drift: -0.01 }],
  );
  assert.deepEqual(lead, { kind: "one", ticker: "VXUS", amount: 300, onlyBelowTarget: true });
});

test("next contribution: one holding funded, but it is not the only one below target", () => {
  const lead = nextContributionLead(
    [{ ticker: "VOO", amount: 0 }, { ticker: "QQQM", amount: 300 }],
    [{ ticker: "VOO", drift: -0.02 }, { ticker: "QQQM", drift: -0.03 }],
  );
  assert.equal(lead.kind, "one");
  assert.equal(lead.kind === "one" && lead.onlyBelowTarget, false);
});

test("next contribution: money split across several holdings keeps the plan's total", () => {
  const lead = nextContributionLead(
    [{ ticker: "VOO", amount: 165 }, { ticker: "QQQM", amount: 75 }, { ticker: "VXUS", amount: 60 }],
    [{ ticker: "VOO", drift: 0 }, { ticker: "QQQM", drift: 0 }, { ticker: "VXUS", drift: 0 }],
  );
  assert.equal(lead.kind, "split");
  assert.deepEqual(lead.kind === "split" && lead.tickers, ["VOO", "QQQM", "VXUS"]);
  assert.equal(lead.kind === "split" && lead.amount, 300);
});

test("next contribution: nothing planned says nothing, and rounding dust is not a split", () => {
  assert.deepEqual(nextContributionLead([], []), { kind: "none" });
  assert.deepEqual(nextContributionLead([{ ticker: "VOO", amount: 0.001 }], [{ ticker: "VOO", drift: -0.1 }]), { kind: "none" });
});
