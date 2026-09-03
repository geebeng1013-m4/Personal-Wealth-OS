import assert from "node:assert/strict";
import { test } from "./testHarness";
import { saveSnapshot, loadStateFromCloud, migrateState, CURRENT_VERSION } from "../src/state";
import type { WealthState } from "../src/models";
import { reset, signIn, setCloudDocument } from "test:firebase-stub";

const UID = "isolate-cloud-sync-user";

test("isolate: async loadStateFromCloud with a conditional localStorage.setItem monkey-patch", async () => {
  reset();
  localStorage.clear();
  signIn(UID);

  const stale = migrateState({ version: CURRENT_VERSION, deviceId: "test-device", updatedAt: 1_000, trades: [] } as Partial<WealthState>);
  localStorage.setItem(`personal-wealth-os-state-${UID}`, JSON.stringify(stale));

  setCloudDocument(migrateState({ version: CURRENT_VERSION, deviceId: "test-device", updatedAt: 5_000, trades: [] } as Partial<WealthState>));

  const original = localStorage.setItem;
  localStorage.setItem = (key: string, value: string) => {
    if (key.startsWith("personal-wealth-os-snapshots")) {
      throw new Error("simulated");
    }
    return original.call(localStorage, key, value);
  };

  try {
    const outcome = await loadStateFromCloud();
    assert.equal(outcome.outcome, "cloud-applied");
  } finally {
    localStorage.setItem = original;
  }
});
