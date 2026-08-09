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
  precedent in the codebase is project config trust
  (`packages/node-core/src/server/routes/configTrust.ts`,
  `packages/node-core/src/main/repoConfigTrust.test.ts`), where an ack row binds a project id to
  the hash of the config it approved (`config_acks`, keyed `(project_id, hash)`). Same shape —
  hash-pinned consent before executing something a config supplied — with the scope moved out one
  level: that trust is stored on the Node and scoped to a project, this one is stored on the
  device and scoped to a plugin bundle, because the thing being approved is code the device is
  about to run.

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

## As built

All four exit criteria hold; the first is asserted end to end in
`apps/desktop/e2e/twoNode.spec.ts` ("asks before running a plugin a paired node serves"). Where the
implementation departs from the plan above, and why:

**The loader now enumerates every installed package, not just the ones it runs.**
`loadExternalPlugins` returns `installed: InstalledPlugin[]` alongside `loaded`, carrying the
manifest, its directory, and the client bundle's hash and size. A client-only package — legal in the
manifest schema and previously `continue`d past — is in that list, gets a roster row the plugin host
never produced, and is distributed normally. Its row reports `running: !disabled`, so toggling one
never raises the restart banner: its contributions are all client-side and the client's plugin host
disposes-then-registers on a roster change, which a Node restart would not improve on. A package
whose node half declared itself and then failed to import is deliberately NOT enumerated: it is
broken, not client-only, and shipping its UI to every device would advertise a plugin whose routes
exist nowhere.

**`PLUGIN_API_MAJOR` moved to `@acorn/protocol`.** Both halves now hold it against the same manifest —
the Node decides what to load, the device decides which of a fleet's bundles it can run — so one
compatibility constant could not stay on one side. `pluginManifest.ts` re-exports it, so nothing
downstream changed. `scripts/build-plugin.mjs` reads it from protocol now; a regex over the
re-export would find the name without a value.

**No `app://acorn/plugin-cache/<hash>.js` route.** The section above calls it debug-only ("the
sandbox origin is the real consumer"). `app://acorn` serves under `script-src 'self'`, so putting
third-party JavaScript at that origin makes it importable into the host realm — a real hazard bought
for a debugging convenience. Phase 3's `app-plugin://` is the only origin that should ever serve
these bytes.

**No `/v2/core/plugins/:id/assets/*` route.** Nothing loads an asset until phase 3 decides what a
frame document is; adding the route now would be a guess at a shape phase 3 gets to choose. Cheap to
add then — `confineExistingFile` is already the helper it wants.

**Permissions at prompt time come from the roster row, not a re-parsed archive.** The threat-model
section assumes a package archive travelling with the bundle. v1 serves one JavaScript file and the
manifest never leaves the Node, so the roster row — the manifest as the Node's own loader read it —
is the only source there is. The defence is unchanged: the acknowledgement binds to the hash the
device computed, and phase 3's sandbox is what actually contains the code. Revisit when phase 5's
tarball install gives the device an archive to parse.

**The trust store keeps acknowledgements when a Node is forgotten.** The decision was about bytes;
those bytes may still be offered by another Node, and re-pairing a machine should not re-prompt for
code the owner already approved. The cache's own sweep is what eventually retires an entry no Node
has offered in a month.

**`client.js` re-hashes at read time** rather than reporting the hash computed at boot. The two
disagree exactly when the file changed underneath a running Node, and the honest answer is the hash
of what is being sent — which the device then finds does not match the listing, and refuses. Fail
closed.

**The client platform adapter is `packages/client-core/src/plugins/host.ts`** and nothing more: the
one module allowed to touch `acornGlobal()?.plugins`, speaking hashes and decisions. That is the
seam a future web client re-implements over IndexedDB (docs/future/remote.md). A boundaries rule
(`tools/arch/boundaries.test.ts`, "only main touches the third-party plugin cache and trust store")
keeps the stores themselves inside `apps/desktop`.
