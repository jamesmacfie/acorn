import { For, Show } from 'solid-js'
import { EmptyState, Table, TableCell, TableHead, TableRow } from '../../../kit/components/primitives'
import Cell from './Cell'
import { rowPress, type PanelViewProps } from './props'

// The table view: columns are the projected fields, each cell drawn by its field's semantic type.
//
// A row's declared action is `TableRow`'s `onPress`, which carries the keyboard wiring the primitive
// `Row` would have given a list. A table cell can't be a Row, and a table whose rows are only
// clickable by mouse is a table half the app can't use.
//
// No source column is hardcoded here. Provenance is an ordinary panel-local field on a mapped
// multi-source panel (mapping.ts § PANEL_SOURCE_FIELD_ID), so it arrives through `fields` like every
// other column: projectable, hideable, reorderable and filterable, none of which the special case
// allowed.

export default function TableView(props: PanelViewProps) {
  const table = (rows: typeof props.rows) => (
    <Show
      when={rows.length && props.fields.length}
      fallback={<EmptyState align="start" size="sm">Nothing to show.</EmptyState>}
    >
      <Table size="sm" stickyHead>
        <TableRow head>
          <For each={props.fields}>{(field) => <TableHead>{field.name}</TableHead>}</For>
        </TableRow>
        <For each={rows}>
          {(row) => (
            <TableRow onPress={rowPress(props, row)}>
              <For each={props.fields}>
                {(field) => <TableCell><Cell field={field} value={row.values[field.id]} unit={row.units?.[field.id]} /></TableCell>}
              </For>
            </TableRow>
          )}
        </For>
      </Table>
    </Show>
  )
  const sections = (groups: NonNullable<typeof props.groups>) => <For each={groups}>{group => <section class="dash-row-group"><h4>{`${group.label} · ${group.count}`}</h4>{group.children?.length ? sections(group.children) : table(group.rows)}</section>}</For>
  return props.groups?.length ? sections(props.groups) : table(props.rows)
}
