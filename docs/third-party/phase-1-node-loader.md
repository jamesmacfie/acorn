# Phase 1 — Node loader

**Size: M.** Requires Phase 0. After this phase a Node can load a plugin from disk at boot, with
contained failure, and one first-party plugin (Rollbar) dogfoods the path in dev.

## What exists today

- The node plugin host (`packages/node-core/src/server/plugin/host.ts`) builds each plugin's
  context, runs `init` in declaration order, runs the `ready` pass, records every registration
  (routes, tools, context sections, WS claims) for disposal, and deliberately does **not** catch
  init errors — first-party code fails loudly at boot.
- The activation list is static: `apps/node/src/server/plugins.ts` (composed in
  `apps/node/src/server/composition.ts`; declared cross-plugin dependencies in
  `pluginDeps.ts`).
- The per-node disable set is a file in the data root, read one layer above the server
  (`packages/node-core/src/main/disabledPlugins.ts`), surfaced through the roster route
  (`packages/node-core/src/server/routes/plugins.ts`, `PluginsBridge`, `restartRequired: true`).
- Per-plugin SQLite: `packages/node-core/src/main/pluginStorage.ts` (database factory) and
  `pluginMigrations.ts` (per-plugin chains).

## What this phase adds

### The manifest

`acorn-plugin.json` at the plugin package root. Zod-validated (module-level schema, `safeParse`,
per the wire-validation rule in docs/architecture-overview.md — this is a trust boundary even
though it arrives from disk):

```jsonc
{
  "id": "ntfy",                      // ^[a-z][a-z0-9-]{1,31}$ — becomes /v2/p/<id> and the DB filename
  "name": "ntfy notifier",
  "version": "0.2.0",                // plugin's own semver
  "apiVersion": "1",                 // major of @acorn/plugin-api it was built against
  "node": "./dist/node.js",          // optional; ESM bundle, default-exports NodePlugin
  "client": "./dist/client.js",      // optional; used from Phase 2 on
  "permissions": {
    "api": ["core.tasks:read"],      // UI bridge scopes — hard-enforced in Phase 3
    "events": ["invalidate:tasks"],  // UI event channels — hard-enforced in Phase 3
    "node": {                        // node-half facets — shape ctx in this phase (see
                                     // "Permission-shaped context" below for what this does
                                     // and does not guarantee)
      "core": ["tasks:read", "projects:read", "git"],   // CoreServices facets on ctx.core
      "capabilities": ["agents.onStatusChanged"],
      "secrets": false,              // use-scoped secret access via ctx.core.secrets
      "exec": false,                 // process broker facet
      "net": ["ntfy.sh"]             // intended egress hosts (disclosure until node-half
                                     // sandboxing — node-security.md, rung 2)
    }
  },
  "contributions": {}                // declarative chrome, used from Phase 4 on
}
```

Rules the loader enforces:

- `id` must not collide with any built-in plugin name or another installed plugin. The host binds
  the route namespace, DB filename, and capability attribution from **this** id; `plugin.name`
  inside the bundle is checked to match and otherwise ignored.
- `apiVersion` must equal the running plugin-api major, else the plugin is skipped with an
  attention item ("built for a newer/older acorn").
- `node` entry must resolve inside the plugin directory (no `..` escape; reuse the path
  confinement helpers CoreServices already uses).

### Install directory

```text
<dataRoot>/plugins/<id>/           the unpacked package (manifest + dist/ + migrations/)
<dataRoot>/plugins/<id>.lock.json  written by the installer (Phase 5): source, resolved version,
                                   sha256 of the archive and of each entrypoint
```

In this phase installation is manual (developer copies files) and gated behind an explicit env
flag: **`ACORN_UNSAFE_PLUGINS=1`**. Without the flag the loader logs and skips. The flag exists
because the trust acknowledgement UI does not arrive until Phases 2/5; do not ship a default-on
loader before the consent surface exists. Remove the flag in Phase 5.

### The loader

Runs in the Node composition root after built-in plugins are listed and before
`initPlugins` — loaded plugins join the same array and the same host pass, so ordering,
`ready`, capability late-binding, and disposal are identical to built-ins:

```ts
import { pathToFileURL } from 'node:url'

async function loadExternalPlugins(dataRoot: string): Promise<LoadedPlugin[]> {
  const out: LoadedPlugin[] = []
  for (const dir of await listPluginDirs(dataRoot)) {
    const manifest = parseManifest(dir)                 // zod; reject → attention item, skip
    if (manifest.apiVersion !== PLUGIN_API_MAJOR) { report(manifest, 'api-mismatch'); continue }
    if (!manifest.node) continue                        // client-only plugin: nothing to load here
    const url = pathToFileURL(join(dir, manifest.node)).href   // pathToFileURL or Windows breaks
    let mod: unknown
    try { mod = await import(url) } catch (err) { report(manifest, 'import-failed', err); continue }
    const plugin = validatePluginShape(mod)             // structural zod check on the default export
    if (!plugin) { report(manifest, 'bad-shape'); continue }
    out.push({ manifest, plugin })
  }
  return out
}
```

- **ESM only.** Bundles are `format: 'esm'`; `import()` of anything else is rejected by the shape
  check. Document this in the future authoring guide (README, "Future work").
- **Structural validation, not `instanceof`.** The bundle's realm is the same but its classes are
  its own; check `{ name: string, init: function, ready?, dispose? }` shape.
