# Testing

Tests are organized by runtime and boundary. The suite uses real temporary SQLite roots, real TLS
listeners, and real child processes where those seams are part of the behavior.

## Commands

```sh
pnpm lint
pnpm test
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/desktop test:e2e
pnpm db:check
```

`pnpm test` rebuilds native modules for plain Node and runs Vitest through Turborepo with bounded
concurrency. The desktop e2e package builds the service artifact and desktop output before Playwright;
running Playwright directly can exercise stale output.

## Test layers

- protocol tests validate Zod contracts, route builders, query keys, errors, and service messages;
- Node-core tests cover data roots, TLS, auth, pairing, idempotency, migrations, backups, audit,
  worktrees, process/filesystem guards, routes, and WebSocket behavior;
- plugin tests cover schemas, providers, route behavior, reconciliation, and client models using
  package-local fixtures;
- architecture tests scan the package graph for forbidden imports, undeclared dependencies, cycles,
  Electron leakage, protocol impurity, and non-contract plugin edges;
- desktop integration tests cover broker, fleet, persistence, plugin activation, and native seams;
- Playwright covers boot, onboarding, restore, task navigation, WebSocket terminal behavior, search,
  preview, restart, security settings, and the two-Node fleet path.

## Composition-root tests

Tests that require populated plugin registries belong under `apps/node/test/integration` or the
desktop integration tree. Route protection must be tested through the real `createApp()` factory,
not by mounting middleware only in the test. Standalone parity tests ensure `dev:node` wires the same
pure-Node feature capabilities as the supervised Node.

## Reliability

The suite launches Git, PTYs, Docker probes, provider fakes, and Node children. A full run is
resource-sensitive; verify a failing package in isolation before changing production timeouts. Do
not weaken runtime limits to accommodate a saturated test runner.

### Known pre-existing failures

Verified on a clean tree. If you see exactly these and nothing else, your change is not the cause:

- `apps/node/test/integration/serviceSpawn.test.ts` and `standaloneShutdown.test.ts` fail in some
  environments with `SyntaxError: The requested module 'electron' does not provide an export named
  'dialog'`, from `plugins/terminal/src/main/folderPickerIpc.ts` — which the standalone
  (Electron-free) node still pulls in through the terminal plugin's main entry.
- One live-PTY `posix_spawnp` failure in `agentSend` tests, a native-module ABI artefact.
  `pnpm rebuild:node` fixes the ABI class of failure; this one survives it.

Also worth knowing before you read a red gate as your own: the root `lint` script is
`oxlint && turbo run lint`, so an oxlint failure means `tsc --noEmit` never ran at all. Check
which half failed before assuming the types are fine — or run `pnpm lint:types` on its own.

## Non-vacuity

Tests that assert source shape or route mounting must fail when the behavior is removed. Boundary and
parity tests include explicit graph/literal checks, while source-text tests strip comments before
matching implementation calls.
