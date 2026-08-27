import { resolve } from "path";
import { execSync } from "child_process";

process.chdir(resolve(import.meta.dirname));
execSync("node node_modules/vite/bin/vite.js --host localhost", {
  stdio: "inherit",
  cwd: resolve(import.meta.dirname),
});