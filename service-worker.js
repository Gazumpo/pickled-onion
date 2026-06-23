const VERSION = "2026-06-23-centered-links";
const CACHE_PREFIX = "pickled-onion";
const PRECACHE_CACHE = `${CACHE_PREFIX}-precache-${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${VERSION}`;
const ALL_CACHES = [PRECACHE_CACHE, RUNTIME_CACHE];

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/links.js",
  "/manifest.webmanifest",
  "/offline.html",
  "/favicon.svg",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
];

const OPTIONAL_CACHE_URLS = [
  "/piano",
  "/piano/",
  "/piano/index.html",
  "/trains",
  "/trains/",
  "/trains/index.html",
  "/swim",
  "/swim/",
  "/swim/index.html",
  "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js",
  "https://fonts.googleapis.com/css2?family=Sacramento&family=Space+Grotesk:wght@400;500;700&display=swap",
];

function isCacheableResponse(response) {
  return response && (response.ok || response.type === "opaque");
}

async function cacheOptionalUrl(cache, url) {
  try {
    const response = await fetch(url, { cache: "reload" });
    if (isCacheableResponse(response)) {
      await cache.put(url, response);
    }
  } catch {
    // Optional routes may not exist in local development, and remote assets may be unavailable.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await Promise.all(OPTIONAL_CACHE_URLS.map((url) => cacheOptionalUrl(cache, url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && !ALL_CACHES.includes(cacheName))
          .map((cacheName) => caches.delete(cacheName))
      );
      await self.clients.claim();
    })()
  );
});

async function putInRuntimeCache(request, response) {
  if (!isCacheableResponse(response)) {
    return;
  }

  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response.clone());

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.search) {
    await cache.put(url.pathname, response.clone());
  }
}

async function findNavigationFallback(request) {
  const url = new URL(request.url);
  const cachedRequest = await caches.match(request, { ignoreSearch: true });
  if (cachedRequest) {
    return cachedRequest;
  }

  if (url.origin === self.location.origin) {
    const withoutTrailingSlash = url.pathname.replace(/\/$/, "");
    const candidates = [
      url.pathname,
      `${withoutTrailingSlash}/`,
      `${withoutTrailingSlash}/index.html`,
    ];

    for (const candidate of [...new Set(candidates)]) {
      const cached = await caches.match(candidate, { ignoreSearch: true });
      if (cached) {
        return cached;
      }
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const cachedHome = (await caches.match("/index.html")) || (await caches.match("/"));
      if (cachedHome) {
        return cachedHome;
      }
    }
  }

  return (
    (await caches.match("/offline.html")) ||
    new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    await putInRuntimeCache(request, response);
    return response;
  } catch {
    return findNavigationFallback(request);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  await putInRuntimeCache(request, response);
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (response) => {
      await putInRuntimeCache(request, response);
      return response;
    })
    .catch(() => null);

  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (
    url.hostname === "cdn.jsdelivr.net" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
