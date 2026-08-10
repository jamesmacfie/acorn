// The loadable-package declaration for this plugin: what `apps/node/scripts/build-plugin.mjs` reads
// to build the bundle and generate `acorn-plugin.json`. It lives here, not in the build script, so
// the plugin's declared surface is visible from the plugin's own directory.
//
// The smallest thing this file can describe, and the two absences are the interesting part.
//
// No `client` key, because there is no frame — the plugin registers two connection providers and two
// model adapters and stops. Nothing of it executes on the device, so no client bundle is built, no
// hash is cached, and no trust prompt is ever raised; the integrations settings list is drawn by the
// host from the connection providers the node reports, exactly as it was when this was compiled in.
//
// `secrets: false`, because the adapter never fetches a credential. Core resolves the `integrations`
// row inside its own secret scope and hands `generateText` the key, so `ctx.core.secrets` would be a
// grant with no call site. The plugin touches no CoreServices facet at all, hence `core: []`.
//
// And no routes, so `contributions: {}` — a consumer owns its own route and calls
// `CoreServices.models.generateText`; see the header of plugins/model-providers/src/node/index.ts
// for why a generic model endpoint is deliberately absent.
export default {
  name: 'Model Providers',
  entry: '@acorn/plugin-model-providers/node/index.ts',
  factory: 'modelProvidersPlugin',
  permissions: {
    api: [],
    events: [],
    // These two are where the SDKs go by default, and a stored connection cannot redirect them: the
    // provider declares one `apiKey` field and normalizes to an empty `config`, so there is no
    // user-supplied base URL. The PROCESS environment can still redirect both — `openai` reads
    // OPENAI_BASE_URL and `@anthropic-ai/sdk` reads ANTHROPIC_BASE_URL — and since `net` is
    // disclosure rather than enforcement, that is worth saying here rather than leaving a reader to
    // conclude the list is exhaustive.
    node: { core: [], capabilities: [], secrets: false, exec: false, net: ['api.openai.com', 'api.anthropic.com'] },
  },
  contributions: {},
}
