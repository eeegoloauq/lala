const CACHE = 'lala-v1';

// Static shell to cache on install
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon.svg'];

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
            fetch(e.request).catch(() => caches.match('/'))
        );
        return;
    }

    // Cache-first for static assets (JS/CSS/fonts have hashed filenames)
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(res => {
                if (res.ok && e.request.method === 'GET') {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            });
        })
    );
});
