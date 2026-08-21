// The Monaco surface, owned once by the host: the theme both compiled panes were carrying a copy
// of, and the canonical-language-id to Monaco map that replaces their two divergent extension
// tables. See docs/third-party/monaco.md § Sequence step 1 for why it is its own entrypoint and why
// it is compiled-panes-only (folding it onto ./ui/host would drag 30 MB of editor into docker's
// boot graph).
//
// Two names, one per module, came off here in the prune pass (docs/plugins.md § The plugin API):
// `applyMonacoTheme`, which `watchMonacoTheme` already calls once on subscribe, and the by-language-id
// `monacoLanguageFor`, since a pane holds a path and wants `monacoLanguageForPath` instead. Both stay
// reachable inside client-core; neither was reached from outside it.
export { MONACO_THEME, watchMonacoTheme } from '@acorn/client-core/editor/theme.ts'
export { monacoLanguageForPath } from '@acorn/client-core/editor/language.ts'
