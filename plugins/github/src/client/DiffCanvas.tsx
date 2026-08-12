import { For, Show } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'
import { DiffLine, type LineComposerController, NonCodeRow, SplitCell, type ThreadCollapseController } from '@acorn/plugin-api/ui'
import { type CodeRow, type FindHighlight, type GapRow, isCodeRow, type Row, type SplitBand, type ViewMode } from '@acorn/plugin-api/ui/diff'
import type { Thread } from '../contract/api'

type VirtualItem = { index: number; start: number; end: number }
type DiffVirtualizer = {
  getTotalSize: () => number
  getVirtualItems: () => VirtualItem[]
}

export function DiffCanvas(props: {
  viewMode: Accessor<ViewMode>
  rows: Accessor<Row[]>
  bands: Accessor<SplitBand[]>
  virt: DiffVirtualizer
  splitVirt: DiffVirtualizer
  stickyHead: () => JSX.Element
  // The scroller must be handed back: the virtualizer only produces rows once it has this element.
  publishScrollEl: (element: HTMLDivElement, mode: ViewMode) => void
  onScroll: (element: HTMLDivElement) => void
  scheduleElementMeasure: (target: 'unified' | 'split', element: HTMLElement) => void
  shouldMeasureRow: (row: Row) => boolean
  shouldMeasureBand: (band: SplitBand) => boolean
  onMutated: () => void
  resolveThread: (threadId: string, resolved: boolean) => Promise<unknown>
  replyReview: (databaseId: number, body: string) => Promise<unknown>
  expandGap: (gap: GapRow) => Promise<void>
  retryDiff: (path: string) => void
  mentions: () => string[]
  threadCollapse: (thread: Thread) => ThreadCollapseController
  fileCollapsed: (path: string) => boolean
  onToggleFileCollapse: (path: string) => void
  lineComment: (row: CodeRow) => { side: 'LEFT' | 'RIGHT'; lineNo: number; key: string; canAdd: boolean }
  addComment: (body: string, path: string, lineNo: number, side: 'LEFT' | 'RIGHT') => Promise<unknown>
  composerFor: (key: string) => LineComposerController
  splitComposer: (row: CodeRow | null, side: 'LEFT' | 'RIGHT') => LineComposerController | undefined
  headSha: Accessor<string | null>
  invalidate: () => void
  findHighlight: (row: CodeRow) => FindHighlight | undefined
}) {
  const virtualRows = () => props.virt.getVirtualItems().flatMap((vi) => {
    const row = props.rows()[vi.index]
    return row ? [{ vi, row }] : []
  })
  const virtualBands = () => props.splitVirt.getVirtualItems().flatMap((vi) => {
    const band = props.bands()[vi.index]
    return band ? [{ vi, band }] : []
  })

  return (
    <Show when={props.viewMode() === 'split'} fallback={
      <div class="diff" ref={(el) => props.publishScrollEl(el, 'unified')} onScroll={(e) => props.onScroll(e.currentTarget)}>
        {props.stickyHead()}
        <div class="diff-rows" style={{ height: `${props.virt.getTotalSize()}px` }}>
          <For each={virtualRows()}>
            {({ vi, row }) => {
              let rowEl: HTMLDivElement | undefined
              const measureRow = () => {
                if (rowEl) props.scheduleElementMeasure('unified', rowEl)
              }
              return (
                <div
                  class="diff-row"
                  classList={{
                    'diff-hunk': row.kind === 'hunk',
                    'diff-add': row.kind === 'insert',
                    'diff-del': row.kind === 'delete',
                    'diff-file-row': row.kind === 'file',
                    'diff-thread-row': row.kind === 'thread' || row.kind === 'nodiff' || row.kind === 'load',
                  }}
                  data-index={vi.index}
                  ref={(el) => {
                    rowEl = el
                    if (props.shouldMeasureRow(row)) props.scheduleElementMeasure('unified', el)
                  }}
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <Show
                    when={isCodeRow(row) ? row : null}
                    fallback={
                      <NonCodeRow
                        row={row as Exclude<Row, CodeRow>}
                        onMutated={props.invalidate}
                        resolveThread={(threadId, resolved) => props.resolveThread(threadId, resolved)}
                        reply={(databaseId, body) => props.replyReview(databaseId, body)}
                        expandGap={props.expandGap}
                        retryDiff={(file) => props.retryDiff(file.path)}
                        mentions={props.mentions()}
                        threadCollapse={props.threadCollapse}
                        fileCollapsed={props.fileCollapsed}
                        onToggleFileCollapse={props.onToggleFileCollapse}
                        onLayoutChange={measureRow}
                      />
                    }
                  >
                    {(code) => {
                      const comment = props.lineComment(code())
                      return (
                        <DiffLine
                          r={code()}
                          canAdd={comment.canAdd}
                          addComment={(body) => props.addComment(body, code().path, comment.lineNo, comment.side)}
                          onMutated={props.invalidate}
                          composer={comment.canAdd ? props.composerFor(comment.key) : undefined}
                          mentions={props.mentions()}
                          highlight={props.findHighlight(code())}
                        />
                      )
                    }}
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    }>
      <div class="diff diff-split" ref={(el) => props.publishScrollEl(el, 'split')} onScroll={(e) => props.onScroll(e.currentTarget)}>
        {props.stickyHead()}
        <div class="diff-split-rows" style={{ height: `${props.splitVirt.getTotalSize()}px` }}>
          <For each={virtualBands()}>
            {({ vi, band }) => {
              let bandEl: HTMLDivElement | undefined
              const measureBand = () => {
                if (bandEl) props.scheduleElementMeasure('split', bandEl)
              }
              const fullRow = () => (band as Extract<SplitBand, { kind: 'full' }>).row
              return (
                <div
                  class="diff-split-band"
                  data-index={vi.index}
                  ref={(el) => {
                    bandEl = el
                    if (props.shouldMeasureBand(band)) props.scheduleElementMeasure('split', el)
                  }}
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <Show
                    when={band.kind === 'pair' ? (band as Extract<SplitBand, { kind: 'pair' }>) : null}
                    fallback={
                      <div
                        class="diff-split-full"
                        classList={{
                          'diff-hunk': fullRow().kind === 'hunk',
                          'diff-file-row': fullRow().kind === 'file',
                          'diff-thread-row': fullRow().kind === 'thread' || fullRow().kind === 'nodiff' || fullRow().kind === 'load',
                        }}
                      >
                        <NonCodeRow
                          row={fullRow()}
                          onMutated={props.invalidate}
                          resolveThread={(threadId, resolved) => props.resolveThread(threadId, resolved)}
                          reply={(databaseId, body) => props.replyReview(databaseId, body)}
                          expandGap={props.expandGap}
                          retryDiff={(file) => props.retryDiff(file.path)}
                          mentions={props.mentions()}
                          threadCollapse={props.threadCollapse}
                          fileCollapsed={props.fileCollapsed}
                          onToggleFileCollapse={props.onToggleFileCollapse}
                          onLayoutChange={measureBand}
                        />
                      </div>
                    }
                  >
                    {(pair) => (
                      <div class="diff-split-pair">
                        <SplitCell
                          r={pair().left}
                          gutter={pair().left?.oldNo ?? null}
                          canAdd={!!props.headSha() && pair().left?.oldNo != null}
                          addComment={(body) => props.addComment(body, pair().left!.path, pair().left!.oldNo!, 'LEFT')}
                          onMutated={props.invalidate}
                          composer={props.splitComposer(pair().left, 'LEFT')}
                          mentions={props.mentions()}
                          highlight={pair().left ? props.findHighlight(pair().left!) : undefined}
                        />
                        <SplitCell
                          r={pair().right}
                          gutter={pair().right?.newNo ?? null}
                          canAdd={!!props.headSha() && pair().right?.newNo != null}
                          addComment={(body) => props.addComment(body, pair().right!.path, pair().right!.newNo!, 'RIGHT')}
                          onMutated={props.invalidate}
                          composer={props.splitComposer(pair().right, 'RIGHT')}
                          mentions={props.mentions()}
                          highlight={pair().right ? props.findHighlight(pair().right!) : undefined}
                        />
                      </div>
                    )}
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}
