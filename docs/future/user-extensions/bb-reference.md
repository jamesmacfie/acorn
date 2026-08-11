# How bb's self-modification loop works

Design notes from the bb-comparison session (2026-08-12). This file is a self-contained record of
what was read in bb's actual code — not its marketing — at `references/bb` on that date. It is
written to remain useful if that checkout moves or is deleted. Paths below are relative to the bb
repo root.

bb describes itself as "an agentic IDE that can control itself" (`README.md`). The famous property
— use bb to modify bb — is real, and this file records exactly how it works, because acorn wants
the same *experience* while explicitly not wanting several of the *mechanisms* that produce it.

## Runtime shape

| Process | Code | Role |
| --- | --- | --- |
| Launcher (`npx bb-app`) | `packages/bb-app/src/launcher.ts` | spawns and supervises the others |
| Server | `apps/server` | Hono HTTP + WS, SQLite (`packages/db`) as source of truth. **Plugin backends run in-process here.** |
| Host daemon | `apps/host-daemon` | per-machine: worktrees, provider CLIs |
| App (UI) | `apps/app` (Vite SPA, served by the server) | **plugin frontends run here, in the same page as bb's own UI** |
| Desktop shell | `apps/desktop` (Electron) | `loadURL(<local server url>)` — a shell over the same web UI |
| CLI (`bb`) | `apps/cli` | thin client over the server API; also how agents drive bb |

Work happens in threads (conversation + event stream) bound to environments (a workspace dir on a
host), driven by pluggable agent providers (Codex, Claude Code, Pi, ACP).

## The foundational decision: no sandbox, anywhere

Everything else in bb follows from one choice: **plugins are full-trust code.**

- The backend is Node code imported into the server process. Full `fs`, full network, the entire
  bb SDK. The authoring skill says it plainly: "Plugins are full-trust code: they can read all
  local bb data."
- The frontend is an ESM module dynamically imported into the same browser page as bb's own UI —
  same origin, same React instance (host-provided via `globalThis.__bbPluginRuntime` shims).
  Content scripts are documented as "trusted same-origin page code, not a security sandbox"
  (`packages/plugin-sdk/README.md`).
- The install command prints a full-trust warning and prompts. `--yes` skips it; a non-TTY without
  `--yes` is refused — so an agent in bash must pass `--yes`, which the authoring skill's
  quickstart documents. The HTTP install route (`POST /api/v1/plugins/install`,
  `apps/server/src/routes/plugins.ts`) is guarded only by a local-origin check — **no server-side
  human confirmation exists**. The effective gate is the agent provider's own bash-approval prompt.

The warning is the security model. That is the trade bb made for its loop speed, and it is the
trade acorn refuses (see `agent-authored-plugins.md`).

## Plugin anatomy

The manifest is `package.json` with a `bb` section (parsed in
`apps/server/src/services/plugins/manifest.ts`):

```json
{ "name": "bb-plugin-hello", "type": "module",
  "engines": { "bb": ">=0.9", "bbPluginSdk": "^0.4.1" },
  "bb": { "name": "…", "description": "…", "branding": { "icon": "Zap" },
          "server": "./server.ts", "app": "./app.tsx",
          "skills": ["skills"], "themes": [{ "id": "…", "name": "…", "css": "./themes/x.css" }] } }
```

Plugin id = last package-name segment minus the `bb-plugin-` prefix; it namespaces routes, storage,
settings, and the plugin's CLI command.

Install sources (`install-sources.ts`, `plugin-registration.ts`):

- `builtin:<name>` — bundled with the app, auto-installed from a registry table.
- `path:<dir>` — registered **in place**; nothing is copied. This is the self-modification source.
- `git:<url>@<ref>` — cloned, `npm install` with lifecycle scripts disabled, built, promoted to an
  immutable artifact dir.
- `npm:<pkg>@<spec>` — must ship a metadata-valid prebuilt `dist/`; never built locally.

