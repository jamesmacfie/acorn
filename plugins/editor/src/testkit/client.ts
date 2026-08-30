// The client half of this package's test seam (docs/architecture-overview.md § Package
// boundaries). This package contributes nothing a node test needs, so there is no ./index.ts.
//
//   apps/desktop/src/client/scopedEviction.test.ts   the three per-task client stores
//   apps/desktop/test/integration/persistedState.conformance.test.ts   editorOpenFilesSlice
export { editorOpen, openFiles } from '../client/editorState'
export { editorTreeDirectoryOpen, setEditorTreeDirectoryOpen } from '../client/editorTreeState'
export { editorViewState, rememberEditorViewState } from '../client/editorViewState'
export { editorOpenFilesSlice } from '../client/openFilesSlice'
