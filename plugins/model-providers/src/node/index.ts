// The model-providers plugin's node part. For the adapter shape, the missing generic HTTP endpoint,
// and the connection-before-model registration order this file follows, see docs/integrations.md
// § Model providers.
//
// This ships as a loaded package, so a grep of apps/node/src/server/plugins.ts will not find it. The
// manifest row is in apps/node/scripts/build-plugin.mjs and the distribution roster is in
// apps/desktop/scripts/build-bundled-plugins.mjs. Nothing below changes across that boundary:
// ctx.providers.connection and ctx.providers.model are identical for both tiers. There is no client
// bundle, so no device holds interface code of ours.
//
// No database and no routes. This plugin turns a stored credential into an OpenAI or Anthropic HTTP
// call and persists nothing. The credential is core's integrations row, read inside a secret scope.
//
// Not `required`: a node with no AI features configured loses nothing. Turning it off unregisters
// both connection providers, so they leave the integrations settings list, and
// CoreServices.models.generateText fails closed for a connection whose adapter is gone.
import type { NodePlugin } from '@acorn/plugin-api/node'
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
