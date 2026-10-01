/** @jsxImportSource @acorn/tui/jsx */
import { Show } from 'solid-js'
import { Text } from '../showing'
import { Select } from './choices'

/** Two `Select`s over the backends a Generate control can spend: a stored key, or an installed agent CLI.
 *
 *  Structurally typed rather than importing `ModelBackend`, like every other node in this file: the
 *  terminal kit is a second implementation of the vocabulary, not a consumer of the shell's types.
 *  What it must match is the behaviour, and until this rename it did not — it always drew the model
 *  select and never reset the model when the backend changed. Both are fixed here, because two hosts
 *  that draw the same node and answer differently is a bug a plugin author cannot see coming. */
export function ModelBackendPicker(props: {
  backends: readonly { id: string; kind?: 'connection' | 'harness'; label?: string; models?: readonly { id: string; label?: string }[]; defaultModelId?: string; catalogUnavailable?: boolean }[]
  backendId: string
  modelId: string
  onChange: (pick: { backendId: string; modelId: string }) => void
}) {
  const current = () => props.backends.find((entry) => entry.id === props.backendId) ?? props.backends[0]
  const models = () => current()?.models ?? []
  const modelOptions = () => {
    const backend = current()
    const choices = models().map((model) => ({ value: model.id, label: model.label ?? model.id }))
    if (backend?.kind !== 'harness' || (!choices.length && !backend.catalogUnavailable)) return choices
    const options = [{ value: '', label: `Use ${backend.label ?? backend.id} default` }, ...choices]
    if (backend.catalogUnavailable && props.modelId && !choices.some((model) => model.value === props.modelId)) {
      options.push({ value: props.modelId, label: `${props.modelId} (saved)` })
    }
    return options
  }
  // The same rule as `defaultModelIdFor` (@acorn/protocol/modelProviders.ts), restated rather than
  // imported: that function takes a whole `ModelBackend` and these props are the structural subset.
  const defaultModel = (backend: (typeof props.backends)[number] | undefined) =>
    backend?.kind === 'harness' ? backend.defaultModelId ?? '' : backend?.defaultModelId || backend?.models?.[0]?.id || ''
  return (
    <box flexDirection="row" gap={1}>
      <Show when={props.backends.length > 1}>
        <Select
          label="Generate with"
          value={props.backendId}
          options={props.backends.map((entry) => ({ value: entry.id, label: entry.label ?? entry.id }))}
          onChange={(backendId) => props.onChange({ backendId, modelId: defaultModel(props.backends.find((entry) => entry.id === backendId)) })}
        />
      </Show>
      <Show when={modelOptions().length}>
        <Select
          label="Model"
          value={props.modelId}
          options={modelOptions()}
          onChange={(modelId) => props.onChange({ backendId: current()?.id ?? '', modelId })}
        />
      </Show>
      <Show when={current()?.catalogUnavailable}>
        <Text tone="muted">Could not refresh this CLI's model list. Saved choices are kept.</Text>
      </Show>
    </box>
  )
}
