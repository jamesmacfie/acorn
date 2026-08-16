// The test half of the plugin API: how a plugin's TESTS reach the host.
//
// Production plugin code goes through ./node and ./client, and an arch rule enforces it. Test code had
// no equivalent, so every plugin rebuilt the host by hand — deep-importing node-core's internal files
// and forging `as unknown as NodePluginContext` literals that could not fail when the real context
// changed. This is that seam.
//
// Everything below is a RE-EXPORT, like the other entrypoints. Two rules of its own:
//
//   NODE-ENVIRONMENT SAFE. No Solid, no `.tsx`, nothing that touches `window`. A barrel evaluates every
//     module on it, and plugin vitest configs are node-env with `*.test.ts` only — one component import
//     here would make this entrypoint unloadable from the suites it exists to serve.
//   TEST SCAFFOLDING, NOT SURFACE. Things appear here that ./node deliberately refuses: core's table
//     schema, core's database type. A test that seeds core's `workspaces` to build a fixture is
//     legitimate and always will be; a plugin's PRODUCTION code owning core tables is not, and the
//     arch suite still fails that.
//
// The exports are used by tests only — `tools/arch/boundaries.test.ts` fails a production file that
// imports any package's testkit/.

// ── A real plugin context ─────────────────────────────────────────────────────────────────────────
// Not a mock: makeTestNodeContext calls the same server/plugin/context.ts the host calls at boot, over
// a temp data root. Pass `permissions` for the loaded tier, omit it for the built-in tier.
export { makeTestNodeContext, makeTestRequestContext } from '@acorn/node-core/testkit/pluginContext.ts'
// The handle a test holds onto, and nothing else. The two options bags were here too and no suite named
// them — a test passes an object literal to the factory and the parameter type does the checking — so
// they came off with the rest of the prune pass. The test seam gets the same rule as the production
// surface, including the part where it is three days old.
export type { TestNodeContext } from '@acorn/node-core/testkit/pluginContext.ts'

// ── Databases, bindings and the auth gate ─────────────────────────────────────────────────────────
// makeTestNodeContext already hands back a migrated core database and an `env`; these are for a test
// that needs one without a plugin context — a service, a route mounted on its own Hono app.
// `TEST_ENCRYPTION_KEY` is not here: `testEnv` already bakes it in, and the twenty suites that still spell
// `'0'.repeat(64)` reach `testSecretEnv` deep — they are the migration this seam exists for, and the
// constant on its own had no caller either way.
export { makeTestDb, makeTestPluginDb, testEnv, testSecretEnv } from '@acorn/node-core/testkit/db.ts'
export type { TestDb, TestPluginDb } from '@acorn/node-core/testkit/db.ts'
// Seed the principal exactly as authMiddleware would, then run the real requireUser gate:
// `.use('/api/*', ...testGate(principal))`.
export { testGate } from '@acorn/node-core/testkit/auth.ts'
export { seedProviderConnection } from '@acorn/node-core/testkit/integration.ts'
// Core's tables, for seeding fixtures. See the second rule at the top of this file.
export { schema } from '@acorn/node-core/server/db/index.ts'
export type { AppDatabase } from '@acorn/node-core/server/db/index.ts'

// ── The manifest ──────────────────────────────────────────────────────────────────────────────────
// Run the real schema over `acorn-plugin.config.mjs`, so a bad declaration fails in `pnpm test` rather
// than at the next boot. It takes the package root and finds the file itself, so the filename constant and
// the result type are its business, not a caller's — both came off in the prune pass.
export { validatePluginConfig } from '@acorn/node-core/testkit/manifest.ts'