Install is a DB row plus a load. Builtin ids are reserved (`refuseBuiltinShadow`) so a third-party
package can't silently replace `secrets` or `automations`.

## Loading and the hot-reload machinery

`apps/server/src/services/plugins/plugin-runtime.ts` (`loadOne`) is the heart:

1. Manifest read → `engines.bb` / `engines.bbPluginSdk` checks → packaged-artifact metadata checks.
2. Frontend bundle refreshed if its recorded SDK version no longer matches the running SDK.
3. A per-load `bb` API handle is created.
4. **Path installs load `server.ts` from source** — no build step. Managed installs prefer
   `dist/server.js` when its SDK stamp matches.
5. The source is imported with **jiti** (`moduleCache: false`), so TypeScript loads directly.
6. `mod.default(bb)` runs time-boxed to 30 s; then a single map write (`loaded.set(id, plugin)`)
   is the commit point. Until that line, every dispatcher still resolves the previous handle.

Two mechanisms make reload real rather than cosmetic:

- **Cache busting.** Node's ESM registry keys modules by URL forever, so a `registerHooks`
  resolve hook stamps `?bbPluginLoad=<rootId>.<epoch>` onto every `file:` URL inside a mutable
  plugin root, and each reload bumps the epoch (with a rollback closure if the candidate fails).
  Edited files genuinely re-import.
- **Candidate-then-commit swap.** Reload runs the new factory against a *candidate* registration
  set. If it throws, the previous set stays fully live and the failure is reported as status
  detail. On success: background services aborted (bounded await), `onDispose` hooks run LIFO,
  in-flight HTTP/RPC/event handlers drained, vended DB handles closed, the old `bb` handle
  invalidated (stale use throws `PluginContextStaleError`), then the map entry is replaced and
  durable schedules re-synced.

## The self-modification loop, end to end

1. **Entry point.** Settings → Plugins has a "Create a plugin" button that seeds a chat prompt:
   *"I want to build a new bb plugin. Use the bb-plugin-authoring skill to scaffold a starter
   plugin and walk me through customizing it."* The user reviews and sends. Everything after that
   is the agent using bash.
2. **The agent knows how.** Three tiers of injected knowledge: a `bb-cli` skill; the
   **`bb-plugin-authoring` skill — 1,678 lines, the complete plugin API** — loaded on demand into
   any agent thread; and a server-*generated* `plugin-commands` skill listing every installed
   plugin's CLI command, so a plugin the agent just wrote becomes agent-discoverable.
3. **Write.** `bb plugin new hello [--app]` scaffolds a package in the agent's own worktree:
   manifest, `server.ts`, optional `app.tsx`, a tsconfig mapping the SDK to local type
   declarations, vendored UI components, a plugin skill, `.gitignore`. `bb plugin types` rewrites
   those declarations (~13k readable lines) **from the running bb instance** — explicitly the
   agent's lookup path ("Never answer an API question from a built bundle").
4. **Install.** `bb plugin install . --yes`. The directory is registered in place, the frontend
   bundle is built once if declared, the row is upserted, and `loadOne` runs immediately.
5. **Iterate.** `bb plugin dev`: recursive `fs.watch` on the plugin root (300 ms debounce,
   ignoring `dist/`, `node_modules/`, `.git/`) → rebuild the frontend → `POST /api/v1/plugins/
   reload?id=<id>`. A build failure skips that cycle's reload and keeps watching.
