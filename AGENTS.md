# acorn agent guide

acorn is an agent workspace: a Tauri desktop shell, a Node service, a terminal client, and a tree
of plugins. This page tells you where to look and how to check your work.

## Find the docs

- [docs/README.md](./docs/README.md) indexes every doc. Start there.
- [docs/architecture-overview.md](./docs/architecture-overview.md) covers the runtimes and the
  contracts between them.
- [docs/conventions.md](./docs/conventions.md) says where a file goes and what to call it.
- [docs/plugin-map.md](./docs/plugin-map.md) is the short way into the plugin system.
- [docs/testing.md](./docs/testing.md) and
  [docs/local-development.md](./docs/local-development.md) hold the full test and dev workflows.
- `docs/future/` holds designs for work that hasn't shipped. Its README lists every one.

Before you change code, find the runtime that owns it. Trace the data from its source through the
Node API, protocol, broker, client cache, and UI. Keep the Node/shell and plugin boundaries, and use
the contribution and capability seams. When behavior or a contract changes, update the doc that
owns it and add any new doc to `docs/README.md`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm install --frozen-lockfile` | Installs dependencies. A fresh worktree needs this first. |
| `pnpm lint` | Runs oxlint, then `tsc --noEmit` in every package. |
| `pnpm test:focus <package> <file> [-t <name>]` | Runs one file or test. Use it while you iterate. |
| `pnpm test --filter=<package>` | Runs one package's full suite through Turborepo. |
| `pnpm --filter @acorn/arch-tests test` | Runs the repo-wide architecture rules, including doc links. |
| `pnpm test` | Runs every suite. This is the full gate. |
| `pnpm --filter @acorn/desktop test` | Stages the bundle, then runs the desktop and Rust suites. |
| `pnpm dev` | Starts the app for local development. |
| `pnpm dev:agent -- --session <name>` | Starts an isolated desktop session you can drive. |
| `pnpm dev:tui:agent -- --session <name>` | Starts an isolated terminal client you can drive. |
| `pnpm db:generate` and `pnpm db:check` | Generate and check database migrations. |

## Test and lint quickly

1. While you edit, run `pnpm test:focus @acorn/node-core src/server/core/git.test.ts`. It prepares
   the native module once, caps workers, and fails if it runs no tests.
2. Before handoff, run `pnpm lint` and `pnpm test --filter=<package>` for each package you touched
   and each package that consumes it.
3. If you changed a plugin manifest, renderer source shape, or a doc, also run
   `pnpm --filter @acorn/arch-tests test`.

Use `pnpm test`, not `turbo run test`. The script caps concurrency. Without the cap, tests that spawn
processes or mint certificates time out under load, even though they pass on their own. A narrow run
doesn't prove that dependents pass. For the exact scopes, see
[focused agent runs](./docs/testing.md#focused-agent-runs).

## Check UI changes in the real app

For the desktop, run `pnpm dev:agent -- --session <name>`. In a second terminal, run
`pnpm dev:agent:ui -- --session <name> snapshot`, then `click`, `fill`, and `screenshot` with the
element references it returns. Take a new snapshot after each change of screen. Finish with
`pnpm dev:agent:ui -- --session <name> stop`. The session uses its own data and ports and adds this
checkout as a project, so onboarding and GitHub login don't get in the way. Add `--onboarding` to
test the wizard. The driver can't reach native menus, native dialogs, or child webviews.

For the terminal client, run `pnpm dev:tui:agent -- --session <name> --fixture tui-navigation`. In
a second terminal, use `pnpm dev:tui:agent:ui -- --session <name>` with `snapshot`, `press`, and
`resize 120 40`. Finish with `stop`.

For details, see [local development](./docs/local-development.md).

## Lint rules

The oxlint config only checks dead code and the `node:` import prefix. It stays narrow on purpose,
because a linter that argues about style gets ignored.
