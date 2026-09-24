/**
 * Switch privacy mode on, walk every page, and report money the mask misses.
 *
 * "Mask amounts on screen" blurs elements marked `.t-amt` (see `amt`/`amtIn` in
 * src/html.ts). Nothing stops a new page from printing a figure without the
 * mark, and nobody can see that by reading a diff — which is how the mask came
 * to leak on most pages after the tidy redesign. So this looks: it finds every
 * text node that reads like money and asks the browser whether it is actually
 * blurred.
 *
 *   node scripts/mask-scan.mjs                    # against a demo dev server
 *   node scripts/mask-scan.mjs --port=5199        # a dev server already running
 *   node scripts/mask-scan.mjs --list             # print what IS blurred instead
 *
 * Needs a demo-mode dev server and Edge with remote debugging, both started by
 * hand so this script never touches a server it did not start:
 *
 *   VITE_DEMO_MODE=true npx vite --host 127.0.0.1 --port 5199
 *   "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
 *     --disable-gpu --remote-debugging-port=9222 --user-data-dir=/tmp/edge-mask about:blank
 *
 * Judge the output, don't just count it. Three kinds of "leak" are meant to be
 * there: a percentage, market data (a share price, a fund's payout per share,
 * a drawdown) and the user's own goal sentence, which is free text. The rule
 * the mask follows is the user's own money blurs; the market's numbers do not.
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const APP_PORT = Number(flag("port", 5199));
const CDP_PORT = Number(flag("cdp", 9222));
const LIST_MODE = args.includes("--list");

const PAGES = [
  "dashboard", "portfolio", "ledger", "goals", "buckets", "me",
  "advisor", "money-leaks", "rules", "tvm", "review", "market",
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Anything blurred anywhere up the tree counts: the mark may sit on a parent. */
const MASKED_FN = `(el) => {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (getComputedStyle(node).filter.includes("blur")) return true;
  }
  return false;
}`;

/**
 * Money-shaped text: a currency-prefixed figure, a grouped number, or a bare
 * two-decimal figure. Deliberately loose — a false positive costs one line of
 * reading, a false negative is the bug this script exists to catch.
 */
const SCAN = `(() => {
  const masked = ${MASKED_FN};
  const MONEY = /(?:MYR|RM|USD|HKD|SGD|GBP)\\s?-?[\\d,]+(?:\\.\\d+)?|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\b\\d+\\.\\d{2}\\b/;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const leaks = [];
  let seen = 0, blurred = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue.trim();
    if (!text || !MONEY.test(text)) continue;
    const el = walker.currentNode.parentElement;
    if (!el) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    seen++;
    if (masked(el)) { blurred++; continue; }
    const path = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      path.unshift(n.tagName.toLowerCase() + (n.className ? "." + String(n.className).trim().split(/\\s+/).join(".") : ""));
    }
    leaks.push(path.slice(-2).join(" > ") + "  ::  " + text.slice(0, 70));
  }
  return JSON.stringify({ seen, blurred, leaks });
})()`;

/** The other direction: what the mask hides, to catch it blurring too much. */
const LIST = `(() => {
  const out = [];
  document.querySelectorAll("*").forEach((el) => {
    if (!getComputedStyle(el).filter.includes("blur")) return;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).filter.includes("blur")) return;
    }
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;
    const text = (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ");
    if (text) out.push(text.slice(0, 48));
  });
  return JSON.stringify([...new Set(out)]);
})()`;

/** Folded sections hold tables of their own; open them or they go unscanned. */
const UNFOLD = `(() => {
  document.querySelectorAll("details").forEach((d) => { d.open = true; });
  document.querySelectorAll('button[aria-expanded="false"][aria-controls]').forEach((b) => b.click());
  return true;
})()`;

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error(`No page target on CDP port ${CDP_PORT}. Is Edge running with --remote-debugging-port?`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return res.result?.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { send, ev, errors, close: () => ws.close() };
}

const app = await connect();
// The app reads its route on boot and has no hashchange listener, so land on
// Settings through a real load rather than by changing the hash.
await app.send("Page.navigate", { url: "about:blank" });
await wait(300);
await app.send("Page.navigate", { url: `http://127.0.0.1:${APP_PORT}/#settings` });
await wait(4000);

const flipped = await app.ev(`(() => {
  const box = document.querySelector('[data-privacy="maskAmounts"]');
  if (!box) return "no switch — is this a demo-mode server?";
  if (!box.checked) box.click();
  return "on";
})()`);
console.log("mask switch :", flipped);
console.log("body class  :", await app.ev(`document.body.classList.contains("mask-financial-amounts")`));

let total = 0;
for (const page of PAGES) {
  const found = await app.ev(`(() => {
    const entry = [...document.querySelectorAll('[data-page]')].find((a) => a.dataset.page === '${page}');
    if (!entry) return false;
    entry.click();
    return true;
  })()`);
  if (!found) { console.log(`\n== ${page}: no nav entry`); continue; }
  await wait(1200);
  await app.ev(UNFOLD);
  await wait(1500);
  await app.ev(`(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); return true; })()`);
  await wait(500);

  if (LIST_MODE) {
    const items = JSON.parse(await app.ev(LIST));
    console.log(`\n== ${page} — ${items.length} blurred`);
    for (const item of items) console.log("   ", item);
    continue;
  }
  const { seen, blurred, leaks } = JSON.parse(await app.ev(SCAN));
  total += leaks.length;
  console.log(`\n== ${page} — ${blurred}/${seen} blurred`);
  for (const leak of leaks) console.log("   LEAK", leak);
}

console.log("\nconsole errors:", app.errors.length ? app.errors : "none");
if (!LIST_MODE) console.log(`unblurred figures: ${total} — judge each against the rule above.`);
app.close();
