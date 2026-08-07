// Register the built-in integration providers directly into the core registries, for integration tests.
//
// TEST-ONLY, and it exists because production no longer has an equivalent: each provider plugin registers
// its own descriptor from `init` through `ctx.providers` now, so apps/node/src/server/providers.ts is
// gone. A suite that only wants a registered provider (to assert a route's behaviour, or a codec's
// conformance) should not have to boot the whole plugin host, open four SQLite files and start a PTY
// engine to get one.
//
// Imported from each test rather than Vitest global setup so a suite's `vi.mock` declarations hoist before
// provider modules are loaded.
//
// Suites that assert the assembled MOUNT TABLE must NOT use this — they run `initPlugins` over the real
// plugin list, which is where the provider routers come from now.
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations/connectionRegistry.ts'
import { integrationProviderRegistry } from '@acorn/node-core/server/integrations/registry.ts'
import { githubProvider } from '@acorn/plugin-github/server/provider.ts'
import { linear } from '@acorn/plugin-linear/server/routes/linear.ts'
import { linearProvider } from '@acorn/plugin-linear/server/provider.ts'
import { rollbar } from '@acorn/plugin-rollbar/server/routes/rollbar.ts'
import { rollbarProvider } from '@acorn/plugin-rollbar/server/provider.ts'

// Idempotent: several suites in one vitest worker may import this, and the registries throw on a
// duplicate id. Keyed on the registry's own state rather than a local flag so it stays correct if a
// suite registers one provider itself.
for (const provider of [githubProvider, linearProvider, rollbarProvider]) {
  if (integrationProviderRegistry.get(provider.id)) continue
  connectionProviderRegistry.register(provider)
  integrationProviderRegistry.register(provider)
}
for (const [providerId, router] of [
  ['linear', linear],
  ['rollbar', rollbar],
] as const) {
  if (integrationProviderRegistry.routes().some((r) => r.providerId === providerId)) continue
  integrationProviderRegistry.registerRoute({ providerId, prefix: '', router })
}
