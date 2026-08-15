# acorn's plugin system as verified 2026-08-12

Design notes from the bb-comparison session (2026-08-12). This is the baseline inventory the
user-extensions project starts from — what is shipped, where it lives, and which parts were
*decided*, not merely unbuilt. The owning docs for current behavior are `docs/plugins.md` and
`docs/security.md`; where this file drifts from those, those win. Everything below was read off
the code on the date above unless tagged **[DOCS ONLY]**.

## The four deliberate blockers

An agent writing a plugin onto the node and acorn loading it is mechanically close to possible —
the loader takes any directory with a valid manifest and ESM bundle. Four things stand in the way,
and all four are decisions with recorded rationale, not gaps:

1. **No bundler at node runtime.** Plugin packages are built by
   `apps/node/scripts/build-plugin.mjs` using Vite, which is a *devDependency* of `@acorn/node`.
   The standalone-node runtime dependency list (`scripts/pack-node.mjs`, the `RUNTIME` array) and
   the packaged desktop app ship nothing that can compile anything. There is no esbuild anywhere
   in the workspace.
2. **Nothing hot-reloads.** Every install/update/uninstall returns
   `state: 'installed-restart-required'`; routes, tables, and tools are wired at plugin `init`
   only.
3. **The install route is agent-unreachable by design.** `/v2/core/plugins/install` is behind
   `requireDevice` (a task-scoped internal token gets 403), and it sits in the *permanently
   unmappable* group of the frame bridge table with the note "Installs code that runs with the
   Node's own access" (`packages/client-core/src/plugins/frames/scopes.ts`).
   `docs/security.md § Tokens, routes, and agents` names prompt injection as the reason.
4. **Trust is per (pluginId, bundleHash), per device.** An agent iterating on a plugin would mean
   a trust prompt on every save. The active bundle set is also resolved **once per session**.

Two loopholes worth knowing, both intentional seams rather than bugs:

- A **node-half-only plugin needs no bundler** if it is written as ESM with only relative imports
  and `node:` builtins — the loader `await import()`s the entrypoint and multi-file packages
  already work (the builder emits `dist/chunks/`). Bare npm specifiers are what force bundling: a
  plugin directory has no `node_modules`.
- A **dev build can install from a local path** (`{ path }` → symlink), gated on
  `allowLocalPath: !config.isPackaged`.

## On disk

Everything lives under `<dataRoot>/plugins/` (`packages/node-core/src/main/pluginStorage.ts`; dev
data root `apps/node/.acorn/`):

```
<dataRoot>/plugins/
  <id>/                      the package: acorn-plugin.json, dist/node.js, dist/client.js, migrations/
  <id>.sqlite (+ -wal/-shm)  the plugin's DB, host-opened
  <id>.lock.json             installer lockfile: source, resolvedVersion, archiveSha256, entrypoint hashes
  bundled-state.json         ownership rows: installed | user | removed, with fingerprints
  .staging-* / *.incoming-* / *.old-*   install debris, swept at boot
```

The id regex `^[a-z][a-z0-9-]{1,31}$` forbids dots, which keeps `<id>/` and `<id>.sqlite`
non-colliding — and is why **a table-owning plugin's id can never change** (the SQLite filename is
the id).

## Loader

`packages/node-core/src/main/pluginLoader.ts` — `scanInstalled` / `loadExternalPlugins`.
Subdirectories (including symlinks-to-dirs for dev installs) are scanned; the manifest is parsed
with Zod (`pluginManifest.ts`, the authoritative contribution vocabulary); `apiVersion` must equal
`PLUGIN_API_MAJOR`; duplicate ids are rejected; the entrypoint path is confined to the package
root; then `await import()` and a structural check of the default export. **Every failure is a
skip + report, never a throw.** An unrecorded directory is treated as owner-installed
(`bundledPlugins.ts` reconciliation: seed when missing, update when the app fingerprint changes,
never overwrite an owner-installed package, tombstone uninstalls, treat a `.acorn-dev-build`
marker as app-owned).

Graph assembly is `apps/node/src/server/composition.ts` (`assembleNodeGraph`) — loaded plugins
join the same array as built-ins, and a loaded plugin with a built-in's id shadows it. The host
(`packages/node-core/src/server/plugin/host.ts`) runs `initPlugins` with per-plugin `ctx`,
`contain()` rollback for loaded plugins (that plugin fails, the node keeps booting), and
`clearRegistrations()` for idempotent re-init — **the seams a future reload path builds on.**

The plugin's client JS never touches a registry directly: the node's roster
(`GET /v2/core/plugins`) carries the manifest + bundle hash, and the device turns that into
contributions (`packages/client-core/src/plugins/chrome/register.ts` for descriptors,
`plugins/frames/register.ts` for iframe rectangles).

## Installer and trust

Two independent gates, both shipped:

