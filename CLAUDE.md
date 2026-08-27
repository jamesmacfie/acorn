# acorn engineering guide

Architecture and runtime contracts are in
[docs/architecture-overview.md](./docs/architecture-overview.md) and the topic docs beneath `docs/`.
Design and migration material lives under `docs/third-party/` (the loaded-plugin record and
remaining work), `docs/future/`, and `docs/smolforge/`.

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
