export { mountEmbeddedEditor } from './embed.ts'
export type { EmbeddedEditor } from './embed.ts'
export { languageForPath, shouldHighlightDocument } from './language.ts'
export { languageServices, refreshLanguageServices } from './languageServices.ts'
export type { LanguageServiceSource } from './languageServices.ts'
export { editorSearch, openReplacePanel } from './search.ts'
export { editorTheme, refreshEditorTheme, watchEditorTheme } from './theme.ts'
export { applyViewState, captureViewState } from './viewState.ts'
export type { EditorViewState } from './viewState.ts'

export {
  documentCustody,
  recoverDocumentCustody,
  fileDocumentCustodies,
  reserveDocumentDestinations,
  reserveFileSourceCustodies,
  type DocumentCustody,
} from './documentCustody'
export { richTooltipDom, richTooltipTheme } from './richTooltip.ts'
export type { RichTooltipContent } from './richTooltip.ts'
