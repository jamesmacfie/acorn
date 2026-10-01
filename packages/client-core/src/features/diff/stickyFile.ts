import { createMemo } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { DiffDocumentFile } from '@acorn/diff-document/document'
import type { DiffItem } from './documentView'

type MountedItem = { index: number; start: number; end: number }

// The sticky header follows the item crossing the scroll edge. Every item belongs to a file, so the
// file under the edge is known without any row being loaded; the header hides while that file's own
// header row is the one at the edge.
export function createDiffStickyFile(props: {
  items: Accessor<DiffItem[]>
  range: Accessor<readonly MountedItem[]>
  scrollTop: Accessor<number>
}) {
  return createMemo<DiffDocumentFile | null>(() => {
    const top = props.scrollTop()
    if (top <= 0) return null
    const all = props.items()
    const edge = props.range().find((item) => item.end > top)
    const item = edge ? all[edge.index] : undefined
    if (!edge || !item) return null
    if (item.kind === 'file' && edge.start >= top) return null
    return item.file
  })
}
