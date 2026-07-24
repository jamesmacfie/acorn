// App-layer activation: register the built-in integration providers (descriptors + their HTTP
// routers) into the core registry. The ONE place naming the provider plugins. Composition roots
// import it at boot; provider unit tests import it in-graph (so their vi.mock of a provider module
// hoists above this registration). It is deliberately NOT in the vitest global setup — a global
// pre-load would defeat those mocks. Adding a provider is a one-line edit here (docs/plugins.md).
import { integrationProviderRegistry } from '../../core/server/integrations/registry'
import { connectionProviderRegistry } from '../../core/server/integrations/connectionRegistry'
import { modelProviderRegistry } from '../../core/server/modelProviders/registry'
import { linear } from '../../plugins/linear/server/routes/linear'
import { rollbar } from '../../plugins/rollbar/server/routes/rollbar'
import { githubProvider } from '../../plugins/github/server/provider'
import { linearProvider } from '../../plugins/linear/server/provider'
import { rollbarProvider } from '../../plugins/rollbar/server/provider'
import {
  openAIConnectionProvider,
  openAIModelProvider,
} from '../../plugins/model-providers/server/openai'
import {
  anthropicConnectionProvider,
  anthropicModelProvider,
} from '../../plugins/model-providers/server/anthropic'

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
