// The diff toolkit: the model that turns a patch into rows, the virtualizer, the highlighter
// hydration and the find pass. Its own entrypoint because it is a domain toolkit rather than a
// primitive, and because its `Row` type would collide with the `Row` layout component on ./ui.
//
// The row COMPONENTS are on ./ui, by the same mechanical rule that governs ./client: anything
// from a .tsx module goes there, so a plugin's node-environment test can still load this model.

export {
  buildDiffRows,
  buildRenderableRows,
  DIFF_LOAD_ROW_HEIGHT,
  estimateRowSize,
  estimateSplitBandSize,
  expandGap,
  gapId,
  highlighterTokenize,
  isCodeRow,
  plainTokenize,
  rowIdentityKeys,
  splitBandIdentityKeys,
  toBands,
} from '@acorn/client-core/ui/diff/model.ts'
export type { CodeRow, DiffFile, GapRow, ParsedFile, Row, SplitBand, TokenizeLine, ViewMode } from '@acorn/client-core/ui/diff/model.ts'

export { collectMatches } from '@acorn/client-core/ui/diff/find.ts'
export type { FindHighlight } from '@acorn/client-core/ui/diff/find.ts'
export { createDiffHydrator } from '@acorn/client-core/ui/diff/hydration.ts'
export { synth } from '@acorn/client-core/ui/diff/synth.ts'
export { createDiffMeasureSchedulers, createDiffVirtualizer } from '@acorn/client-core/ui/diff/virtualization.ts'
