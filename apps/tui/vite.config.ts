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
  id === 'solid-js' || id.startsWith('solid-js/') || id.startsWith('@tanstack/') || id.startsWith('@opentui/solid')
// Aliased to something local, so it must not be externalized first: the `external` callback sees the
// raw specifier and a `true` there wins before `resolve.alias` runs, which left `@solidjs/router` in the
// output as a bare import of a package this host deliberately does not have
// (src/kit/router.ts, docs/future/terminal/phase-6-panes-sweep.md).
const isAliased = (id: string) => id === '@solidjs/router' || id === 'lucide-static/icon-nodes.json'
  || id.startsWith('@acorn/plugin-api/ui')
const externalizeBareImports = (id: string) =>
  !id.startsWith('.') && !isAbsolute(id) && !isWorkspacePackage(id) && !isReactiveRuntime(id) && !isAliased(id)

export default defineConfig({
  resolve: {
    conditions: ['node'],
    // Anchored patterns rather than the object form, which matches by prefix and would rewrite
    // `solid-js/dist/solid.js` again, forever.
    alias: [
      { find: /^@acorn\/plugin-api\/ui$/, replacement: resolve(import.meta.dirname, 'src/kit/ui.ts') },
      // …and the host's own surfaces beside it. `ui/host` is the palette chrome, the drawer, the
      // reference-panel box and the two cooperative-extension nodes, and the DOM's copies of them are
      // portals and `<ul>`s (src/kit/host.tsx).
      { find: /^@acorn\/plugin-api\/ui\/host$/, replacement: resolve(import.meta.dirname, 'src/kit/host.tsx') },
      // …and the editor surface, which on this host is a stub. The facade's real half is CodeMirror's
      // theme and a grammar per language, and cells have neither: the `editor` rectangle draws the
      // file read-only and hands `$EDITOR` a PTY (src/kit/rectangle.tsx). Left unaliased, the editor
      // pane pulled seventeen grammars into a process that never highlights (src/kit/editor.ts).
      { find: /^@acorn\/plugin-api\/ui\/editor$/, replacement: resolve(import.meta.dirname, 'src/kit/editor.ts') },
      // lucide's icon geometry, removed rather than replaced: 706 KB of SVG paths, and this host has
      // no SVG. Left alone it is externalised, and Node's loader refuses a JSON module with no import
      // attribute on it (src/kit/iconNodes.ts).
      //
      // Both halves of it, because client-core splits the set: the census's eager map is a relative
      // JSON import and would be inlined into this bundle rather than externalised, which is the same
      // 16 KB of paths nobody here can draw (client-core kit/tokens/iconNodes.ts).
      { find: /^lucide-static\/icon-nodes\.json$/, replacement: resolve(import.meta.dirname, 'src/kit/iconNodes.ts') },
      { find: /^\.\/iconNodes\.eager\.json$/, replacement: resolve(import.meta.dirname, 'src/kit/iconNodes.ts') },
      // The router, removed rather than replaced. `@solidjs/router` reads `window.history.state` at
      // module scope, so a pane that imports it cannot even be loaded here, and there is no URL behind
      // it to answer with (src/kit/router.ts).
      { find: /^@solidjs\/router$/, replacement: resolve(import.meta.dirname, 'src/kit/router.ts') },
      // Solid's `node` export condition is its server renderer, which has no reactivity. Every
      // consumer that runs Solid on a real Node process points at the client build instead; OpenTUI's
      // own Node harness does the same (references/opentui/packages/solid/scripts/solid-transform.ts).
      { find: /^solid-js$/, replacement: 'solid-js/dist/solid.js' },
      { find: /^solid-js\/store$/, replacement: 'solid-js/store/dist/store.js' },
      // The reconciler, with loose text wrapped on the way in. `src/kit/reconciler.ts` re-exports all of
      // `@opentui/solid` and replaces one function, and it is aliased rather than imported because the
      // Solid transform emits its calls by module name (`moduleName` below) — so this is the only way
      // to sit in front of every one of them, including the ones client-core's own components make.
      //
      // Absolute inside it, because client-core's components are compiled with this transform too and
      // reach for the reconciler from a package that does not depend on it. They are not drawn here —
      // the TUI has its own kit and its own layouts — but they are in the graph, so they have to
      // resolve, and they have to resolve to the same instance.
      { find: /^@opentui\/solid$/, replacement: resolve(import.meta.dirname, 'src/kit/reconciler.ts') },
      // …and the real one behind it, which only `src/kit/reconciler.ts` names.
      { find: /^@opentui\/solid\/index\.js$/, replacement: fileURLToPath(import.meta.resolve('@opentui/solid')) },
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
        // The golden set, its own entry beside the screenshot for the same reason the screenshot has
        // one: it is a script Node runs by path, so its name has to be stable
        // (src/captureGolden.tsx). It goes with the goldens in phase 4.
        captureGolden: resolve(import.meta.dirname, 'src/captureGolden.tsx'),
        // The plugin sandbox's bootstrap, emitted beside `main.js` because a worker is pointed at it
        // by path and it has to be one file a thread with almost no filesystem can read. Its own
        // entry rather than a chunk, so its name is stable and `workerFactory.ts` can spell it.
        pluginWorker: resolve(import.meta.dirname, 'src/plugins/pluginWorker.js'),
      },
      external: (id: string) => externalizeBareImports(id) || builtinModules.includes(id.replace(/^node:/, '')),
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
})
