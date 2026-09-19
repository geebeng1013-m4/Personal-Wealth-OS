/*
 * Renders the "WealthUp" name shown at the bottom of the launch screen
 * (PLAN.md S-4) to public/brand/launch-name.png.
 *
 * The name is an image, not live text, so the page's launch screen and the
 * iPhone startup images (scripts/generate-launch-images.py composites this
 * file) show exactly the same letters: the page paints before any web font
 * has loaded, and a phone's own system font would not match the image.
 *
 * Drawn by headless Microsoft Edge in the app's own Inter, at 3x, white at
 * 72 % on a transparent ground. Run from personal-wealth-os/:
 *   node scripts/render-launch-name.mjs
 * then re-run scripts/generate-launch-images.py. Windows paths; set EDGE_PATH
 * to point at another Chromium.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const FONT = pathToFileURL(join(ROOT, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")).href;
const OUT = join(ROOT, "public/brand/launch-name.png");
const PORT = 9341;
const SCALE = 3;

const html = `<!doctype html><html><head><style>
  @font-face { font-family: "Inter Variable"; src: url("${FONT}") format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; background: transparent; }
  #name { display: inline-block; padding: 4px 6px; font: 600 15px/1 "Inter Variable"; letter-spacing: 0.06em; color: rgb(255 255 255 / 0.72); }
</style></head><body><span id="name">WealthUp</span></body></html>`;

const work = mkdtempSync(join(tmpdir(), "launch-name-"));
const page = join(work, "name.html");
writeFileSync(page, html);
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(work, "profile")}`, "about:blank"], { stdio: "ignore" });

try {
  let targets;
  for (let i = 0; i < 40 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 100, deviceScaleFactor: SCALE, mobile: false });
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send("Page.navigate", { url: pathToFileURL(page).href });
  await new Promise((r) => setTimeout(r, 800));
  const ready = await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => document.fonts.check('600 15px \"Inter Variable\"'))", awaitPromise: true, returnByValue: true });
  if (ready.result?.result?.value !== true) throw new Error("Inter did not load; is node_modules installed?");
  const box = (await send("Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('name').getBoundingClientRect())", returnByValue: true })).result.result.value;
  const { x, y, width, height } = JSON.parse(box);
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x, y, width, height, scale: 1 } });
  writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
  console.log(`launch-name.png: ${Math.round(width * SCALE)}x${Math.round(height * SCALE)} px (${width}x${height} CSS px at ${SCALE}x)`);
  ws.close();
} finally {
  edge.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { rmSync(work, { recursive: true, force: true }); } catch { /* Edge may still hold its profile for a moment */ }
}
