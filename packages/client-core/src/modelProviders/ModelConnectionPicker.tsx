import { createMemo, Show } from 'solid-js'
import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import { Select } from '../kit/components/primitives'
import { defaultModelIdFor } from './defaultModel'

// Controlled connection + model dropdowns over the configured model-provider connections
// (availableModelConnections in core/shared/modelProviders). The connection select is hidden when
// only one is configured. Reusable by any plugin whose route consumes generateTextForConnection.

export { defaultModelIdFor }

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
        <Select
          title="Model provider"
          value={current()?.connection.id ?? ''}
          onChange={(value) => {
            const next = props.connections.find((c) => c.connection.id === value)
            props.onChange({ connectionId: value, modelId: defaultModelIdFor(next) })
          }} options={[...props.connections.map((c) => ({ value: c.connection.id, label: c.connection.label || c.provider.label }))]} />
      </Show>
      <Show when={models().length}>
        <Select
          title="Model"
          value={props.modelId}
          onChange={(value) => props.onChange({ connectionId: current()?.connection.id ?? '', modelId: value })} options={[...models().map((m) => ({ value: m.id, label: m.label }))]} />
      </Show>
    </>
  )
}
