import { builtinModules } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// The terminal client's bundle. Shaped after apps/node's config, because the output is the same kind
// of thing: one ES module run by Node, with every bare import left to the runtime.
//
// Three things make it the TUI rather than the desktop:
//
//   - `generate: 'universal'` sends Solid's JSX to OpenTUI's reconciler instead of to the DOM.
//   - `__ACORN_HOST__` is `'tui'`, which is what `Only` and `Fallback` read (client-core
//     kit/tokens/support.ts).
//   - `@acorn/plugin-api/ui` resolves to this package's kit. A compiled pane imports the kit through
//     that facade and nothing else, so aliasing the facade is the whole host switch for it. Mirrored
//     in tsconfig.json's `paths`.
const isWorkspacePackage = (id: string) => id.startsWith('@acorn/')
// Anything that touches Solid's reactive graph is bundled rather than left to Node, so there is
// exactly one copy of it. Two reasons, and they bite differently:
//
//   - `solid-js` resolves to its server renderer under the `node` condition, which has no reactivity.
//   - A second copy is a second graph and a second set of contexts, which fails as
//     "No renderer found" from inside a component that is plainly under the provider. `@opentui/solid`
//     holds the renderer in a Solid context, so it has to share the instance too.
//
// pnpm-workspace.yaml's catalog says the same thing about solid-js for the same reason.
// `@opentui/core` stays external: it is the native half, and bundling it would not help.
const isReactiveRuntime = (id: string) =>
  id === 'solid-js' || id.startsWith('solid-js/') || id.startsWith('@tanstack/') || id === '@opentui/solid'
const externalizeBareImports = (id: string) =>
  !id.startsWith('.') && !isAbsolute(id) && !isWorkspacePackage(id) && !isReactiveRuntime(id)

export default defineConfig({
  resolve: {
    conditions: ['node'],
    // Anchored patterns rather than the object form, which matches by prefix and would rewrite
    // `solid-js/dist/solid.js` again, forever.
    alias: [
      { find: '@acorn/plugin-api/ui', replacement: resolve(import.meta.dirname, 'src/kit/ui.ts') },
      // Solid's `node` export condition is its server renderer, which has no reactivity. Every
      // consumer that runs Solid on a real Node process points at the client build instead; OpenTUI's
      // own Node harness does the same (references/opentui/packages/solid/scripts/solid-transform.ts).
      { find: /^solid-js$/, replacement: 'solid-js/dist/solid.js' },
      { find: /^solid-js\/store$/, replacement: 'solid-js/store/dist/store.js' },
      // Absolute, because client-core's own components are compiled with this transform too and reach
      // for the reconciler from a package that does not depend on it. They are not drawn here — the
      // TUI has its own kit and its own layouts — but they are in the graph, so they have to resolve.
      { find: /^@opentui\/solid$/, replacement: fileURLToPath(import.meta.resolve('@opentui/solid')) },
    ],
  },
  plugins: [solid({ solid: { generate: 'universal', moduleName: '@opentui/solid' } })],
  ssr: { noExternal: true },
  define: { __ACORN_HOST__: '"tui"' },
  build: {
    target: 'node22',
    outDir: 'dist',
    ssr: true,
    modulePreload: false,
    copyPublicDir: false,
    reportCompressedSize: false,
    minify: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/main.tsx'),
        capture: resolve(import.meta.dirname, 'src/capture.tsx'),
      },
      external: (id: string) => externalizeBareImports(id) || builtinModules.includes(id.replace(/^node:/, '')),
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
})
