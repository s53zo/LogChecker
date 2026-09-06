const CACHE_PREFIX = "contest-log-workbench-";
const CACHE = `${CACHE_PREFIX}v2`;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const indexResponse = await fetch("./index.html");
    const indexText = await indexResponse.clone().text();
    const assets = [...indexText.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map((match) => match[1]);
    await cache.put("./index.html", indexResponse);
    await cache.addAll([...new Set(["./", "./manifest.webmanifest", "./og.png", ...assets])]);
    // Module workers are referenced by the built JS rather than index.html.
    // Cache them on first load so the first large import also works offline.
    const workers = [];
    for (const asset of assets.filter((asset) => asset.endsWith(".js"))) {
      const response = await cache.match(asset);
      if (!response) continue;
      const source = await response.text();
      for (const match of source.matchAll(/import-worker-[A-Za-z0-9_-]+\.js/g)) {
        workers.push(new URL(match[0], new URL(asset, self.location.href)).href);
      }
    }
    await cache.addAll([...new Set(workers)]);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)))),
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
