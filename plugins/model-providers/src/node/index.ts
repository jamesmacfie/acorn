// The model-providers plugin's node part (docs/plugins.md § The plugin API).
//
// Replaces six calls in apps/node/src/server/providers.ts: two connection-provider registrations and two
// model-adapter registrations, plus the two imports that made the composition root name this package.
//
// **No database and no routes**, and both absences are the design rather than a gap. This plugin is
// adapters: it turns "generate text with this stored credential" into an OpenAI or Anthropic HTTP call.
// Consumers own their own route and call `CoreServices.models.generateText` — there is deliberately no
// generic model HTTP endpoint, because one would be an un-budgeted proxy to whatever the caller asked for.
// Nothing is persisted here; the credential is core's `integrations` row, read inside a secret scope.
//
// Not `required`: a node with no AI features configured loses nothing. Turning it off unregisters both
// connection providers, so they vanish from the integrations settings list and
// `CoreServices.models.generateText` fails closed for a connection whose adapter is gone — which is the
// honest degradation, since there is nothing left that could service the request.
//
// CONNECTION BEFORE MODEL, per pair, is load-bearing: `modelProviderRegistry.register` refuses an adapter
// naming an unregistered connection provider, and it also checks that the provider declares
// `textGeneration`. Registering them in the wrong order fails the boot rather than silently producing a
// provider that cannot generate.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { anthropicConnectionProvider, anthropicModelProvider } from '../server/anthropic'
import { openAIConnectionProvider, openAIModelProvider } from '../server/openai'

export const modelProvidersPlugin = (): NodePlugin => ({
  name: 'model-providers',
  init: (ctx) => {
    ctx.providers.connection(openAIConnectionProvider)
    ctx.providers.model(openAIModelProvider)
    ctx.providers.connection(anthropicConnectionProvider)
    ctx.providers.model(anthropicModelProvider)
  },
})
