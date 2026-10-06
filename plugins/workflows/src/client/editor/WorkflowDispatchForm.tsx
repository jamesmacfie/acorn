import MapAgentForm from './MapAgentForm'
import type { AgentProviderDescriptor } from '@acorn/plugin-agents/contract/wire.ts'
import { For, Show } from 'solid-js'
import { dataBindingSchema, type DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { TypedBindingPicker } from '@acorn/plugin-api/ui/data-sources'
import { Button, Field, Fold, Input, SectionHeader, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type {
  WorkflowCatalog, WorkflowCatalogTarget, WorkflowDef,
  WorkflowStepDef, WorkflowValueBinding,
} from '../../shared/workflowContracts'
import { workflowRefKey } from '../../shared/workflowRefs'
import { workflowBindingOrigins, workflowMapItemSchema } from './bindingOrigins'

const targetFor = (step: WorkflowStepDef, catalog: WorkflowCatalog | undefined): WorkflowCatalogTarget | undefined => {
  const key = step.childWorkflow?.ref ? workflowRefKey(step.childWorkflow.ref) : ''
  return catalog?.workflows?.find(target => workflowRefKey(target.ref) === key)
}

const typedBinding = (value: WorkflowValueBinding | undefined): DataBinding | undefined => {
  const parsed = dataBindingSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export default function WorkflowDispatchForm(props: {
  def: WorkflowDef
  step: WorkflowStepDef
  catalog: WorkflowCatalog | undefined
  providers?: readonly AgentProviderDescriptor[]
  disabled?: boolean
  onChange: (patch: Partial<WorkflowStepDef>) => void
  onCreateChild?: (itemSchema: DataSchema) => void
}) {
  const isMap = () => props.step.kind === 'workflow-map'
  const target = () => targetFor(props.step, props.catalog)
  const targetKey = () => props.step.childWorkflow?.ref ? workflowRefKey(props.step.childWorkflow.ref) : ''
  // A newly created child is absent from the catalog until it is published. Remount the form when
  // either side of that lookup changes so controls do not retain the old "not available" label or
  // the placeholder input metadata after the target becomes resolvable.
  const targetStateKey = () => `${targetKey()}\u0000${target()?.name ?? ''}`
  const origins = () => workflowBindingOrigins(props.def, props.step, props.catalog, { includeItem: isMap() })
  const itemSchema = () => workflowMapItemSchema(props.def, props.step, props.catalog)
  const targetInputs = () => {
    const byName = new Map((target()?.inputs ?? []).map(input => [input.name, input]))
    for (const name of Object.keys(props.step.childWorkflow?.inputs ?? {})) {
      if (!byName.has(name)) byName.set(name, { name, description: "The chosen workflow doesn't have this input." })
    }
    return [...byName.values()]
  }
  const setBinding = (name: string, binding: WorkflowValueBinding | undefined): void => {
    if (!props.step.childWorkflow) return
    const inputs = { ...props.step.childWorkflow.inputs }
    if (binding) inputs[name] = binding
    else delete inputs[name]
    props.onChange({ childWorkflow: { ...props.step.childWorkflow, inputs: Object.keys(inputs).length ? inputs : undefined } })
  }
  const titleNames = () => {
    const names = new Set(Object.keys(props.step.title?.bindings ?? {}))
    for (const match of props.step.title?.template?.matchAll(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g) ?? []) names.add(match[1]!)
    return [...names]
  }
  const Binding = (input: { name: string; schema?: DataSchema; required?: boolean; description?: string }) => <Stack gap="row">
    <TypedBindingPicker label={input.name} origins={origins()} destination={input.schema ?? { type: 'string' }}
      destinationRequired={input.required} disabled={props.disabled}
      value={typedBinding(props.step.childWorkflow?.inputs?.[input.name])}
      onChange={binding => setBinding(input.name, binding)} />
    <Show when={input.description}><Text emphasis="muted" wrap>{input.description}</Text></Show>
  </Stack>

  return <Show when={targetStateKey()} keyed>{(_targetStateKey) => <Stack gap="stack">
    <Show when={isMap()}>
      <TypedBindingPicker label="Records to process"
        origins={workflowBindingOrigins(props.def, props.step, props.catalog)}
        destination={{ type: 'array', items: { type: 'object' } }} destinationRequired disabled={props.disabled}
        value={props.step.items ? { address: { from: 'step', stepId: props.step.items.step, pointer: props.step.items.pointer } } : undefined}
        onChange={binding => {
          const address = binding?.address
          props.onChange({ items: address?.from === 'step' ? { step: address.stepId, pointer: address.pointer } : undefined })
        }} />
    </Show>

    <Show when={isMap()}>
      <Field label="Run" group>
        <Select label="Run" value={props.step.agent ? 'agent' : 'workflow'} disabled={props.disabled}
          options={[{ value: 'agent', label: 'Agent session' }, { value: 'workflow', label: 'Child workflow' }]}
          onChange={value => props.onChange(value === 'agent'
            ? { agent: { prompt: '', onFailure: 'continue' }, childWorkflow: undefined }
            : { agent: undefined })} />
      </Field>
    </Show>
    <Show when={props.step.agent}>{agent => <MapAgentForm agent={agent()} catalog={props.catalog} providers={props.providers}
      disabled={props.disabled} onChange={value => props.onChange({ agent: value })} />}</Show>
    <Show when={!props.step.agent}>
    <Field label="Child workflow"
      error={!targetKey() ? 'Choose a saved workflow.' : !target() ? 'This workflow is not available to the selected project.' : undefined} group>
      <Select label="Child workflow" disabled={props.disabled} value={targetKey()}
        options={[
          { value: '', label: 'Choose a workflow' },
          ...(!target() && targetKey() ? [{ value: targetKey(), label: `${targetKey()} (not available)` }] : []),
          ...(props.catalog?.workflows ?? []).map(entry => ({ value: workflowRefKey(entry.ref), label: entry.published === false ? `${entry.name} (draft)` : entry.name, title: workflowRefKey(entry.ref) })),
        ]}
        onChange={key => {
          const selected = props.catalog?.workflows?.find(entry => workflowRefKey(entry.ref) === key)
          props.onChange({ childWorkflow: selected ? { ref: selected.ref, inputs: props.step.childWorkflow?.inputs } : undefined })
        }} />
    </Field>
    <Show when={target()?.published === false}>
      <Text emphasis="muted" wrap>This workflow isn't published. It gets published with this one.</Text>
    </Show>
    <Show when={isMap() && itemSchema() && !props.disabled}>
      <Button size="sm" onPress={() => props.onCreateChild?.(itemSchema()!)}>Create a workflow for this record</Button>
    </Show>

    <Show when={targetInputs().length}>
      <SectionHeader level="sub">Child inputs</SectionHeader>
      <For each={targetInputs()}>{input => Binding({ ...input, required: input.required && !input.hasDefault })}</For>
    </Show>

    </Show>
    <Show when={isMap()}>
      <Fold label="Advanced" level="sub"><Stack gap="row">
        <Field label="Item ID field" help="Only for plain lists. Records from a source already have an ID." group>
          <Input label="Item ID field" disabled={props.disabled} value={props.step.itemKey ?? ''}
            placeholder="/id" onInput={itemKey => props.onChange({ itemKey: itemKey || undefined })} />
        </Field>
        <Field label={props.step.agent ? "Session title" : "Task title"} hint="Optional. Leave empty to use each item’s title." group>
          <Input label={props.step.agent ? "Session title" : "Task title"} disabled={props.disabled} value={props.step.title?.template ?? ''}
            placeholder="Review ${ticket}" onInput={template => props.onChange({ title: template ? { template, bindings: props.step.title?.bindings } : undefined })} />
        </Field>
        <For each={titleNames()}>{name =>
          <TypedBindingPicker label={name} origins={origins()} destination={{ type: 'string' }} destinationRequired
            disabled={props.disabled} value={typedBinding(props.step.title?.bindings?.[name])}
            onChange={binding => {
              const bindings = { ...props.step.title?.bindings }; if (binding) bindings[name] = binding; else delete bindings[name]
              props.onChange({ title: { template: props.step.title?.template ?? '', bindings } })
            }} />}
        </For>
      </Stack></Fold>
    </Show>
  </Stack>}</Show>
}
