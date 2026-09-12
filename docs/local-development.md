# Local development

acorn is a pnpm workspace with Turborepo. First-party packages are source-consumed TypeScript
packages; `apps/node` and `apps/desktop` are the composition/build roots.

## Environment

Create `apps/desktop/.env` for local desktop development:

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

### Agent-driven desktop development

An agent on a graphical development host can launch and drive a real Acorn window without using the
normal development profile or signing in to GitHub:

```sh
pnpm dev:agent -- --session my-change
```

The launcher builds an automation-only debug binary, chooses unused loopback ports for Vite and the
embedded WebDriver server, and keeps the Node data, logs, screenshots, and session manifest under
`.acorn/agent-dev/my-change/`. It does not share the normal development data root or participate in
the production shell's single-instance lock, so it can run beside another Acorn checkout. By default
it adds the current checkout as a local project before launch. Pass `--project /absolute/path` to add
a different folder, or `--onboarding` to start with an empty profile and exercise the first-run flow.
Git and GitHub remain optional in either case.

Once the launcher prints `ready`, use its small command-line driver from another terminal:

```sh
pnpm dev:agent:ui -- --session my-change snapshot
pnpm dev:agent:ui -- --session my-change click e2
pnpm dev:agent:ui -- --session my-change fill e4 "new value"
pnpm dev:agent:ui -- --session my-change screenshot after-change.png
pnpm dev:agent:ui -- --session my-change stop
```

Run `snapshot` before an element action and again after the UI changes; its element references belong
to that snapshot. Omit `--session` when exactly one agent session is running. Session names identify
persistent data directories, so a stopped name is not reused accidentally; pass `--reuse` to keep and
reopen its data. For a disposable end-to-end check of the launcher and first-run UI, run
`pnpm dev:agent:smoke`.

The driver controls the main Acorn renderer through the Tauri webview. It can inspect rendered text,
click and fill elements, and capture the window. Native menus and dialogs, terminal keyboard fidelity,
and host-owned child webviews still require native computer-use control or the release smoke checklist.
The WebDriver dependency and server exist only behind the `agent-automation` Cargo feature used by
this launcher; normal development and packaged builds do not expose it.

Working on a loaded plugin is `pnpm dev:plugin <id>` beside one of those. It rebuilds the plugin's
package on every save. [plugins.md](./plugins.md) § The dev loop has the whole loop, including which
target to build into and why the node restarts.

## Native ABI

`node-pty` is the only native module. SQLite is the runtime's own `node:sqlite`
(`packages/node-core/src/main/sqlite.ts`), so it has no ABI to match. Rebuild once at the workspace
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

## Build artifacts

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and chunks. `apps/desktop/scripts/stage.mjs`
puts them, all core and plugin migration chains, the plugin frame stylesheet, and the pinned Node
runtime where the bundler will find them. The staging check detects missing artifacts but cannot
identify stale output by itself, so build order is `package.json`'s job.

## Data and credentials

Never commit `apps/desktop/.env`, data roots, device tokens, integration credentials, TLS keys, or
generated archives. Use a fresh `ACORN_DATA_DIR` for onboarding/import tests. The importer reads a
copy and leaves the source database and sidecars unchanged.
