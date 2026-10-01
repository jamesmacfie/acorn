/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { diffRowsFromPlain, type CodeRow, type Row as DiffRowT } from '@acorn/client-core/kit/diff/diffModel.ts'
import { segmentContentKey, type DiffDocumentFile, type DiffDocumentTopology, type DiffSegmentPayload, type DiffSegmentRequest } from '@acorn/diff-document/document'
import { annotationKey } from '@acorn/client-core/host/annotations/annotationKey.ts'
import { requestAnnotations } from '@acorn/client-core/host/annotations/annotations.ts'
import { Line, runStyle } from '../cells'
import { ScrollViewport, type Viewport } from '../scrolling'
import { AnnotatedDiffLine, FileHead, NonCodeRow } from './diffRows'

/** One line of the window: a file's header, a row of a loaded segment, or a line of one still loading. */
type DiffEntry =
  | { head: DiffDocumentFile; code?: undefined; pending?: undefined }
  | { head?: undefined; code: DiffRowT; pending?: undefined }
  | { head?: undefined; code?: undefined; pending: true }

/** A file header or a segment, at its first line. */
type DiffBlock = { start: number; file: DiffDocumentFile; ordinal: number; lines: number }

const isCode = (row: DiffRowT): row is CodeRow =>
  row.kind === 'normal' || row.kind === 'insert' || row.kind === 'delete'

/** Rows drawn beyond each edge of the viewport, so a wheel or a page key has something to show before
 *  the next slice is built. Twenty is half a screen at this host's tallest ordinary size. */
const DIFF_OVERSCAN = 20

/** What to draw before the viewport has been laid out and can say how tall it is. A screenful on a
 *  tall terminal: enough that the pane is never blank, bounded so a five-thousand-line diff does not
 *  build itself once before the first correction. */
const DIFF_ASSUMED_ROWS = 60

/** Segments held at once: more than any window can reach, since a segment is at least one line, and
 *  bounded, so a reader paging through a long diff does not keep all of it. */
const DIFF_HELD_SEGMENTS = 512

type TuiDiffSource = {
  topology: () => DiffDocumentTopology | undefined
  loading: () => boolean
  loadSegments: (requests: DiffSegmentRequest[], signal: AbortSignal) => Promise<DiffSegmentPayload[]>
}

/** Draw a unified diff from document topology. The pane loads only segments inside the viewport
 *  window; spacers preserve its total height and let `ScrollViewport` own keys, wheel, and offset.
 *  Annotation rows add one visual line that the topology does not count. A variable-height row kind
 *  would require cumulative row offsets (docs/diff-rendering.md § The document). */
