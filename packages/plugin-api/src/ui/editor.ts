// The editor surface, owned once by the host: the theme both compiled panes were carrying a copy
// of, and the canonical-language-id to CodeMirror map that replaces their two divergent extension
// tables. See docs/editor.md § The shared surface for why it is its own entrypoint and why it is
// compiled-panes-only.
//
// It stays a separate entrypoint after the move off Monaco for the same reason it became one: an
// editor is a few hundred kilobytes of grammars that no other pane's boot graph should carry. What
// changed is that it is no longer *unloadable* under node — CodeMirror touches no browser global at
// module scope — which is why it is not on the browser-realm list in entrypoints.test.ts any more.
//
// `languageFor` stays off this surface (docs/plugins/plugin-api.md § The plugin API): a pane holds a path, so
// it wants `languageForPath`.
export { editorTheme, refreshEditorTheme, watchEditorTheme } from '@acorn/client-core/features/editor'
export { languageForPath, shouldHighlightDocument } from '@acorn/client-core/features/editor'
export { applyViewState, captureViewState, type EditorViewState } from '@acorn/client-core/features/editor'
// A code box that is not a document: the library and the theme, and the caller keeps the text
// (client-core features/editor/embed.ts). Workflows' JSON tab is the case.
export { mountEmbeddedEditor } from '@acorn/client-core/features/editor'
export type { EmbeddedEditor } from '@acorn/client-core/features/editor'

export { documentCustody, recoverDocumentCustody, type DocumentCustody } from '@acorn/client-core/features/editor'
