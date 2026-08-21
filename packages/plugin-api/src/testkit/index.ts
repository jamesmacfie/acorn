// The test half of the plugin API: how a plugin's tests reach the host. See docs/plugins.md § The
// plugin API for why this seam exists (every plugin used to forge `as unknown as NodePluginContext`
// literals) and docs/architecture-overview.md § Package boundaries for the node-environment-safe
// rule and the ban on importing testkit/ from production.
//
// Core's table schema and database type appear here: seeding core's `workspaces` to build a fixture
// is legitimate in a test, but a plugin's production code owning core tables still fails the arch
// suite.

// ── A real plugin context ─────────────────────────────────────────────────────────────────────────
// Not a mock: calls the same server/plugin/context.ts the host calls at boot, over a temp data root
// (docs/plugins.md § The plugin API). Pass `permissions` for the loaded tier, omit it for the
// built-in tier.
export { makeTestNodeContext, makeTestRequestContext } from '@acorn/node-core/testkit/pluginContext.ts'
// The handle a test holds onto, and nothing else. The two options bags were here too, and no suite
// named them: a test passes an object literal to the factory and the parameter type does the
// checking, so they came off with the rest of the prune pass.
export type { TestNodeContext } from '@acorn/node-core/testkit/pluginContext.ts'

// ── Databases, bindings and the auth gate ─────────────────────────────────────────────────────────
// makeTestNodeContext already hands back a migrated core database and an `env`; these are for a
// test that needs one without a plugin context, such as a service or a route mounted on its own
// Hono app. `TEST_ENCRYPTION_KEY` is not here: `testEnv` already bakes it in, and the twenty suites
// that still spell `'0'.repeat(64)` reach `testSecretEnv` deep. They are the migration this seam
// exists for; the constant on its own had no caller either way.
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
// Runs the real manifest schema over `acorn-plugin.config.mjs` (docs/plugins.md § The dev loop), so
// a bad declaration fails in `pnpm test` rather than at the next boot. It takes the package root and
// finds the file itself, so the filename constant and the result type are its business, not a
// caller's; both came off in the prune pass.
export { validatePluginConfig } from '@acorn/node-core/testkit/manifest.ts'

