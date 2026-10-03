// The test half of the plugin API: how a plugin's tests reach the host. See docs/plugins/plugin-api.md § The
// plugin API for why this seam exists (every plugin used to forge `as unknown as NodePluginContext`
// literals) and docs/architecture/packages.md § Package boundaries for the node-environment-safe
// rule and the ban on importing testkit/ from production.
//
// Core's table schema and database type appear here: seeding core's `workspaces` to build a fixture
// is legitimate in a test, but a plugin's production code owning core tables still fails the arch
// suite.

// ── A real plugin context ─────────────────────────────────────────────────────────────────────────
// Not a mock: calls the same server/pluginHost/context.ts the host calls at boot, over a temp data root
// (docs/plugins/plugin-api.md § The plugin API). Pass `permissions` for the loaded tier, omit it for the
// built-in tier.
export { makeTestNodeContext, makeTestRequestContext } from '@acorn/node-core/testkit'
// The handle a test holds onto, and nothing else. The options bags stay off: a test passes an object
// literal to the factory and the parameter type does the checking.
export type { TestNodeContext } from '@acorn/node-core/testkit'

// ── Databases, bindings and the auth gate ─────────────────────────────────────────────────────────
// makeTestNodeContext already hands back a migrated core database and an `env`. These are for a test
// that needs one without a plugin context, such as a service or a route mounted on its own Hono app.
// `TEST_ENCRYPTION_KEY` is not here, because `testEnv` bakes it in.
export { makeTestCoreServices, makeTestDb, makeTestPluginDb, testEnv, testSecretEnv } from '@acorn/node-core/testkit'
export type { TestDb, TestPluginDb } from '@acorn/node-core/testkit'
// Seed the principal exactly as authMiddleware would, then run the real requireUser gate:
// `.use('/api/*', ...testGate(principal))`.
export { testGate } from '@acorn/node-core/testkit'
export { seedProviderConnection } from '@acorn/node-core/testkit'
// Core's tables, for seeding fixtures. See the second rule at the top of this file.
export { schema } from '@acorn/node-core/server/db/index.ts'
export type { AppDatabase } from '@acorn/node-core/server/db/index.ts'

// ── The manifest ──────────────────────────────────────────────────────────────────────────────────
// Runs the real manifest schema over `acorn-plugin.config.mjs` (docs/plugins/dev-loop.md § The dev loop), so
// a bad declaration fails in `pnpm test` rather than at the next boot. It takes the package root and
// finds the file itself, so the filename constant and the result type stay its business.
export { validatePluginConfig } from '@acorn/node-core/testkit'
export { testAgentToolDescriptor, testContextSectionDescriptor, testCliCommandDescriptor } from '@acorn/node-core/testkit'

// Host services used to exercise plugin routes without constructing a full Node.
export { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
export { settleBackground } from '@acorn/node-core/server/background.ts'
export { patchBlobKey } from '@acorn/node-core/server/blobs.ts'
export { BridgeError, setRouteTestCapability } from '@acorn/node-core/server/bridge.ts'
export { createTaskService, createProjectService } from '@acorn/node-core/server/core'
export { createCoreServices } from '@acorn/node-core/server/core/index.ts'
export type { CoreServices, GenerateTextRequest, ModelService, ProjectRef } from '@acorn/node-core/server/core/index.ts'
export { SecretService } from '@acorn/node-core/server/core/secrets.ts'
export { isContainedPath, isValidRepoIdent, resolveInRoot, confineExistingFile } from '@acorn/node-core/server/core/fs.ts'
export type { ConfineFailure, ConfineResult } from '@acorn/node-core/server/core/fs.ts'
export { ProviderOperationError, connectionProviderRegistry, connectProvider, rotateConnection, testConnection } from '@acorn/node-core/server/integrations'
export { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
export { onServerError } from '@acorn/node-core/server/respond.ts'
export { harness, setRunBridge } from '@acorn/node-core/server/routes'
export { decryptSecret } from '@acorn/node-core/server/secretBox.ts'
export { rendererBaseCheckout } from '@acorn/node-core/server/worktrees'
export type { Env } from '@acorn/node-core/server/bindings.ts'
export type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
export type { PluginDatabase } from '@acorn/node-core/server/plugins'
export type { RunBridge } from '@acorn/node-core/server/routes'
export type { RunTarget } from '@acorn/node-core/server/runConfig.ts'
