import assert from "node:assert/strict";
import { test } from "./testHarness";
import { cloudLoadNeedsRender, emptyState } from "../src/state";

test("cloud load: the same save as the one on screen does not re-render", () => {
  const onScreen = { ...emptyState(), updatedAt: 1_789_700_000_000 };
  const fromCloud = { ...emptyState(), updatedAt: 1_789_700_000_000, lastSyncedAt: 1_789_700_000_000 };
  assert.equal(cloudLoadNeedsRender(onScreen, fromCloud), false);
});

test("cloud load: a different save (another device edited) re-renders", () => {
  const onScreen = { ...emptyState(), updatedAt: 1_789_700_000_000 };
  const fromCloud = { ...emptyState(), updatedAt: 1_789_700_050_000 };
  assert.equal(cloudLoadNeedsRender(onScreen, fromCloud), true);
});

test("cloud load: an empty local copy on a new device re-renders", () => {
  assert.equal(cloudLoadNeedsRender(emptyState(), { ...emptyState(), updatedAt: 1_789_700_000_000 }), true);
});
