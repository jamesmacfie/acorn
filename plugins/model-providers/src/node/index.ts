// The model-providers plugin's node part (docs/plugins.md § The plugin API; docs/integrations.md
// § Model providers covers the adapter shape, the missing generic HTTP endpoint, and the
// connection-before-model registration order this file follows).
//
// Replaces six calls in apps/node/src/server/providers.ts: two connection-provider registrations
// and two model-adapter registrations, plus the two imports that made the composition root name
// this package.
//
// This ships as a loaded package, so a grep of apps/node/src/server/plugins.ts will not find it.
// The manifest row is in apps/node/scripts/build-plugin.mjs and the distribution roster is in
// apps/desktop/scripts/build-bundled-plugins.mjs. Nothing below changes across that boundary:
// ctx.providers.connection and ctx.providers.model are identical for both tiers. There is no
// client bundle, so no device ever has interface code of ours to trust.
//
// No database and no routes: this plugin only turns a stored credential into an OpenAI or
// Anthropic HTTP call, and nothing here is persisted. The credential is core's integrations row,
// read inside a secret scope.
//
// Not `required`: a node with no AI features configured loses nothing. Turning it off unregisters
// both connection providers, so they vanish from the integrations settings list, and
// CoreServices.models.generateText fails closed for a connection whose adapter is gone, which is
// the honest degradation since nothing is left that could service the request.
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
