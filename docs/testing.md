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
  package-local fixtures. Every plugin's `vitest.config.ts` is one line re-exporting
  `plugins/vitest.shared.ts` (node environment, `src/**/*.test.ts`, git config neutralized), and the
  testkit resolves a plugin's migration chain from its id — `makeTestPluginDb('github')` and
  `makeTestNodeContext({ plugin })` find `plugins/<id>/migrations` themselves;
- architecture tests scan the package graph for forbidden imports, undeclared dependencies, cycles,
  Electron leakage, protocol impurity, and non-contract plugin edges;
- loadability tests EXECUTE the two rules that keep the workspace bootable, because a rule about
  whether something loads is honestly checked only by loading it:
  `packages/plugin-api/src/entrypoints.test.ts` imports every node-safe facade entrypoint in a
  node-environment vitest worker (the same shape a plugin's own suite runs in), and
  `apps/node/test/integration/mainBarrelLoad.test.ts` imports every plugin main barrel in a plain Node
  child. The arch suite's text checks stay as a fast, precise first line, but they are no longer the
  only line — and neither owns a file allowlist any more;
- desktop integration tests cover broker, fleet, persistence, plugin activation, and native seams;
- Playwright covers boot, onboarding, restore, task navigation, WebSocket terminal behavior, search,
  preview, restart, security settings, and the two-Node fleet path.

## Composition-root tests

Tests that require populated plugin registries belong under `apps/node/test/integration` or the
desktop integration tree. Route protection must be tested through the real `createApp()` factory,
not by mounting middleware only in the test. Standalone parity tests ensure `dev:node` wires the same
pure-Node feature capabilities as the supervised Node.

## Testkit

`@acorn/node-core`'s testkit (`packages/node-core/src/testkit/`) used to be three files sitting under
`server/routes/`, because that is where a test-only SQLite factory was first needed. None of the three
were routes, and eleven packages ended up importing test scaffolding through a path that reads like
production surface. The directory move made the import path say what it is: every
`@acorn/node-core/testkit/...` import is test scaffolding by construction, and the arch suite fails a
production file that reaches one (docs/architecture-overview.md § Package boundaries). See
[plugins.md § What is published, and what acorn promises about it](./plugins.md) for why
`makeTestNodeContext` and `makeTestRequestContext` build a real host context rather than a mock.

`testEnv()` builds the `c.env` bindings a route test needs. `testSecretEnv()` and
`TEST_ENCRYPTION_KEY` mint the raw session key and the `SecretService` binding it seals together, as a
pair, because a test that sets only one of them compiles and then fails at the first credential read;
every test in the repo uses the same 64-hex key so a test can seal a credential with the same key the
`Env` it built is using.

`workspacePluginMigrations()` and `makeTestPluginDb()` resolve a workspace plugin's Drizzle migration
chain from its id, as `<checkout>/plugins/<id>/migrations`. They replaced about twenty call sites that
spelled out a path the id already implies, and the eight per-plugin `migrations.ts` modules that used
to do the same job. This only works from a source checkout, so a plugin developed outside this
checkout passes its migrations folder explicitly. The `plugins/<id>/` segment is spelled out rather
than found by walking up from the caller, so it can never resolve to core's own migration chain at
`packages/node-core/migrations`, which a bare ancestor walk would find first.

## Reliability

The suite launches Git, PTYs, Docker probes, provider fakes, and Node children. A full run is
resource-sensitive; verify a failing package in isolation before changing production timeouts. Do
not weaken runtime limits to accommodate a saturated test runner.

### Known pre-existing failures

Verified on a clean tree. If you see exactly these and nothing else, your change is not the cause:

- `apps/node/test/integration/serviceSpawn.test.ts` and `standaloneShutdown.test.ts` fail in some
  environments with `SyntaxError: The requested module 'electron' does not provide an export named
  'dialog'`, from `plugins/terminal/src/main/folderPickerIpc.ts` — which the standalone
  (Electron-free) node still pulls in through the terminal plugin's main entry. That class of failure
  now has a test of its own: `apps/node/test/integration/mainBarrelLoad.test.ts` loads every
  `plugins/*/src/main/index.ts` in a plain `node --import tsx` child and fails with the barrel name
  and the missing export, so it breaks at the commit that causes it rather than as a puzzling red in
  two unrelated suites.
- One live-PTY `posix_spawnp` failure in `agentSend` tests, a native-module ABI artefact.
  `pnpm rebuild:node` fixes the ABI class of failure; this one survives it.

Also worth knowing before you read a red gate as your own: the root `lint` script is
`oxlint && turbo run lint`, so an oxlint failure means `tsc --noEmit` never ran at all. Check
which half failed before assuming the types are fine — or run `pnpm lint:types` on its own.

## Non-vacuity

Tests that assert source shape or route mounting must fail when the behavior is removed. Boundary and
parity tests include explicit graph/literal checks, while source-text tests strip comments before
matching implementation calls.

The snapshot-backed lists are the case that needs saying out loud, because a file you can regenerate looks
like one you can launder a regression past. `packages/plugin-api/src/surface.snapshot.txt` and the four
plugin golden lists (docs/plugins.md § The golden lists) are all asserted with exact equality against a
committed file, never a subset — a contribution that silently VANISHES has to fail as loudly as one that
appears — and each carries a hand-written floor beside it, because an exact match against an empty snapshot
would otherwise pass. Regeneration is deliberate, behind an env flag, and the diff is the review surface.

The facade snapshot goes one step further, because its file is a published contract rather than an internal
list: its first line records the `PLUGIN_API_MAJOR` it was written under, and `UPDATE_SURFACE=1` REFUSES to
write a snapshot that has lost a name while that major is unchanged. Adding is free; removing has to move
the number, which every plugin package pins by exact string match. It is the one regeneration in the repo
that can say no.
