# Plugins

Plugins come in two tiers. Built-ins are first-party packages compiled into acorn and registered by
the Node/client composition roots. Loaded plugins are installed at runtime from a manifest plus ESM
bundles. Either tier can contribute Node behavior, client behavior, or both; the available carriers
and trust boundary differ by tier.

## Package shape

```text
plugins/<name>/
  src/
    node/       NodePlugin entry, schema, and Node-owned behavior
    server/     Hono route handlers and provider logic
    main/       Electron-free runtime engines and adapters
    client/     SolidJS panes, sources, settings, and contributions
    contract/   narrow cross-plugin types, capability IDs, and provider contracts
    shared/     types/logic shared by this plugin's runtimes
```

Not every plugin has every directory. The built-in Claude, Codex, and Aider profiles are registered
by `plugins/agents`; there are no separate profile packages. Onboarding is a client overlay with
core setup support. Linear and Rollbar are integration providers that use core's generic external-
item store rather than owning a plugin database.

## The plugin API

`packages/plugin-api` (`@acorn/plugin-api`) is the only host package a plugin's production code may
import. It adds no behavior of its own: it re-exports an enumerated slice of node-core and
client-core, and `tools/arch/boundaries.test.ts` enforces both halves of that — plugins reach the
host only through the facade, and the facade only re-exports.

Five entrypoints:

| Entrypoint | What it carries |
| --- | --- |
| `@acorn/plugin-api/node` | `NodePlugin` and the context types, the route toolkit (`AppEnv`, `requireUser` and friends, `respondError`, the bridge), per-plugin SQLite and migrations, the `CoreServices` type, capability ids, provider and integration contracts |
| `@acorn/plugin-api/client` | `ClientPlugin`, the API client and query options, client events, contribution types, task/workspace/fleet state, and the design system's plain functions (`cx`, `token`, metrics) |
| `@acorn/plugin-api/ui` | Everything that is a component: primitives, `Icon`, `Picker`, `Modal`, `Tabs`, the diff rows, and the registration seams that live in a `.tsx` module |
| `@acorn/plugin-api/ui/diff` | The diff model, virtualizer, hydration and find pass |
| `@acorn/plugin-api/ui/sdk` | The framework-free sandbox bridge, including API/state/UI calls and declared key claims |

The line between `/client` and `/ui` is drawn by the runtime, not by taste. Each entrypoint is a
barrel, so importing one member evaluates all of them, and Solid compiles a component to code that
touches `window` at module scope. Anything reached through a `.tsx` module therefore lands on `/ui`,
which keeps `/client` loadable from a plugin's node-environment test suite. A boundaries rule
enforces it.

`packages/plugin-api/src/surface.snapshot.txt` pins every exported name. A change to the surface
fails that test until the snapshot is regenerated
(`UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`), which is the point: growing the contract
should be a deliberate act. The implementation still lives in
`packages/node-core/src/server/plugin/types.ts` and
`packages/client-core/src/registries/plugin.ts`, which stay free to move files around underneath.

Two things stay outside the facade. `@acorn/protocol` is the shared wire-type package and is
imported directly. And plugin TEST code may still reach node-core and client-core: a test that seeds
core's tables, builds a real `CoreServices` or opens a temp-directory database is reaching for the
host rather than for an API, and a second ratchet in the boundaries test reviews what it reaches.
That is a first-party privilege; a third-party author gets a testkit entrypoint if and when one is
built.

## Activation

`apps/node/src/server/plugins.ts` is the Node activation list. `apps/desktop/src/app/client/plugins.ts`
is the client activation list. The host validates unique names, applies the per-Node disabled-plugin
set, initializes enabled plugins, runs the optional ready/activation pass, and owns disposal of their
registrations.

Required plugins are agents, memory, notes, and terminal. GitHub is optional: when enabled it contributes
the provider, PR rail, importer, and mirror routes; when disabled core Home and the remaining plugins
still boot.

Optional plugins can be disabled per Node through Settings → Plugins; their SQLite files remain on
disk and can be re-enabled later.

Node initialization happens before the listener accepts requests. A plugin can register:

- routes under `/v2/p/<plugin>/...`;
- typed capabilities;
- client broadcasts through `ctx.events`;
- agent tools and task-context sections;
- integration, connection, and model-provider descriptors;
- a plugin-owned SQLite migration chain and disposal hook.

