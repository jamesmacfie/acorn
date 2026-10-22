// Keeps the app's own files so a relaunch draws before the network answers. A file comes from the
// network when it can, and from here when it can't. `/account` is the account service, whose answers are
// the person's session and tickets, and the Node's data never comes this way at all: it crosses an
// encrypted channel the client's own query cache keeps what it wants of. So this never sees either.
// shortcut: files of old builds stay in the cache, which is small; clear them if that ever isn't so.
const CACHE = 'acorn-app'
const LIVE = /^\/account(\/|$)/

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || LIVE.test(url.pathname)) return
  // Every route of the app is the same page, so a launch from any of them can fall back to the app's root.
  const key = request.mode === 'navigate' ? self.registration.scope : request
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
