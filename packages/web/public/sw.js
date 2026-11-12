// A new name drops what older versions cached cache-first (unhashed files among them).
const CACHE = 'lala-v2';

// Static shell to cache on install; relative to this script, so the app may live under a subpath.
const PRECACHE = ['./', './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(PRECACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Never intercept: API calls, WebSocket upgrades, cross-origin
    if (url.pathname.startsWith('/api/') || e.request.url !== url.origin + url.pathname + url.search) {
        return;
    }

    // Network-first for navigation (always get fresh HTML)
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request).catch(() => caches.match('./'))
        );
        return;
    }

    // Cache-first only for built assets: their names carry a hash of their content, so a
    // cached one is never stale. Everything else (icons, the audio worklet, RNNoise, the blur
    // model) keeps its name across releases and comes from the network, the cache only offline.
    if (/\/assets\/[^/]+$/.test(url.pathname)) {
        e.respondWith(
            caches.match(e.request).then(cached => cached || fetchAndCache(e.request))
        );
        return;
    }
    e.respondWith(
        fetchAndCache(e.request).catch(() => caches.match(e.request).then(cached => cached || Response.error()))
    );
});

function fetchAndCache(request) {
    return fetch(request).then(res => {
        if (res.ok && request.method === 'GET') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
    });
}
