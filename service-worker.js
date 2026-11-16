const CACHE_NAME = "novaai-market-app-v1";
const SHELL = [
  "./",
  "./index.html",
  "./retail.html",
  "./seller-motors-houses.html?market=property",
  "./property-details.html",
  "./manifest.webmanifest",
  "./novaai-icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => (key.startsWith("novaai-property-") || key.startsWith("novaai-market-")) && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve stale seller login/portal documents or auth helper scripts.
  if (/\\/(seller(?:-property|-retail|-motors)?\\.html|seller-location\\.js)$/.test(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).then(response => {
        if (response && response.ok &&
            /\\/(index\\.html|retail\\.html|seller-motors-houses\\.html|property-details\\.html)?$/.test(url.pathname)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (url.pathname.endsWith("/property-details.html")) return (await cache.match("./property-details.html")) || Response.error();
        if (url.pathname.endsWith("/seller-motors-houses.html")) return (await cache.match("./seller-motors-houses.html?market=property")) || Response.error();
        if (url.pathname.endsWith("/retail.html")) return (await cache.match("./retail.html")) || Response.error();
        if (url.pathname.endsWith("/index.html") || url.pathname.endsWith("/")) return (await cache.match("./index.html")) || Response.error();
        return Response.error();
      })
    );
    return;
  }

  // Keep application scripts fresh; retain a last-known copy only as an offline fallback.
  if (/\\.js$/.test(url.pathname)) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  if (/\\.(webmanifest|svg|css)$/.test(url.pathname)) {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request))
    );
  }
});