The host supplies `CoreServices` for confined filesystem access, Git, processes, secrets, tasks,
repositories, task context, model generation, preferences, and the machine identity. Plugins do not
receive the core database handle merely to query shared tables.

It supplies no HTTP client. This list named one, and none exists — see docs/http-client.md for why
that matters and when it will have to.

### Loaded plugins

A Node can also load a plugin's node half from disk, from `<dataRoot>/plugins/<id>/` — a directory
holding an `acorn-plugin.json` manifest and an ESM bundle that default-exports a `NodePlugin`
(`packages/node-core/src/main/pluginManifest.ts`, `pluginLoader.ts`). Loaded plugins join the same
array and the same host pass as the compiled-in ones, so ordering, `ready`, capability late-binding
and disposal are identical.

Three things differ, and all three follow from the code not being ours:

- **They get there through the installer.** `POST /v2/core/plugins/install` (owner/device principal,
  `Idempotency-Key` required, audited) resolves a GitHub release, an npm package, a tarball URL or — on
  a development build — a local folder; validates the manifest; and places the package atomically with
  a hash-pinned lockfile beside it (`packages/node-core/src/main/pluginInstaller.ts`,
  docs/plugins.md). Uninstalling removes the package and, by default, leaves its
  SQLite file alone. Each device then asks its own owner before running the plugin's interface code.
- **Failures are contained.** A built-in throwing from `init` still fails the boot — it is first-party
  code in the same binary, and a node that cannot assemble should say so. A loaded plugin throwing has
  its registrations rolled back, is reported through the roster (`state: 'failed'`) and the attention
  inbox, and the node keeps starting.
- **The context is shaped by the manifest.** `permissions.node` decides which `CoreServices` facets
  and capability ids the plugin can see; `ctx.routes.register` (Hono), `ctx.events.channel` and
  `ctx.events.streams` are never present, whatever the manifest says. A loaded plugin serves routes as
  `ctx.routes.fetch(handler)` instead — a `(Request, PluginRequestContext) → Response` function. The
  request context projects authenticated identity plus a provider runtime; it exposes provider-owned
  resource/connection operations without exposing Hono, the core database, or the secret service. A
  loaded integration provider likewise passes a fetch handler to `ctx.providers.integration`; passing
  Hono is an explicit initialization error. Project access is deliberately three grants:
  `projects:read` for identity and checkout paths, `projects:config` for executable build/dev/database
  configuration, and `projects:write` for creating or updating project references. The `prefs` facet
  is projected into `plugin:<id>:*`, the same namespace used by that plugin's frame `state.get` and
  `state.set` verbs; this is the supported Node-half↔frame state channel. Values are capped at 1 MiB
  from either side.

That last point is least privilege for **cooperative** code and honest disclosure for users, not a
security boundary: a loaded bundle shares the Node's process and can `import('node:fs')` and ignore
`ctx` entirely. `docs/security.md` is the full threat model, and every surface that
renders these permissions has to say *declared*, not *enforced*.

`apps/node/scripts/build-plugin.mjs` builds a first-party plugin into this shape for development; it
is not the distribution mechanism. It installs into the data root under the plugin's own id, so a
package whose id matches a built-in **shadows** it: the loader drops the compiled-in copy from the
graph and logs which directory won. That is how the loader is dogfooded, and it is the one case
where the code running is not the code in the binary — worth knowing before debugging a plugin that
behaves like a version you cannot find.

### Loaded plugins: the client half

A loaded plugin's UI is not registered by its own code. The Node hands each device the plugin's
manifest and the hash of its client bundle in the roster (`GET /v2/core/plugins`); the device
decides what to render from that, and the plugin's JavaScript never touches a shell registry. Two
kinds of contribution come out of one manifest:

- **Frames** — a pane, reference panel, settings page, or project importer that the plugin draws
  itself. Each renders in an iframe on `app-plugin://<bundle-hash>`, a scheme Electron main serves
  from its content-addressed cache with `connect-src 'none'`: the frame has no network, no
  `window.acorn`, and no reach into the shell. Its only I/O is one `MessagePort`, where every call
  is checked against the manifest's declared scopes by an allowlist naming each path and method
  (`packages/client-core/src/plugins/frames/`, `scopes.ts` is the choke point). The host pins which
  Node the frame talks to; the frame cannot name one.
