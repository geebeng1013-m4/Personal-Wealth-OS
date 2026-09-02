// Minimal test harness for _test.mjs's esbuild bundle-and-run setup.
// Each test.ts file imports `test` and calls it with a name + assertion body.
// Failures are collected so one bad assertion doesn't hide the rest of the suite.

// Minimal in-memory localStorage so tests can call state helpers that persist
// (deviceId, snapshots) without a browser.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() { return store.size; },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
  });
}

let total = 0;
let failed = 0;

/**
 * Tests run one at a time, in registration order, and the summary waits for
 * all of them.
 *
 * The harness used to call fn() and move on. A synchronous body was fine; an
 * async one was not awaited at all, so it reported "ok" before it had done
 * anything, its failure escaped the counter, and the suite printed
 * "648/648 tests passed" a moment before the process died on the uncaught
 * rejection. Async tests also ran concurrently, which let them race each other
 * on module-level state and fail for reasons that had nothing to do with the
 * code under test.
 *
 * Serialising costs nothing here — the suite is CPU-bound and sub-second — and
 * it buys a result that can be trusted.
 */
let queue: Promise<void> = Promise.resolve();

export function test(name: string, fn: () => void | Promise<void>): void {
  total++;
  queue = queue.then(async () => {
    try {
      await fn();
      console.log(`  ok - ${name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL - ${name}`);
      console.error(err instanceof Error ? err.message : err);
    }
  });
}

/**
 * Wait for every registered test, then report. The runner must await this —
 * a summary printed from process.on("exit") cannot wait for anything, which is
 * how the old harness came to announce results it had not collected yet.
 */
export async function flush(): Promise<void> {
  await queue;
  const passed = total - failed;
  console.log(`\n${passed}/${total} tests passed`);
  if (failed > 0) process.exitCode = 1;
}
