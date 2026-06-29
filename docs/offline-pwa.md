# Offline & PWA

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). In the Electron build the **service worker is disabled** (it would
> mask app upgrades) — `src/client/index.tsx` skips registration under Electron and unregisters any
> leftover. The IndexedDB query cache still applies. PWA install metadata is unused on desktop.

acorn is an installable PWA that can browse recently-seen PRs while offline. Offline support is a read-only view of already-cached data — there is **no** real-time sync or offline mutation queue. It rests on three pieces: a service worker (`apps/web/public/sw.js`), a web manifest (`apps/web/public/manifest.webmanifest`), and the IndexedDB-persisted TanStack Query cache wired up in `apps/web/src/client/index.tsx`.

## Service worker

`sw.js` is a minimal offline app shell with **no build integration** — its caching is generic runtime caching keyed on the request, so it survives hashed asset filenames without a precache manifest. It is registered on `window` `load` in `index.tsx`:

```ts
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
```

### Lifecycle

- `install` → `skipWaiting()` so a new worker activates immediately.
- `activate` → deletes every cache except the current `acorn-shell-v1`, then `clients.claim()`. Bumping the cache name is how a shell version is rotated.

### Fetch strategy

The `fetch` handler only touches **same-origin GET** requests. Two paths are explicitly never cached and always hit the network:

- `/api/*` — application data (see below; the IndexedDB query cache owns offline data, not the SW).
- `/auth/*` — the OAuth flow (see [authentication](./authentication.md)).

For everything else:

| Request | Strategy | Behaviour |
| --- | --- | --- |
| `req.mode === 'navigate'` | **Network-first** | Fetch the page; on success cache the response under `/` (the app shell). When the network fails, serve the cached `/` so the SPA boots offline. |
| Other same-origin GET (static assets) | **Stale-while-revalidate** | Serve the cached response immediately if present, while revalidating in the background (only `res.ok` responses are written back). If nothing is cached, fall through to the network. |

This means the app **shell** (HTML, JS, CSS, fonts) comes back offline, but a navigation always *tries* the network first so a deploy is picked up as soon as connectivity allows.

## Web manifest

`manifest.webmanifest` makes the app installable:

```json
{
  "name": "acorn",
  "short_name": "acorn",
  "description": "GitHub PR review tool",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#121212",
  "theme_color": "#121212"
}
```

`display: standalone` launches it chromeless; `start_url: /` lands on the redirect-to-first-repo route. The `#121212` colours match the dark-theme background token (see [ui-design](./ui-design.md)).

## Offline data via IndexedDB

The service worker deliberately does **not** cache API responses. Offline *data* is owned entirely by the TanStack Query cache, persisted to IndexedDB. In `index.tsx`:

- The `QueryClient` sets `gcTime: 24h` so entries outlive a session and survive reload.
- `PersistQueryClientProvider` persists the cache with `createAsyncStoragePersister` backed by `idb-keyval` (`get`/`set`/`del`), under key `acorn-cache`, with `maxAge: 24h`.

On load the persisted cache rehydrates, so the app renders last-known data instantly and, offline, can show any PR list / PR detail / file diff that was fetched while online. New `/api/*` requests simply fail offline; the cached query data is what's displayed. See [caching](./caching.md) for how this layers with the server-side D1/KV mirror.

### Privacy

The persisted cache holds private repo data, so it is treated as user-scoped and wiped on logout: `logout()` in `App.tsx` dispatches the `acorn:logout` window event, and `index.tsx` listens for it to call `clear()` on the IndexedDB store. This prevents the next user on a shared device from reading the previous user's cached PRs.

## Limits

- **Read-only offline.** Mutations (`merge`, `comment`, `resolve`, etc.) are same-origin POSTs that go straight to the network — they fail offline and are not queued.
- **No real-time sync.** Data is whatever was last fetched; refresh requires connectivity (TanStack Query refetches on window focus when online).
- **Only seen data.** Offline browsing covers PRs whose queries were already populated and within the 24h `maxAge`; never-visited PRs have nothing cached.
