import type { PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import type { CodeRow } from '../ui/diff/model'

/**
 * One code row, as an annotation key.
 *
 * The three fields the two diff owners declare (`{ file, line, side }`) and the one string the host
 * mints its lookup from. `side` is the row's own kind rather than the view mode: a contributor marking
 * "line 42 as it will be" means the new side whether the reader is in split or unified.
 *
 * Its own JSX-free module so both halves of the contract can be held against each other in a test: the
 * owner declares the field names on its point (`changes:diff-line`, `github:diff-line`) and this mints
 * the values, and a key whose fields drifted from the declaration would silently match nothing.
 */
export const DIFF_ANNOTATION_FIELDS = ['file', 'line', 'side'] as const

export const annotationKey = (row: CodeRow): PluginAnnotationKey => ({
  file: row.path,
  line: (row.kind === 'delete' ? row.oldNo : row.newNo) ?? 0,
  side: row.kind === 'delete' ? 'old' : 'new',
})
