# Local development

acorn is a pnpm workspace with Turborepo. First-party packages are source-consumed TypeScript
packages; `apps/node` and `apps/desktop` are the composition/build roots.

## Environment

Create `apps/desktop/.env` for local Electron development:

```dotenv
GITHUB_CLIENT_ID=...
SESSION_ENC_KEY=<64 hexadecimal characters>
```

`GITHUB_CLIENT_ID` is only needed when connecting GitHub; the GitHub plugin owns that configuration.
There is no GitHub client secret. `SESSION_ENC_KEY` is optional — the desktop supplies one from
safeStorage, and a node with neither generates its own into the data root (see
[node-distribution.md](./node-distribution.md)). Setting it in `.env` pins a stable key across
throwaway data roots, which is why it is still listed here.

The data root defaults to `apps/node/.acorn/` and is gitignored. Set `ACORN_DATA_DIR` to isolate a
run. Set `ACORN_PORT` to force a port for tests or a standalone process; otherwise the Node prefers
the last port in `node.json` and falls back to an ephemeral port.

## Start

```sh
pnpm install
pnpm run rebuild
pnpm dev
```

`pnpm dev` builds the Node artifact, builds the desktop main/preload/renderer, stages migrations and
Node output, and launches Electron. `pnpm dev:node` runs the standalone Node and prints one JSON
handshake line containing endpoint, fingerprint, certificate, Node ID, and device token.

## Native ABI

`node-pty` is the only native module. SQLite is the runtime's own `node:sqlite`
(`packages/node-core/src/main/sqlite.ts`), so there is no ABI to match for it. Rebuild once at the
workspace root for the process that will load node-pty — where its prebuilt binary applies, the
rebuild script detects that and does nothing:

```sh
pnpm rebuild:node       # plain Node: tests, dev:node, database commands
pnpm run rebuild        # Electron: desktop development/build
```

Do not rebuild per package; all packages resolve the same physical native copy.

## Database workflow

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
next launch — that is the intended fresh-install path, since there is no upgrade path from an older
database.

## Build artifacts

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and chunks. Electron stages them into
`apps/desktop/out/main/` and stages all core/plugin migrations. Build the service before desktop e2e;
the staging check detects missing artifacts but cannot identify stale output by itself.

## Data and credentials

Never commit `apps/desktop/.env`, data roots, device tokens, integration credentials, TLS keys, or
generated archives. Use a fresh `ACORN_DATA_DIR` for onboarding/import tests. The importer reads a
copy and leaves the source database and sidecars unchanged.
