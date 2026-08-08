# Phase 2 — Bundle distribution and trust

**Size: M.** Requires Phase 1. After this phase, a plugin installed on any Node (local or paired)
gets its client bundle to every device that connects, hash-verified, cached for offline, and
gated behind a per-device trust acknowledgement. Nothing executes yet in a sandbox — Phase 3
consumes what this phase distributes.

## The problem this phase solves

The client may be viewing a remote Node that has plugins the client has never seen. The app
artifact ships only built-in plugin code, so the **Node is the distribution point**: it already
has the full plugin package on disk; its `dist/client.js` needs to travel the pipe that already
exists (broker → pinned HTTPS → bearer), land in a local cache, and be servable to the renderer
without ever letting the renderer touch the network.

## Flow

```text
node connects (broker, pinned HTTPS + device bearer)
  → GET /v2/core/plugins                 roster now includes version, apiVersion, client hash
  → diff against the local content-addressed cache
  → missing: GET /v2/core/plugins/:id/client.js      (bytes via broker)
      Electron main hashes the BYTES itself, stores under that hash
  → per-device trust check on (plugin id, computed hash) — prompt on first sight
  → (Phase 3) import from app-plugin://<hash>/ …
```

## Node side

Extend the roster route (`packages/node-core/src/server/routes/plugins.ts`):

- `GET /v2/core/plugins` rows gain `{ version, apiVersion, client: { hash, bytes } | null }`
  where `hash` is the sha256 the Node computed at install/boot for `dist/client.js` and `bytes`
  its size. Loaded plugins read this from disk; built-in plugins report `client: null` (their UI
  ships in the app).
- `GET /v2/core/plugins/:id/client.js` streams the file with `Content-Type: text/javascript` and
  an `ETag` of the hash. Authenticated like every `/v2/core` route (`requireUser`); task-scoped
  internal tokens do NOT get it — this is an owner/device surface, not a task surface (see
  `packages/node-core/src/server/middleware/auth.ts` for the principal distinction).

