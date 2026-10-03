# acorn engineering guide

[docs/README.md](./docs/README.md) is the index: it names every document under `docs/`, grouped by
kind, and says which one owns what. Start there.
[docs/architecture-overview.md](./docs/architecture-overview.md) holds the runtimes and the contracts
between them, and [docs/conventions.md](./docs/conventions.md) holds the naming rules — where a new
file goes and what it is called. Design material for work that has not shipped lives under
`docs/future/`, whose README indexes every programme and single file.

Before changing code, identify the owning runtime and trace data from its source through the Node API,
protocol, broker, client cache, and UI consumer. Preserve the Node/shell and plugin boundaries,
use the contribution and capability seams, and update the owning documentation when behavior
or a contract changes.

Run `pnpm lint` and the relevant tests before handing work back. `pnpm lint` is oxlint followed by
`tsc --noEmit` in every package. The oxlint config is deliberately narrow (dead code and the
`node:` protocol) because a linter arguing about style on day one is one people learn to ignore.
For the whole suite, use `pnpm test`, not `turbo run test` directly: it keeps Turborepo's concurrency
bound, and without that bound the tests that spawn processes or mint certificates time out under the
load while passing in isolation. For the desktop shell alone, use
`pnpm --filter @acorn/desktop test`, which stages the bundle inputs and then runs the boot test and
the Rust suite.

During iteration, run an explicit file or named test with
`pnpm test:focus <package> <file-filter> [-t <test-name>]`. It prepares the native module once,
caps Vitest workers, and fails when the selection runs no tests. Before handoff, run the affected
package suites and the uncached architecture suite for changes to plugin or renderer source shape;
see [docs/testing.md](./docs/testing.md#focused-agent-runs) for the exact scopes. A narrow run does
not verify dependent consumers. Keep the `pnpm lint` and relevant-test handoff requirement above.

When a change affects the desktop UI, test it in the real Tauri window on a graphical host. Run
`pnpm dev:agent -- --session <name>`; it uses isolated data and ports and adds the current checkout as
a local project, so neither the onboarding wizard nor GitHub login blocks the test. In another
terminal, run `pnpm dev:agent:ui -- --session <name> snapshot`, then use `click`, `fill`, and
`screenshot` with the returned element references. Run `snapshot` again after each UI transition and
finish with `pnpm dev:agent:ui -- --session <name> stop`. Use `--onboarding` when the wizard is the
subject and `pnpm dev:agent:smoke` to verify the automation path itself. This driver covers the main
renderer, not native menus and dialogs or host-owned child webviews; use native computer-use control
or the release checklist for those surfaces. See [docs/local-development.md](./docs/local-development.md)
for the full workflow.

When a change affects the terminal UI, run it in the isolated PTY driver. Start
`pnpm dev:tui:agent -- --session <name> --fixture tui-navigation`; in another terminal, use
`pnpm dev:tui:agent:ui -- --session <name> snapshot` after each navigation step, `press` to send keys,
and `resize 120 40` to check the wider layout. Run
`pnpm dev:tui:agent:flow -- --session <name> navigation` for the repeatable path, then
`pnpm dev:tui:agent:ui -- --session <name> stop`. To compare shared content with the desktop, start
`pnpm dev:agent -- --session <other-name> --fixture tui-navigation` with the same profile and seed.
See [docs/local-development.md](./docs/local-development.md#agent-driven-terminal-development) for
the commands, reports, and limits of the text snapshots.
