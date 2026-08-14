// The loadable-package declaration for this plugin: what `apps/node/scripts/build-plugin.mjs` reads
// to build the bundles and generate `acorn-plugin.json`. It lives here, not in the build script, so
// the plugin's declared surface — its permissions, frames, sources, commands — is visible from the
// plugin's own directory, which is where an author looks first and where a reviewer diffs it.
export default {
  name: 'Rollbar',
  // The Rollbar mark, as one SVG path's `d` in a 24 box. The host validates the grammar and registers
  // it as `brand:rollbar` under the id it stamps from this package's directory, so `glyph:
  // 'brand:rollbar'` in src/server/provider.ts resolves with no client code of ours drawing it. From
  // simple-icons (CC0 artwork; trademark remains Rollbar's).
  icon: { d: 'M24 2.5795c-.0019-.1956-.1152-.5064-.484-.584-.0578-.0162-.1178-.0113-.177-.0104-.3082.0276-4.3793.4162-8.9551 2.4569-2.7478 1.2221-4.8747 3.0984-6.213 5.376l-.3449.1494C2.9271 12.1542 0 16.4046 0 21.338v.0828c0 .3392.2786.5955.5967.5955h16.2625c.1045 0 .2506-.0351.3748-.1391l6.5533-5.5255a.5932.5932 0 0 0 .2116-.4598V2.5795Zm-6.5544 17.5582V8.382l5.3622-4.5195v11.7557ZM7.3684 16.4908h8.885v4.3333H2.227ZM14.868 5.532a30.7234 30.7234 0 0 1 6.5315-2.043L16.6063 7.53a30.4061 30.4061 0 0 0-6.489 1.528c1.1866-1.4487 2.787-2.6501 4.7506-3.5262ZM8.978 10.7722a30.7706 30.7706 0 0 1 7.2753-1.9947v6.5211h-8.494a10.5382 10.5382 0 0 1 1.2187-4.5264zm-1.636.7611a11.8074 11.8074 0 0 0-.7887 4.0826l-5.2886 4.4632c.4-3.6262 2.5535-6.6591 6.0773-8.5458z' },
  entry: '@acorn/plugin-rollbar/node/index.ts',
  factory: 'rollbarPlugin',
  client: {
    entry: './src/frame/index.tsx',
    // A frame owns its realm and bundle, so its Solid graph is intentionally independent from the
    // shell's. The build seam stays framework-agnostic: the builder maps this key to the right Vite
    // transforms, and a React/Vue/vanilla frame names its own framework (or none) here instead.
    framework: 'solid',
  },
  permissions: {
    api: ['core.tasks:read'],
    events: [],
    // `secrets: false` for the same reason linear's is: the provider spends the owner's Rollbar token,
    // but never through `ctx.core.secrets` — core resolves the `integrations` row inside its own secret
    // scope and lends the key for the length of the call. This was `true` for a while, which was a
    // grant with no call site and a trust-prompt line that overstated.
    node: { core: ['projects:read'], capabilities: [], secrets: false, exec: false, net: ['api.rollbar.com'] },
  },
  contributions: {
    frames: [{ target: 'pane', id: 'rollbar', label: 'Rollbar', glyph: 'brand:rollbar', order: 100 }],
    sources: [{
      id: 'rollbar-items',
      label: 'Rollbar',
      glyph: 'brand:rollbar',
      order: 30,
      providerId: 'rollbar',
      items: '/v2/p/rollbar/rail-items',
      onSelect: { verb: 'openPane', pane: 'rollbar' },
    }],
    commands: [{
      id: 'open',
      title: 'Rollbar: open linked items',
      category: 'pane',
      palette: false,
      action: { verb: 'openPane', pane: 'rollbar' },
    }],
    keybindings: [{ command: 'open', defaultChord: 'meta+shift+o', when: 'task' }],
  },
}