- **Node side.** `packages/node-core/src/main/pluginInstaller.ts`: sources are GitHub release
  (asset must be named exactly `acorn-plugin.tgz`), npm, https URL, or local path (dev only).
  https enforced including after redirects, 32 MiB archive cap, symlink-escape walk rejects the
  whole package, downgrade guard, atomic double-rename placement, hash-pinned lockfile. The route
  requires an owner/device principal and an `Idempotency-Key`, and is audited. The old
  `ACORN_UNSAFE_PLUGINS` escape hatch is gone; the installer is the only path in.
- **Device side.** Running UI code needs a per-(pluginId, bundleHash) acknowledgement stored on
  the device, bound to bytes *the device hashed itself*
  (`apps/desktop/src/app/main/pluginCache.ts`, `pluginTrustStore.ts`; prompt UI
  `packages/client-core/src/plugins/PluginTrustDialog.tsx`). Bundled plugins are auto-trusted only
  from the app's own resource directory.

**The node half is disclosed, not contained.** `permissions.node` shapes `ctx`
(`pluginPermissions.ts`) but a loaded bundle shares the process and can `import('node:fs')`.
Out-of-process node halves and a network/credential broker are designed in
`docs/security.md § rungs 2–3` **[DOCS ONLY]** — the acknowledged honest weakness.

## The change model (why nothing is live today)

- **Node:** `restartRequired` is computed by diffing what is on disk against what this process
  booted with (`packages/node-core/src/server/routes/plugins.ts`); row states are
  `active | disabled | failed | pending-restart`. Settings → Plugins shows a banner and a
  **Restart node** button for a supervised local node (`restartLocalNode()` in
  `packages/client-core/src/node/fleetActions.ts`); a remote node needs an operator.
- **Client:** contribution sync (`syncChromeContributions` / `syncFrameContributions`) runs at
  boot and again when a trust decision lands — **and nowhere else**. `activeBundles` is "chosen
  once per session and never recomputed" (`plugins/distribution.ts`). Net effect: a plugin
  installed mid-session needs a node restart *and* a renderer reload.

Integration tests proving loader/install/disable behavior: `apps/node/test/integration/
pluginLoader.test.ts`, `httpLoaded.test.ts`, `pluginDisable.test.ts` (note: new desktop e2e specs
are not being added while that suite is extracted from core).

## Contribution inventory

**Manifest-declared** (available to loaded/third-party plugins; all parsed in
`pluginManifest.ts`, landing in `packages/client-core/src/registries/`): `frames` (targets
`pane | refPanel | settings | importer | webview | overlay`), frame `layout` (the host-owned
document surface: `document`, `document-over-frame`, completions), `sources` (rail), `slots`
(**`footer` only**), `commands`, `keybindings` (bounded: modifier required, reserved chords
unclaimable, collisions lose politely), `attention`, `nodeStats`, `contentLinks`, `routes`
(confined to `/p/:projectId/x/<id>/`), `agentContexts`, `refResolvers`, `permissions`
(frame-bridge API scopes, events, node capabilities), `migrations`. Actions come from a **closed
verb set** (`openPane`, `navigate`, `runNodeAction`, `createTask`, `openUrl`, `openOverlay`,
`surfaceAction`) — a design point the extension-points file leans on.

**Node-side `ctx`** (`packages/node-core/src/server/plugin/types.ts`): `routes.fetch` (mounted at
`/v2/p/<id>/*`), `tools.register` (agent tools with schema + risk tier, projected to the HTTP tool
surface, stdio MCP, and the renderer permission UI — **the seam the approval-mediated install flow
builds on**), `contextSections`, `providers.integration|connection|model`,
`capabilities.provide/get` (get filtered to declared ids; provide deliberately unfiltered —
"exporting a capability is a contribution, not an access grant"), `storage.open()`, scoped
`core`, `events`, `log`. Never for loaded plugins: `routes.register` (raw Hono),
`events.channel/streams`.

**Host-only client registries** (compiled plugins only; no manifest form): `themes.ts` and
`styles.ts` (see below), non-footer slots (`topbar.left`, `topbar.right`, `task.switcher.extra`,
`overlay`, `drawer`, `tabrail.task-row`), `agentToolRenderers`, `contextSections`, `pollers`,
`integrationFlows`, component-form sources and importers, `persistedState`, and the generic
escape hatch `ctx.contribute(registry, entry)`. **No context-menu registry exists anywhere.**
Settings pages are a registry whose core rows are a plain array in
`apps/desktop/src/app/client/pageContributions.tsx`.

The plugin-facing API surface is pinned by snapshot:
`packages/plugin-api/src/surface.snapshot.txt` + `surface.test.ts`, eight entrypoints across
`node`/`client`/`ui`/`testkit`.

### Theming, specifically

