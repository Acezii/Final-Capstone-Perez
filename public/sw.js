const CACHE_NAME = "pathfinder-shell-v7";
const SHELL_FILES = [
  "/",
  "/offline.html",
  "/favicon.svg",
  "/manifest.json",
  "/shared/css/base.css",
  "/shared/js/config.js",
  "/shared/js/api.js",
  "/shared/js/idb.js",
  "/shared/vendor/qrcode-generator.js",
  "/shared/vendor/jsqr.js",
  "/student/",
  "/student/dashboard.html",
  "/student/css/dashboard.css",
  "/student/js/dashboard.js",
  "/student/js/pathfinder.js",
  "/student/js/scheduler.js",
  "/student/js/ai-chat.js",
  "/student/js/qr-card.js",
  "/admin/",
  "/admin/dashboard.html",
  "/admin/css/dashboard.css",
  "/admin/js/dashboard.js",
  "/admin/js/qr-scanner.js",
  "/admin/js/evaluation.js",
  "/admin/js/csv-import.js",
  "/admin/js/concerns.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function safeResponse(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          const safe = await safeResponse(response);
          if (safe.ok) {
            const clone = safe.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return safe;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached || (await caches.match("/offline.html")) || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then(async (response) => {
          const safe = await safeResponse(response);
          if (safe.ok) {
            const clone = safe.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return safe;
        })
        .catch(() => cached || caches.match("/offline.html"));
      return cached || network;
    })
  );
});
