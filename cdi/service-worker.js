
/* SMT Racing PWA Service Worker (CDI Only) */
const CACHE_VERSION = "smt-cdi-v3"; // NAHKAN versi biar cache lama dibuang

const CORE_ASSETS = [
  "/cdi-mapping.html",
  // "/cdi.webmanifest",  // JANGAN cache di sini (biar tidak nyangkut)

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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_VERSION ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

// helper: network-first + update cache
async function networkFirst(req){
  try{
    const res = await fetch(req);
    const copy = res.clone();
    const cache = await caches.open(CACHE_VERSION);
    cache.put(req, copy);
    return res;
  }catch(e){
    const cached = await caches.match(req);
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  // === MANIFEST: SELALU NETWORK-FIRST (biar orientation update) ===
  if (url.pathname === "/cdi.webmanifest") {
    event.respondWith(networkFirst(req));
    return;
  }

  // HTML: network-first biar update cepat
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match("/cdi-mapping.html")))
    );
    return;
  }

  // Static: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        return res;
      });
    })
  );
});
