# Local development

This page covers getting acorn running from a checkout: the environment, the dev loops, the native
module, and the database commands. The agent drivers and profiling have their own pages.

acorn is a pnpm workspace built with Turborepo. First-party packages are consumed as TypeScript
source. `apps/node` and `apps/desktop` are the build roots. The Node's build entries are in
`apps/node/src/entries/`, and the boot code they share is in `apps/node/src/composition/`. The
desktop's three processes are `apps/desktop/src/client/`, `src/shell/`, and `src/helper/`.

| Page | Covers |
| --- | --- |
| [Agent drivers](./local-development/agent-drivers.md) | Driving an isolated desktop window or terminal client from the command line, native control, and the large-surface flow. |
| [Profiling](./local-development/profiling.md) | Timing a cold start and a task switch. |

<a id="agent-driven-desktop-development"></a>
<a id="native-control-of-a-session"></a>
<a id="agent-driven-terminal-development"></a>
<a id="large-surface-flow"></a>
<a id="timing-a-cold-start"></a>
<a id="timing-a-task-switch"></a>

The agent-driven desktop and terminal sections, native control, and the large-surface flow moved to
[agent drivers](./local-development/agent-drivers.md). Timing a cold start and timing a task switch
moved to [profiling](./local-development/profiling.md).

## Prerequisites

- Node in the range the root `package.json` `engines` field allows. The desktop bundle and the tests
  use the version pinned in `node-runtime.json`.
- pnpm at the version the root `package.json` names in `packageManager`.
- A Rust toolchain, for the Tauri shell.

## Start

```sh
pnpm install --frozen-lockfile
pnpm rebuild:node
pnpm dev
```

`pnpm dev` stages the Node artifact, the bundled plugins, the desktop helper, and the injected bridge
with the pinned Node runtime and the migration chains. It then runs `tauri dev` against a Vite
renderer on port 4319.

Other ways to run it:

| Command | What it does |
| --- | --- |
| `pnpm dev:no-watch` | The same run with the Rust watcher off. |
| `pnpm dev:node` | Runs the standalone Node and prints one JSON handshake line with the endpoint, fingerprint, certificate, Node ID, and device token. |
| `pnpm dev:plugin <id>` | Rebuilds one loaded plugin's package on every save. [Plugins](./plugins.md) § The dev loop has the whole loop. |
| `pnpm dev:agent -- --session <name>` | Starts an isolated desktop session you can drive. See [agent drivers](./local-development/agent-drivers.md). |
| `pnpm dev:tui:agent -- --session <name>` | Starts an isolated terminal client you can drive. |

`tauri dev` rebuilds and relaunches the app on every change under `src-tauri`, which takes the window
away from whoever is using it. Use `pnpm dev:no-watch` when someone is working in the app while you
edit the shell. To pick up the new binary, stop it and run `pnpm dev` again. Vite's hot reload of the
renderer works either way.

## Environment

To customize local desktop development, create `<checkout>/apps/desktop/.env`:

```dotenv
# Optional: use your own GitHub app instead of acorn's default.
# GITHUB_CLIENT_ID=your-app-client-id
SESSION_ENC_KEY=<64 hexadecimal characters>
```

