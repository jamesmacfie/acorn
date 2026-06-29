# Architecture Overview

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). The same Hono app + Drizzle schema + SolidJS UI now run in an
> Electron main process (server via `@hono/node-server`, DB via better-sqlite3) instead of a Worker.
> References below to the Worker / D1 / KV / wrangler describe the prior host; the app design is
> unchanged.

acorn is a GitHub pull-request review tool. It is a SolidJS single-page app
served by one Hono Worker on Cloudflare Workers, backed by a D1 SQLite
read-model mirror, a KV blob cache, and IndexedDB client persistence.

This is the keystone doc. See the [index](#documentation-index) at the bottom
for everything else.

## One Worker, one origin

There is a single Worker (`apps/web/src/server/index.ts`). It serves three
things from the same origin:

- the SPA shell and static assets,
- the `/api/*` JSON API, and
- the `/auth/*` OAuth flow.

Routing is done by Cloudflare's asset handling, configured in
`apps/web/wrangler.jsonc`:

```jsonc
"assets": {
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*", "/auth/*"]
}
```

`run_worker_first` sends only `/api/*` and `/auth/*` to the Worker. Everything
else is served from the built assets; unknown paths fall back to `index.html`
so the client router can handle deep links (`/:owner/:repo/:number`).

Because the API and the app share an origin, the session is a plain
same-origin cookie — no CORS, no bearer tokens in the browser, no token
storage on the client at all. See [authentication](./authentication.md).

The HTTP API contract is mirrored into shared TypeScript, not a runtime RPC
client. `apps/web/src/shared/api.ts` owns response types, route builders, and
query-key factories that the SPA consumes through plain same-origin `fetch`.
That keeps the route and cache contracts typed without adding client bundle
weight or extra per-request abstraction. See [api-reference](./api-reference.md)
for the full route map.

## Lazy read-model mirror

The defining idea: **D1 is a cache of GitHub, not a source of truth.** acorn
never owns PR/repo data — GitHub does. The mirror exists only to make reads
fast and to support offline browsing.

Consequences of treating the mirror as a cache:

- **Populated on read.** A table row only exists because someone fetched that
  resource. There are no webhooks and no background sync jobs — nothing fills
  D1 ahead of demand.
- **Revalidated, never trusted blindly.** Each read checks freshness. Repos use
  a TTL window; PR lists, PR detail and files gate on a TTL recorded in
  `sync_state`, and repos/PR-lists revalidate against GitHub with an ETag where
  one is available (`If-None-Match` → a `304` is free against the rate limit).
- **Disposable.** Mirror rows can be deleted and re-synced at any time. The
  list endpoints delete-then-insert on every refresh so resources the user lost
  access to drop out.

A small set of tables are *not* mirror data — they are app-state acorn owns
(per-user prefs, pinned repos, "viewed file" checkboxes). Those are the source
of truth and survive mirror re-syncs. See [data-layer](./data-layer.md) for the
table-by-table split.

A hard rule rides on top of this: **only public, identical-for-all-users data
may live in shared storage.** Private repo data is user-scoped in D1; only
public patch bodies go to the shared KV namespace. See
[caching](./caching.md#public-private-rule).

## Three cache layers

Reads pass through up to three caches, each with a different scope and
lifetime:

| Layer | Where | Scope | Holds | Lifetime |
| --- | --- | --- | --- | --- |
| D1 mirror | Worker / D1 | Per user | Repos, PRs, files, reviews, comments, checks, labels, threads | TTL + ETag (see [caching](./caching.md)) |
| KV `BLOBS` | Worker / KV | Shared, public repos only | Immutable patch/diff bodies keyed by blob SHA | Immutable |
| IndexedDB | Browser | Per user/device | TanStack Query cache (last-known API responses) | `gcTime` 24h, persisted |

The client cache is a stale-while-revalidate layer: it renders instantly from
the last persisted response, then refetches. `gcTime` is set to 24h so
persisted entries survive a reload, which is what enables offline browsing of
recently-seen PRs. See [offline-pwa](./offline-pwa.md).

## End-to-end data flow

A cold read of a PR list, top to bottom:

```
Browser (SolidJS SPA)
  │  TanStack Query: render from IndexedDB if present, then fetch
  ▼
GET /api/repos/:owner/:repo/pulls           (same-origin cookie)
  │
Worker (Hono)
  │  csrf() + authMiddleware: decrypt session cookie in-CPU → ctx.user
  ▼
D1 mirror
  │  sync_state fresh within TTL? ──► yes ──► serve mirror rows  ─┐
  │                                                               │
  └─ no/stale                                                     │
        │  conditional fetch with If-None-Match (sync_state.etag) │
        ▼                                                         │
     GitHub REST/GraphQL                                          │
        │  304 ► bump freshness, serve mirror ────────────────────┤
        │  200 ► delete-then-insert rows + update sync_state ─────┤
        ▼                                                         │
     (patch bodies for public repos → KV BLOBS by SHA)            │
                                                                  ▼
                                                       JSON response
  ▲                                                               │
  └───────────────────────────────────────────────────────────────┘
  Browser caches the response in IndexedDB and renders
```

Writes (merge/close/draft/comment/label/…) follow the same spine in reverse:
the Worker calls GitHub, then updates (or busts the freshness of) the D1
mirror so a read inside the TTL window reflects the change. See
[github-integration](./github-integration.md) and
[api-reference](./api-reference.md).

## What acorn deliberately does not have

- No webhooks or background jobs — everything is read-driven.
- No server-side session store — the session lives entirely in an encrypted
  cookie, decrypted per request.
- No GitHub token in the browser — only public profile fields cross the wire.
- No second backend — one Worker is the whole server.

## Documentation index

- [architecture-overview](./architecture-overview.md) — this doc: the one-Worker
  design, the lazy mirror, the three cache layers, the data flow.
- [local-development](./local-development.md) — running the Vite + Miniflare dev
  server, OAuth callback setup, local D1/KV state.
- [authentication](./authentication.md) — GitHub OAuth web flow, the encrypted
  stateless session cookie, CSRF protections, the 401 → reauth bounce.
- [data-layer](./data-layer.md) — Drizzle + D1 schema table-by-table, mirror vs
  app-state, user-scoping, staleness bookkeeping, migrations.
- [caching](./caching.md) — the three cache layers and their exact policies
  (TTLs, ETag revalidation, KV blobs, IndexedDB persistence).
- [github-integration](./github-integration.md) — the REST + GraphQL clients,
  the operation → endpoint map, ETag usage and rate limits.
- [api-reference](./api-reference.md) — every Worker route: method, path,
  params, response shape, error codes, and shared client contract.
- [frontend](./frontend.md) — the SolidJS app, routing, panes, and the shared
  TanStack Query definitions.
- [diff-rendering](./diff-rendering.md) — how patches are parsed and rendered,
  including inline review comments and viewed-file state.
- [offline-pwa](./offline-pwa.md) — the service worker app shell, web manifest,
  and IndexedDB-backed offline browsing.
- [ui-design](./ui-design.md) — layout, panes, theming, and design conventions.
