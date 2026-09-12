const CACHE = "red-nexus-classroom-v22";
const APP = [
  "/",
  "./index.html",
  "./manifest.webmanifest",
  "./nexus-local-ai.js?v=1"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const r = event.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.pathname.startsWith("/api/") || u.pathname.includes("/socket") || u.pathname.includes("/ws")) return;
  event.respondWith(caches.match(r).then(cached => {
    if (cached) return cached;
    return fetch(r).then(response => {
      if (!response || response.status !== 200 || response.type === "opaque") return response;
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(r, copy));
      return response;
    }).catch(() => caches.match("./index.html"));
  }));
});
self.addEventListener("message", event => { if (event.data === "SKIP_WAITING") self.skipWaiting(); });
