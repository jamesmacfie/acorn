# Third-party plugins

This folder is the working documentation for making acorn's plugin system loadable: third-party
plugins installed at runtime, distributed by the Node that owns them, and rendered in a sandboxed
UI tier. It is written for the agents and developers implementing the phases: each phase has its
own file with enough context to execute without re-deriving the analysis.

## The goal

- Anyone can build, publish, and install an acorn plugin without forking or recompiling the app.
- Plugins are loadable JavaScript registered against the **existing** contribution registries —
  the same `NodePlugin` / `ClientPlugin` seams first-party code uses today
  (`packages/node-core/src/server/plugin/types.ts`,
  `packages/client-core/src/registries/plugin.ts`), not a parallel system.
- The **Node is the unit of installation and the distribution point**: a plugin is installed on a
  Node, and that Node serves the plugin's client bundle to every device that pairs with it. The
  app artifact never bundles third-party code.
- Third-party UI is **sandboxed**: plugin surfaces render in isolated frames with no host DOM,
  no network, and no token access; every effect passes through one typed, permission-checked
  bridge.
- Small chrome (left-rail sources, taskbar/footer badges, palette rows, attention items, node
  stats) is contributed as **declarative descriptors** backed by plugin node routes, rendered
  natively by the host, kept fresh by the existing invalidation channel.
- Trust is explicit and per-device: content-addressed bundles, a hash-pinned lockfile, and a user
  acknowledgement showing the plugin's declared permissions before any of its code runs.

## The model

```text
Plugin package (GitHub release / npm / tarball)
  acorn-plugin.json        id, version, apiVersion, entrypoints, permissions, contributions
  dist/node.js             ESM bundle, deps inlined, plugin-api imported as types only
  dist/client.js           ESM bundle for sandboxed frames (any framework, self-contained)
  migrations/              optional plugin-owned SQLite chain

Install (on a Node)
  <dataRoot>/plugins/<id>/…      unpacked package
  loaded at boot by the node plugin host, contained failure, disable set honoured

Distribution (to clients)
  GET /v2/core/plugins                      roster + versions + client bundle hashes
  GET /v2/core/plugins/:id/client.js        bundle bytes over the broker
  Electron main: content-addressed cache, hash computed from bytes, served at
  app://acorn/plugin-cache/<hash>.js and app-plugin://<hash>/ (sandboxed origin)

Rendering
  rectangles  → sandboxed iframe per surface, MessageChannel RPC bridge
                (panes, reference panels, settings pages, project importers)
  chrome      → descriptors rendered natively by the host, data from plugin node routes
```

## Two tiers, permanently

First-party plugins keep the current in-realm path. Contributions that need the shell's realm —
PTY stream ownership (`ctx.events.streams()`, "exactly one plugin may own these"), inline
agent-tool renderers drawn inside the transcript list, diff/UI components embedded in other
surfaces' component trees — cannot cross a message-passing boundary and remain first-party-only.
The dividing line: **a contribution the sandbox can host is one expressible as data plus async
messages.** If a third-party plugin someday genuinely needs an inline renderer, the escalation
path is review and adoption into first-party, not a bigger hole in the sandbox.

Project importers (`packages/client-core/src/registries/projectImporters.ts`) sit on the
sandbox-hostable side even though they are component contributions today. An importer is a
rectangle the shell hosts in a modal plus two lifecycle callbacks (`onClose`, `onImported`) — it
never reaches into a surrounding component tree, so the callbacks become bridge verbs and the
rectangle becomes a frame. Phase 3 carries it; there is no separate phase for project discovery.

## Why loadable JS and not external processes

The alternative (herdr-style language-agnostic argv executables driving a CLI) was considered and
rejected: it abandons acorn's trust posture (task-scoped tokens, no provider credentials to child
processes), duplicates the contribution system as a second-class CLI surface, and cannot
participate in the renderer at all. The architecture was already built for loadable JS: plugin
wire contracts are plugin-owned (docs/architecture-overview.md § "Who owns which contract" calls
this "the precondition for third-party plugins"), per-plugin SQLite files and migration chains
exist (`packages/node-core/src/main/pluginStorage.ts`, `pluginMigrations.ts`), the per-node
disable set exists (`packages/node-core/src/main/disabledPlugins.ts`), and both plugin hosts
already own registration disposal for clean re-init.

