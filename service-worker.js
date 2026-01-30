const CACHE = "smt-cdi-v1";

const CORE = [
  "/",
  "/cdi-mapping.html",
  "/cdi.webmanifest",
  "/service-worker.js",
  "/favicon.ico",

  // icons (wajib untuk install)
  "/assets/icon-192.png",
  "/assets/icon-512.png",

  // CDI base files (sesuai struktur kamu)
  "/cdi/css/style.css",
  "/cdi/js/app.js",
  "/cdi/img/bg-cdi.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/cdi-mapping.html"));
    })
  );
});
