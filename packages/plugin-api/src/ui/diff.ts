// The diff toolkit: the model that turns a patch into rows, the virtualizer, the highlighter hydration
// and the find pass. Its own entrypoint because it's a domain toolkit rather than a primitive, and
// because its `Row` type would collide with the `Row` layout component on ./ui.
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
} from '@acorn/client-core/ui/diff/model.ts'
export type { CodeRow, DiffFile, GapRow, ParsedFile, Row, SplitBand, TokenizeLine, ViewMode } from '@acorn/client-core/ui/diff/model.ts'

// The tokenizer the async builders take. On this entrypoint rather than ./client because it's part of
// the diff toolkit's contract, since `buildDiffRowsAsync(file, tokenizeDocument)` is the whole intended
// call, and because a plugin has no other reason to reach the highlighter directly.
export { tokenizeDocument } from '@acorn/client-core/highlight/worker.ts'
export type { TokenizeDocument } from '@acorn/client-core/highlight/worker.ts'

export { collectMatches } from '@acorn/client-core/ui/diff/find.ts'
export type { FindHighlight } from '@acorn/client-core/ui/diff/find.ts'
export { createDiffHydrator } from '@acorn/client-core/ui/diff/hydration.ts'
export { synth } from '@acorn/client-core/ui/diff/synth.ts'
export { createDiffMeasureSchedulers, createDiffVirtualizer } from '@acorn/client-core/ui/diff/virtualization.ts'
export { createSplitScrollSync } from '@acorn/client-core/ui/diff/splitScrollSync.ts'
