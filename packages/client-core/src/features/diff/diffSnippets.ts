import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { segmentContentKey, type DiffDocumentFile, type DiffSegmentPayload, type DiffSegmentRequest } from '@acorn/diff-document/document'
import { isCodeRow } from '../../kit/diff/diffModel'
import { segmentOfLine, type SegmentRef } from './documentView'
import { segmentCacheFor } from './segmentCache'
import { createSegmentLoader } from './segmentLoader'

// A few lines of a diff around one anchor, for a card that quotes the code it is about: a review
// thread in a pull request's conversation (docs/github-integration.md § Conversation).
//
// Read from the one segment that holds the line, through the same loader and node cache the diff
// viewer uses (./segmentLoader.ts, ./segmentCache.ts), so a segment the reader has already seen in the
// diff costs nothing and a snippet read here is there when they open it. Nothing parses a whole patch:
// the document's descriptors say which segment holds a line before any segment is read.
//
// Only what a caller wants is loaded. A card asks with `want` when it comes near the viewport and lets
// go when it leaves the DOM, so a conversation with four hundred threads reads the segments of the
// dozen it is showing. Plain text only: a snippet is drawn as an excerpt, and colouring segments here
// would spend the worker on rows nobody sees highlighted.

/** A line on one side of a file's diff. `old` is GitHub's LEFT. */
export type DiffSnippetAnchor = { path: string; side: 'old' | 'new'; line: number }
export type DiffSnippetLine = { kind: 'normal' | 'insert' | 'delete'; oldNo: number | null; newNo: number | null; text: string }
/** `unavailable` is a file the document does not hold (capped, binary, or with no patch), a line in
 *  no segment, or a segment that failed to load. It never causes anything else to load. */
export type DiffSnippet = { state: 'loading' } | { state: 'unavailable' } | { state: 'ready'; lines: DiffSnippetLine[] }

/** Lines drawn either side of the anchor. */
const CONTEXT = 2

const LOADING: DiffSnippet = { state: 'loading' }
const UNAVAILABLE: DiffSnippet = { state: 'unavailable' }

/**
 * Snippets over one document. Call it in a component under the node's query client, whose segment
 * cache it shares. `files` is undefined while the document is loading.
 */
export function createDiffSnippets(options: {
  files: Accessor<readonly DiffDocumentFile[] | undefined>
  load: (requests: DiffSegmentRequest[], signal: AbortSignal) => Promise<DiffSegmentPayload[]>
}) {
  const loader = createSegmentLoader({ cache: segmentCacheFor(useQueryClient()), load: options.load })
  onCleanup(loader.dispose)
  const byPath = createMemo(() => new Map((options.files() ?? []).map((file) => [file.path, file])))

  /** Undefined while the document loads, null when the anchor has no segment to read. */
  const refOf = (anchor: DiffSnippetAnchor): SegmentRef | null | undefined => {
    if (!options.files()) return undefined
    const file = byPath().get(anchor.path)
    if (!file?.patchKey) return null
    const ordinal = segmentOfLine(file, anchor.side, anchor.line)
    if (ordinal < 0) return null
    return { file, ordinal, descriptor: file.segments[ordinal]!, contentKey: segmentContentKey(file.patchKey, ordinal) }
  }

  const [wanted, setWanted] = createSignal<readonly DiffSnippetAnchor[]>([])
  createEffect(() => {
    const refs: SegmentRef[] = []
    for (const anchor of wanted()) {
      const ref = refOf(anchor)
      if (ref) refs.push(ref)
    }
    loader.demand(refs, [])
  })

  return {
    /** Load this anchor's segment, until the returned function is called. */
    want: (anchor: DiffSnippetAnchor): (() => void) => {
      setWanted((list) => [...list, anchor])
      return () => setWanted((list) => list.filter((item) => item !== anchor))
    },
    /** The lines around the anchor, reactive as its segment arrives. */
    snippet: (anchor: DiffSnippetAnchor): DiffSnippet => {
      const ref = refOf(anchor)
      if (ref === undefined) return LOADING
      if (ref === null) return UNAVAILABLE
      const rows = loader.rows(ref)
      if (!rows) return loader.status(ref) === 'error' ? UNAVAILABLE : LOADING
      const code = rows.filter(isCodeRow)
      const at = code.findIndex((row) => (anchor.side === 'old' ? row.oldNo : row.newNo) === anchor.line)
      if (at < 0) return UNAVAILABLE
      return {
        state: 'ready',
        lines: code.slice(Math.max(0, at - CONTEXT), at + CONTEXT + 1)
          .map((row) => ({ kind: row.kind, oldNo: row.oldNo, newNo: row.newNo, text: row.raw })),
      }
    },
  }
}

export type DiffSnippets = ReturnType<typeof createDiffSnippets>
