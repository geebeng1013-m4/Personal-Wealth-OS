---
name: run-wealthup
description: Launch the WealthUp / personal-wealth-os app and drive it in a real browser to confirm a change works. Use when asked to run, start, open, screenshot, or smoke-test the app, or to verify a UI change beyond typecheck and unit tests — especially after extracting a page out of ui.ts.
argument-hint: "[page-id] [what to verify]"
---

# Running WealthUp

`npm test`, `npm run typecheck` and `npm run build` prove the code compiles and
the read models are correct. They render nothing. Anything touching `ui.ts`, a
page module, or a shared component needs the app actually driven.

Everything below is verified working on this machine. No Playwright or
Puppeteer — Node 24 ships a global `WebSocket` and Edge is installed, so the
CDP driver needs nothing installed.

## 1. Start the dev server in demo mode

```sh
cd "c:/zhixue douyin/personal-wealth-os"
VITE_DEMO_MODE=true node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5199 > /tmp/dev.log 2>&1 &
```

`VITE_DEMO_MODE=true` is what makes this usable unattended: it skips Firebase
auth, signs in a mock user, and loads the fixture in `src/demoData.ts`. Without
it you land on a Google sign-in wall and can see nothing.

Wait for it rather than sleeping blindly:

```sh
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5199/ | grep -q 200 && break
  sleep 1
done
```

## 2. Start Edge with remote debugging

```sh
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"$EDGE" --headless=new --disable-gpu --no-sandbox \
        --remote-debugging-port=9222 --user-data-dir=/tmp/edgeprof about:blank &
sleep 4
curl -s http://127.0.0.1:9222/json/version   # confirm CDP is up
```

Edge writes unrelated `ERROR:` lines to stderr (QQBrowser importer, task
manager fallback). They are browser noise, not app errors — judge the app by
`Runtime.exceptionThrown` and `console.error`, which the driver collects.

## 3. Drive it

`scripts/cdp.mjs` is the driver. As a CLI:

```sh
node .claude/skills/run-wealthup/scripts/cdp.mjs review \
  "document.querySelectorAll('.review-item').length"
```

As a library, for a real interaction:

```js
import { openApp, navigateInApp } from "./scripts/cdp.mjs";

const app = await openApp("tvm");
await app.ev(`document.querySelector('[data-tvm-solve="futureValue"]').click(); true`);
await new Promise(r => setTimeout(r, 500));
console.log(await app.ev(`document.querySelector('[data-tvm-input="futureValue"]').value`));
console.log(app.errors);       // must be empty
app.close();
```

### The one trap: there is no hashchange listener

`main.ts` reads the hash **on boot** and `navigate()` writes it back for
bookmarkability, but nothing listens for `hashchange`. So navigating from
`#tvm` to `#review` by changing the hash alone leaves the TVM page on screen —
which looks exactly like a broken page extraction and is not one.

`openApp()` handles this by going through `about:blank` first, forcing a real
load. To test in-app navigation instead, use `navigateInApp(app, "tvm")`,
which clicks the sidebar entry a user would click.

## 4. Screenshot — and look at it

```sh
WD=$(pwd -W)   # Edge needs a Windows-style path; a /c/... path silently fails
"$EDGE" --headless=new --disable-gpu --no-sandbox --user-data-dir="C:/temp/edgeshot" \
        --virtual-time-budget=9000 --window-size=1400,1000 \
        --screenshot="$WD/shot.png" "http://127.0.0.1:5199/#review"
```

Then read the PNG. A blank or half-painted frame is a failure to launch, and
only looking catches it.

## 5. Clean up

```sh
taskkill //F //IM msedge.exe
for p in $(netstat -ano | grep -E ":5199\s+.*LISTENING" | awk '{print $NF}' | sort -u); do
  taskkill //F //PID $p
done
```

## Page ids

`dashboard` `portfolio` `goals` `market` `ledger` `buckets` `money-leaks`
`advisor` `review` `rules` `tvm` `calculator` `settings` — plus `quick`, which
is a separate route (`/quick`), not in the main nav.

## What a good smoke check asserts

Rendering alone is weak evidence. Prefer, in order:

1. **A computed result.** Solve for FV from the seeded PV/PMT/rate/periods and
   check the number against hand arithmetic — `57,103.45` for the defaults,
   with total payments `-36,000` and interest `20,103.45` agreeing.
2. **A state change that survives a re-render.** Submit the Review form and
   confirm the history count rises and the form is still there. This is the
   path through a page module's `rerender` hand-off.
3. **Zero `app.errors`.** An empty array is part of the result, not a footnote.
4. **Demo figures you can cross-check.** The fixture's income is `2300` and
   spending `249` — the same numbers `tests/regressionBaseline.test.ts` pins.
