// App-layer activation: register the built-in integration providers (descriptors + their HTTP
// routers) into the core registry. The ONE place naming the provider plugins. Composition roots
// import it at boot; provider unit tests import it in-graph (so their vi.mock of a provider module
// hoists above this registration). It is deliberately NOT in the vitest global setup — a global
// pre-load would defeat those mocks. Adding a provider is a one-line edit here (docs/plugins.md).
import { integrationProviderRegistry } from '@acorn/node-core/server/integrations/registry.ts'
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations/connectionRegistry.ts'
import { modelProviderRegistry } from '@acorn/node-core/server/modelProviders/registry.ts'
import { linear } from '@acorn/plugin-linear/server/routes/linear.ts'
import { rollbar } from '@acorn/plugin-rollbar/server/routes/rollbar.ts'
import { githubProvider } from '@acorn/plugin-github/server/provider.ts'
import { linearProvider } from '@acorn/plugin-linear/server/provider.ts'
import { rollbarProvider } from '@acorn/plugin-rollbar/server/provider.ts'
import {
  openAIConnectionProvider,
  openAIModelProvider,
} from '@acorn/plugin-model-providers/server/openai.ts'
import {
  anthropicConnectionProvider,
  anthropicModelProvider,
} from '@acorn/plugin-model-providers/server/anthropic.ts'

export const builtInIntegrationProviders = [githubProvider, linearProvider, rollbarProvider] as const
export const builtInModelConnectionProviders = [
  openAIConnectionProvider,
  anthropicConnectionProvider,
] as const
export const builtInModelProviders = [openAIModelProvider, anthropicModelProvider] as const

for (const provider of builtInIntegrationProviders) {
  connectionProviderRegistry.register(provider)
  integrationProviderRegistry.register(provider)
}
for (const provider of builtInModelConnectionProviders) {
  connectionProviderRegistry.register(provider)
}
for (const provider of builtInModelProviders) {
  modelProviderRegistry.register(provider)
}

integrationProviderRegistry.registerRoute({ providerId: 'linear', prefix: '/linear', router: linear })
integrationProviderRegistry.registerRoute({ providerId: 'rollbar', prefix: '/rollbar', router: rollbar })
