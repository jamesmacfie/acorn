import { For, Show } from 'solid-js'
import { EmptyState, Table } from '../../ui/primitives'
import Cell from './Cell'
import Provenance from './Provenance'
import type { PanelViewProps } from './props'

// The table view: columns are the projected fields, each cell drawn by its field's semantic type.
//
// A row's declared action rides the <tr>, with the keyboard wiring the primitive `Row` would have
// given a list — a table cell cannot be a Row, and a table whose rows are only clickable by mouse is
// a table half the app cannot use.

export default function TableView(props: PanelViewProps) {
  return (
    <Show
      when={props.rows.length && props.fields.length}
      fallback={<EmptyState align="start" size="sm">Nothing to show.</EmptyState>}
    >
      <Table size="sm" stickyHead>
        <thead>
          <tr>
            <Show when={props.provenance}><th scope="col">Source</th></Show>
            <For each={props.fields}>{(field) => <th scope="col">{field.name}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr
                role={row.action ? 'button' : undefined}
                tabindex={row.action ? 0 : undefined}
                onClick={row.action ? () => props.onActivate(row) : undefined}
                onKeyDown={row.action
                  ? (event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    props.onActivate(row)
                  }
                  : undefined}
              >
                <Show when={props.provenance}><td><Provenance pluginId={row.pluginId} /></td></Show>
                <For each={props.fields}>
                  {(field) => <td><Cell field={field} value={row.values[field.id]} /></td>}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </Table>
    </Show>
  )
}
