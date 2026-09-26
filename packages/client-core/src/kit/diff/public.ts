export type { LineComposerController, ThreadCollapseController } from './DiffRows.tsx'
export {
  buildDiffRows, buildDiffRowsAsync, buildRenderableRows,
  expandGap, expandGapAsync,
  gapId, highlighterTokenize, isCodeRow, maxLineCols,
  plainTokenize, rowIdentityKeys, toBands,
} from './diffModel.ts'
export type { CodeRow, DiffFile, GapRow, ParsedFile, Row, SplitBand, TokenizeLine, ViewMode } from './diffModel.ts'
export type { FindHighlight } from './find.ts'
export { createSplitScrollSync } from './splitScrollSync.ts'
export { synth } from './synth.ts'