Two orthogonal axes on `<html>`: `data-theme` (colour) and `data-style` (shape/type/space/
density). The token contract exists **as data** in
`packages/client-core/src/ui/tokenAxes.ts` (`THEME_TOKENS`, `STYLE_TOKENS`); the values are CSS in
`styles/tokens-theme.css` / `tokens-style.css`; a test asserts the stylesheets match the
declaration. `themeRegistry` / `styleRegistry` exist — the latter's comment even anticipates "so a
plugin can contribute a style pack the same way it would contribute a theme" — but neither is a
member of the plugin context, there is no manifest key, and there is no CSS-injection path: a
theme id without a matching block in the shell's compiled CSS renders nothing. A loaded plugin's
CSS is confined to its own frame document; the shell stylesheet is host-assembled and
un-replaceable. This exact gap is what `extension-points.md § Themes` fills.

## Sandbox tier (shipped)

- Frames are iframes on a privileged `app-plugin://<sha256>/` scheme served from a
  content-addressed cache: `/`, `/index.html`, `/ui.css`, `/client.js` — **one file per bundle,
  no asset tree** (`apps/desktop/src/app/main/pluginScheme.ts`). The document is host-generated.
- CSP: `default-src 'none'`; scripts/styles self; `connect-src 'none'` — **a frame has no network
  at all**; no workers (this is what killed a bundled Monaco: 7.93 MiB against the 8 MiB cap and
  undeliverable workers — the origin of the host-owned document surface, `docs/third-party/monaco.md`).
- One `MessagePort`; every bridge call is checked against the manifest by an allowlist of
  (path shape, method) with `mapped`/`unmappable`/`unknown` classes and an exhaustive route-sweep
  test (`plugins/frames/scopes.ts`). A frame may not call another plugin's routes or fetch another
  plugin's bundle.
- Bundle ceiling 8 MiB (enforced by node and device), archive ceiling 32 MiB. Webviews are
  host-enforced-allowlist `WebContentsView`s.

All six third-party phases (0–5) shipped; their briefs were deleted from `docs/third-party/` once
done — only the migration record (`docs/third-party/README.md`) and `editor.md` remain.

## Storage and migrations (shipped; one production caller)

One SQLite file per table-owning plugin, opened and migrated **by the host**
(`pluginStorage.ts`: 0700 dir / 0600 file before WAL, busy timeout, sync-transaction batch).
Loaded plugins declare `migrations: './migrations'`; the chain is validated
(`pluginMigrationsChain()` requires Drizzle's journal) and applied inside `ctx.storage.open()`.
**No declaration ⇒ `open()` throws; there is no fallback search outside the package.** The chain
is *copied* into the package by the builder (Drizzle reads the journal and `.sql` off disk at
migrate time), and the builder hard-fails if a declared chain is missing.

On update: the installer replaces the package directory atomically (new `migrations/` with it),
the running process keeps executing the old code, the roster reports `pending-restart`, and the
new chain applies at the next boot's `storage.open()`. A broken chain fails contained to that
plugin. Uninstall keeps the `.sqlite` unless `purgeData: true`. Only `plugins/http` exercises this
in production; `apps/node/test/integration/httpLoaded.test.ts` covers update-with-migration
against a populated DB, a broken chain, and uninstall-without-purge. Non-table plugins use core
services instead (the provider-scoped external-item store; prefs scoped to `plugin:<id>:*`,
1 MiB/value).

## Dev build workflow

Workspace packages are consumed as source. The loaded-plugin rebuild is:

```
pnpm --filter @acorn/node build:plugin <id>          # → <dataRoot>/plugins/<id>/ + .acorn-dev-build marker
pnpm --filter @acorn/node build:plugin <id> -- --package-root <dir>   # distribution staging
node apps/desktop/scripts/build-bundled-plugins.mjs  # the five bundled: database, http, linear, model-providers, rollbar
```

…then restart the node, and for UI, reload the renderer. The build script's header records "Why
Vite and not esbuild". What the node *does* have at runtime that is adjacent: `ctx.core.proc`
(gated on the `exec` permission) and child processes — it could shell out to a bundler that
happens to exist on the machine, and the installer already shells out to `/usr/bin/tar`. The
agent-authored-plugins design deliberately avoids depending on that.

## Verify before building

The seams most likely to have moved by the time this is built: the once-per-session
`activeBundles` resolution and the boot-only contribution sync (`plugins/distribution.ts`,
`apps/desktop/src/app/client/index.tsx`); the unmappable-route table (`frames/scopes.ts`); the
manifest slot enum (`pluginManifest.ts`); the host's `clearRegistrations()`/`contain()` seams
(`server/plugin/host.ts`); whether `docs/security.md`'s rung-2 out-of-process node halves have
shipped (which would change the reload design's containment story); and whether the desktop e2e
extraction changed where plugin install/trust is tested.
