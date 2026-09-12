# Local development

acorn is a pnpm workspace with Turborepo. First-party packages are source-consumed TypeScript
packages; `apps/node` and `apps/desktop` are the composition/build roots. The node's build entries are
in `apps/node/src/entries/` and the boot code they share is in `apps/node/src/composition/`; the
desktop's three processes are `apps/desktop/src/client/`, `src/shell/`, and `src/helper/`.

## Environment

Create `<checkout>/apps/desktop/.env` for local desktop development:

```dotenv
GITHUB_CLIENT_ID=...
SESSION_ENC_KEY=<64 hexadecimal characters>
```

`GITHUB_CLIENT_ID` is only needed when connecting GitHub, and the GitHub plugin owns that
configuration. There is no GitHub client secret. `SESSION_ENC_KEY` is optional: a node without one
generates its own into the data root. For more information, see
[node-distribution.md](./node-distribution.md). Setting it in `.env` pins a stable key across
throwaway data roots, which is why it is listed here.

The data root defaults to `apps/node/.acorn/` and is gitignored. Set `ACORN_DATA_DIR` to isolate a
run. Set `ACORN_PORT` to force a port for tests or a standalone process; otherwise the Node prefers
the last port in `node.json` and falls back to an ephemeral port.

Two variables exist for plugin work. `ACORN_BUNDLED_PLUGINS_DIR` gives a standalone Node a directory
of app-owned plugin packages to reconcile from. The desktop always has one and `pnpm dev:node` does
not, and if the variable is unset the reconcile step does not run at all.
`ACORN_PROMPT_BUNDLED_PLUGIN_TRUST=1` puts the per-bundle trust dialog back for the app's own bundled
packages, which a development build otherwise acknowledges the way a packaged build does. For more
information, see [plugins.md](./plugins.md) § The dev loop.

## Start

```sh
pnpm install
pnpm rebuild:node
pnpm dev
```

`pnpm dev` builds the Node artifact, the bundled plugins, the desktop helper and the injected bridge,
stages them with the pinned Node runtime and the migration chains, then runs `tauri dev` against a
Vite renderer on port 4319. `pnpm dev:node` runs the standalone Node and prints one JSON handshake
line containing endpoint, fingerprint, certificate, Node ID, and device token.

Working on a loaded plugin is `pnpm dev:plugin <id>` beside one of those. It rebuilds the plugin's
package on every save. [plugins.md](./plugins.md) § The dev loop has the whole loop, including which
target to build into and why the node restarts.

## Native ABI

`node-pty` is the only native module. SQLite is the runtime's own `node:sqlite`
(`packages/node-core/src/server/storage/sqlite.ts`), so it has no ABI to match. Rebuild once at the workspace
root for the process that loads node-pty. Where the prebuilt binary applies, the rebuild script
detects that and does nothing:

```sh
pnpm rebuild:node
```

There is one ABI to match, because the desktop runs the node under the same pinned Node runtime the
tests use. Do not rebuild per package. All packages resolve the same physical native copy.

## Database workflow

`scripts/db.mjs` finds a chain by the presence of a `drizzle.config.ts`, and every plugin's is one line
re-exporting `plugins/drizzle.shared.ts` (`./src/node/schema.ts` → `./migrations`). A new table-owning
plugin adds that one-line file, plus `migrationsModule: import.meta.url` on its `NodePlugin` so the host
opens and migrates the database for it (docs/data-layer.md § Migrations).

Edit the schema in its owning package, then run:

