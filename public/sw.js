// Minimal service worker for the PWA shell.
//
// Scope is deliberately narrow: it precaches only the offline fallback page
// and its icon, and it only intercepts top-level navigations. Game assets,
// Street View tiles, and the Socket.IO transport are never cached, so a stale
// service worker can never serve a broken panorama or a wedged socket.
const CACHE = "world-seek-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icon.svg"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only page navigations get the offline fallback. Everything else (scripts,
  // styles, XHR, WebSocket upgrades) is left to the network untouched.
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res || Response.error())),
  );
});