export function DiffPane(props: { source: TuiDiffSource; annotations?: string }) {
  // Every file header and segment at its first line. Bounded by segments, not rows: the whole of what
  // the window is found in. A header is block `-1`.
  const blocks = createMemo(() => {
    const out: DiffBlock[] = []
    let at = 0
    for (const file of props.source.topology()?.files ?? []) {
      out.push({ start: at++, file, ordinal: -1, lines: 1 })
      if (!file.patchKey) continue
      file.segments.forEach((segment, ordinal) => {
        out.push({ start: at, file, ordinal, lines: segment.rows })
        at += segment.rows
      })
    }
    return { out, total: at }
  })

  // Loaded segments' rows by path and content key. Two files with the same patch share a content key,
  // but each row carries its file's path, which annotations and the grammar read. A new revision
  // keeps any segment whose content survived.
  const [loaded, setLoaded] = createSignal<ReadonlyMap<string, DiffRowT[]>>(new Map())
  const asked = new Set<string>()
  const keyOf = (path: string, patchKey: string, ordinal: number): string => `${path}\u0000${segmentContentKey(patchKey, ordinal)}`
  const blockKey = (block: DiffBlock): string => keyOf(block.file.path, block.file.patchKey!, block.ordinal)
  // Leaving the pane aborts the loads still in flight.
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  let viewport: (Renderable & Viewport) | undefined
  const [top, setTop] = createSignal(0)
  const [fit, setFit] = createSignal(0)
  /** Read the viewport's own offset and height. Called from the two places the offset moves: the
   *  viewport's key handlers, which say so, and the wheel, which does not and is caught on the box
   *  around the viewport instead (../scrolling.tsx § onScroll). */
  const sync = (): void => {
    if (!viewport) return
    setTop(Math.max(0, Math.round(viewport.scrollTop)))
    setFit(viewport.viewport.height)
  }

  const window = createMemo(() => {
    const { out, total } = blocks()
    const height = fit() || DIFF_ASSUMED_ROWS
    const at = Math.min(top(), Math.max(0, total - height))
    const from = Math.max(0, at - DIFF_OVERSCAN)
    const until = Math.min(total, at + height + DIFF_OVERSCAN)
    const rows: DiffEntry[] = []
    const wanted: DiffBlock[] = []
    for (const block of out) {
      if (block.start + block.lines <= from) continue
      if (block.start >= until) break
      if (block.ordinal < 0) {
        rows.push({ head: block.file })
        continue
      }
      const segment = loaded().get(blockKey(block))
      if (!segment) wanted.push(block)
      for (let line = Math.max(block.start, from); line < Math.min(block.start + block.lines, until); line++) {
        const row = segment?.[line - block.start]
        rows.push(row ? { code: row } : { pending: true })
      }
    }
    return { from, rows, after: Math.max(0, total - until), wanted }
  })

  // The segments the window reaches and does not have, asked for once each.
  createEffect(() => {
    const wanted = window().wanted.filter((block) => !asked.has(blockKey(block)))
    if (!wanted.length) return
    for (const block of wanted) asked.add(blockKey(block))
    const byKey = new Map(wanted.map((block) => [blockKey(block), block]))
    void props.source.loadSegments(
      wanted.map((block) => ({ path: block.file.path, patchKey: block.file.patchKey!, ordinal: block.ordinal })),
      abort.signal,
    ).then((payloads) => {
      const next = new Map(untrack(loaded))
      for (const payload of payloads) {
        const key = keyOf(payload.path, payload.patchKey, payload.ordinal)
        const block = byKey.get(key)
        if (block) next.set(key, diffRowsFromPlain(block.file.path, block.file.sha, payload.rows))
      }
      // Oldest first out.
      for (const key of next.keys()) {
        if (next.size <= DIFF_HELD_SEGMENTS) break
        next.delete(key)
        asked.delete(key)
      }
      setLoaded(next)
    }, () => {
      // Asked again the next time the window reaches it.
      for (const key of byKey.keys()) asked.delete(key)
    })
  })

  // The code rows in the window, asked about in one request per contributor rather than one per line.
  // `requestAnnotations` compares the key set, so a render that moves nothing re-asks nothing
  // (client-core/host/annotations).
  const keys = createMemo(() => window().rows.flatMap((entry) => (entry.code && isCode(entry.code) ? [annotationKey(entry.code)] : [])))
  createEffect(() => {
    const point = props.annotations
    if (!point) return
    requestAnnotations(point, keys())
  })

  return (
    // The box around the viewport, and it is here for the wheel: a wheel step runs each node's own
    // handler from the node under the pointer upwards, so a listener here sees the scroll after the
    // scrollbox below has already moved its offset. On the scrollbox itself it would see it before
    // (../../tree/hit.ts § wheelAt).
    <box
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      minHeight={0}
      onMouseScroll={sync}
      onSizeChange={sync}
    >
      <ScrollViewport onScroll={sync} onBox={(box) => { viewport = box; sync() }}>
        <Show when={props.source.topology()} fallback={<Line role="muted">{props.source.loading() ? 'loading…' : 'no changes'}</Line>}>
          {/* The rows above the window, as height rather than as renderables, so the scrollbox's own
              offset and bar are about the whole diff and not about the slice. */}
          <box flexShrink={0} height={window().from} />
          <For each={window().rows}>
            {(entry) => (
              <Show
                when={entry.code}
                fallback={entry.head ? (
                  /* `flexShrink={0}` for the reason each row carries it: a column taller than the
                     panel is squeezed rather than scrolled, and one file's rows are then drawn over
                     the next file's. The scroll is this pane's, at the box above. */
                  <box flexDirection="column" flexShrink={0}>
                    <FileHead file={entry.head} />
                  </box>
                ) : <text flexShrink={0} wrapMode="none" {...runStyle('muted')}>loading…</text>}
              >
                {(row) => (
                  <Show when={isCode(row())} fallback={<NonCodeRow row={row() as Exclude<DiffRowT, CodeRow>} />}>
                    <AnnotatedDiffLine r={row() as CodeRow} point={props.annotations} />
                  </Show>
                )}
              </Show>
            )}
          </For>
          <box flexShrink={0} height={window().after} />
        </Show>
      </ScrollViewport>
    </box>
  )
}