Also serve any static assets the bundle needs later (`GET /v2/core/plugins/:id/assets/*`, path
confined to the plugin's `dist/assets/`). Keep v1 to one JS file + assets; no HTML from the Node
— the sandbox host page is generated locally in Phase 3.

## Electron main side

New module, suggested `apps/desktop/src/app/main/pluginCache.ts`, owned by main (renderer never
sees paths):

- **Content-addressed store** under Electron `userData`, e.g. `plugin-cache/<sha256>.js` plus a
  small JSON index `{ hash → { pluginId, version, nodeIds: [...], firstSeen } }`.
- `put(bytes)` computes sha256 **from the bytes** and stores; the hash claimed in the roster
  listing is used only as a cache key hint and cross-checked — mismatch = reject and report.
  This is the "trust binds to bytes" invariant from the README: a compromised Node can lie in
  its listing, so nothing security-relevant may derive from the listing's hash.
- Serving: extend the `app://` handler (`apps/desktop/src/app/main/appScheme.ts`) with
  `app://acorn/plugin-cache/<hash>.js` → cache file, immutable caching headers. (Phase 3 adds the
  separate sandboxed origin; this route is for the loader-in-realm case only if ever needed and
  for debugging — the sandbox origin is the real consumer.)
- Eviction: entries whose hash is referenced by no installed plugin on any known Node and older
  than N days can be deleted at boot. Keep it simple; the cache is small.
- Preload/IPC surface (`preload.ts`, `nodeBrokerIpc.ts`): `pluginCache.has(hash)`,
  `pluginCache.putFromNode(nodeId, pluginId)` (main performs the broker fetch itself so bundle
  bytes never round-trip through the renderer), and `pluginCache.list()`.
- **Future-web note** (docs/future/remote.md): the cache and trust store are Electron-main
  implementations of what a future web client does with IndexedDB and server-side per-user
  acknowledgements. Keep renderer access to both behind the client platform adapter (the same
  narrow interface that wraps `nodeFetch`/streams) rather than sprinkling `window.acorn.*` calls
  through client code — the interface is the part that must stay portable, not the storage.

## Trust store

New module beside the device-token store (`apps/desktop/src/app/main/deviceTokenStore.ts` is the
custody model to copy): persisted map of acknowledgements
`{ pluginId, hash, nodeId, decidedAt, decision: 'accepted' | 'rejected' }`, stored in main, not
in the renderer.

Rules:

- First sight of `(pluginId, hash)` → renderer shows a trust prompt: plugin id/name/version, the
  Node it came from, and the **declared permissions from the manifest** (which Phase 3 starts
  enforcing; show them now — the manifest travels in the roster row).
- A previously accepted plugin arriving with a **new hash** (update) → prompt again, framed as an
  update, showing a permission diff if permissions changed.
- Rejected hashes are remembered; the plugin's UI simply does not load from that Node and the
  roster row shows "blocked on this device".
- Acknowledgements are per-device by design — pairing a new laptop re-prompts. This mirrors
  device-token custody and is the consent surface for executing node-supplied code. The pattern
  precedent in the codebase is repo config trust
  (`packages/node-core/src/server/routes/configTrust.ts`,
  `packages/node-core/src/main/repoConfigTrust.test.ts`) — same shape, different scope.

## Fleet version resolution

Two nodes may carry different versions of one plugin. Contribution IDs are un-namespaced
persisted layout keys (see the comment block in
`packages/client-core/src/registries/plugin.ts`), so **exactly one client bundle per plugin id
may be active**:

- Candidates: every accepted `(pluginId, hash)` across currently-known Nodes plus cache.
- Winner: highest plugin `version` whose `apiVersion` the client supports.
- The winner is chosen at boot and **does not change mid-session** — a better candidate arriving
  later takes effect at next boot. Live re-init of a plugin's UI while its panes may be open is
  churn with no payoff.
- The plugin's UI renders against every Node that has the plugin (any version). Wire-contract
  compatibility across versions is the plugin author's responsibility — the contract is
  plugin-owned (docs/architecture-overview.md); document the expectation in the future authoring
  guide (README, "Future work").

Presence is per-node: the client keeps, per Node, the set of enabled plugin ids from the roster.
Phase 3/4 surfaces consult it ("plugin enabled on this node" predicate) exactly where
`providerId` gating already happens for sources (a source shows iff a connected integration with
that id exists — `packages/client-core/src/registries/sources.ts` / tabs wiring).

## Offline and first boot

- The cache is persistent: previously accepted bundles load on boot before any Node connects.
- A never-seen plugin on an offline Node is simply absent, like a disabled plugin today; it
  appears when the Node does (registries are signal-backed; the client host disposes-then-
  registers, so late arrival is the same code path as enable/disable).

## Threat model (write this into docs/security.md when closing the phase)

- **Compromised/malicious paired Node** serving hostile JS: mitigated by bytes-hash trust +
  per-device acknowledgement + (Phase 3) the sandbox. The prompt names the Node.
- **Listing lies** (wrong hash/version/permissions): hash is recomputed; permissions shown at
  prompt time come from the manifest that rides with the bundle bytes (re-parse from the
  archive, not from the listing row).
- **Cache poisoning**: only main writes the cache; content addressing means a poisoned entry
  cannot masquerade under a previously accepted hash.
- **Downgrade**: resolution prefers highest version; a Node offering an older hash cannot evict
  a newer accepted one, only add a candidate.

## Tests

- pluginCache: put/has round-trip, listing-hash mismatch rejection, eviction.
- Trust store: first-sight prompt required, re-prompt on hash change, rejection remembered,
  per-device isolation (fresh store prompts again).
- Version resolution: pure-function unit tests over candidate sets (two nodes, three versions,
  apiVersion filtering, deterministic tie-break).
- Node routes: auth scoping (device principal yes, task-scoped token no), ETag/304, path
  confinement on assets.
- e2e (desktop): paired-node fixture serving a bundle → prompt → accept → cached → offline boot
  still lists it.

## Exit criteria

- A plugin installed on a paired Node appears on a second device with a trust prompt naming the
  Node and its permissions; accepting caches it; offline boot serves from cache.
- A tampered bundle (bytes ≠ claimed hash) is refused and reported.
- Two Nodes with different versions of one plugin resolve to one active bundle, stable within a
  session.
- `pnpm lint`, suites, boundaries test green.
