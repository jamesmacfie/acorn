import { createMemo, For, Index, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import type { Accessor, JSX } from 'solid-js'
import type { DiffDocumentFile } from '@acorn/diff-document/document'
import { Button } from '../../kit/components/primitives'
import { DiffLine, FileHead, NonCodeRow, SplitCell, type LineComposerController, type ThreadCollapseController } from '../../kit/diff/DiffRows'
import type { FindHighlight } from '../../kit/diff/find'
import { DIFF_LINE_HEIGHT, isCodeRow, toBands, type CodeRow, type DiffThread, type GapRow, type Row, type SplitBand, type ViewMode } from '../../kit/diff/diffModel'
import { createSplitScrollSync } from '../../kit/diff/splitScrollSync'
import { threadBlockId, type DiffRangeItem } from './diffLayout'
import type { DiffItem } from './documentView'
import type { SegmentStatus } from './segmentLoader'

/** What the canvas needs from the geometry (./diffLayout.ts). */
type CanvasLayout = {
  range: Accessor<readonly DiffRangeItem[]>
  attachCanvas: (element: HTMLElement) => void
  observeBlock: (element: HTMLElement, block: Accessor<{ id: string; base: number } | null>) => void
  input: () => void
}

/** What a row needs from the pane: the comment layer, gap expansion, find and the source's seams. */
export type DiffRowContext = {
  onMutated: () => void
  resolveThread: (threadId: string, resolved: boolean) => Promise<unknown>
  replyReview: (databaseId: number, body: string) => Promise<unknown>
  expandGap: (gap: GapRow) => Promise<void>
  mentions: () => string[]
  threadCollapse: (thread: DiffThread) => ThreadCollapseController
  lineComment: (row: CodeRow) => { side: 'LEFT' | 'RIGHT'; lineNo: number; key: string; canAdd: boolean }
  addComment: (body: string, row: CodeRow, side: 'LEFT' | 'RIGHT', lineNo: number) => Promise<unknown>
  composerFor: (key: string) => LineComposerController
  splitComposer: (row: CodeRow | null, side: 'LEFT' | 'RIGHT') => LineComposerController | undefined
  canComment: Accessor<boolean>
  findHighlight: (row: CodeRow) => FindHighlight | undefined
  hasLineExtra: (row: CodeRow) => boolean
  lineExtra?: (row: CodeRow) => JSX.Element
  lineAction?: { title: string; run: (row: CodeRow, event: MouseEvent) => void }
  openLine?: (row: CodeRow) => void
  /** The dynamic block a code row or a split band carries now, or null for none (./diffLayout.ts). */
  lineBlock: (row: CodeRow) => string | null
  bandBlock: (left: CodeRow | null, right: CodeRow | null) => string | null
  observeBlock: CanvasLayout['observeBlock']
}

export function DiffCanvas(props: {
  viewMode: Accessor<ViewMode>
  items: Accessor<DiffItem[]>
  /** The geometry for the mode on screen: what is mounted, and where. */
  layout: CanvasLayout
  stickyHead: () => JSX.Element
  // The scroller must be handed back: the virtualizer only produces items once it has this element.
  publishScrollEl: (element: HTMLDivElement, mode: ViewMode) => void
  onScroll: (element: HTMLDivElement) => void
  /** Widest code line in columns: the row canvas's width, since code lines don't wrap. */
  maxCols: Accessor<number>
  /** A mounted segment's or slice's rows with its threads placed, or undefined while not loaded. */
  itemRows: (item: Extract<DiffItem, { kind: 'segment' | 'overlay' }>) => readonly Row[] | undefined
  segmentStatus: (contentKey: string) => SegmentStatus | undefined
  retrySegment: (contentKey: string) => void
  fileCollapsed: (path: string) => boolean
  onToggleFileCollapse: (path: string) => void
  rows: DiffRowContext
}) {
  // Mounted items by key, so an item that stays in range keeps its DOM while the range moves and a
  // composer typing inside it keeps its focus. `For` over the keys, not over the range: the range
  // mints new entries whenever an offset changes.
  const mounted = createMemo(() => {
    const all = props.items()
    const byKey = new Map<string, { vi: DiffRangeItem; item: DiffItem }>()
    for (const vi of props.layout.range()) {
      const item = all[vi.index]
      if (item) byKey.set(item.key, { vi, item })
    }
    return byKey
  })
  const keys = createMemo(() => [...mounted().keys()], undefined, {
    equals: (a, b) => a.length === b.length && a.every((key, at) => key === b[at]),
  })

  const splitScroll = createSplitScrollSync()
  onCleanup(splitScroll.dispose)

  const split = () => props.viewMode() === 'split'

  const itemBody = (item: Accessor<DiffItem>, size: Accessor<number>) => (
    <Switch>
      <Match when={item().kind === 'file'}>
        <FileRowView file={item().file} split={split()} collapsed={props.fileCollapsed(item().file.path)} onToggleCollapse={props.onToggleFileCollapse} />
      </Match>
      <Match when={item().kind === 'nodiff'}>
        <FullRow split={split()} class="diff-thread-row">
          <span class="diff-nodiff muted">No diff (binary or too large).</span>
        </FullRow>
      </Match>
      <Match when={item().kind === 'segment' || item().kind === 'overlay' ? (item() as Extract<DiffItem, { kind: 'segment' | 'overlay' }>) : null}>
        {(content) => {
          const rows = () => props.itemRows(content())
          const contentKey = () => {
            const current = content()
            return current.kind === 'segment' ? current.segment.contentKey : ''
          }
          return (
            <Show when={rows()} fallback={(
              <SegmentPlaceholder
                height={size()}
                failed={props.segmentStatus(contentKey()) === 'error'}
                onRetry={() => props.retrySegment(contentKey())}
              />
            )}>
              {(loaded) => (
                <Show when={split()} fallback={<Index each={loaded()}>{(row) => <UnifiedRow row={row()} ctx={props.rows} />}</Index>}>
                  <Bands rows={loaded()} ctx={props.rows} adopt={splitScroll.adopt} />
                </Show>
              )}
            </Show>
          )
        }}
      </Match>
    </Switch>
  )

  const canvas = () => (
    <For each={keys()}>
      {(key) => {
        const entry = () => mounted().get(key)
        const item = () => entry()!.item
        return (
          <Show when={entry()}>
            <div
              class="diff-item"
              data-index={entry()!.vi.index}
              data-kind={item().kind}
              style={{ transform: `translateY(${entry()!.vi.start}px)` }}
            >
              {itemBody(item, () => entry()!.vi.end - entry()!.vi.start)}
            </div>
          </Show>
        )
      }}
    </For>
  )

  // The reader's own input, so a scroll that follows it is told apart from this pane's corrections.
  // The canvas height is the layout's to set, not a style binding here (./diffLayout.ts says why).
  const input = () => props.layout.input()
  return (
    <Show when={split()} fallback={
      <div
        class="diff"
        ref={(el) => props.publishScrollEl(el, 'unified')}
        onScroll={(e) => props.onScroll(e.currentTarget)}
        onWheel={input}
        onTouchMove={input}
        onPointerDown={input}
        onKeyDown={input}
      >
        {/* Inside the canvas, not the scroller: the sticky head needs a canvas-wide containing
            block to stay put when the wide unified canvas scrolls sideways. */}
        <div class="diff-rows" style={{ '--diff-cols': props.maxCols() }} ref={(el) => props.layout.attachCanvas(el)}>
          {props.stickyHead()}
          {canvas()}
        </div>
      </div>
    }>
      <div
        class="diff diff-split"
        ref={(el) => props.publishScrollEl(el, 'split')}
        onScroll={(e) => props.onScroll(e.currentTarget)}
        onWheel={input}
        onTouchMove={input}
        onPointerDown={input}
        onKeyDown={input}
      >
        <div class="diff-split-rows" ref={(el) => { splitScroll.attach(el); props.layout.attachCanvas(el) }}>
          {props.stickyHead()}
          {canvas()}
        </div>
      </div>
    </Show>
  )
}

/** A full-width row in either projection: a unified row, or a split band's full cell. */
function FullRow(props: { split: boolean; class: string; children: JSX.Element }) {
  return (
    <Show when={props.split} fallback={<div class={`diff-row ${props.class}`}>{props.children}</div>}>
      <div class="diff-split-band">
        <div class={`diff-split-full ${props.class}`}>{props.children}</div>
      </div>
    </Show>
  )
}

function FileRowView(props: { file: DiffDocumentFile; split: boolean; collapsed: boolean; onToggleCollapse: (path: string) => void }) {
  return (
    <FullRow split={props.split} class="diff-file-row">
      <FileHead file={props.file} anchorId={`diff-file:${props.file.path}`} collapsed={props.collapsed} onToggleCollapse={props.onToggleCollapse} />
    </FullRow>
  )
}

/**
 * A segment on screen whose rows have not arrived. Exactly the segment's height, so nothing below it
 * moves when they do and the scrollbar never collapses; it says so in words rather than as a blank.
 */
function SegmentPlaceholder(props: { height: number; failed: boolean; onRetry: () => void }) {
  return (
    <div class="diff-segment-pending" style={{ height: `${Math.max(props.height, 20)}px` }}>
      <span class="diff-load" classList={{ 'diff-load-error': props.failed }}>
        <span>{props.failed ? 'Could not load diff.' : 'Loading diff…'}</span>
        <Show when={props.failed}>
          <Button variant="bare" onPress={props.onRetry}>Retry</Button>
        </Show>
      </span>
    </div>
  )
}

function UnifiedRow(props: { row: Row; ctx: DiffRowContext }) {
  const code = () => (isCodeRow(props.row) ? props.row : null)
  // A thread row is all dynamic block; a code row is one when something is drawn under its line, and
  // that line is the fixed part of it.
  const block = () => {
    if (props.row.kind === 'thread') return { id: threadBlockId(props.row.thread), base: 0 }
    const row = code()
    const id = row && props.ctx.lineBlock(row)
    return id ? { id, base: DIFF_LINE_HEIGHT } : null
  }
  return (
    <div
      ref={(element) => props.ctx.observeBlock(element, block)}
      class="diff-row"
      classList={{
        'diff-hunk': props.row.kind === 'hunk',
        'diff-add': props.row.kind === 'insert',
        'diff-del': props.row.kind === 'delete',
        'diff-thread-row': props.row.kind === 'thread',
      }}
      title={props.ctx.lineAction && code() ? props.ctx.lineAction.title : undefined}
      onClick={(event) => {
        const row = code()
        if (row && props.ctx.lineAction) props.ctx.lineAction.run(row, event)
      }}
    >
      <Show
        when={code()}
        fallback={
          <NonCodeRow
            row={props.row as Exclude<Row, CodeRow>}
            onMutated={props.ctx.onMutated}
            resolveThread={props.ctx.resolveThread}
            reply={props.ctx.replyReview}
            expandGap={props.ctx.expandGap}
            mentions={props.ctx.mentions()}
            threadCollapse={props.ctx.threadCollapse}
          />
        }
      >
        {(row) => {
          const comment = () => props.ctx.lineComment(row())
          return (
            <>
              <DiffLine
                r={row()}
                canAdd={comment().canAdd}
                addComment={(body) => props.ctx.addComment(body, row(), comment().side, comment().lineNo)}
                onMutated={props.ctx.onMutated}
                composer={comment().canAdd ? props.ctx.composerFor(comment().key) : undefined}
                mentions={props.ctx.mentions()}
                highlight={props.ctx.findHighlight(row())}
                openLine={props.ctx.openLine}
              />
              {/* Its own line under the code. `.diff-row` wraps, so anything drawn beside `DiffLine`
                  needs a full basis or it shares the line with the code and squeezes it. The wrapper
                  is the host's, so neither a plugin's own annotation nor another plugin's marks has
                  to know that. */}
              <Show when={props.ctx.hasLineExtra(row())}>
                <div class="diff-line-extra">{props.ctx.lineExtra?.(row())}</div>
              </Show>
            </>
          )
        }}
      </Show>
    </div>
  )
}

/** One segment's rows as split bands. Paired inside the segment, which is exact: the segmenter never
 *  separates a deletion run from its insertions when it can avoid it, and counted the same way. */
function Bands(props: { rows: readonly Row[]; ctx: DiffRowContext; adopt: (band: HTMLElement) => void }) {
  const bands = createMemo(() => toBands([...props.rows]))
  return <Index each={bands()}>{(band) => <SplitBandView band={band()} ctx={props.ctx} adopt={props.adopt} />}</Index>
}

function SplitBandView(props: { band: SplitBand; ctx: DiffRowContext; adopt: (band: HTMLElement) => void }) {
  let bandEl: HTMLDivElement | undefined
  // onMount, not the ref: the cells are not in the DOM yet when the ref for their band fires. A band
  // scrolling in while its column is scrolled right must not start at 0.
  onMount(() => {
    if (bandEl) props.adopt(bandEl)
  })
  const pair = () => (props.band.kind === 'pair' ? props.band : null)
  const full = () => (props.band as Extract<SplitBand, { kind: 'full' }>).row
  const extra = (row: CodeRow | null) => !!row && props.ctx.hasLineExtra(row)
  const block = () => {
    const band = props.band
    if (band.kind === 'full') return band.row.kind === 'thread' ? { id: threadBlockId(band.row.thread), base: 0 } : null
    const id = props.ctx.bandBlock(band.left, band.right)
    return id ? { id, base: DIFF_LINE_HEIGHT } : null
  }
  return (
    <div class="diff-split-band" ref={(element) => { bandEl = element; props.ctx.observeBlock(element, block) }}>
      <Show
        when={pair()}
        fallback={
          <div
            class="diff-split-full"
            classList={{
              'diff-hunk': full().kind === 'hunk',
              'diff-thread-row': full().kind === 'thread',
            }}
          >
            <NonCodeRow
              row={full() as Exclude<Row, CodeRow>}
              onMutated={props.ctx.onMutated}
              resolveThread={props.ctx.resolveThread}
              reply={props.ctx.replyReview}
              expandGap={props.ctx.expandGap}
              mentions={props.ctx.mentions()}
              threadCollapse={props.ctx.threadCollapse}
            />
          </div>
        }
      >
        {(band) => (
          <>
            <div class="diff-split-pair">
              <SplitCell
                r={band().left}
                gutter={band().left?.oldNo ?? null}
                canAdd={props.ctx.canComment() && band().left?.oldNo != null}
                addComment={(body) => props.ctx.addComment(body, band().left!, 'LEFT', band().left!.oldNo!)}
                onMutated={props.ctx.onMutated}
                composer={props.ctx.splitComposer(band().left, 'LEFT')}
                mentions={props.ctx.mentions()}
                highlight={band().left ? props.ctx.findHighlight(band().left!) : undefined}
                openLine={props.ctx.openLine}
              />
              <SplitCell
                r={band().right}
                gutter={band().right?.newNo ?? null}
                canAdd={props.ctx.canComment() && band().right?.newNo != null}
                addComment={(body) => props.ctx.addComment(body, band().right!, 'RIGHT', band().right!.newNo!)}
                onMutated={props.ctx.onMutated}
                composer={props.ctx.splitComposer(band().right, 'RIGHT')}
                mentions={props.ctx.mentions()}
                highlight={band().right ? props.ctx.findHighlight(band().right!) : undefined}
                openLine={props.ctx.openLine}
              />
            </div>
            {/* Below the pair rather than inside a cell: an annotation is about the line, and both
                columns can be showing the same one. */}
            <Show when={extra(band().left) || extra(band().right)}>
              <div class="diff-line-extra">
                <Show when={extra(band().left) ? band().left : null}>{(left) => props.ctx.lineExtra?.(left())}</Show>
                <Show when={extra(band().right) && band().right !== band().left ? band().right : null}>{(right) => props.ctx.lineExtra?.(right())}</Show>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
