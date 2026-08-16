import { For, Show } from 'solid-js'
import { EmptyState, Row } from '../../ui/primitives'
import { titleField } from '../shaping'
import Cell from './Cell'
import Provenance from './Provenance'
import type { PanelViewProps } from './props'

// The list view: the title-role field leads, everything else projected trails as meta.
//
// Built on `Row`, which is what makes a panel over a third-party plugin's collection pixel-identical
// to one over github's under every appearance pack — the same argument the descriptor rail makes.

export default function ListView(props: PanelViewProps) {
  const lead = () => titleField(props.schema)
  const status = () => props.fields.find((field) => field.role === 'status' && field.type === 'enum')
  // Everything the panel projects except the two the row already draws in their own slots.
  const meta = () => props.fields.filter((field) => field.id !== lead()?.id && field.id !== status()?.id)

  return (
    <For each={props.rows} fallback={<EmptyState align="start" size="sm">Nothing to show.</EmptyState>}>
      {(row) => (
        <Row
          density="compact"
          onActivate={row.action ? () => props.onActivate(row) : undefined}
          leading={(
            <>
              <Show when={props.provenance}><Provenance pluginId={row.pluginId} /></Show>
              <Show when={status()}>{(field) => <Cell field={field()} value={row.values[field().id]} />}</Show>
            </>
          )}
          meta={
            <For each={meta()}>
              {(field) => (
                <span class="dash-list-meta">
                  <Cell field={field} value={row.values[field.id]} />
                </span>
              )}
            </For>
          }
        >
          <Show when={lead()} fallback={row.id}>
            {(field) => <Cell field={field()} value={row.values[field().id]} />}
          </Show>
        </Row>
      )}
    </For>
  )
}