- **Webviews** — a host-drawn pane backed by an Electron-main `WebContentsView`. A surface declares
  exactly one literal `url` or plugin-owned `urlSource` plus a non-empty `hosts` allowlist. HTTPS is
  required except for `localhost`, `127.0.0.1`, and `::1`; the renderer broker validates requested
  navigation and Electron enforces the same list on direct navigation and redirects. The page has an
  isolated ephemeral partition, no preload, no CDP, no devtools, no tunnel credentials, and no script
  or message bridge. The plugin's sandboxed client frame remains the controller for only
  `navigate`, `back`, `forward`, and `reload`; it cannot read the page or type into it.
- **Descriptors** — a rail source, task-footer badge, commands/keybindings, attention items, node stats, and
  restricted URL recognizers (`contentLinks`).
  These are data, not code: the host renders them with its own components and fetches their content
  from routes in the plugin's own `/v2/p/<id>/` namespace, so they stay live when no frame is
  mounted anywhere (`packages/client-core/src/plugins/chrome/`). Freshness rides the existing
  invalidation ping plus one shared timer. A plugin that ships only descriptors needs no client
  bundle at all, and therefore no trust prompt — nothing of its executes on the device. A source may
  declare `createTask`; its row supplies the task seed and optional external link, while the host owns
  the modal, create-before-link ordering, and partial-failure reporting. A `contentLinks` entry uses a
  bounded `https://` host/path grammar, names a pane from the same manifest, and delivers one captured
  path segment as a `plugin:select` intent.

