// Service worker mínimo: deixa o app instalável e abre a tela inicial mesmo sem sinal.
const C = "primecorp-cap-v1"; const BASE = ["/app", "/app.css", "/app.js", "/manifest.webmanifest", "/icon-192.png", "/logo-claro.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/a/") || u.pathname.startsWith("/.netlify/")) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && BASE.includes(u.pathname)) { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match("/app"))));
});
