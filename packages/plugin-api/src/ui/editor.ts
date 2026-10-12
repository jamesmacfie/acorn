// The editor surface, owned once by the host: the editor theme and the canonical-language-id to
// CodeMirror map. See docs/editor.md § The shared surface for why it is its own entrypoint and why it
// is compiled-panes-only. An editor is a few hundred kilobytes of grammars that no other pane's boot
// graph should carry.
//
// `languageFor` stays off this surface (docs/plugins/plugin-api.md § The plugin API): a pane holds a path, so
// it wants `languageForPath`.
export { editorTheme, refreshEditorTheme, watchEditorTheme } from '@acorn/client-core/features/editor'
export { languageForPath, shouldHighlightDocument } from '@acorn/client-core/features/editor'
// Hover and diagnostics from routes the host resolved, drawn by the host's editor. The owner names
// routes and its edit counter, nothing more.
export { languageServices, refreshLanguageServices } from '@acorn/client-core/features/editor'
// The same sanitized body and credit line, for a tooltip an owner opens itself, such as annotation
// detail on a line.
export { richTooltipDom, richTooltipTheme, type RichTooltipContent } from '@acorn/client-core/features/editor'
export { applyViewState, captureViewState, type EditorViewState } from '@acorn/client-core/features/editor'
// Find and replace drawn with the kit's controls.
export { editorSearch, openReplacePanel } from '@acorn/client-core/features/editor'
// A code box that is not a document: the library and the theme, and the caller keeps the text.
// Workflows' JSON tab is the case.
export { mountEmbeddedEditor } from '@acorn/client-core/features/editor'
export type { EmbeddedEditor } from '@acorn/client-core/features/editor'

export {
  documentCustody,
  recoverDocumentCustody,
  fileDocumentCustodies,
  reserveDocumentDestinations,
  reserveFileSourceCustodies,
  type DocumentCustody,
} from '@acorn/client-core/features/editor'
