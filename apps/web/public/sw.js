// Minimal offline shell (docs/caching.md / architecture-overview.md). No build integration —
// generic runtime caching, so it survives hashed asset names. Data (GET /api/*) is NOT cached
// here; the client's IndexedDB query cache owns offline data. /api and /auth always hit network.
const CACHE = 'gurthurd-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  ),
)

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return // always network

  // Navigations → network-first, fall back to the cached app shell (index.html) when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('/', res.clone()))
          return res
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    )
    return
  }

  // Same-origin static assets → stale-while-revalidate.
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = await c.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res.ok) c.put(req, res.clone())
          return res
        })
        .catch(() => cached)
      return cached ?? network
    }),
  )
})
