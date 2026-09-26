import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js'
import type { Accessor } from 'solid-js'
import { segmentContentKey, type DiffSearchMatch, type DiffSearchPage, type DiffSearchRequest } from '@acorn/diff-document/document'
import type { FindHighlight } from '../../kit/diff/find'

// In-diff find (Cmd+F). The diff is loaded a segment at a time, so the renderer cannot scan it: the
// source searches the whole document and answers pages of matches by segment and row
// (docs/diff-rendering.md § Modes). Pages are fetched as the reader steps past the last one, and a
// match's segment loads when the reader is taken to it. The query goes to the source and nowhere
// else; it never reaches telemetry.

/** Typing settles before a request goes out. */
const SEARCH_DEBOUNCE_MS = 150

export type DiffFindController = ReturnType<typeof createDiffFindController>

export function createDiffFindController(props: {
  search: (request: DiffSearchRequest, signal: AbortSignal) => Promise<DiffSearchPage>
  /** The document searched. A new revision is a new search. */
  revision: Accessor<string>
  /** Take the reader to a match. */
  reveal: (match: DiffSearchMatch) => void
}) {
  const [findOpen, setFindOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal('')
  const [findCase, setFindCase] = createSignal(false)
  const [matchIdx, setMatchIdx] = createSignal(0)
  const [findFocusTick, setFindFocusTick] = createSignal(0)
  const [matches, setMatches] = createSignal<DiffSearchMatch[]>([])
  const [nextCursor, setNextCursor] = createSignal<string | null>(null)

  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    controller?.abort()
    controller = null
    clearTimeout(timer)
  }
  onCleanup(stop)

  // A source reads a bounded stretch of the document per page, so a page can hold no matches and
  // still say there is more. Keep reading until one holds a match or the document ends.
  const fetchPage = async (cursor: string | null): Promise<DiffSearchPage | null> => {
    controller?.abort()
    const current = new AbortController()
    controller = current
    try {
      const request = { query: findQuery(), caseSensitive: findCase() }
      let page = await props.search({ ...request, cursor }, current.signal)
      while (!page.matches.length && page.nextCursor && !current.signal.aborted) {
        page = await props.search({ ...request, cursor: page.nextCursor }, current.signal)
      }
      return current.signal.aborted ? null : page
    } catch {
      // A failed search finds nothing; the bar says 0 and the reader can type again.
      return null
    }
  }

  createEffect(on(() => [findOpen(), findQuery(), findCase(), props.revision()] as const, ([open, query]) => {
    stop()
    setMatchIdx(0)
    setMatches([])
    setNextCursor(null)
    if (!open || !query) return
    timer = setTimeout(() => {
      void fetchPage(null).then((page) => {
        if (!page) return
        setMatches(page.matches)
        setNextCursor(page.nextCursor)
      })
    }, SEARCH_DEBOUNCE_MS)
  }))

  // Match ranges by file, segment content and row, for the rows that happen to be mounted. The path is
  // part of the key because two files with the same patch share a content key.
  const rowKey = (path: string, contentKey: string, row: number) => `${path}\u0000${contentKey}#${row}`
  const rangesByRow = createMemo(() => {
    const map = new Map<string, [number, number][]>()
    for (const match of matches()) {
      const key = rowKey(match.path, segmentContentKey(match.patchKey, match.ordinal), match.row)
      const ranges = map.get(key)
      if (ranges) ranges.push([match.start, match.end])
      else map.set(key, [[match.start, match.end]])
    }
    return map
  })
  const currentMatch = () => matches()[matchIdx()] ?? null
  const findHighlight = (path: string, contentKey: string, row: number): FindHighlight | undefined => {
    const ranges = rangesByRow().get(rowKey(path, contentKey, row))
    if (!ranges) return undefined
    const current = currentMatch()
    const isCurrent = current && current.path === path && segmentContentKey(current.patchKey, current.ordinal) === contentKey && current.row === row
    return { ranges, current: isCurrent ? [current.start, current.end] : null }
  }

  const openFind = () => {
    setFindOpen(true)
    setFindFocusTick((tick) => tick + 1)
  }
  const closeFind = () => setFindOpen(false)
  const gotoMatch = (delta: number) => {
    const count = matches().length
    if (!count) return
    const target = matchIdx() + delta
    const cursor = nextCursor()
    // Past the last loaded match with more to come: fetch the next page and step onto it.
    if (target >= count && cursor) {
      void fetchPage(cursor).then((page) => {
        if (!page) return
        setMatches((loaded) => [...loaded, ...page.matches])
        setNextCursor(page.nextCursor)
        setMatchIdx(Math.min(target, matches().length - 1))
      })
      return
    }
    setMatchIdx((target + count) % count)
  }

  createEffect(() => {
    if (!findOpen()) return
    const current = currentMatch()
    // Only a change of match moves the reader. What reveal reads, the item index and the scroller,
    // changes when the reader expands a gap or collapses a file, and that must not pull them back.
    if (current) untrack(() => props.reveal(current))
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
