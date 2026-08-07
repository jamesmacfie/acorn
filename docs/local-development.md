# Local development

acorn is a pnpm workspace with Turborepo. First-party packages are source-consumed TypeScript
packages; `apps/node` and `apps/desktop` are the composition/build roots.

## Environment

Create `apps/desktop/.env` for local Electron development:

```dotenv
GITHUB_CLIENT_ID=...
SESSION_ENC_KEY=<64 hexadecimal characters>
```

`GITHUB_CLIENT_SECRET` may exist for environment compatibility but the GitHub device flow does not
consume it. `GITHUB_CLIENT_ID` and `SESSION_ENC_KEY` are required to boot a development Node.

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

`better-sqlite3` and `node-pty` are native modules. Rebuild once at the workspace root for the
process that will load them:

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

## Build artifacts

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and chunks. Electron stages them into
`apps/desktop/out/main/` and stages all core/plugin migrations. Build the service before desktop e2e;
the staging check detects missing artifacts but cannot identify stale output by itself.

## Data and credentials

Never commit `apps/desktop/.env`, data roots, device tokens, integration credentials, TLS keys, or
generated archives. Use a fresh `ACORN_DATA_DIR` for onboarding/import tests. The importer reads a
copy and leaves the source database and sidecars unchanged.
