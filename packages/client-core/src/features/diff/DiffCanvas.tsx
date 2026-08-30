import { For, onCleanup, onMount, Show } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'
import { DiffLine, NonCodeRow, SplitCell, type LineComposerController, type ThreadCollapseController } from '../../kit/diff/DiffRows'
import type { FindHighlight } from '../../kit/diff/find'
import { isCodeRow, type CodeRow, type DiffThread, type GapRow, type Row, type SplitBand, type ViewMode } from '../../kit/diff/model'
import { createSplitScrollSync } from '../../kit/diff/splitScrollSync'

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
  /** Widest code line in columns: the row canvas's width, since code lines don't wrap. */
  maxCols: Accessor<number>
  scheduleElementMeasure: (target: 'unified' | 'split', element: HTMLElement) => void
  shouldMeasureRow: (row: Row) => boolean
  shouldMeasureBand: (band: SplitBand) => boolean
  onMutated: () => void
  resolveThread: (threadId: string, resolved: boolean) => Promise<unknown>
  replyReview: (databaseId: number, body: string) => Promise<unknown>
  expandGap: (gap: GapRow) => Promise<void>
  retryDiff: (path: string) => void
  mentions: () => string[]
  threadCollapse: (thread: DiffThread) => ThreadCollapseController
  fileCollapsed: (path: string) => boolean
  onToggleFileCollapse: (path: string) => void
  lineComment: (row: CodeRow) => { side: 'LEFT' | 'RIGHT'; lineNo: number; key: string; canAdd: boolean }
  addComment: (body: string, row: CodeRow, side: 'LEFT' | 'RIGHT', lineNo: number) => Promise<unknown>
  composerFor: (key: string) => LineComposerController
  splitComposer: (row: CodeRow | null, side: 'LEFT' | 'RIGHT') => LineComposerController | undefined
  canComment: Accessor<boolean>
  invalidate: () => void
  findHighlight: (row: CodeRow) => FindHighlight | undefined
  /** The source's own annotation under a code row. See DiffSource.lineExtra. */
  lineExtra?: (row: CodeRow) => JSX.Element
  /** The source's own click affordance on a code row. See DiffSource.lineAction. */
  lineAction?: { title: string; run: (row: CodeRow, event: MouseEvent) => void }
}) {
  const virtualRows = () => props.virt.getVirtualItems().flatMap((vi) => {
    const row = props.rows()[vi.index]
    return row ? [{ vi, row }] : []
  })
  const virtualBands = () => props.splitVirt.getVirtualItems().flatMap((vi) => {
    const band = props.bands()[vi.index]
    return band ? [{ vi, band }] : []
  })

  const splitScroll = createSplitScrollSync()
  onCleanup(splitScroll.dispose)

  return (
    <Show when={props.viewMode() === 'split'} fallback={
      <div class="diff" ref={(el) => props.publishScrollEl(el, 'unified')} onScroll={(e) => props.onScroll(e.currentTarget)}>
        {/* Inside the canvas, not the scroller: the sticky head needs a canvas-wide containing
            block to stay put when the wide unified canvas scrolls sideways. */}
        <div class="diff-rows" style={{ height: `${props.virt.getTotalSize()}px`, '--diff-cols': props.maxCols() }}>
          {props.stickyHead()}
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
                  title={props.lineAction && isCodeRow(row) ? props.lineAction.title : undefined}
                  onClick={props.lineAction && isCodeRow(row)
                    ? ((e) => props.lineAction!.run(row, e))
                    : undefined}
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
                        <>
                          <DiffLine
                            r={code()}
                            canAdd={comment.canAdd}
                            addComment={(body) => props.addComment(body, code(), comment.side, comment.lineNo)}
                            onMutated={props.invalidate}
                            composer={comment.canAdd ? props.composerFor(comment.key) : undefined}
                            mentions={props.mentions()}
                            highlight={props.findHighlight(code())}
                          />
                          {/* Its own line under the code. `.diff-row` wraps, so anything drawn
                              beside `DiffLine` needs a full basis or it shares the line with the code
                              and squeezes it. The wrapper is the host's, so neither a plugin's own
                              annotation nor another plugin's marks has to know that. */}
                          <div class="diff-line-extra">{props.lineExtra?.(code())}</div>
                        </>
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
        <div
          class="diff-split-rows"
          style={{ height: `${props.splitVirt.getTotalSize()}px` }}
          ref={(el) => splitScroll.attach(el)}
        >
          {props.stickyHead()}
          <For each={virtualBands()}>
            {({ vi, band }) => {
              let bandEl: HTMLDivElement | undefined
              const measureBand = () => {
                if (bandEl) props.scheduleElementMeasure('split', bandEl)
              }
              // onMount, not the ref: the cells are not in the DOM yet when the ref for their band
              // fires. A band scrolling in while its column is scrolled right must not start at 0.
              onMount(() => {
                if (bandEl) splitScroll.adopt(bandEl)
              })
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
                      <>
                        <div class="diff-split-pair">
                          <SplitCell
                            r={pair().left}
                            gutter={pair().left?.oldNo ?? null}
                            canAdd={props.canComment() && pair().left?.oldNo != null}
                            addComment={(body) => props.addComment(body, pair().left!, 'LEFT', pair().left!.oldNo!)}
                            onMutated={props.invalidate}
                            composer={props.splitComposer(pair().left, 'LEFT')}
                            mentions={props.mentions()}
                            highlight={pair().left ? props.findHighlight(pair().left!) : undefined}
                          />
                          <SplitCell
                            r={pair().right}
                            gutter={pair().right?.newNo ?? null}
                            canAdd={props.canComment() && pair().right?.newNo != null}
                            addComment={(body) => props.addComment(body, pair().right!, 'RIGHT', pair().right!.newNo!)}
                            onMutated={props.invalidate}
                            composer={props.splitComposer(pair().right, 'RIGHT')}
                            mentions={props.mentions()}
                            highlight={pair().right ? props.findHighlight(pair().right!) : undefined}
                          />
                        </div>
                        {/* Below the pair rather than inside a cell: an annotation is about the line,
                            and both columns can be showing the same one. */}
                        <Show when={props.lineExtra}>
                          {(extra) => (
                            <div class="diff-line-extra">
                              <Show when={pair().left}>{(left) => extra()(left())}</Show>
                              <Show when={pair().right}>{(right) => extra()(right())}</Show>
                            </div>
                          )}
                        </Show>
                      </>
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
