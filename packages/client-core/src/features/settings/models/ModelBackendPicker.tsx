import { createMemo, Show } from 'solid-js'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { Select } from '../../../kit/components/primitives'
import { defaultModelIdFor } from './defaultModel'

// Two controlled selects, backend then model, over everything this owner can generate with: a stored
// API key, or an agent CLI installed on this machine (@acorn/protocol/modelProviders.ts § ModelBackend).
// Any plugin whose route consumes `models.generateText` can draw it.
//
// The backend select is hidden when there is one choice, and the model select when the backend lists
// no models. A CLI keeps its own model list and offers none here, so on a machine with only `claude`
// this draws nothing at all — which is right: there is no choice to make.
//
// Labels are `backend.label` with no group header and no icon. `Select` draws neither, and "Claude
// Code" beside "Anthropic" already says which is which.

export { defaultModelIdFor }

export default function ModelBackendPicker(props: {
  backends: ModelBackend[]
  backendId: string
  modelId: string
  onChange: (pick: { backendId: string; modelId: string }) => void
}) {
  // A memo, not a plain getter: two places read it, and a getter would re-run the find on every
  // upstream tick.
  const current = createMemo(() => props.backends.find((backend) => backend.id === props.backendId) ?? props.backends[0])
  const models = () => current()?.models ?? []

  return (
    <>
      <Show when={props.backends.length > 1}>
        <Select
          title="Generate with"
          value={current()?.id ?? ''}
          onChange={(value) => {
            // The model resets with the backend. A model id belongs to one backend, so carrying the
            // old one over would ask Anthropic for an OpenAI model, or a CLI for a model it has never
            // heard of.
            const next = props.backends.find((backend) => backend.id === value)
            props.onChange({ backendId: value, modelId: defaultModelIdFor(next) })
          }} options={[...props.backends.map((backend) => ({ value: backend.id, label: backend.label }))]} />
      </Show>
      <Show when={models().length}>
        <Select
          title="Model"
          value={props.modelId}
          onChange={(value) => props.onChange({ backendId: current()?.id ?? '', modelId: value })} options={[...models().map((model) => ({ value: model.id, label: model.label }))]} />
      </Show>
    </>
  )
}
