import assert from "node:assert/strict";
import { test } from "./testHarness";
import { money } from "../src/rules";

test("money: cents always show two digits, whole amounts none", () => {
  assert.equal(money(63466.2), "MYR 63,466.20");
  assert.equal(money(14484.04), "MYR 14,484.04");
  assert.equal(money(21600), "MYR 21,600");
  assert.equal(money(0.5, ""), " 0.50");
  assert.equal(money(-12.3), "MYR -12.30");
});

test("money: a float that rounds to whole ringgit prints whole", () => {
  assert.equal(money(0.1 + 0.2 - 0.3), "MYR 0");
  assert.equal(money(99.999), "MYR 100");
  assert.equal(money(Number.NaN), "MYR 0");
});
