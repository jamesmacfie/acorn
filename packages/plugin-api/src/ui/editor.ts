// The Monaco surface, owned once by the host (docs/future/monaco.md § Sequence step 1): the theme
// both compiled panes were carrying a copy of, and the canonical-language-id → Monaco map that
// replaces their two divergent extension tables.
//
// ITS OWN ENTRYPOINT rather than a few more lines on ./ui/host, and the reason is mechanical. A
// barrel evaluates every module on it, and `monaco-editor` reads `window.location` at module scope —
// so folding these onto ./ui/host would mean docker's archive concern, which imports that barrel for
// `registerWillHandler`, pulls 30 MB of editor into the boot graph and fails in a test environment
// that has no real window. Importing an editor should be a deliberate act; here it is one.
//
// Compiled first-party panes only. A LOADED plugin never drives an editor: it declares a document
// surface in its manifest and the host draws the whole thing.
//
// Two names, one per module, came off here in the prune pass (docs/plugins.md § The plugin API):
// `applyMonacoTheme` (which `watchMonacoTheme` already calls, once, on subscribe) and the by-language-id
// `monacoLanguageFor` (a pane holds a path, so it wants `monacoLanguageForPath`). Both are still core's,
// reachable inside client-core; neither was reached from outside it.
export { MONACO_THEME, watchMonacoTheme } from '@acorn/client-core/editor/theme.ts'
export { monacoLanguageForPath } from '@acorn/client-core/editor/language.ts'
