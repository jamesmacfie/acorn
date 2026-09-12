import { For, Show } from 'solid-js'
import { EmptyState, Table, TableCell, TableHead, TableRow } from '../../../kit/components/primitives'
import Cell from './Cell'
import type { PanelViewProps } from './props'

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
  return (
    <Show
      when={props.rows.length && props.fields.length}
      fallback={<EmptyState align="start" size="sm">Nothing to show.</EmptyState>}
    >
      <Table size="sm" stickyHead>
        <TableRow head>
          <For each={props.fields}>{(field) => <TableHead>{field.name}</TableHead>}</For>
        </TableRow>
        <For each={props.rows}>
          {(row) => (
            <TableRow onPress={row.action ? () => props.onActivate(row) : undefined}>
              <For each={props.fields}>
                {(field) => <TableCell><Cell field={field} value={row.values[field.id]} /></TableCell>}
              </For>
            </TableRow>
          )}
        </For>
      </Table>
    </Show>
  )
}
