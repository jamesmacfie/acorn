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
- [docs/writing-docs.md](./docs/writing-docs.md) says where a doc goes, the house style, how to split
  a long page, and how to cite a doc from code. Read it before you add or move a doc.
- `docs/future/` holds designs for work that hasn't shipped. Its README lists every one.

Before you change code, find the runtime that owns it. Trace the data from its source through the
Node API, protocol, broker, client cache, and UI. Keep the Node/shell and plugin boundaries, and use
the contribution and capability seams. When behavior or a contract changes, update the doc that
owns it and add any new doc to `docs/README.md`.

## Simplicity, readability, and maintainability

Treat these as requirements for every change, including fixes, features, tests, and refactors.
Optimize for a developer who needs to understand the behavior and change it safely later.

- Use descriptive names, straightforward control flow, typed contracts, and explicit dependencies.
  Make data flow, state ownership, side effects, and asynchronous lifetimes visible in the code.
- Keep modules focused on a coherent responsibility and place them beside the feature they own.
  Keep entrypoints focused on composition and registration; put domain rules in their owning modules.
- Give mutable state one owner. Reuse stores and public contracts, and keep imports acyclic.
  Pass the specific operations a module needs instead of exposing a broad service or mutable state bag.
- Introduce abstractions for demonstrated needs. Explain what they simplify and which callers need
  them. Avoid speculative frameworks, unnecessary indirection, and mechanical file splitting.
- Before adding a dependency, check what the repository already provides. Weigh the behavior it
  supplies against its transitive graph, shipped payload, runtime requirements, and upgrade burden.
  Keep useful libraries when they reduce the code and behavior Acorn must maintain.
- Preserve behavior, persisted data, public contracts, and security boundaries when simplifying.
  Keep changes focused, remove obsolete paths created by the change, and verify observable behavior.

Before handoff, review whether another developer can find the owner, follow the inputs and outputs,
and make a routine change without tracing unrelated code. Explain any complexity the change adds
and why it is needed. Flag broader cleanup separately when it falls outside the task's scope.

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
