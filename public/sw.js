const CACHE = "contest-log-workbench-v1";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const indexResponse = await fetch("./index.html");
    const indexText = await indexResponse.clone().text();
    const assets = [...indexText.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map((match) => match[1]);
    await cache.put("./index.html", indexResponse);
    await cache.addAll([...new Set(["./", "./manifest.webmanifest", "./og.png", ...assets])]);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => event.request.mode === "navigate" ? caches.match("./index.html") : undefined)),
  );
});
