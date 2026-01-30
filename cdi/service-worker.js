/* =========================================================
   SMT Racing PWA Service Worker (CDI Only) — SAFE MULTI PWA
   - Tidak menghapus cache PWA lain (DYNO aman)
   - Tidak meng-handle request di luar /cdi/ (biar tidak ganggu)
   - HTML: network-first (update cepat)
   - Static: cache-first
   - Manifest: network-first (biar update)
========================================================= */

const CACHE_PREFIX  = "smt-cdi-";
const CACHE_VERSION = "smt-cdi-v3";   // naikkan versi kalau update
const CACHE_NAME    = CACHE_VERSION;

const CDI_HOME = "/cdi-mapping.html";   // pastikan ini benar

const CORE_ASSETS = [
  CDI_HOME,

  // jangan cache manifest jika kamu mau selalu fresh (OK)
  // "/cdi/cdi.webmanifest",

  "/css/style.css",
  "/js/app.js",

  "/js/esp/esp-api.js",
  "/js/esp/esp-api-dual.js",

  "/js/cdi-basic/cdi-basic.js",
  "/js/cdi-basic/cdi-basic-live.js",

  "/js/cdi-dual/cdi-dual.js",
  "/js/cdi-dual/cdi-dual-live.js",

  "/js/cdi-racing/cdi-racing.js",

  "/img/bg-cdi.png",

  // icon global boleh
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // addAll gagal kalau ada 1 file 404.
    // Biar install tetap jalan: cache satu-satu.
    await Promise.all(
      CORE_ASSETS.map(async (u) => {
        try { await cache.add(u); } catch (e) {}
      })
    );

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // HAPUS HANYA cache CDI, jangan sentuh DYNO
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        const isCDICache = k.startsWith(CACHE_PREFIX);
        const isCurrent  = k === CACHE_NAME;
        if (isCDICache && !isCurrent) return caches.delete(k);
        return null;
      })
    );

    await self.clients.claim();
  })());
});

// helper: network-first + update cache
async function networkFirst(req){
  try{
    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  }catch(e){
    const cached = await caches.match(req);
    return cached || (await caches.match(CDI_HOME)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // hanya same-origin
  if (url.origin !== self.location.origin) return;

  // ✅ BATASI: CDI SW hanya handle /cdi/ + /assets/
  const isCDI    = url.pathname.startsWith("/cdi/");
  const isAssets = url.pathname.startsWith("/assets/");
  if (!isCDI && !isAssets) return; // biarkan DYNO / lainnya lewat normal

  // Manifest CDI: network-first (kalau manifest kamu di /cdi/)
  if (url.pathname === "/cdi/cdi.webmanifest" || url.pathname === "/cdi.webmanifest") {
    event.respondWith(networkFirst(req));
    return;
  }

  const accept = (req.headers.get("accept") || "");

  // HTML/navigation: network-first
  if (req.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith((async () => {
      try{
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
        return res;
      }catch(e){
        // ✅ fallback path benar
        return (await caches.match(req)) || (await caches.match(CDI_HOME));
      }
    })());
    return;
  }

  // Static: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try{
      const res = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
      return res;
    }catch(e){
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});

