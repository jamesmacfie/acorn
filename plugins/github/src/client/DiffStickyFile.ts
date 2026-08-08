import { createMemo } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { DiffFile, Row, SplitBand, ViewMode } from '@acorn/client-core/ui/diff/model.ts'

type VirtualItem = { index: number; start: number; end: number }
type DiffVirtualizer = { getVirtualItems: () => VirtualItem[] }

// The sticky header follows the row currently crossing the scroll edge. Keeping the geometry walk
// beside the diff shell leaves the renderer focused on row markup while preserving the virtualizer's
// exact item identities and file-path rules.
export function createDiffStickyFile<T extends Pick<DiffFile, 'path'>>(props: {
  rows: Accessor<Row[]>
  bands: Accessor<SplitBand[]>
  viewMode: Accessor<ViewMode>
  virt: DiffVirtualizer
  splitVirt: DiffVirtualizer
  scrollTop: Accessor<number>
  files: Accessor<readonly T[]>
}) {
  const virtualRows = createMemo(() => props.virt.getVirtualItems().flatMap((vi) => {
    const row = props.rows()[vi.index]
    return row ? [{ vi, row }] : []
  }))
  const virtualBands = createMemo(() => props.splitVirt.getVirtualItems().flatMap((vi) => {
    const band = props.bands()[vi.index]
    return band ? [{ vi, band }] : []
  }))
  const rowPath = (row: Row): string | null => {
    if (row.kind === 'file' || row.kind === 'load') return row.file.path
    if (row.kind === 'thread') return row.thread.path
    if (row.kind === 'hunk' || row.kind === 'nodiff') return null
    return row.path
  }
  const stickyPath = createMemo<string | null>(() => {
    const top = props.scrollTop()
    if (top <= 0) return null
    const items = props.viewMode() === 'split'
      ? virtualBands().map(({ vi, band }) => ({
          vi,
          path: band.kind === 'pair' ? (band.left ?? band.right)?.path ?? null : rowPath(band.row),
          header: band.kind === 'full' && band.row.kind === 'file',
        }))
      : virtualRows().map(({ vi, row }) => ({ vi, path: rowPath(row), header: row.kind === 'file' }))
    const topIndex = items.findIndex(({ vi }) => vi.end > top)
    if (topIndex < 0 || (items[topIndex].header && items[topIndex].vi.start >= top)) return null
    for (let index = topIndex; index >= 0; index--) {
      if (items[index].path) return items[index].path
    }
    return null
  })
  const stickyFile = createMemo(() => {
    const path = stickyPath()
    return (path && props.files().find((file) => file.path === path)) || null
  })
  return { virtualRows, virtualBands, stickyFile }
}
