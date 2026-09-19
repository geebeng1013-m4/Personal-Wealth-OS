import assert from "node:assert/strict";
import { test } from "./testHarness";
import { greetingName } from "../src/pages/dashboardPage";

test("greeting: a new account is greeted by the first word of its sign-in name", () => {
  assert.equal(greetingName("", "Alex Chen"), "Alex");
});

test("greeting: a name typed in Settings wins over the sign-in name", () => {
  assert.equal(greetingName("Hong", "Alex Chen"), "Hong");
});

test("greeting: with neither name it still says there", () => {
  assert.equal(greetingName("", ""), "there");
  assert.equal(greetingName("  ", "   "), "there");
});
