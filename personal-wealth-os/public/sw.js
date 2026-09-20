// Bumped whenever the caching rules change: activate then drops every older
// cache, including one an earlier worker left in a state the app cannot boot
// from. This only ever removes copies of the app's own files — the ledger
// lives in local storage and Firestore, which a service worker never touches.
const CACHE_NAME = "wealth-os-v20";

// How long opening the app waits for the network before it shows the copy
// already on the phone. A connection that is up but not answering (weak
// signal, Wi-Fi that has not finished connecting) never fails fast: without a
// limit the screen stayed blank until the request gave up, often long enough
// that people closed the app and opened it again.
const NAVIGATION_TIMEOUT_MS = 3000;
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.png",
  "/brand/wealth-mark.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

/** Vite emits hashed filenames; the built HTML is what names them. */
function assetPathsFrom(html) {
  return [
    ...new Set(
      Array.from(html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g), (match) => match[1]),
    ),
  ];
}

/**
 * Whether a response really is the file that was asked for.
 *
 * A hashed asset that no longer exists used to come back as index.html with
 * status 200 (the SPA rewrite answered everything), and storing that HTML
 * under the script's URL left the app unable to boot from its own cache: the
 * browser rejects a module script served as text/html, nothing renders, and
 * the launch screen stays up. vercel.json now keeps /assets/ out of the
 * rewrite so this is a real 404, and this check is the second lock.
 */
function isUsableAsset(path, response) {
  if (!response || !response.ok) return false;
  if (!path.startsWith("/assets/")) return true;
  return !(response.headers.get("content-type") || "").includes("text/html");
}

/**
 * Store a shell and the assets it names, or store neither.
 *
 * The rule the app depends on: a cached index.html is never left pointing at
 * scripts this cache cannot supply. The previous worker saved a late network
 * answer as index.html on its own, so after a deployment the cache held a new
 * shell and the previous build's assets — and the next slow launch served
 * that shell, failed to load its scripts, and showed the launch screen for
 * ever. Assets go in first; the shell follows only once they are all in.
 */
async function cacheShell(cache, response) {
  const html = await response.clone().text();
  const stored = await Promise.all(
    assetPathsFrom(html).map(async (path) => {
      const existing = await cache.match(path);
      if (existing && isUsableAsset(path, existing)) return true;
      try {
        const asset = await fetch(path, { cache: "no-store" });
        if (!isUsableAsset(path, asset)) return false;
        await cache.put(path, asset);
        return true;
      } catch {
        return false;
      }
    }),
  );
  // A shell whose scripts are missing is worse than the older shell already
  // cached, which at least still has its own.
  if (stored.some((ok) => !ok)) return;
  await cache.put("/index.html", response);
}

/** A shell is only worth showing if this cache can also serve its scripts. */
async function shellIsBootable(cache, shell) {
  const paths = assetPathsFrom(await shell.clone().text());
  if (paths.length === 0) return false;
  const present = await Promise.all(
    paths.map(async (path) => isUsableAsset(path, await cache.match(path))),
  );
  return present.every(Boolean);
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(PRECACHE);

  // Discover the hashed filenames from the built HTML so the first installed
  // launch works offline before runtime caching has occurred.
  const indexResponse = await fetch("/index.html", { cache: "no-store" });
  if (!indexResponse.ok) return;
  await cacheShell(cache, indexResponse);
}

// Install - precache the complete application shell.
self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

// Activate - clean old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Navigation - the network's index.html when it answers in time, so a new
// deployment is not pinned to an old index.html and its old hashed assets.
// If it is slow, the cached copy opens the app now; the network answer is
// still saved for the next launch. With nothing cached (first visit), or with
// a cached shell this cache cannot run, there is nothing safe to fall back to,
// so it waits for the network as before.
async function navigationResponse(network) {
  // Nothing about reading the cache may stop the app opening, so any failure
  // in here — storage blocked, a body that will not decode — leaves the
  // network in charge rather than rejecting respondWith, which would hand the
  // user a browser error page instead of the app.
  let cached = null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const shell = await cache.match("/index.html");
    if (shell && (await shellIsBootable(cache, shell))) cached = shell;
  } catch {
    cached = null;
  }
  if (!cached) return network.catch(() => Response.error());
  return Promise.race([
    network.catch(() => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT_MS)),
  ]);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin (Firebase, Google fonts, etc.)
  if (event.request.method !== "GET") return;

  if (url.origin === location.origin && event.request.mode === "navigate") {
    let saved = Promise.resolve();
    const network = fetch(event.request).then((response) => {
      if (response.ok) {
        // Cloned before the page can start reading the body.
        const copy = response.clone();
        saved = caches.open(CACHE_NAME).then((cache) => cacheShell(cache, copy));
      }
      return response;
    });
    // Keep the worker alive until a late answer is saved, even when the
    // cached copy was already shown.
    event.waitUntil(network.then(() => saved).catch(() => {}));
    event.respondWith(navigationResponse(network));
    return;
  }

  // Versioned local assets can render immediately while refreshing in the background.
  if (url.origin === location.origin) {
    let background = Promise.resolve();
    const served = caches.open(CACHE_NAME).catch(() => null).then(async (cache) => {
      // Storage the browser will not open is a reason to go to the network,
      // not a reason to fail the request.
      if (!cache) return fetch(event.request);
      const cached = await cache.match(event.request);
      if (cached && isUsableAsset(url.pathname, cached)) {
        background = fetch(event.request)
          .then((response) => {
            if (isUsableAsset(url.pathname, response)) return cache.put(event.request, response.clone());
          })
          .catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(event.request);
        if (isUsableAsset(url.pathname, response)) await cache.put(event.request, response.clone());
        return response;
      } catch {
        // Returning undefined here would reject respondWith and turn a failed
        // refresh into a failed request.
        return cached || Response.error();
      }
    });
    event.respondWith(served);
    event.waitUntil(served.then(() => background).catch(() => {}));
  }
});