- **Zero runtime host imports.** Because `@acorn/plugin-api/node` is types(+small helpers bundled
  in), a node bundle imports nothing from the host at runtime — every live object arrives via
  `ctx`. There is no module-sharing machinery on the node side; keep it that way.

### Contained failure for loaded plugins only

Extend `initPlugins` (`server/plugin/host.ts`) with a per-plugin `contained: boolean` (true for
loaded plugins). For contained plugins, wrap `init`/`ready` in try/catch: on error, run the
plugin's recorded disposals, add it to a `failed` list in `PluginHostResult`, and continue.
Built-ins keep the current throw-through behavior — the existing comment explains why, keep it.
Failures surface two ways:

- the roster route (`routes/plugins.ts`) gains a `state: 'active' | 'failed' | 'disabled'` field;
- an attention item ("Plugin ntfy failed to start") via the existing attention surface, so the
  owner sees it without opening Settings.

`dispose` errors on shutdown are caught and logged for contained plugins (the host already awaits
disposal before closing plugin databases — keep that ordering).

### Permission-shaped context

For loaded plugins the host builds the `NodePluginContext` **from the manifest** instead of
handing over the full context built-ins get:

- `ctx.capabilities.get(id)` returns `undefined` for any capability id not listed under
  `permissions.node.capabilities` — indistinguishable from the provider being absent, which is
  already a state every consumer must handle (missing optional providers degrade, per
  docs/plugins.md).
- `ctx.core` exposes only the facets named under `permissions.node.core`; `secrets`, the process
  broker (`exec`), and Git are individually gated. An unrequested facet is absent from the
  object, so honest code fails at development time, not in production.
- `projects` splits read from write, because the two are very different asks.
  `projects:read` gives `byId`, `byGithub`, `checkouts`, `config`, and `setup`; `projects:write`
  adds `create` and `update` — the facet a project importer needs (phase 3). Note in the trust
  prompt that `checkouts()` returns every mapped project folder path on the node, which is a
  filesystem-layout disclosure and not obvious from the words "read projects"
  (`packages/node-core/src/main/core/projects.ts`).
- `ctx.events.streams()` and `ctx.events.channel()` are **never** present for loaded plugins,
  regardless of manifest — WS/PTY infrastructure ownership is first-party-only (README, "Two
  tiers").

Be precise about what this buys. It is **least-privilege for cooperative code**: it keeps honest
plugins from over-reaching, makes the Phase 5 trust prompt truthful for the well-behaved
majority, and trains the ecosystem to write minimal manifests. It is **not a security boundary**:
a loaded bundle shares the Node's process and can `import('node:fs')` or
`import('node:child_process')` and ignore `ctx` entirely. Hard enforcement of the `node`
permission block requires moving loaded plugins out of process (planned as a later phase; not in
scope here). Until then the `node` block is honest disclosure plus ctx-shaping, and every surface
that renders it must not claim more. The full threat model, the out-of-process design this
phase must not foreclose, and the reviewer checklist are in
[node-security.md](./node-security.md).

### Lifecycle

- **Disable/enable**: the existing disabled-set file and Settings → Plugins toggle work unchanged
  — loaded plugin ids join the roster. `restartRequired` stays true and honest.
- **Reload/upgrade**: Node restart. ESM module cache has no un-import; do not build cache-busting
  in v1.
- **Uninstall**: Phase 5. Until then: disable, restart, delete the directory.

## Dogfood: Rollbar on the loader path

Rollbar is the ideal guinea pig: integration-provider registration only, no plugin database, no
WS claims (docs/plugins.md lists it among plugins that own no DB file). Add a dev-only path that
builds `plugins/rollbar`'s node half with esbuild (deps inlined, plugin-api external-as-types),
writes it plus a generated manifest into `<dataRoot>/plugins/rollbar/`, removes it from the
static list, and boots. Everything must behave identically: provider routes mount, rail source
appears (client half is still compiled-in until Phase 2 — a plugin may be loaded on the node and
built-in on the client during the transition; the id is what ties them).

Github is the more interesting eventual target — the projects migration left it `required: false`
with a provider-gated rail source and no core privilege beyond `ctx.core.projects`
(`plugins/github/src/client/index.ts`), so nothing structural stops it loading. It is deliberately
not this phase's guinea pig: a first loader bug should not take PR review out from under whoever is
dogfooding. Revisit once bundle distribution has run for a while.

## Tests

- Host: contained plugin whose `init` throws → `failed` list, disposals ran, boot continued,
  siblings unaffected. Built-in that throws still fails the boot.
- Loader: manifest rejection cases (bad id, id collision with built-in, apiVersion mismatch,
  entry outside dir, missing default export), each producing a skip + report, never a throw.
- Windows path handling: an integration test asserting `pathToFileURL` round-trip on a path with
  spaces.
- Roster route: `state` field for active/failed/disabled.
- Permission-shaped context: undeclared capability id → `get` returns undefined; undeclared
  `core` facet absent from `ctx.core`; `secrets`/`exec` gated off by default;
  `streams`/`channel` absent for loaded plugins even when everything else is granted. Built-in
  plugins still receive the full context.
- The Rollbar dogfood boot as an integration test behind the env flag.

## Exit criteria

- Rollbar loads from disk in dev and behaves identically to the compiled-in build.
- A deliberately broken plugin disables cleanly with an attention item; boot continues.
- Disable/enable round-trips through the existing Settings toggle.
- Loader inert without `ACORN_UNSAFE_PLUGINS=1`.
- Boundaries test, `pnpm lint`, and suites green.
