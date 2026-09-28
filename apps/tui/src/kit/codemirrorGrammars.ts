// CodeMirror's grammar half, as this host's answer: a throw.
//
// The sixth alias in the host switch (../vite.config.ts), and the third that replaces a package
// rather than swapping a component for one. Two sets of specifiers resolve here — every
// `@codemirror/lang-*` and every `@codemirror/legacy-modes/mode/*`.
//
// **`@codemirror/language` is not one of them, and the reason is worth keeping.** It was, for an
// afternoon, and it broke the editor pane: `codemirror` depends on it, the `editor` pane imports
// `basicSetup` from `codemirror`, and under vitest — where `ssr.noExternal` inlines node_modules —
// the stub was handed to a package that works here. It is a declared dependency instead. A stub may
// only stand in front of a specifier no working surface reaches.
//
// **Why they cannot be here.** All of them are reached from one surface, client-core's
// `features/editor/DocumentSurface.tsx`, which holds an `HTMLElement` and mounts a CodeMirror
// `EditorView` into it. The host supplies a cell document surface for plugin regions instead
// (`../plugins/DocumentSurface.tsx`); the DOM fallback stays in the bundle's lazy graph but is never
// mounted here. The separate editor plugin draws its `editor` rectangle and runs `$EDITOR` in a PTY
// (./rectangle.tsx, ./editor.ts).
//
// **Why an alias rather than a dependency.** The bundle externalises every bare import, so leaving
// these to the runtime means Node resolves them when the chunk loads — which needs seventeen packages
// installed for a surface that cannot draw. Aliasing them here is what lets `package.json` drop the
// lot without turning a surface that fails into a chunk that will not load
// (docs/tui.md § The host switch).
//
// **Everything here throws, and that is the point.** A stub that answers plausibly is how this host
// ended up with an editor pane pulling seventeen grammars it could never highlight. If a surface ever
// does reach one of these, the message says which host it is on and where to look, rather than
// drawing an empty box that somebody has to bisect.

const absent = (what: string): never => {
  throw new Error(
    `${what} is CodeMirror, and the terminal client has no DOM to draw it in. `
    + 'This host draws documents with the `editor` rectangle instead '
    + '(apps/tui/src/kit/codemirrorGrammars.ts, apps/tui/vite.config.ts).',
  )
}

// ── `@codemirror/lang-*` and `@codemirror/legacy-modes/mode/*` ────────────────────────────────
//
// One export per grammar `client-core/src/features/editor/language.ts` names, because it reads the
// name off the module namespace after an `await import()` and the name has to exist for the build to
// link. Adding a language there means adding a line here; the build says so if you forget.

export const cpp = (): never => absent('the C and C++ grammar')
export const css = (): never => absent('the CSS grammar')
export const go = (): never => absent('the Go grammar')
export const html = (): never => absent('the HTML grammar')
export const java = (): never => absent('the Java grammar')
export const javascript = (): never => absent('the JavaScript grammar')
export const json = (): never => absent('the JSON grammar')
export const markdown = (): never => absent('the Markdown grammar')
export const python = (): never => absent('the Python grammar')
export const rust = (): never => absent('the Rust grammar')
export const sql = (): never => absent('the SQL grammar')
export const xml = (): never => absent('the XML grammar')
export const yaml = (): never => absent('the YAML grammar')

/** The legacy modes, which are plain objects rather than functions where the real package is
 *  concerned — so these are proxies, and reading any field of one says the same thing. A proxy
 *  rather than an empty object, so a reader of any field gets the message rather than `undefined`. */
const style = (name: string): Record<string, never> => new Proxy({}, { get: () => absent(name) })

export const properties = style('the INI mode')
export const ruby = style('the Ruby mode')
export const shell = style('the shell mode')
export const toml = style('the TOML mode')