6. **Backend takes effect** via the candidate swap above — old version stays live on failure.
7. **UI appears live, no refresh.** The server broadcasts `plugins-changed` over the WS; every
   open client reconciles independently: fetch the inventory, and for each plugin whose **content
   hash changed** (sha256 over `app.js` + `app.css` + meta) `import()` the fresh-hash URL (the
   browser module cache can't serve stale), validate the export, bump a per-plugin generation,
   abort + dispose the prior content-script generation, then **replace that plugin's slot
   registrations wholesale** and swap the CSS `<link>`. Generation is folded into React keys so
   mounted slots remount with fresh error boundaries. Unchanged hash = untouched, so a
   backend-only reload never remounts UI. Old ESM module objects just become unreferenced —
   documented as accepted.

Net: the agent saves a file and the new UI is on screen in open windows about a second later.

### What the loop can and cannot modify

- **New plugins**: yes — the blessed path.
- **Existing path-installed plugins**: yes — edit files, `bb plugin reload <id>`.
- **Bundled plugins in a dev checkout**: yes — a dev flag enables a recursive watch + dev loop
  over every bundled plugin root, so editing `plugins/tasks/app.tsx` live-updates the UI.
- **Packaged builtins**: patched bundles would load (only metadata fields are validated, not the
  bytes), but there is no supported loop and app updates overwrite them.
- **Core** (server, app shell, CLI, daemon): **no.** That requires the bb checkout and the
  documented dev loop; the server and daemon do not hot-reload. Deliberate — the vision doc says
  users "should not have to fork bb"; plugins are the answer to that.
- The recursive twist: the SDK's plugins area exposes install / enable / disable / reload /
  remove / callRpc / getSource / updateSettings — so **a plugin can install and reload plugins,
  including itself**.

### Guardrails, honestly

All containment, not security: the 30 s factory time box; failed reload keeps the old set;
degraded status when a background service won't stop; a per-slot error boundary rendering a
"plugin crashed" chip; cross-plugin tool-name collisions drop the later plugin with an
explanation; message-directive crashes fall back to literal source text; native addons are
rejected with a message. Managed (git/npm) installs additionally verify engines, artifact
identity, and SDK major, and take a **pre-activation state snapshot** (plugin DB + settings + kv +
schedules + secrets + registration row) with automatic rollback on failed activation.

## Backend API surface (what a plugin's `server.ts` receives)

`settings.define` (four descriptor types; `secret: true` → 0600 file, never sent to the frontend);
`storage.kv` (≤256 KB/value, in bb's DB) + `storage.database()` (own SQLite file) +
`storage.migrate`; `http.route` at `/api/v1/plugins/<id>/http/<path>` with `auth:
"local"|"token"|"none"`; `rpc.register` (schema-validated frontend data plane); `realtime.publish`
(WS signal); `background.service` (AbortSignal + backoff) and `background.schedule` (durable cron
rows); `cli.register` (one top-level `bb <name>` subcommand, executed server-side);
`agents.registerTool` / `agents.configure` / `agents.contributeInstructions`;
`ui.registerMentionProvider` (host-rendered, no bundle needed) and `ui.requestInput` (blocking
form replacing the composer); `events.on` (exactly six observe-only thread events); and `sdk` —
the **entire** bb SDK over loopback: threads, projects, environments, hosts, files, terminals,
providers, skills, plugins, theme, system.

## Frontend contribution types

The authoritative slot list (`apps/app/src/lib/plugin-slots.ts`): homepage sections, settings
sections, nav panels, thread panel actions, composer customizations, pending interactions, sidebar
footer actions, thread lists, thread header actions, file openers, message directives, message
actions — plus content scripts (arbitrary DOM code in the app shell) and host-provided components
(`ThreadChat`, `Markdown`, a composer). Frontend builds use esbuild with react/radix/etc. replaced
by shims reading the host runtime, so there is one React. The build toolchain (esbuild + Tailwind)
is downloaded on first use into the data dir — bb ships no bundler in the app itself either, but
is willing to fetch one at runtime.

## Cross-plugin, theming, data

- **Cross-plugin:** no formal extension-point/hook API. What exists: sanctioned RPC
  (`sdk.plugins.callRpc` — plugin A calls plugin B's registered methods, can read B's source,
  toggle B's enabled state); content scripts as the de facto universal extension point (full-trust
  DOM mutation of anything, including other plugins' UI); and **arbitration, not composition**
  where surfaces collide — slots flatten in plugin-id order, agent tool names are first-wins, one
  CLI name per plugin. The one *exclusive* slot is the sidebar thread list: registering it does
  not seize the sidebar; **the user picks the provider in settings**, and bb falls back to its own
  list if that plugin is disabled or crashes. That user-arbitrated pattern is worth stealing.
- **Themes:** manifest-declared CSS files (`bb.themes` — unique ids, must exist, `.css`), exposed
  from loaded plugins only, selectable as `plugin:<pluginId>:<themeId>` in Settings → Appearance,
  size-capped, falling back to the default theme when the owning plugin is disabled or removed.
  Sibling mechanism: user themes as plain CSS files in the data dir. Plugin *component* styling is
  Tailwind against host tokens only — custom theme colors in component code are forbidden by the
  build.
- **Data:** per-plugin dir in the data dir (`data.db` SQLite WAL, `secrets/` 0600, JSONL logs
  rotated at 5 MB). Registration, artifacts, snapshots, kv, settings, and schedules are rows in
  bb's own DB. **Migrations:** `storage.migrate(db, statements)` — the statement **array index is
  the migration id**, tracked in a plugin-owned `_bb_migrations` table; unapplied statements run
  in one transaction; the contract is append-only, never reorder or edit shipped statements. bb
  does not manage plugin schemas beyond that.
- **Updates:** builtins are pinned to the app release. git/npm installs are manual: `bb plugin
  outdated` reads only the remote manifest; `bb plugin update` applies only candidates satisfying
  the engines ranges, snapshots state first, and rolls back on failed activation. Settings saves
  never auto-reload a healthy plugin.

## Steal / adapt / refuse

| bb mechanism | acorn's answer |
| --- | --- |
| Seeded "create a plugin" prompt in settings | **Steal.** Product entry point, near-zero cost. |
| Authoring skill injected into agent context | **Steal** via acorn's existing agent-context seams. |
| API types generated from the running instance | **Steal** — the agent-facing projection of acorn's pinned plugin-api surface snapshot. |
| Generated skill listing installed plugins' commands/tools | **Steal** — acorn's tool registry already projects to MCP; make new plugins' tools discoverable without restart. |
| Candidate-then-commit reload with rollback | **Steal** the semantics for the node-side reload path. |
| ESM cache-busting via resolve-hook query params | **Steal** — directly portable to the node loader. |
| Hash-keyed client reconcile on a "plugins changed" event | **Adapt** — acorn's frames are iframes keyed by bundle hash, an even cleaner swap than bb's in-page ESM. |
| Source-loaded TS backend (jiti, no build) | **Adapt** — acorn's answer is a documented no-bundler *profile* (plain ESM), not a TS loader in the trusted process. |
| Append-only migration contract | **Steal the contract, keep acorn's mechanism** (Drizzle chains, host-applied). |
| Pre-activation state snapshot + rollback | **Adapt** — worth considering for acorn's installer on update. |
| User-arbitrated exclusive slot (sidebar thread list) | **Steal the pattern** for "replace a core surface" contributions. |
| Manifest-declared themes | **Adapt** — validated token maps instead of raw CSS (see `extension-points.md`). |
| `--yes` full-trust install; no server-side confirmation | **Refuse.** acorn's install stays human-approved (see `agent-authored-plugins.md`). |
| No sandbox; same-origin plugin UI | **Refuse.** The frame sandbox is acorn's differentiator. |
| Content scripts as the universal extension point | **Refuse.** That is the absence of a boundary, not extension. |
| Plugins installing plugins via the SDK | **Refuse** as a direct capability; the approval-mediated flow covers the legitimate use. |

## Verify before building

If `references/bb` still exists, the fastest re-orientation points are:
`apps/server/src/services/plugins/plugin-runtime.ts` (loading, reload, cache busting),
`apps/app/src/lib/plugin-frontend.ts` (client reconcile), `apps/cli/src/commands/plugin.ts`
(new/install/dev/types), and
`apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/SKILL.md` (the real spec). If
it is gone, this file is the record.