```sh
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

The launch path applies pending migrations automatically. `pnpm db:locate` prints the active core
database path.

To go back to a first run, quit the app and delete the databases:

```sh
pnpm db:reset          # lists what it will delete, then asks
pnpm db:reset --yes    # non-interactive
```

It removes `core.sqlite` and every `plugins/*.sqlite` (WAL and SHM sidecars included) from the dev
data root, or from `ACORN_DATA_DIR` when that is set. Node identity, the listener key, and the
internal token stay. The device row goes with the core database, so the desktop pairs again on the
next launch. That is the intended fresh-install path, since there is no upgrade path from an older
database.

## Timing a cold start

Four processes, four accounts of their own boot, all of them lines on a stream with a running offset.
Every line carries `+Nms` from that process's start and `(Nms)` for the step alone, so the one step
that cost the boot is the one wide number.

**The node prints its marks unconditionally.** A node that took eleven seconds to bind should say so
without anyone having asked, so `[service:boot]` needs no switch: `login-shell`,
`bundled-packages`, `migrate`, `graph` (the plugin loader importing whatever is installed in the data
root), then one line per plugin per pass (`plugin github init`, `plugin x ready`), then `install`,
`cert`, `bind`, `listener-up`, `scheduler`, the four `reconcile.*` steps, and `teardown`. The per-plugin
lines are there because `install` on its own cannot say which plugin was the slow one.

Two labels need reading with care. `login-shell` is when the `PATH` probe started, not when it
finished: the probe runs behind the boot and the first process the node spawns is what waits for it
([node-distribution.md](./node-distribution.md) § Boot order), so this step is a fraction of a
millisecond even on a packaged macOS build where the probe itself takes half a second. And the
per-plugin lines are wall-clock slices rather than per-plugin costs, because the whole `init` pass runs
at once. A plugin's line says when it finished. Where the two coincide, in the common case of a plugin
whose `init` never awaits anything, the delta is that plugin's own work; where a plugin does await, the
plugin that finished next takes the credit for the gap.

`migrate` is also wider than its name. The step covers `makeRuntime`, which opens and migrates
`core.sqlite` and then builds the rest of the runtime bindings, so a slow `migrate` is not necessarily
a slow migration. Drizzle's `migrate` against an up-to-date journal is one `SELECT`, and on this
machine's data root the whole `openDb` call is 7 ms.

**Everything else is behind `ACORN_PERF=1`**, because those streams are the ones a developer watches
while using the app:

| Process | Set | Prints |
| --- | --- | --- |
| Helper | `ACORN_PERF=1` in the environment the shell was started from | `[helper:boot]` on **stderr** for handshake, plugin-cache sweep, bundled plugins trusted, `service.start`, node adopted, WebSocket bound, ready line. stderr and not stdout: stdout is the line protocol Rust parses |
| Node | same variable | `[perf:request]` per request (method, matched route pattern, status, ms, response bytes, request id), plus `git` and SQLite histograms. The byte count is the response's `content-length`, and `-1` where it declares none, which is what a stream looks like |
| Renderer | `localStorage.setItem('acorn.perf', '1')` and reload | `[renderer:boot]` in the devtools console for script start, node selected, plugins applied, tree built, first paint, `nodeReady`. A `localStorage` switch rather than the variable because a webview has no environment — Rust loads the renderer from a custom scheme rather than spawning it. The `performance.mark`s are made either way, so the devtools performance panel has the same labels with the switch off |
| `acorn` | nothing | `[acorn:boot]` on exit for node open, App imported, tasks read, renderer created, first draw. Held rather than printed live, because stderr is the file the renderer draws on while it owns the terminal — a line written mid-session reads as the shell going to garbage. Printed after `renderer.destroy()`, beside the held Node warnings |

The node's histograms count what it does over and over with nothing else counting it: `git status` and
`git diff` spawns as `git.<subcommand>`, and SQLite statements as `sql.<verb>`. They print at drain,
and `kill -USR2 <pid>` dumps and clears them mid-session, so a second dump describes the interval
rather than all time.

`ACORN_PERF=1` is a printer over the telemetry collector rather than a mechanism of its own, so the
switch also turns collection on with no sink and no preference
(`packages/node-core/src/server/telemetry/collector.ts`, [telemetry.md](./telemetry.md) § The
switch). The request line is printed where the request ends rather than from the collector's flush,
because a developer watching a dev server wants it when the request finishes and not in a burst five
seconds later.

Every other line the node writes goes to **stderr** through `createLogger`, including the
`[service:boot]` marks, which used to be on stdout. Stdout is a wire: the standalone entry prints
its handshake JSON there. Two things are still written to stdout on purpose, both from
`apps/node/src/entries/standalone.ts`: that handshake, and the pairing banner.

Reading a desktop cold start end to end means putting three of these together: Rust spawns the helper,
the helper's `[helper:boot] ready line` is the whole of what Rust waited for, and the renderer's clock
starts at its own document's navigation, after Rust created the window. The node's
`[service:boot] listener-up` no longer sits inside the wait — the window opens on the helper being
listening, so the node's whole boot happens after it ([shell.md](./shell.md) § The shell process). The
two accounts meet at `[helper:boot] service.start`, which is the node reporting that it is listening,
so `ready line` to `service.start` is how long the shell was on screen without a node behind it.

Two things about the node's own account are worth knowing before quoting it. Its clock starts inside
`startServiceRuntime`, so spawning the process and evaluating the service bundle are in front of `+0ms`
and appear in no step. That gap is a little over 350 ms, nearly all of it evaluating the
bundle's module graph, and most of that is external libraries rather than acorn's own code,
`drizzle-orm` and its `sqlite-core` being a third of the whole
([performance.md](./performance.md) § The service bundle's evaluation). And measuring the node by calling
`startServiceRuntime` under `tsx` rather than launching the app inflates `graph` roughly sevenfold,
because the loader then transpiles as it imports.

**`[renderer:boot] first paint` does not print from a background window.** It is a
`requestAnimationFrame` callback, and macOS pauses those while the window is occluded, so a launch
watched from a terminal never records it. Bring the window to the front before reloading, or read
`tree built` instead: that one is printed synchronously when `render` returns, so it fires wherever the
window is, and it is the end of the renderer's own work. The difference between the two is the
compositor, which is the part a background window does not do.

## Build artifacts

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and chunks. `apps/desktop/scripts/stage.mjs`
puts them, all core and plugin migration chains, the plugin frame stylesheet, and the pinned Node
runtime where the bundler will find them. The staging check detects missing artifacts but cannot
identify stale output by itself, so build order is `package.json`'s job.

## Data and credentials

Never commit `<checkout>/apps/desktop/.env`, data roots, device tokens, integration credentials, TLS keys, or
generated archives. Use a fresh `ACORN_DATA_DIR` for onboarding/import tests. The importer reads a
copy and leaves the source database and sidecars unchanged.
