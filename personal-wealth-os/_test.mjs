import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build, stop } from "esbuild";

const projectRoot = resolve(import.meta.dirname);
const testDirectory = resolve(projectRoot, "tests");
const testFiles = (await readdir(testDirectory))
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

if (testFiles.length === 0) {
  throw new Error("No test files found in tests/*.test.ts");
}

const firebaseStubPlugin = {
  name: "firebase-stub",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^\.\/firebase$/ }, (args) => {
      if (!args.importer.endsWith("state.ts")) return undefined;
      return { path: "firebase-stub", namespace: "test-stub" };
    });
    // The same module, addressed by name, so a test can drive what state.ts
    // sees. Both resolutions return one path+namespace, so esbuild emits a
    // single instance — the test and state.ts share it.
    buildApi.onResolve({ filter: /^test:firebase-stub$/ }, () => ({
      path: "firebase-stub",
      namespace: "test-stub",
    }));
    buildApi.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
      loader: "ts",
      contents: `
        let user = null;
        let cloudDocument = null;
        export const saved = [];

        export const currentUser = () => user;
        export const loadFromFirestore = async () => cloudDocument;
        export const saveToFirestore = async (uid, state) => { saved.push({ uid, state }); };

        /** Back to "signed out, cloud empty, nothing written". */
        export function reset() {
          user = null;
          cloudDocument = null;
          saved.length = 0;
        }
        export function signIn(uid) { user = { uid }; }
        export function setCloudDocument(document) { cloudDocument = document; }
      `,
    }));
  },
};

// The flush import comes last so every file has registered its tests before
// the runner waits on them, and the await is what makes an async failure
// count instead of surfacing after the summary.
const entrySource = [
  ...testFiles.map((name) => `import ${JSON.stringify(`./tests/${name}`)};`),
  `import { flush } from "./tests/testHarness";`,
  `await flush();`,
].join("\n");
const result = await build({
  stdin: {
    contents: entrySource,
    loader: "ts",
    resolveDir: projectRoot,
    sourcefile: "test-entry.ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
  plugins: [firebaseStubPlugin],
});

const bundledTests = result.outputFiles[0].text;
await import(`data:text/javascript;base64,${Buffer.from(bundledTests).toString("base64")}`);

// esbuild's JS API leaves a service child process running, and its two pipe
// handles are what `process.getActiveResourcesInfo()` reports after a build.
// A script that builds once and then wants to exit has to shut it down.
await stop();

// The suite has run, the summary is printed, process.exitCode is set, and
// esbuild's service is stopped — there is no legitimate work left. Even so,
// something on Linux CI still holds the event loop open past all of that:
// several rounds of bisection pinned it to test files that reassign
// localStorage.setItem but never named the handle, and the cost was 10-minute
// timeouts on runs where every test had already passed in ~30s. Exit rather
// than wait for a handle that is doing nothing. process.exit() with no
// argument uses process.exitCode (1 when flush() saw a failure, else 0); the
// awaited stop() above yields a loop turn first, so the summary flushes.
process.exit();
