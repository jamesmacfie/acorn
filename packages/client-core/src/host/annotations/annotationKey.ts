import type { PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import type { CodeRow } from '../../kit/diff/diffModel'

/**
 * One code row, as an annotation key.
 *
 * The three fields every diff owner declares (`{ file, line, side }`) and the one string the host
 * mints its lookup from. `side` is the row's own kind rather than the view mode: a contributor marking
 * "line 42 as it will be" means the new side whether the reader is in split or unified.
 *
 * `fixed` adds fields that hold for every row of one diff, such as the code hosts' `task`, after the
 * row's own. An owner declares them after the three, so a mark answered for one task's diff never
 * matches another task's.
 *
 * A JSX-free module so a test can hold the field names the owners declare (`changes:diff-line`,
 * `github:diff-line`) against the values minted here. A key whose fields drift matches nothing, silently.
 */
export const DIFF_ANNOTATION_FIELDS = ['file', 'line', 'side'] as const

export const annotationKey = (row: CodeRow, fixed?: PluginAnnotationKey): PluginAnnotationKey => ({
  ...fixed,
  file: row.path,
  line: (row.kind === 'delete' ? row.oldNo : row.newNo) ?? 0,
  side: row.kind === 'delete' ? 'old' : 'new',
})
