import { createMemo, For, Show } from 'solid-js'
import type { AvailableModelConnection } from '../../shared/modelProviders'

// Controlled connection + model dropdowns over the configured model-provider connections
// (availableModelConnections in core/shared/modelProviders). The connection select is hidden when
// only one is configured. Reusable by any plugin whose route consumes generateTextForConnection.

export const defaultModelIdFor = (connection: AvailableModelConnection | undefined): string =>
  connection?.provider.defaultModelId ?? connection?.provider.models?.[0]?.id ?? ''

export default function ModelConnectionPicker(props: {
  connections: AvailableModelConnection[]
  connectionId: string
  modelId: string
  onChange: (selection: { connectionId: string; modelId: string }) => void
}) {
  const current = createMemo(
    () => props.connections.find((c) => c.connection.id === props.connectionId) ?? props.connections[0],
  )
  const models = () => current()?.provider.models ?? []

  return (
    <>
      <Show when={props.connections.length > 1}>
        <select
          class="integration-key-input"
          title="Model provider"
          value={current()?.connection.id ?? ''}
          onChange={(e) => {
            const next = props.connections.find((c) => c.connection.id === e.currentTarget.value)
            props.onChange({ connectionId: e.currentTarget.value, modelId: defaultModelIdFor(next) })
          }}
        >
          <For each={props.connections}>
            {(c) => <option value={c.connection.id}>{c.connection.label || c.provider.label}</option>}
          </For>
        </select>
      </Show>
      <Show when={models().length}>
        <select
          class="integration-key-input"
          title="Model"
          value={props.modelId}
          onChange={(e) => props.onChange({ connectionId: current()?.connection.id ?? '', modelId: e.currentTarget.value })}
        >
          <For each={models()}>{(m) => <option value={m.id}>{m.label}</option>}</For>
        </select>
      </Show>
    </>
  )
}
