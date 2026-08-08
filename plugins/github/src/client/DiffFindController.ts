import { createEffect, createMemo, createSignal, on } from 'solid-js'
import type { Accessor } from 'solid-js'
import { type CodeRow, collectMatches, type FindHighlight, type Row, type SplitBand, type ViewMode } from '@acorn/plugin-api/ui/diff'

type ScrollTarget = {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'start' | 'center' | 'end' }) => void
}

export type DiffFindController = ReturnType<typeof createDiffFindController>

export function createDiffFindController(props: {
  rows: Accessor<Row[]>
  bands: Accessor<SplitBand[]>
  viewMode: Accessor<ViewMode>
  unified: ScrollTarget
  split: ScrollTarget
}) {
  const [findOpen, setFindOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal('')
  const [findCase, setFindCase] = createSignal(false)
  const [matchIdx, setMatchIdx] = createSignal(0)
  const [findFocusTick, setFindFocusTick] = createSignal(0)
  const matches = createMemo(() => (findOpen() ? collectMatches(props.rows(), findQuery(), findCase()) : []))
  const matchesByRow = createMemo(() => {
    const map = new Map<CodeRow, [number, number][]>()
    for (const match of matches()) {
      const ranges = map.get(match.row)
      if (ranges) ranges.push([match.start, match.end])
      else map.set(match.row, [[match.start, match.end]])
    }
    return map
  })
  const currentMatch = () => matches()[matchIdx()] ?? null
  const findHighlight = (row: CodeRow): FindHighlight | undefined => {
    const ranges = matchesByRow().get(row)
    if (!ranges) return undefined
    const current = currentMatch()
    return { ranges, current: current && current.row === row ? [current.start, current.end] : null }
  }

  const openFind = () => {
    setFindOpen(true)
    setFindFocusTick((tick) => tick + 1)
  }
  const closeFind = () => setFindOpen(false)
  const gotoMatch = (delta: number) => {
    const count = matches().length
    if (count) setMatchIdx((index) => (index + delta + count) % count)
  }

  createEffect(on(findQuery, () => setMatchIdx(0)))
  createEffect(() => {
    if (matchIdx() >= matches().length) setMatchIdx(0)
  })
  createEffect(() => {
    if (!findOpen()) return
    const current = currentMatch()
    if (!current) return
    if (props.viewMode() === 'split') {
      const index = props.bands().findIndex((band) => band.kind === 'pair' && (band.left === current.row || band.right === current.row))
      if (index >= 0) props.split.scrollToIndex(index, { align: 'center' })
    } else {
      props.unified.scrollToIndex(current.rowIndex, { align: 'center' })
    }
  })

  return {
    findOpen,
    findQuery,
    setFindQuery,
    findCase,
    setFindCase,
    matchIdx,
    findFocusTick,
    matches,
    openFind,
    closeFind,
    gotoMatch,
    findHighlight,
  }
}
