/**
 * OpenNOW Web service worker.
 *
 * Deliberately narrow scope: cache the app shell and static assets so the UI
 * loads instantly and survives flaky networks. Never touches /api/ (session
 * cookies, catalog, CloudMatch relay) or the /api/signaling WebSocket, because
 * stale cached responses there would break authentication and streaming.
 *
 * Vite emits content-hashed asset filenames, so hashed bundles are cached
 * permanently and a version bump naturally leaves old entries unreferenced.
 */
const CACHE_VERSION = "opennow-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isNeverCached(url) {
  return url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/src/") ||
    url.origin !== self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isNeverCached(url)) return;

  const isNavigation = request.mode === "navigate";
  const isHashedAsset = url.pathname.startsWith("/assets/");

  // Hashed assets are immutable: serve from cache, fall back to network once.
  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetchAndCache(request, ASSET_CACHE)),
    );
    return;
  }

  // Navigations and the shell use network-first so deploys show up immediately,
  // with an offline fallback to the cached shell.
  if (isNavigation || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      fetchAndCache(request, SHELL_CACHE).catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match("/index.html")),
      ),
    );
    return;
  }

  // Everything else static (icons, logos): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const revalidate = fetchAndCache(request, ASSET_CACHE).catch(() => cached);
      return cached ?? revalidate;
    }),
  );
});

async function fetchAndCache(request, cacheName) {
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}