GitHub connects with acorn's public client ID and needs no configuration. Set `GITHUB_CLIENT_ID` only
to use your own app. [GitHub integration](./github-integration.md#connecting) covers app setup.

`SESSION_ENC_KEY` is optional. A Node without one generates its own key into the data root. Setting it
pins a stable key across throwaway data roots. [Node distribution](./node-distribution.md) covers the
key.

| Variable | Effect |
| --- | --- |
| `ACORN_DATA_DIR` | Isolates a run in another data root. The default is `apps/node/.acorn/`, which Git ignores. |
| `ACORN_PORT` | Forces a port. Otherwise the Node prefers the last port in `node.json`, then an ephemeral one. |
| `ACORN_BUNDLED_PLUGINS_DIR` | Gives a standalone Node a directory of app-owned plugin packages to reconcile from. The desktop always has one. `pnpm dev:node` doesn't, and without it the reconcile step doesn't run. |
| `ACORN_PROMPT_BUNDLED_PLUGIN_TRUST=1` | Shows the trust dialog for the app's own bundled packages, which a development build otherwise accepts as a packaged build does. |
| `ACORN_PERF=1` | Prints boot and request timing. See [profiling](./local-development/profiling.md). |

## Develop the headless CLI

Build the CLI, terminal, and Node bundles, then run the shared launcher. Help needs no Node. Read and
write commands attach to a running local Node. Use a temporary data root when you test service
ownership:

```sh
pnpm --filter @acorn/cli build
pnpm --filter @acorn/tui build
pnpm --filter @acorn/node build
node apps/cli/bin/acorn.mjs --help
export ACORN_DATA_DIR="$(mktemp -d)"
node apps/cli/bin/acorn.mjs node start --background --output json
node apps/cli/bin/acorn.mjs node status --output json
node apps/cli/bin/acorn.mjs node stop --output json
```

Keep the same `ACORN_DATA_DIR` for later commands, including `node stop`. The service uses the
standalone Node bundle. Run the CLI suite with `pnpm --filter @acorn/cli test`. To check the packed
artifact, run `pnpm pack:node`, then `npm install --omit=dev` inside the extracted archive.
[CLI](./cli.md) covers resource schemas, pairing, and examples.

## Native ABI

`node-pty` is the only native module. SQLite is the runtime's own `node:sqlite`, through
`packages/node-core/src/server/storage/sqlite.ts`, so it has no ABI to match. Rebuild once at the
workspace root:

```sh
pnpm rebuild:node
```

The script does nothing where the prebuilt binary already fits. There's one ABI to match, because the
desktop runs the Node under the same pinned runtime the tests use. Don't rebuild per package. Every
package resolves the same physical copy.

## Database workflow

`scripts/db.mjs` finds a migration chain by its `drizzle.config.ts`. Every plugin's config is one line
that re-exports `plugins/drizzle.shared.ts`, which maps `./src/node/schema.ts` to `./migrations`. A new
table-owning plugin adds that one-line file, plus `migrationsModule: import.meta.url` on its
`NodePlugin`, so the host opens and migrates its database. [Data layer](./data-layer.md#migrations)
covers migrations.

Edit the schema in its owning package, then run:

```sh
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

The launch path applies pending migrations. `pnpm db:locate` prints the active core database path.

### Reset a data root

To inspect a disposable installation before a reset, name its roots:

```sh
pnpm db:reset -- --node-root /absolute/node/root --tui-root /absolute/tui/config
```

This prints a JSON inventory and changes nothing. The root arguments are required, and the command
never picks a directory from the environment. To reset, stop the Node and the terminal client, then
choose a new recovery directory outside the roots:

```sh
pnpm db:reset -- --execute --node-root /absolute/node/root --tui-root /absolute/tui/config --recovery-dir /absolute/recovery
```

The command checks Node locks and open files, exports each listed file to a private directory,
verifies SHA-256 digests, and records each removal in `manifest.json`. Run the same command with the
same recovery directory to resume an interrupted reset. Repository files, worktrees, `.env`, other
files, and external databases aren't in the inventory. Restore the snapshot only into an isolated
directory with the old acorn binary. Retained worktrees stay detached until you add them again. Name
the private memory root with `--memory-root` to reset accepted memory.

For a desktop installation, quit the normal app, make an empty private recovery directory, and run
the desktop binary's host stage first:

```sh
mkdir -m 700 /absolute/recovery
acorn-desktop --reset-stage --desktop-root /absolute/desktop/custody --recovery-dir /absolute/recovery
pnpm db:reset -- --execute --node-root /absolute/node/root --desktop-root /absolute/desktop/custody --recovery-dir /absolute/recovery
```

The host stage opens a dedicated `app://acorn` window without starting the helper or a Node. It
exports that origin's local storage and query cache to `desktop-origin.json`, and the `acorn/data-key`
keychain or file key to `desktop-key.txt` when one exists. It clears the origin and the keychain
entry, then writes `desktop-stage.json`. The filesystem command checks that stage's hashes, private
permissions, and custody root before it removes custody files. If the stage fails, the filesystem
reset stays blocked. A development checkout's custody is normally `<node-root>/shell`. A packaged
build's is in the application-data directory. Review the inventory before you point a reset at the
checkout's own data root.

## Build artifacts

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and chunks. `apps/desktop/scripts/stage.mjs`
puts them, every core and plugin migration chain, the plugin frame stylesheet, and the pinned Node
runtime where the bundler finds them. The staging check catches missing artifacts but can't tell
stale output, so `package.json` scripts own the build order. `apps/cli` emits the headless bundle and
launcher, and `apps/tui` emits the interactive bundle. `pnpm pack:node` puts all three in one archive
with the runtime dependencies its generated manifest names.

## Data and credentials

Never commit `<checkout>/apps/desktop/.env`, data roots, device tokens, integration credentials, TLS
keys, or generated archives. Use a fresh `ACORN_DATA_DIR` to test onboarding or import. The importer
reads a copy and leaves the source database and its sidecar files unchanged.
