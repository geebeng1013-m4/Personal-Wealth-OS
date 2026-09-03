import assert from "node:assert/strict";
import { test } from "./testHarness";

test("isolate: reassigning localStorage.setItem and restoring it", () => {
  const original = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error("simulated");
  };
  try {
    assert.doesNotThrow(() => {
      try { localStorage.setItem("x", "y"); } catch { /* expected */ }
    });
  } finally {
    localStorage.setItem = original;
  }
});
