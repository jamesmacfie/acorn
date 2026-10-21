// Keeps the app's own files so a relaunch draws before the gateway answers. A file comes from the
// network when it can, and from here when it can't. `/node`, `/session` and `/events` are the Node's
// data, and the client's own query cache keeps what it wants of them, so this never sees them.
// shortcut: files of old builds stay in the cache, which is small; clear them if that ever isn't so.
const CACHE = 'acorn-app'
const LIVE = /^\/(node|session|events)(\/|$)/

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || LIVE.test(url.pathname)) return
  // Every route of the app is the same page, so a launch from any of them can fall back to `/`.
  const key = request.mode === 'navigate' ? '/' : request
  event.respondWith(
    fetch(request).then(
      (response) => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)))
        }
        return response
      },
      async () => (await caches.match(key)) ?? Response.error(),
    ),
  )
})
