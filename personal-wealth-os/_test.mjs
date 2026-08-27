import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

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
    buildApi.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
      loader: "ts",
      contents: `
        export const currentUser = () => null;
        export const loadFromFirestore = async () => null;
        export const saveToFirestore = async () => undefined;
      `,
    }));
  },
};

const entrySource = testFiles
  .map((name) => `import ${JSON.stringify(`./tests/${name}`)};`)
  .join("\n");
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