const CACHE_NAME = "novaai-market-app-v2";
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
  const sensitiveSellerPath =
    url.pathname.endsWith("/seller.html") ||
    url.pathname.endsWith("/seller-retail.html") ||
    url.pathname.endsWith("/seller-property.html") ||
    url.pathname.endsWith("/seller-motors.html") ||
    url.pathname.endsWith("/seller-location.js");
  if (sensitiveSellerPath) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).then(response => {
        const isAppDocument =
          url.pathname.endsWith("/index.html") ||
          url.pathname.endsWith("/retail.html") ||
          url.pathname.endsWith("/seller-motors-houses.html") ||
          url.pathname.endsWith("/property-details.html") ||
          url.pathname.endsWith("/");
        if (response && response.ok && isAppDocument) {
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
  if (url.pathname.endsWith(".js")) {
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

  if (url.pathname.endsWith(".webmanifest") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".css")) {
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
