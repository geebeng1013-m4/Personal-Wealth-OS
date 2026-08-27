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

export function test(name: string, fn: () => void): void {
  total++;
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

process.on("exit", () => {
  const passed = total - failed;
  console.log(`\n${passed}/${total} tests passed`);
  if (failed > 0) process.exitCode = 1;
});
