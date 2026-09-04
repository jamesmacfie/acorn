import { builtinModules } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// The terminal client's bundle. Shaped after apps/node's config, because the output is the same kind
// of thing: one ES module run by Node, with every bare import left to the runtime.
//
// Three things make it the TUI rather than the desktop:
//
//   - `generate: 'universal'` sends Solid's JSX to our own tree module instead of to the DOM.
//   - `__ACORN_HOST__` is `'tui'`, which is what `Only` and `Fallback` read (client-core
//     kit/tokens/support.ts).
//   - `@acorn/plugin-api/ui` resolves to this package's kit. A compiled pane imports the kit through
//     that facade and nothing else, so aliasing the facade is the whole host switch for it. Mirrored
//     in tsconfig.json's `paths`.

// Where every JSX call in the process goes.
//
// `generate: 'universal'` below sends them — client-core's components and a sandboxed plugin's
// included — to the module named in `moduleName`, and that name is this path. Named by its own path
// rather than by a bare specifier with an alias behind it, because an alias is a second place to
// look and there is nothing left to switch between: plain objects, Yoga through wasm, a cell buffer
// (src/tree/renderer.ts, docs/future/terminal-rewrite/architecture.md).
const RECONCILER = resolve(import.meta.dirname, 'src/tree/renderer.ts')

const isWorkspacePackage = (id: string) => id.startsWith('@acorn/')
// Anything that touches Solid's reactive graph is bundled rather than left to Node, so there is
// exactly one copy of it. Two reasons, and they bite differently:
//
//   - `solid-js` resolves to its server renderer under the `node` condition, which has no reactivity.
//   - A second copy is a second graph and a second set of contexts, which fails as
//     "No renderer found" from inside a component that is plainly under the provider.
//
// pnpm-workspace.yaml's catalog says the same thing about solid-js for the same reason.
const isReactiveRuntime = (id: string) =>
  id === 'solid-js' || id.startsWith('solid-js/') || id.startsWith('@tanstack/')
// Aliased to something local, and therefore not externalisable — see `externalizeBareImports` below.
// The `@codemirror`, `@xterm` and `shiki` entries are the packages this host has no way to run and
// no longer installs; every one of them is matched by a pattern in `resolve.alias`, so the list here
// and the list there have to say the same thing.
const isAliased = (id: string) => id === '@solidjs/router' || id === 'lucide-static/icon-nodes.json'
  || id.startsWith('@acorn/plugin-api/ui')
  || id === '@codemirror/theme-one-dark'
  || id.startsWith('@codemirror/lang-') || id.startsWith('@codemirror/legacy-modes')
  || id === '@xterm/xterm' || id.startsWith('@xterm/xterm/')
  || id === '@xterm/addon-fit' || id === '@xterm/addon-webgl'
  || id === 'shiki' || id.startsWith('shiki/')
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
      // consumer that runs Solid on a real Node process points at the client build instead.
      { find: /^solid-js$/, replacement: 'solid-js/dist/solid.js' },
      { find: /^solid-js\/store$/, replacement: 'solid-js/store/dist/store.js' },
      // CodeMirror's grammar and highlight-style half, browser xterm.js and its two addons, and
      // shiki. Three packages' worth of specifiers, three stubs, and one reason for all of them: each
      // is reached only from a DOM surface this host cannot draw — a CodeMirror `EditorView` in a
      // `div`, a `<canvas>` terminal in a drawer slot this host does not have, and a highlighter that
      // answers in hex when the kit answers in the terminal's own sixteen slots.
      //
      // They were left externalised while the packages were installed, so the imports resolved and
      // the surface simply did not draw. Phase 4 dropped the packages, and an unresolved bare import
      // in a lazily loaded chunk is a crash the moment a reader opens that surface rather than a
      // surface that quietly cannot draw. So the specifiers are answered here, by stubs that throw
      // with the host's name on them (src/kit/codemirrorGrammars.ts, src/kit/xterm.ts,
      // src/kit/shiki.ts, docs/future/terminal-rewrite/phase-4-cut-over.md).
      //
      // Patterns rather than one line each, because the grammar and theme sets are open: a language
      // added to `client-core/src/features/editor/language.ts` or a theme added to
      // `client-core/src/infra/highlight/langs.ts` must not become a package this host has to install
      // again.
      //
      // Two packages are deliberately NOT matched, and both are the same mistake caught twice.
      // `@xterm/headless` is the emulator behind the `pty` rectangle (src/kit/rectangle.tsx).
      // `@codemirror/language` is a dependency of `codemirror`, which the `editor` pane really does
      // import — so aliasing it by name reaches inside a package this host uses, and under vitest,
      // where `ssr.noExternal` inlines node_modules too, `basicSetup` then threw and the editor pane
      // drew nothing. A stub may only stand in front of a specifier no working surface reaches.
      {
        find: /^@codemirror\/(?:theme-one-dark|lang-[^/]+|legacy-modes(?:\/.*)?)$/,
        replacement: resolve(import.meta.dirname, 'src/kit/codemirrorGrammars.ts'),
      },
      { find: /^@xterm\/(?:xterm(?:\/.*)?|addon-fit|addon-webgl)$/, replacement: resolve(import.meta.dirname, 'src/kit/xterm.ts') },
      { find: /^shiki(?:\/.*)?$/, replacement: resolve(import.meta.dirname, 'src/kit/shiki.ts') },
    ],
  },
  plugins: [solid({ solid: { generate: 'universal', moduleName: RECONCILER } })],
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
