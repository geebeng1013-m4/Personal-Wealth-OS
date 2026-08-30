/**
 * Drive the WealthUp app in a real browser over the Chrome DevTools Protocol.
 *
 * No Playwright or Puppeteer — Node 24 ships a global WebSocket and the machine
 * has Edge, so this needs nothing installed.
 *
 * Usage as a library:
 *
 *   import { openApp } from "./cdp.mjs";
 *   const app = await openApp("review");
 *   console.log(await app.ev(`document.querySelector('#reviewForm') !== null`));
 *   app.close();
 *
 * Usage as a CLI smoke check:
 *
 *   node cdp.mjs review "document.querySelectorAll('.review-item').length"
 */

const CDP_PORT = Number(process.env.WEALTHUP_CDP_PORT ?? 9222);
const APP_PORT = Number(process.env.WEALTHUP_APP_PORT ?? 5199);

async function firstPageTarget() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error(`No page target on CDP port ${CDP_PORT}. Is Edge running with --remote-debugging-port?`);
  return page;
}

export async function connect() {
  const target = await firstPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  /** Console errors and uncaught exceptions, collected for the caller to assert on. */
  const errors = [];

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
  });

  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  /** Evaluate in the page. Throws with the page's own error text on failure. */
  const ev = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return res.result?.result?.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");

  return { send, ev, errors, close: () => ws.close() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Land on a page by deep link.
 *
 * Always via about:blank first. The app has NO hashchange listener — the hash
 * is written by navigate() for bookmarkability, and routing is decided on boot
 * or by an in-app nav click. A hash-only navigation therefore leaves the
 * previous page on screen, which reads exactly like a broken extraction.
 */
export async function openApp(hash, session) {
  const app = session ?? (await connect());
  await app.send("Page.navigate", { url: "about:blank" });
  await wait(300);
  await app.send("Page.navigate", { url: `http://127.0.0.1:${APP_PORT}/#${hash}` });
  await wait(4000); // boot + demo state + first render
  return app;
}

/** Click a sidebar entry, exercising real in-app navigation rather than a reload. */
export async function navigateInApp(app, page) {
  const clicked = await app.ev(`
    const link = [...document.querySelectorAll('[data-page]')].find(a => a.dataset.page === '${page}');
    if (!link) false; else { link.click(); true }`);
  await wait(1500);
  return clicked;
}

if (import.meta.filename === process.argv[1]) {
  const [hash = "dashboard", expression] = process.argv.slice(2);
  const app = await openApp(hash);
  console.log("hash    :", await app.ev("location.hash"));
  console.log("title   :", await app.ev("document.querySelector('h1')?.innerText.trim()"));
  if (expression) console.log("result  :", await app.ev(expression));
  console.log("errors  :", app.errors.length ? app.errors : "none");
  app.close();
}
