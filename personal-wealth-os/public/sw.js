const CACHE_NAME = "wealth-os-v19";

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

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(PRECACHE);

  // Vite emits hashed filenames. Discover them from the built HTML so the
  // first installed launch works offline before runtime caching has occurred.
  const indexResponse = await fetch("/index.html", { cache: "no-store" });
  if (!indexResponse.ok) return;

  const html = await indexResponse.clone().text();
  const assetPaths = Array.from(
    html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g),
    (match) => match[1],
  );

  await cache.put("/index.html", indexResponse);
  await Promise.all(
    [...new Set(assetPaths)].map(async (path) => {
      try {
        await cache.add(path);
      } catch {
        // One optional chunk must not prevent the service worker installing.
      }
    }),
  );
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
// still saved for the next launch. With nothing cached (first visit) there
// is nothing to fall back to, so it waits as before.
async function navigationResponse(network) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match("/index.html");
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
        saved = caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
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
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});
