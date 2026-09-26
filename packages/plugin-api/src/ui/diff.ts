// The diff toolkit: the model that turns a patch into rows, the virtualizer, the highlighter and the
// find pass, and the document a `DiffSource` hands the viewer. Its own entrypoint because it's a
// domain toolkit rather than a primitive, and because its `Row` type would collide with the `Row`
// layout component on ./ui.
//
// The row components are on ./ui, by the same rule that governs ./client: anything from a .tsx module
// goes there, so a plugin's node-environment test can still load this model.

export {
  buildDiffRows,
  buildDiffRowsAsync,
  buildRenderableRows,
  DIFF_LOAD_ROW_HEIGHT,
  estimateRowSize,
  estimateSplitBandSize,
  expandGap,
  expandGapAsync,
  gapId,
  highlighterTokenize,
  isCodeRow,
  maxLineCols,
  plainTokenize,
  rowIdentityKeys,
  splitBandIdentityKeys,
  toBands,
} from '@acorn/client-core/kit/diff'
export type { CodeRow, DiffFile, GapRow, ParsedFile, Row, SplitBand, TokenizeLine, ViewMode } from '@acorn/client-core/kit/diff'

// The tokenizer the async builders take. On this entrypoint rather than ./client because it's part of
// the diff toolkit's contract, since `buildDiffRowsAsync(file, tokenizeDocument)` is the whole intended
// call, and because a plugin has no other reason to reach the highlighter directly.
export { tokenizeDocument } from '@acorn/client-core/infra/highlight'
export type { TokenizeDocument } from '@acorn/client-core/infra/highlight'

export { collectMatches } from '@acorn/client-core/kit/diff'
export type { FindHighlight } from '@acorn/client-core/kit/diff'
export { synth } from '@acorn/client-core/kit/diff'
export { createDiffMeasureSchedulers, createDiffVirtualizer } from '@acorn/client-core/kit/diff'
export { createSplitScrollSync } from '@acorn/client-core/kit/diff'

// The port DiffPane (on ./ui, since it is a component) is driven through. A plugin that owns a diff
// fills this in from its own queries and mutations; nothing else about the shell is configurable.
export type { CommentSide, DiffLineAnchor, DiffSource } from '@acorn/client-core/features/diff'
// The document the port carries: a topology, segments of plain rows, and search pages. A provider
// builds these on its node (./node); a client source only ever moves them, except for assembling a
// topology from descriptors its node sent (docs/diff-rendering.md § The document).
export { documentTopology } from '@acorn/diff-document/document'
export type {
  DiffDocumentFile, DiffDocumentTopology, DiffSearchMatch, DiffSearchPage, DiffSearchRequest, DiffSegmentDescriptor,
  DiffSegmentPayload, DiffSegmentRequest, PlainDiffRow,
} from '@acorn/diff-document/document'
// Session-only scroll and collapse memory, keyed by scope. `diffScopeKey` is here so a caller keying
// its own session state by the same scope stays in step rather than writing a second spelling.
export { diffScopeKey } from '@acorn/client-core/features/diff'
export type { DiffCollapsedFiles, DiffScrollState, DiffViewScope } from '@acorn/client-core/features/diff'