The projects migration strengthened the case twice over. Core grew `ctx.core.projects`
(`packages/node-core/src/main/core/projects.ts`) — a seam built for plugins rather than exposed to
them, handing out `ProjectRef` projections so a plugin can resolve project identity without
learning core's config columns or touching the core SQLite handle. And the largest first-party
plugin lost its privileges: github now runs `required: false` with a provider-gated rail source and
no core coupling beyond that seam (`plugins/github/src/client/index.ts:17,28`). The seams a
third-party plugin will use are already carrying the plugin most likely to have needed an
exception.

## Status

| Phase | File | Status | Size |
| --- | --- | --- | --- |
| 0 — Extract `@acorn/plugin-api` + client UI layering | [phase-0-plugin-api.md](./phase-0-plugin-api.md) | ⬜ Not started | M–L |
| 1 — Node loader | [phase-1-node-loader.md](./phase-1-node-loader.md) | ⬜ Not started | M |
| 2 — Bundle distribution + trust | [phase-2-distribution-trust.md](./phase-2-distribution-trust.md) | ⬜ Not started | M |
| 3 — Sandboxed UI runtime | [phase-3-sandboxed-ui.md](./phase-3-sandboxed-ui.md) | ⬜ Not started | L |
| 4 — Declarative chrome | [phase-4-declarative-chrome.md](./phase-4-declarative-chrome.md) | ⬜ Not started | M |
| 5 — Install and update UX | [phase-5-install-ux.md](./phase-5-install-ux.md) | ⬜ Not started | M |

Cross-cutting: [node-security.md](./node-security.md) — the node-half threat model, containment
ladder, and the design rules every phase must hold to. Not a phase; reviewers hold PRs from any
phase against its checklist.

Ordering: 1 requires 0. 2 requires 1. 3 and 4 require 2 and can run in parallel with each other.
5 requires 2 (it puts UX on the machinery) and benefits from 3/4. **Phase 0 is valuable
standalone** — it hardens the first-party boundary even if everything else stalls — and should
ship first regardless of when the rest is scheduled.

## Non-goals

- **Sandboxing the node half.** Third-party node code runs in-process in the Node, disclosed and
  acknowledged — the same trust class as a VS Code extension. Worker isolation is a door this
  design leaves open, not one it builds.
- **Third-party inline renderers** inside first-party surfaces (see "Two tiers").
- **Hot reload of node-half code.** ESM has no un-import; disable/enable plus Node restart is the
  v1 lifecycle. The roster route already reports `restartRequired`
  (`packages/node-core/src/server/routes/plugins.ts`).
- **A review pipeline.** Any future discovery surface is unreviewed (see "Future work"); trust is
  enforced at install and load time on the user's devices, not at listing time.

## Future work (deliberately not phased)

Deferred until the machinery has proven itself; none of it blocks phases 0–5:

- **Node-half sandboxing.** Loaded plugins move out of process: a child per plugin launched under
  Node's permission model (fs allowlisted to the plugin's own directories, `exec`/addons denied
  by default), `ctx` over RPC, core access authorized server-side by a plugin-scoped internal
  token — the same pattern the MCP stdio child already uses. Until then the manifest's `node`
  permission block is ctx-shaping plus disclosure (see phase-1), and the trust prompt says so
  (see phase-5). The full threat model, containment ladder, and the design rules phases 0–5 must
  follow to keep this buildable are in [node-security.md](./node-security.md).
- **Web and mobile clients, remote access.** Analysis and conclusions live in
  `docs/future/remote.md` (web auth inversion, browser fan-out vs hub node, mobile PWA subset,
  the relay-service idea). Three cheap preparation items from it are annotated in phases 2 and 3:
  the client platform adapter seam, `formFactor` on frame surfaces, and the scheme-agnostic
  bridge rule.
