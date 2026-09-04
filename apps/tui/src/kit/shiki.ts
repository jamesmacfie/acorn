// shiki, as this host's answer: a throw.
//
// The eighth alias in the host switch (../vite.config.ts). Every `shiki` specifier resolves here —
// `shiki/core`, both engines, every `shiki/langs/*.mjs`, every `shiki/themes/*.mjs`, and the wasm.
//
// **Why it cannot be here.** shiki turns code into HTML or into tokens carrying hex colours, and this
// host draws cells in the sixteen slots the reader's own terminal chose (../appearance.ts). Its three
// callers in the graph are all DOM surfaces: client-core's `DiffPane`, its `Markdown`, and the
// terminal plugin's `TerminalPanel`. This host's own diff pane drops the highlighter and says so
// (./showing.tsx § DiffPane), and its own markdown draws roles rather than a palette.
//
// **The grammars were already lazy and that hid the problem.** `client-core/src/infra/highlight/langs.ts`
// loads each grammar behind an `import()`, so the `langs` chunk this host does load needed none of
// them — right up until the moment something asked for one, which would then have been a
// module-not-found from inside a surface rather than the missing highlighter it is.
//
// **Why an alias rather than a dependency.** The bundle externalises every bare import, so without
// this shiki has to stay installed for three surfaces that cannot draw here
// (docs/future/terminal-rewrite/phase-4-cut-over.md).

const absent = (what: string): never => {
  throw new Error(
    `${what} is shiki, and the terminal client draws in the sixteen slots the reader's terminal chose `
    + 'rather than in a theme of ours. Ask a role for a colour instead '
    + '(apps/tui/src/kit/shiki.ts, apps/tui/vite.config.ts).',
  )
}

// ── `shiki/core` ──────────────────────────────────────────────────────────────────────────────

export const createHighlighterCore = (): never => absent('createHighlighterCore')
export const tokenizeAnsiWithTheme = (): never => absent('tokenizeAnsiWithTheme')

// ── the engines ───────────────────────────────────────────────────────────────────────────────

export const createJavaScriptRegexEngine = (): never => absent('createJavaScriptRegexEngine')
export const createOnigurumaEngine = (): never => absent('createOnigurumaEngine')

/** A grammar or a theme, both of which the real package ships as a default export. A proxy rather
 *  than a throwing function, because a caller reads fields off one rather than calling it — and
 *  `createHighlighterCore` above throws before any caller gets this far. */
export default new Proxy({}, { get: () => absent('a grammar or a theme') })
