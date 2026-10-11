// The diff toolkit: the model that turns a patch into rows, the highlighter and the find pass, and
// the document a `DiffSource` hands the viewer. Its own entrypoint because it's a domain toolkit
// rather than a primitive, and because its `Row` type would collide with the `Row` layout component
// on ./ui.
//
// The row components are on ./ui, by the same rule that governs ./client: anything from a .tsx module
// goes there, so a plugin's node-environment test can still load this model.

export type { CodeRow } from '@acorn/client-core/kit/diff'

export { synth } from '@acorn/client-core/kit/diff'

// The port DiffPane (on ./ui, since it is a component) is driven through. A plugin that owns a diff
// fills this in from its own queries and mutations; nothing else about the shell is configurable.
export type { DiffLineAnchor, DiffSource } from '@acorn/client-core/features/diff'
// The document the port carries: a topology, segments of plain rows, and search pages. A provider
// builds these on its node (./node); a client source only ever moves them, except for assembling a
// topology from descriptors its node sent (docs/diff-rendering/document.md § The document).
export { documentTopology } from '@acorn/diff-document/document'
// From its own file, not the feature's barrel: the Changes pane model is on the renderer's startup
// graph, and the barrel would bring the diff view state and segment loaders along with it.
export { loadDiffLineContext } from '@acorn/client-core/features/diff/lineContext.ts'
export type {
  DiffDocumentFile,
  DiffDocumentTopology,
  DiffSearchPage,
  DiffSearchRequest,
  DiffSegmentPayload,
  DiffSegmentRequest,
} from '@acorn/diff-document/document'
// Session-only scroll and collapse memory, keyed by scope. `diffScopeKey` is here so a caller keying
// its own session state by the same scope stays in step rather than writing a second spelling.
export { diffScopeKey } from '@acorn/client-core/features/diff'
// A few lines around one anchor, read from the segment that holds it through the viewer's own loader
// and node cache: the quoted code on a review thread's card, without parsing any patch.
export { createDiffSnippets } from '@acorn/client-core/features/diff'
export type { DiffSnippetAnchor, DiffSnippetLine, DiffSnippets } from '@acorn/client-core/features/diff'
