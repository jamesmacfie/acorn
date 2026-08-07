# AGENTS.md — acorn

Use [CLAUDE.md](./CLAUDE.md) as the repository-wide engineering guide. The current architecture and
runtime contracts are in [docs/architecture-overview.md](./docs/architecture-overview.md) and the
topic docs beneath `docs/`. The material under `docs/vNext/` is a completed implementation record,
kept for historical reference.

Before changing code, identify the owning runtime and trace data from its source through the Node API,
protocol, broker, client cache, and UI consumer. Preserve the Node/Electron and plugin boundaries,
use the existing contribution/capability seams, and update the owning documentation when behavior
or a contract changes.

Run `pnpm lint` and the relevant tests before handing work back. For desktop e2e, use
`pnpm --filter @acorn/desktop test:e2e` so the bundled Node artifact is rebuilt first.
