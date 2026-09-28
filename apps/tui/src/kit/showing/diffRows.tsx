/** @jsxImportSource @acorn/tui/jsx */
import { createMemo, For, Show } from 'solid-js'
import { buildDiffRows, isCodeRow, plainTokenize, type CodeRow, type DiffFile, type HunkRow, type Row as DiffRowT } from '@acorn/client-core/kit/diff/diffModel.ts'
import type { PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import { annotationKey } from '@acorn/client-core/host/annotations/annotationKey.ts'
import { annotationsFor } from '@acorn/client-core/host/annotations/annotations.ts'
import { Line, Run, runStyle } from '../cells'
import { Icon } from './marks'

/** reduced: no intra-line word highlight. The gutter is the change, the colour is the direction.
 *
 *  One `text` with two runs in it, and `flexShrink={0}` on it, and both halves of that are the same
 *  bug in two directions. A row of two `Line`s is a row of two boxes, so a line wider than the column
 *  shrank both and each clipped its own content, which put the gutter's last digit against the `+`
 *  and lost the space between them; a run inside one `text` clips once, at the end, where a reader
 *  expects it (../cells.tsx § Run). And a column of rows taller than the panel shrank every row
 *  instead of scrolling, so four hundred diff lines were drawn into thirty rows on top of each other
 *  — the smear this node shipped with. A diff row is one line high and never less. */
export function DiffLine(props: { r: CodeRow; canAdd?: boolean; highlight?: unknown }) {
  const mark = () => (props.r.kind === 'insert' ? '+' : props.r.kind === 'delete' ? '-' : ' ')
  const tone = () => (props.r.kind === 'insert' ? 'ok' : props.r.kind === 'delete' ? 'danger' : undefined)
  return (
    <text flexShrink={0} wrapMode="none">
      <Run role="muted">{`${String(props.r.oldNo ?? '').padStart(4)} ${String(props.r.newNo ?? '').padStart(4)} `}</Run>
      <Run tone={tone()}>{`${mark()}${props.r.raw}`}</Run>
    </text>
  )
}

/** reduced: the path in bold with `+n −m` at the far end, and no collapse control. */
export function FileHead(props: { file: Pick<DiffFile, 'path' | 'additions' | 'deletions'>; anchorId?: string; collapsed?: boolean; onToggleCollapse?: (path: string) => void }) {
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
      case 'file': return row.file.path
      case 'hunk': return row.text
      case 'gap': return `… ${row.count ?? 'more'} unchanged lines`
      case 'nodiff': return 'no changes'
      case 'load': return row.status === 'error' ? 'could not load this diff' : 'loading…'
      case 'thread': return `${row.thread.comments.length} comment${row.thread.comments.length === 1 ? '' : 's'}`
      default: return ''
    }
  }
  return <text flexShrink={0} wrapMode="none" {...runStyle('muted')}>{text()}</text>
}

/** reduced: show the file header and unified rows without interactive diff controls. */
export function StackedDiff(props: { path: string; patch: string; lineNumbers?: boolean }) {
  const rows = createMemo(() => {
    const file = { path: props.path, status: null, additions: null, deletions: null, sha: null, viewed: false, patch: props.patch }
    return buildDiffRows(file, plainTokenize).flatMap<HunkRow | CodeRow>((row) => {
      if (row.kind === 'hunk') return [row]
      if (!isCodeRow(row)) return []
      return [props.lineNumbers === false ? { ...row, oldNo: null, newNo: null } : row]
    })
  })
  const head = () => ({
    path: props.path,
    additions: rows().filter((row) => row.kind === 'insert').length,
    deletions: rows().filter((row) => row.kind === 'delete').length,
  })
  return (
    <box flexDirection="column" flexShrink={0}>
      <FileHead file={head()} />
      <For each={rows()}>
        {(row) => (isCodeRow(row) ? <DiffLine r={row} /> : <NonCodeRow row={row as Exclude<DiffRowT, CodeRow>} />)}
      </For>
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
            <Line tone={mark.severity === 'danger' ? 'danger' : mark.severity === 'warn' ? 'warn' : undefined}>{mark.text}</Line>
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
