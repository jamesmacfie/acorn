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
  // The plural feeder, and the reason it exists: one package, two brands, so a single `icon` could not
  // carry both. Keys become the suffix in `brand:model-providers/<key>`; the host stamps the prefix
  // from this package's directory, so these can no more claim another plugin's mark than `icon` could.
  //
  // Worth noting alongside the "no client bundle" point above: this is the clearest demonstration that
  // a logo has to be DATA and not a component. There is no client code here to render one, and the
  // marks still reach the integrations list.
  //
  // Both from simple-icons (CC0 artwork; trademarks remain their owners'). OpenAI's was withdrawn from
  // that project after the version below, so it is taken from tag 14.0.0 rather than master.
  icons: {
    openai: { d: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z' },
    anthropic: { d: 'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z' },
  },
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
