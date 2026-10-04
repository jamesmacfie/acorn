import { createEffect, createSignal, For, on, Show } from 'solid-js'
import { Button, Checkbox, ConfirmButton, DetailColumn, Field, Heading, IconButton, Stack, Text, Textarea, Toolbar, ToolbarSpacer } from '@acorn/plugin-api/ui/tree'
import type { DbCell, DbColumn, DbTable } from '../shared/database'

export type RowDraft = Record<string, { value: string; isNull: boolean }>

// Row viewer + editor: column→value fields; editable when the rows belong to a single table with a
// primary key (ad-hoc SQL results are read-only). Save commits changed columns; Delete removes by PK. In
// `insert` mode the fields start blank and Save inserts a new row.
export default function RowDetail(props: {
  insert?: boolean
  columns: string[]
  row: DbCell[]
  table: DbTable | null
  meta: DbColumn[]
  busy: boolean
  initialDraft: RowDraft | null
  onDraft: (draft: RowDraft) => void
  onClose: () => void
  onSave?: (edits: [string, DbCell][]) => void | Promise<void>
  onDelete?: () => void | Promise<void>
  onInsert?: (values: Record<string, DbCell>) => void | Promise<void>
}) {
  const metaByName = new Map(props.meta.map((c) => [c.name, c]))
  const editable = () => !!props.table && props.meta.some((c) => c.isPk)
  // Draft state per column: value + explicit-null flag. Edit mode seeds from the row; insert mode
  // starts every column null (so untouched columns take their DB default / are omitted).
  const seed = (): RowDraft => Object.fromEntries(props.columns.map((col, i) => [col,
    props.insert ? { value: '', isNull: true } : { value: props.row[i] ?? '', isNull: props.row[i] === null },
  ]))
  const [draft, setDraft] = createSignal<RowDraft>(props.initialDraft ?? seed())
  // A refreshed result must seed the new row, while a returning pane keeps its unsaved edits.
  createEffect(on(() => [props.columns, props.row], () => setDraft(seed()), { defer: true }))
  const set = (col: string, patch: Partial<{ value: string; isNull: boolean }>) => {
    const next = { ...draft(), [col]: { ...draft()[col], ...patch } }
    setDraft(next)
    props.onDraft(next)
  }

  const save = () => {
    const d = draft()
    if (props.insert) {
      // Only send columns the user actually set (non-null); everything else takes its DB default.
      const values: Record<string, DbCell> = {}
      for (const c of props.columns) if (!d[c].isNull) values[c] = d[c].value
      void props.onInsert?.(values)
      return
    }
    const edits: [string, DbCell][] = []
    props.columns.forEach((c, i) => {
      const cur: DbCell = d[c].isNull ? null : d[c].value
      const orig = props.row[i]
      if (cur !== orig) edits.push([c, cur])
    })
    if (edits.length) void props.onSave?.(edits)
  }

  return (
    <Stack gap="none" grow>
      <Toolbar variant="bar" size="sm">
        <Heading level={3}>
          {props.insert ? `New row in ${props.table?.name ?? ''}` : props.table ? `Row in ${props.table.name}` : 'Row'}
        </Heading>
        <ToolbarSpacer />
        <IconButton size="sm" icon="x" label="Close" onPress={props.onClose} />
      </Toolbar>
      <DetailColumn scroll measure="page">
        <Stack gap="stack">
          <For each={props.columns}>
            {(col) => {
              const m = metaByName.get(col)
              return (
                <Stack gap="row">
                  {/* The column's own name as the label, in its own case: `created_at`, not CREATED_AT.
                      The field names the textarea; the null box is a second control beside it. */}
                  <Field label={col} hint={[m?.dataType, m?.isPk ? 'Primary key' : ''].filter(Boolean).join(' · ')}>
                    <Textarea
                      rows={1}
                      assist={false}
                      disabled={!editable() || draft()[col]?.isNull}
                      value={draft()[col]?.isNull ? '' : draft()[col]?.value ?? ''}
                      placeholder={draft()[col]?.isNull ? 'NULL' : ''}
                      onChange={(value: string) => set(col, { value })}
                    />
                  </Field>
                  {/* Insert mode always offers the null toggle (columns start null so untouched ones take
                      their DB default); edit mode only for nullable columns. */}
                  <Show when={editable() && (props.insert || (m?.nullable ?? true))}>
                    <Checkbox label="Set to NULL" checked={draft()[col]?.isNull} onChange={(checked: boolean) => set(col, { isNull: checked })} />
                  </Show>
                </Stack>
              )
            }}
          </For>
          <Toolbar variant="actions" size="sm">
            <Show
              when={editable()}
              fallback={
                <Text tone="muted">
                  {props.table ? "This table has no primary key, so its rows can't be edited here." : 'To edit a row, open its table from the list.'}
                </Text>
              }
            >
              <Button size="sm" variant="solid" disabled={props.busy} onPress={save}>Save</Button>
              <Show when={!props.insert}>
                {/* Remount the armed control with its row so a second press cannot delete another row. */}
                <Show when={props.row} keyed>
                  <ConfirmButton size="sm" tone="danger" disabled={props.busy} confirmLabel="Delete row?" onConfirm={() => void props.onDelete?.()}>
                    Delete
                  </ConfirmButton>
                </Show>
              </Show>
            </Show>
          </Toolbar>
        </Stack>
      </DetailColumn>
    </Stack>
  )
}
