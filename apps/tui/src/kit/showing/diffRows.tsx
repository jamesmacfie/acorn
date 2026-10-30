/** @jsxImportSource @acorn/tui/jsx */
import { createMemo, For, Show, type JSX } from 'solid-js'
import {
  buildDiffRows,
  isCodeRow,
  plainTokenize,
  type CodeRow,
  type DiffFile,
  type HunkRow,
  type Row as DiffRowT,
} from '@acorn/client-core/kit/diff/diffModel.ts'
import type { PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import { annotationKey } from '@acorn/client-core/host/annotations/annotationKey.ts'
import { annotationsFor } from '@acorn/client-core/host/annotations/annotations.ts'
import {
  createPinnedNotes,
  DiffNotesProvider,
  linePlace,
  placeNotes,
  type DiffLinePlace,
  type PinnedNote,
} from '@acorn/client-core/kit/diff'
import { stop } from '../../keys/stops'
import { Line, Run, runStyle } from '../cells'
import { litControl } from '../roles'
import { Icon } from './marks'

/** reduced: no intra-line word highlight. The gutter is the change, the colour is the direction.
 *
 *  One `text` with two runs in it, and `flexShrink={0}` on it, and both halves of that guard the same
 *  failure in two directions. A row of two `Line`s is a row of two boxes, so a line wider than the
 *  column shrinks both and each clips its own content, which puts the gutter's last digit against the
 *  `+` and loses the space between them; a run inside one `text` clips once, at the end, where a reader
 *  expects it (../cells.tsx § Run). And a column of rows taller than the panel would shrink every row
 *  instead of scrolling, drawing hundreds of diff lines on top of each other. A diff row is one line
 *  high and never less. */
export function DiffLine(props: { r: CodeRow; canAdd?: boolean; highlight?: unknown; focused?: boolean }) {
  const mark = () => (props.r.kind === 'insert' ? '+' : props.r.kind === 'delete' ? '-' : ' ')
  const tone = () => (props.r.kind === 'insert' ? 'ok' : props.r.kind === 'delete' ? 'danger' : undefined)
  return (
    <text flexShrink={0} wrapMode="none">
      <Run
        {...(props.focused ? litControl({ focused: true }) : { role: 'muted' as const })}
      >{`${String(props.r.oldNo ?? '').padStart(4)} ${String(props.r.newNo ?? '').padStart(4)} `}</Run>
      <Run tone={tone()}>{`${mark()}${props.r.raw}`}</Run>
    </text>
  )
}

/** reduced: the path in bold with `+n −m` at the far end, and no collapse control. */
export function FileHead(props: {
  file: Pick<DiffFile, 'path' | 'additions' | 'deletions'>
  anchorId?: string
  collapsed?: boolean
  onToggleCollapse?: (path: string) => void
}) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <Line role="strong">{props.file.path}</Line>
      <box flexGrow={1} />
      <Line tone="ok">{`+${props.file.additions ?? 0}`}</Line>
      <Line tone="danger">{`−${props.file.deletions ?? 0}`}</Line>
    </box>
  )
}

/** reduced: a dim line saying what is not being shown, with no control to act on it. */
export function NonCodeRow(props: { row: Exclude<DiffRowT, CodeRow> }) {
  const text = () => {
    const row = props.row
    switch (row.kind) {
      case 'file':
        return row.file.path
      case 'hunk':
        return row.text
      case 'gap':
        return `… ${row.count ?? 'more'} unchanged lines`
      case 'nodiff':
        return 'no changes'
      case 'load':
        return row.status === 'error' ? 'could not load this diff' : 'loading…'
      case 'thread':
        return `${row.thread.comments.length} comment${row.thread.comments.length === 1 ? '' : 's'}`
      default:
        return ''
    }
  }
  return (
    <text flexShrink={0} wrapMode="none" {...runStyle('muted')}>
      {text()}
    </text>
  )
}

/** reduced: the file header and unified rows, with each `DiffNote` child under its row at the code
 *  column. A cell has no hover to show ✦ on, so with `onActivate` each numbered line is a stop instead,
 *  and pressing it sends the line's place. */
