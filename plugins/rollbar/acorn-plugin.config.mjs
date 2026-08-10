// The loadable-package declaration for this plugin: what `apps/node/scripts/build-plugin.mjs` reads
// to build the bundles and generate `acorn-plugin.json`. It lives here, not in the build script, so
// the plugin's declared surface — its permissions, frames, sources, commands — is visible from the
// plugin's own directory, which is where an author looks first and where a reviewer diffs it.
export default {
  name: 'Rollbar',
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
    frames: [{ target: 'pane', id: 'rollbar', label: 'Rollbar', glyph: 'circle-dot', order: 100 }],
    sources: [{
      id: 'rollbar-items',
      label: 'Rollbar',
      glyph: 'circle-dot',
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