- **Ecosystem.** Discovery via a GitHub topic index (`acorn-plugin`, unreviewed, star-sorted), a
  `create-acorn-plugin` scaffold + build preset, an authoring guide, exemplar plugins, and the
  written plugin-api semver/compat policy. The release-asset convention (`acorn-plugin.tgz`,
  consumed by phase-5's GitHub install source) and the version-skew expectation for authors
  (one client bundle may serve several node-half versions — phase-2) get documented here when it
  happens; until then phase-5's install-from-URL/tarball is the distribution story and
  `docs/plugins.md` gets its full two-tier rewrite at the same time.

## Invariants that hold throughout

Breaking one of these silently defeats the design.

### The renderer stays inert

The renderer never opens a network connection and never holds a token or certificate
(docs/architecture-overview.md). Plugin client bundles arrive as bytes over the existing broker
(`apps/desktop/src/app/main/nodeBroker.ts` / `nodeRequest.ts`), are cached and served by Electron
main, and execute only from `app://` / `app-plugin://` origins. Sandboxed frames additionally get
`connect-src 'none'` — their only I/O is the bridge port.

### Trust binds to bytes, not to claims

The hash in a Node's plugin listing is untrusted input: a compromised Node could lie. Electron
main computes the hash of received bundle bytes itself, stores content-addressed, and the
per-device acknowledgement binds `(plugin id, computed hash)`. New or changed hash → prompt
before load, naming the Node it came from. Never auto-run code a Node pushed.

### The host binds every namespace

A plugin's route mount (`/v2/p/<id>`), provider ownership, and contribution attribution come from
the **manifest id as read by the host**, never from values inside plugin code. This extends the
existing anti-squatting checks (route namespace binding in the node host, `providerId` ownership
in `packages/client-core/src/registries/plugin.ts`).

### One active client bundle per plugin id

Contribution IDs are deliberately un-namespaced — they are persisted layout keys and chord
targets (see the comment block in `registries/plugin.ts`). Two versions of one plugin must never
register concurrently. Fleet rule: newest installed version whose `apiVersion` the client
supports wins; a change of winner applies at next boot, never mid-session.

### Loaded plugins fail contained; built-ins fail loud

Both hosts today deliberately do NOT catch init errors ("first-party code… fails loudly at
boot"). That stance is correct for built-ins and stays. Loaded plugins get the opposite: an init
failure disables the plugin, files an attention item, and boot continues.

### Data ownership rules are unchanged

Plugin-owned SQLite file, no cross-file foreign keys, no querying another plugin's tables,
collaboration only via contracts/capabilities/broadcasts/registries (docs/plugins.md). The
architecture test (`tools/arch/boundaries.test.ts`) grows new rules per phase and every phase
must leave it green.

Core owns Workspace → Project → Task (docs/workspaces-and-tasks.md). A plugin that scopes its rows
to a codebase keys them by `projectId`, obtained from `ctx.core.projects` — never by an
`(owner, name)` GitHub pair. The pair is a nullable facet on the project row and its index is
deliberately non-unique, because two clones of one repo are a legal, normal thing to have
(`packages/node-core/src/server/db/schema.ts:125-126`). Keying on it means a plugin's data
silently merges across clones and vanishes for projects with no GitHub remote at all. Every
first-party plugin that stores per-codebase rows already made this move (http, database, memory);
`(owner, name)` survives only inside github's own PR mirror, where the numeric repo id is the real
key anyway.

## Practical notes (repo-wide)

- **Gate before handing work back**: `pnpm lint` (oxlint + `tsc --noEmit` in every package) and
  the relevant vitest suites.
- **better-sqlite3 ABI**: vitest runs under plain Node; on native-module ABI errors run
  `pnpm rebuild:node` first.
- **UI verification constraint**: unit tests are `*.test.ts` under plain Node with no Solid
  plugin — a green suite proves nothing about rendered UI. Desktop e2e:
  `pnpm --filter @acorn/desktop test:e2e`.
- **Client cache gotcha**: the renderer's query cache persists to IndexedDB with no buster; bump
  query keys when persisted response types gain required fields.
- **Migrations are freshly baselined**: every SQLite chain in the repo — core and all eight
  plugins — was reset to a single `0000_*` migration. Nothing here should assume a long numbered
  chain, and the plugin authoring story (phase 5, and the future ecosystem work) starts a new
  plugin's chain at `0000`.
- **Known pre-existing test failures**: one live-PTY `posix_spawnp` failure in agentSend tests,
  and `serviceSpawn`/`standaloneShutdown` electron-import failures in some environments. Verified
  on clean trees; don't chase them.

## Reference documents

- `docs/plugins.md` — the current (compiled-in) plugin system; gets its two-tier rewrite with
  the future ecosystem work (phase-0 already updates its plugin-api line).
- `docs/architecture-overview.md` — runtime topology, contract ownership, wire validation.
- `docs/workspaces-and-tasks.md` — the Workspace → Project → Task model plugins scope against.
  `docs/legacy/projects/` is the completed migration record: read it for rationale, not for
  current state (its phase files describe intermediate dual-write stages that no longer exist).
- `docs/security.md`, `docs/authentication.md` — trust boundaries this design extends.
- `docs/electron.md` — `app://` scheme, preload bridge, broker.
- `docs/panes.md`, `docs/ui-design.md`, `docs/state.md`, `docs/caching.md` — the client surfaces
  and state rules chrome contributions plug into.
