# acorn engineering guide

Architecture and runtime contracts are in
[docs/architecture-overview.md](./docs/architecture-overview.md) and the topic docs beneath `docs/`.
Design and migration material lives under `docs/third-party/` (the loaded-plugin record and
remaining work) and `docs/future/` (its README indexes every programme and single file).

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
