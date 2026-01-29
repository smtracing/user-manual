/* SMT Racing PWA Service Worker (CDI Only) */
const CACHE_VERSION = "smt-cdi-v2"; // naikkan versi biar HP update
const CORE_ASSETS = [
  "/cdi-mapping.html",
  "/cdi.webmanifest",

  "/cdi/css/style.css",
  "/cdi/js/app.js",

  "/cdi/js/esp/esp-api.js",
  "/cdi/js/esp/esp-api-dual.js",

  "/cdi/js/cdi-basic/cdi-basic.js",
  "/cdi/js/cdi-basic/cdi-basic-live.js",

  "/cdi/js/cdi-dual/cdi-dual.js",
  "/cdi/js/cdi-dual/cdi-dual-live.js",

  "/cdi/js/cdi-racing/cdi-racing.js",

  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/cdi/img/bg-cdi.png",
];

async function precacheSafe(cache) {
  // addAll bisa gagal total kalau 1 file 404
  // ini versi aman: coba satu-satu
  await Promise.all(
    CORE_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) await cache.put(url, res.clone());
      } catch (e) {
        // abaikan error per-file
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await precacheSafe(cache);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_VERSION ? null : caches.delete(k))));

      // optional: preload untuk navigasi
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch (e) {}
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // hanya same-origin
  if (url.origin !== location.origin) return;

  const accept = (req.headers.get("accept") || "");

  // NAV/HTML: network-first
  if (req.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          // pakai preload kalau ada
          const preload = await event.preloadResponse;
          if (preload) return preload;

          const res = await fetch(req);
          const copy = res.clone();
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, copy);
          return res;
        } catch (e) {
          const cached = await caches.match(req);
          return cached || caches.match("/cdi-mapping.html");
        }
      })()
    );
    return;
  }

  // STATIC: cache-first
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        const copy = res.clone();
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, copy);
        return res;
      } catch (e) {
        // fallback ringan: kalau request gambar background gagal, balikin kosong
        return new Response("", { status: 504 });
      }
    })()
  );
});