Loaded-plugin commands and shortcuts are host-bound manifest data. A command id `search` becomes
`plugin.<plugin-id>.search`; plugin code cannot claim a first-party command id. `palette` controls
whether the command also appears in the palette (default `true`). A keybinding may target only a
command from the same manifest, uses the canonical `meta+ctrl+alt+shift+key` spelling, and must include
`meta`, `ctrl`, or `alt`:

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "editor", "label": "Editor" }],
    "commands": [{
      "id": "search",
      "title": "Editor: find in files",
      "category": "action",
      "palette": true,
      "action": { "verb": "openPane", "pane": "editor" }
    }],
    "keybindings": [{
      "command": "search",
      "defaultChord": "meta+shift+f",
      "when": "surface",
      "surface": "editor"
    }]
  }
}
```

`when` is `global`, `task`, or `surface`; loaded plugins cannot request `typing-exempt`. Command and
binding ids must remain stable across versions because the qualified binding id is the key in the
user's persisted override map. The old `contributions.palette` descriptor remains an alias for a
command with `palette: true` for plugin API v1 and is scheduled for removal in plugin API v2.

The webview manifest shape is:

```json
{
  "target": "webview",
  "id": "docs",
  "label": "Docs",
  "url": "https://docs.example.com/",
  "hosts": ["docs.example.com", "*.example.com"]
}
```

A frame surface may also declare the modified chords its own UI handles:

```json
{
  "target": "pane",
  "id": "editor",
  "label": "Editor",
  "claimsKeys": ["meta+f", "meta+shift+f"]
}
```

The frame SDK begins with that declared set and `acorn.keys.claim([...])` may narrow it at runtime.
It cannot add undeclared keys. `meta+k`, `meta+,`, `meta+1`–`meta+9`, and `escape` are never claimable.
All other keydowns are forwarded to the shell's one dispatcher, so global and plugin-surface shortcuts
continue to work while the iframe has focus. Claims are disclosed in the device trust prompt and in
Settings → Shortcuts.

`urlSource` replaces `url` when the start URL is dynamic and must be inside the plugin's own
`/v2/p/<id>/` namespace; it answers `{ "url": "..." }` and receives task/project ids as query
parameters when present.

When a plugin has a client bundle, frames, webviews, and descriptors are gated on trust, per device and per
bundle: first sight of a `(plugin, hash)` pair prompts before anything registers, an update re-prompts
with the permission diff, and a rejected bundle gets neither frames nor chrome. A descriptor-only
plugin has no client bytes to trust and registers its data directly. The prompt renders the node-half
permissions, enforced UI scopes and key claims, and webview host grants as **three separate lists**. Webview hosts are
enforced but the remote page has live network access, so folding them into the networkless UI list
would be misleading. For the original two groups, only the second is enforced —
`packages/client-core/src/plugins/permissions.ts` explains why they must never be merged, and it
classifies every line against what the host can actually grant rather than echoing manifest text.

Two behaviours that surprise authors, both deliberate: the `footer` slot is the **task** footer
(the slot `docker-footer-badge` occupies), so a badge is invisible until a task has a worktree; and
across a fleet exactly one bundle per plugin id is active — highest version at this plugin-API
major, chosen at boot and stable for the session — because contribution ids are un-namespaced
persisted layout keys and two versions registering at once would collide on them.

Client initialization for compiled-in plugins is synchronous registration. The host exposes contribution points for panes,
sources, settings pages, shell/task slots, context sections, provider reference panels, palette rows,
agent contexts, agent-tool renderers, pollers, persisted-state slices, Node statistics, and attention
items. An activation pass handles subscriptions or local storage initialization after all descriptors
exist.

## Collaboration rules

Plugins collaborate through four mechanisms:

1. **Contracts** — import only a provider's `contract/` entrypoint for types, capability IDs, or
   narrow pure functions.
2. **Capabilities** — resolve typed functions from the Node's per-runtime capability registry at
   call time. This is the Node's only late-binding mechanism: route handlers receive a read-only
   capability view through `RuntimeBindings`, while plugin providers register during `init`. Missing
   optional providers produce a degraded feature, not a module import. The small helpers in
   `server/bridge.ts` are typed route adapters; their setter functions exist only for isolated route
   tests and are never used by production composition.
3. **Broadcasts** (`ctx.events`) — tell connected CLIENTS that something changed. This is not a
   plugin-to-plugin channel and there is no subscribe side: nothing in the node listens. It is an
   invalidation channel over the authenticated WebSocket — no durability, no replay, no delivery
   guarantee — and a client that misses one refetches after the gap. Durable history belongs in the
   owning plugin's tables. Two plugins that need to talk use a capability (2).
4. **Client registries and slots** — register UI contributions without importing another plugin's
   implementation. The host records disposables so disabling/reloading a plugin removes its entries.

The architecture test enforces zero non-contract plugin-to-plugin edges, no app imports from packages
or plugins, no Electron imports outside the allowed desktop surface, protocol purity, declared
dependencies, an acyclic package graph, and the client/Node split.

## Data ownership

Table-owning plugins open one `plugins/<name>.sqlite` file under the Node data root and own its
migrations. Current table-owning plugins include agents, changes, database, GitHub, HTTP, memory,
notes, terminal, and workflows. Core owns shared workspace/task/integration/external-item/security
tables. Docker, editor, Linear, Rollbar, model providers, preview, and the built-in agents profiles
use core services or provider registries without owning a database file.

A loaded plugin that owns tables declares a package-relative `migrations` directory in
`acorn-plugin.json` and calls `ctx.storage.open()`. The loader confines and validates that chain,
while the host binds the SQLite filename to the manifest id. No declaration means no storage; there
is no fallback search outside the package.

There are no cross-file foreign keys, `ATTACH` queries, or transactions spanning plugin databases.
Cross-plugin workflows use durable operation state and explicit IDs/capabilities.

## Tool projection

A plugin registers schema-validated agent tools with risk metadata. Core projects the registry into:

- the task-scoped HTTP tool surface;
- the stdio MCP server used by spawned agents;
- renderer permission and tool-description UI.

The caller's internal-token scope and the owner's tool permission settings are both applied. Tool
implementations run in the Node and use CoreServices; the renderer and MCP process do not open plugin
databases directly.

## Adding a plugin contribution

1. Put the behavior in the owning plugin and choose the correct runtime directory.
2. Use CoreServices rather than importing core implementation modules or another plugin's internals.
3. Add a narrow `contract/` export, capability, or client registry entry when collaboration is
   needed; `ctx.events` if the renderer needs telling.
4. Register the Node/client entry in the appropriate composition list.
5. Add package-local tests and, for rendered behavior, desktop e2e coverage.
6. Run the architecture test, `pnpm lint`, and the relevant tests.
