/* =========================================================
   service-worker.js (ROOT) — DYNO ROAD PWA
   - Precache file inti
   - Network-first untuk HTML (biar update cepat)
   - Stale-while-revalidate untuk asset statis
========================================================= */

const SW_VERSION = "dyno-v1.0.0";      // naikkan versi kalau update cache
const CACHE_STATIC = `static-${SW_VERSION}`;
const CACHE_PAGES  = `pages-${SW_VERSION}`;

// Halaman utama PWA (sesuaikan kalau path berbeda)
const CORE_PAGES = [
  "/dyno-road.html"
];

// Asset inti DYNO
const CORE_ASSETS = [
  "/dyno/css/style.css",
  "/dyno/js/esp-api-dual.js",
  "/dyno/js/dyno-road.js",
  "/dyno/js/app.js",

  // manifest + icon (supaya install/offline lebih mulus)
  "/dyno.webmanifest",
  "/assets/icon-192.png"
];

// Optional: fallback offline (pakai dyno-road sebagai fallback)
const OFFLINE_FALLBACK = "/dyno-road.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // cache halaman
    const pagesCache = await caches.open(CACHE_PAGES);
    await pagesCache.addAll(CORE_PAGES);

    // cache asset statis
    const staticCache = await caches.open(CACHE_STATIC);
    await staticCache.addAll(CORE_ASSETS);

    // aktifkan cepat
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // bersihkan cache versi lama
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        if (k !== CACHE_STATIC && k !== CACHE_PAGES) return caches.delete(k);
      })
    );

    // kontrol klien langsung
    await self.clients.claim();
  })());
});

// Helper: cek request HTML/navigation
function isHTMLRequest(request) {
  return request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");
}

// Helper: asset statis (css/js/png/svg/ico/json)
function isStaticAsset(url) {
  return (
    url.pathname.endsWith(".js")  ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg")||
    url.pathname.endsWith(".webp")||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".json")||
    url.pathname.endsWith(".webmanifest")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // hanya handle GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // hanya same-origin (biar gak ganggu API luar)
  if (url.origin !== self.location.origin) return;

  // 1) HTML: network-first (biar update cepat), fallback ke cache/offline
  if (isHTMLRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_PAGES);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || (await caches.match(OFFLINE_FALLBACK));
      }
    })());
    return;
  }

  // 2) Static assets: stale-while-revalidate (cepat + tetap update)
  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_STATIC);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);

      // jika ada cache -> langsung pakai, sambil update di belakang
      if (cached) return cached;

      // kalau belum ada cache -> pakai network
      const net = await fetchPromise;
      return net || new Response("", { status: 504, statusText: "Offline" });
    })());
    return;
  }

  // 3) Default: coba network, fallback cache
  event.respondWith((async () => {
    try {
      return await fetch(req);
    } catch (e) {
      return (await caches.match(req)) || new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