export function StackedDiff(props: {
  path: string
  patch: string
  lineNumbers?: boolean
  onActivate?: (place: DiffLinePlace) => void
  children?: JSX.Element
}) {
  const rows = createMemo(() => {
    const file = {
      path: props.path,
      status: null,
      additions: null,
      deletions: null,
      sha: null,
      viewed: false,
      patch: props.patch,
    }
    return buildDiffRows(file, plainTokenize).filter(
      (row): row is HunkRow | CodeRow => row.kind === 'hunk' || isCodeRow(row),
    )
  })
  const head = () => ({
    path: props.path,
    additions: rows().filter((row) => row.kind === 'insert').length,
    deletions: rows().filter((row) => row.kind === 'delete').length,
  })
  const { notes, pin } = createPinnedNotes<JSX.Element>()
  const placed = createMemo(() => placeNotes(rows(), notes()))
  return (
    <DiffNotesProvider value={pin}>
      <box flexDirection="column" flexShrink={0}>
        <FileHead file={head()} />
        <For each={rows()}>
          {(row, index) =>
            isCodeRow(row) ? (
              <>
                <StackedLine
                  r={props.lineNumbers === false ? { ...row, oldNo: null, newNo: null } : row}
                  onActivate={props.onActivate}
                />
                <For each={placed().under.get(index()) ?? []}>{(note) => <NoteLines note={note} />}</For>
              </>
            ) : (
              <NonCodeRow row={row as Exclude<DiffRowT, CodeRow>} />
            )
          }
        </For>
        <For each={placed().unplaced}>{(note) => <NoteLines note={note} unplaced />}</For>
        {props.children}
      </box>
    </DiffNotesProvider>
  )
}

function StackedLine(props: { r: CodeRow; onActivate?: (place: DiffLinePlace) => void }) {
  const place = () => linePlace(props.r)
  return (
    <Show when={props.onActivate && place()} fallback={<DiffLine r={props.r} />}>
      {(at) => {
        const control = stop({ onPress: () => props.onActivate?.(at()) })
        return (
          <box flexShrink={0} ref={control.ref}>
            <DiffLine r={props.r} focused={control.focused()} />
          </box>
        )
      }}
    </Show>
  )
}

/** reduced: one header line, `▾ ✦ Label  Title`, that folds the note when pressed, then the tree's
 *  children. A folded note is its header line only. */
function NoteLines(props: { note: PinnedNote<JSX.Element>; unplaced?: boolean }) {
  const note = () => props.note.props
  const folded = () => props.note.folded()
  const control = stop({ onPress: () => props.note.setFolded(!folded()) })
  const where = () => (props.unplaced ? `  ${note().side === 'old' ? 'Deleted line' : 'Line'} ${note().line}` : '')
  return (
    <box flexDirection="column" paddingLeft={GUTTER_CELLS} flexShrink={0}>
      <box flexShrink={0} ref={control.ref}>
        <text flexShrink={0} wrapMode="none">
          <Run {...litControl({ focused: control.focused(), tone: note().tone })}>
            {`${folded() ? '▸' : '▾'} ✦ ${note().label ?? ''}`}
          </Run>
          <Run role={control.focused() ? 'strong' : 'body'}>{`  ${note().title ?? ''}`}</Run>
          <Run role="muted">{where()}</Run>
        </text>
      </box>
      <Show when={!folded()}>
        <box flexDirection="column" flexShrink={0}>
          {note().children}
        </box>
      </Show>
    </box>
  )
}

/** absent: side-by-side needs 160 cells, so a terminal diff is unified. */
export const SplitCell = (_props: { r: CodeRow | null; gutter: number | null }) => null

/** Draw an annotation beside its plugin ID. The diff pane owns placement below the code line. */
export function AnnotationMarks(props: { point: string; itemKey: PluginAnnotationKey }) {
  const marks = () => annotationsFor(props.point, props.itemKey)
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <For each={marks()}>
        {(mark) => (
          <box flexDirection="row" gap={1} flexShrink={0}>
            <Show when={mark.icon}>{(name) => <Icon name={name()} />}</Show>
            <Line tone={mark.severity === 'danger' ? 'danger' : mark.severity === 'warn' ? 'warn' : undefined}>
              {mark.text}
            </Line>
            <Line role="muted">{mark.pluginId}</Line>
          </box>
        )}
      </For>
    </box>
  )
}

/** Put marks below the code line. Text appended to a long, unwrapped line would be clipped.
 *  Unmarked lines keep the single-text renderable from `DiffLine`. */
const GUTTER_CELLS = 10

export function AnnotatedDiffLine(props: { r: CodeRow; point?: string }) {
  const marks = () => (props.point ? annotationsFor(props.point, annotationKey(props.r)).length : 0)
  return (
    <Show when={props.point && marks()} fallback={<DiffLine r={props.r} />}>
      <box flexDirection="column" flexShrink={0}>
        <DiffLine r={props.r} />
        <box flexDirection="row" paddingLeft={GUTTER_CELLS} flexShrink={0} overflow="hidden">
          <AnnotationMarks point={props.point!} itemKey={annotationKey(props.r)} />
        </box>
      </box>
    </Show>
  )
}
