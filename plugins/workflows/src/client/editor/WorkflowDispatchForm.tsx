import { For, Show } from 'solid-js'
import { Field, Fold, Input, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type {
  WorkflowCatalog,
  WorkflowCatalogTarget,
  WorkflowDef,
  WorkflowStepDef,
  WorkflowValueBinding,
} from '../../shared/workflowContracts'
import { workflowRefKey } from '../../shared/workflowRefs'
import { precedes } from './draft'

const pointerProblem = (pointer: string): string | undefined => {
  if (pointer === '') return undefined
  if (!pointer.startsWith('/')) return 'Start a JSON Pointer with /, or leave it empty for the whole value.'
  if (/~(?:[^01]|$)/.test(pointer)) return 'Escape ~ as ~0 and / as ~1 in a JSON Pointer.'
  const parts = pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  return parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))
    ? 'This JSON Pointer contains a blocked property name.'
    : undefined
}

const targetFor = (step: WorkflowStepDef, catalog: WorkflowCatalog | undefined): WorkflowCatalogTarget | undefined => {
  const key = step.childWorkflow?.ref ? workflowRefKey(step.childWorkflow.ref) : ''
  return catalog?.workflows?.find((target) => workflowRefKey(target.ref) === key)
}

function BindingField(props: {
  label: string
  binding?: WorkflowValueBinding
  parentInputs: readonly string[]
  predecessors: readonly string[]
  allowItem: boolean
  required?: boolean
  disabled?: boolean
  onChange: (binding: WorkflowValueBinding | undefined) => void
}) {
  const source = () => props.binding?.from ?? ''
  const options = () => [
    { value: '', label: props.required ? 'Choose a value source' : 'Not bound' },
    { value: 'literal', label: 'Fixed text' },
    { value: 'input', label: 'Parent input' },
    { value: 'step', label: 'Structured step output' },
    ...(props.allowItem ? [{ value: 'item', label: 'Mapped item' }] : []),
  ]
  const changeSource = (value: string): void => {
    if (value === 'literal') props.onChange({ from: 'literal', value: '' })
    else if (value === 'input') props.onChange({ from: 'input', name: props.parentInputs[0] ?? '' })
    else if (value === 'step') props.onChange({ from: 'step', step: props.predecessors[0] ?? '', pointer: '' })
    else if (value === 'item') props.onChange({ from: 'item', pointer: '' })
    else props.onChange(undefined)
  }
  const selectedOption = (values: readonly string[], value: string | undefined) =>
    value && !values.includes(value) ? [{ value, label: `${value} (not available)` }] : []

  return (
    <Fold label={props.label} level="group" defaultOpen={props.required || !!props.binding}>
      <Stack gap="row">
        <Field label="Value source" error={props.required && !props.binding ? 'Choose where this required input comes from.' : undefined} group>
          <Select
            size="sm"
            label="Value source"
            disabled={props.disabled}
            value={source()}
            options={options()}
            onChange={changeSource}
          />
        </Field>
        <Show when={props.binding?.from === 'literal'}>
          <Field label="Text" group>
            <Input size="sm" label="Text" disabled={props.disabled} value={(props.binding as { value?: string })?.value ?? ''}
              onInput={(value) => props.onChange({ from: 'literal', value })} />
          </Field>
        </Show>
        <Show when={props.binding?.from === 'input'}>
          <Field label="Parent input" group>
            <Select
              size="sm"
              label="Parent input"
              disabled={props.disabled}
              value={(props.binding as { name?: string })?.name ?? ''}
              options={[
                { value: '', label: 'Choose an input' },
                ...selectedOption(props.parentInputs, (props.binding as { name?: string })?.name),
                ...props.parentInputs.map((name) => ({ value: name, label: name })),
              ]}
              onChange={(name) => props.onChange({ from: 'input', name })}
            />
          </Field>
        </Show>
        <Show when={props.binding?.from === 'step'}>
          <Field label="Structured predecessor" group>
            <Select
              size="sm"
              label="Structured predecessor"
              disabled={props.disabled}
              value={(props.binding as { step?: string })?.step ?? ''}
              options={[
                { value: '', label: 'Choose a step' },
                ...selectedOption(props.predecessors, (props.binding as { step?: string })?.step),
                ...props.predecessors.map((name) => ({ value: name, label: name })),
              ]}
              onChange={(step) => props.onChange({ from: 'step', step, pointer: (props.binding as { pointer?: string })?.pointer ?? '' })}
            />
          </Field>
        </Show>
        <Show when={props.binding?.from === 'step' || props.binding?.from === 'item'}>
          <Field label="JSON Pointer" error={pointerProblem((props.binding as { pointer?: string })?.pointer ?? '')} group>
            <Input
              size="sm"
              assist={false}
              label="JSON Pointer"
              disabled={props.disabled}
              value={(props.binding as { pointer?: string })?.pointer ?? ''}
              placeholder="/number"
              onInput={(pointer) => {
                if (props.binding?.from === 'step') props.onChange({ ...props.binding, pointer })
                else props.onChange({ from: 'item', pointer })
              }}
            />
          </Field>
        </Show>
      </Stack>
    </Fold>
  )
}

export default function WorkflowDispatchForm(props: {
  def: WorkflowDef
  step: WorkflowStepDef
  catalog: WorkflowCatalog | undefined
  disabled?: boolean
  onChange: (patch: Partial<WorkflowStepDef>) => void
}) {
  const isMap = () => props.step.kind === 'workflow-map'
  const target = () => targetFor(props.step, props.catalog)
  const targetKey = () => props.step.childWorkflow?.ref ? workflowRefKey(props.step.childWorkflow.ref) : ''
  const structuredPredecessors = () => props.def.steps.filter((candidate) => {
    if (!precedes(props.def, candidate.name, props.step.name)) return false
    if (candidate.schema && typeof candidate.schema === 'object' && !Array.isArray(candidate.schema)) return true
    return !!props.catalog?.kinds.find((kind) => kind.id === (candidate.kind ?? 'agent'))?.describe?.output?.schema
  }).map((candidate) => candidate.name)
  const parentInputs = () => (props.def.inputs ?? []).map((input) => input.name)
  const targetInputs = () => {
    const known = target()?.inputs ?? []
    const byName = new Map(known.map((input) => [input.name, input]))
    for (const name of Object.keys(props.step.childWorkflow?.inputs ?? {})) {
      if (!byName.has(name)) byName.set(name, { name, description: 'This input is not declared by the selected workflow.' })
    }
    return [...byName.values()]
  }
  const setBinding = (name: string, binding: WorkflowValueBinding | undefined): void => {
    if (!props.step.childWorkflow) return
    const inputs = { ...props.step.childWorkflow.inputs }
    if (binding) inputs[name] = binding
    else delete inputs[name]
    props.onChange({
      childWorkflow: {
        ...props.step.childWorkflow,
        inputs: Object.keys(inputs).length ? inputs : undefined,
      },
    })
  }
  const titleNames = () => {
    const names = new Set(Object.keys(props.step.title?.bindings ?? {}))
    for (const match of props.step.title?.template?.matchAll(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g) ?? []) names.add(match[1]!)
    return [...names]
  }

  return (
    <Stack gap="stack">
      <Field
        label="Child workflow"
        hint="Changing this target is an explicit edit. AI edits keep a configured target."
        error={!targetKey() ? 'Choose a saved workflow.' : !target() ? 'This workflow is not available to the selected project.' : undefined}
        group
      >
        <Select
          size="sm"
          label="Child workflow"
          disabled={props.disabled}
          value={targetKey()}
          options={[
            { value: '', label: 'Choose a workflow' },
            ...(!target() && targetKey() ? [{ value: targetKey(), label: `${targetKey()} (not available)` }] : []),
            ...(props.catalog?.workflows ?? []).map((entry) => ({
              value: workflowRefKey(entry.ref),
              label: entry.name,
              title: workflowRefKey(entry.ref),
            })),
          ]}
          onChange={(key) => {
            const selected = props.catalog?.workflows?.find((entry) => workflowRefKey(entry.ref) === key)
            props.onChange({ childWorkflow: selected
              ? { ref: selected.ref, inputs: props.step.childWorkflow?.inputs }
              : undefined })
          }}
        />
      </Field>

      <Show when={targetInputs().length}>
        <Fold label="Child inputs" level="group" defaultOpen>
          <Stack gap="row">
            <For each={targetInputs()}>{(input) => (
              <Stack gap="row">
                <BindingField
                  label={input.name}
                  binding={props.step.childWorkflow?.inputs?.[input.name]}
                  parentInputs={parentInputs()}
                  predecessors={structuredPredecessors()}
                  allowItem={isMap()}
                  required={input.required && !input.hasDefault}
                  disabled={props.disabled}
                  onChange={(binding) => setBinding(input.name, binding)}
                />
                <Show when={input.description}><Text emphasis="muted" wrap>{input.description}</Text></Show>
              </Stack>
            )}</For>
          </Stack>
        </Fold>
      </Show>

      <Show when={isMap()}>
        <Field label="Items" hint="Select an array from a structured predecessor result." error={!props.step.items ? 'Choose the structured result that contains the items.' : undefined} group>
          <Stack gap="row">
            <Select
              size="sm"
              label="Source step"
              disabled={props.disabled}
              value={props.step.items?.step ?? ''}
              options={[
                { value: '', label: 'Choose a structured step' },
                ...(props.step.items?.step && !structuredPredecessors().includes(props.step.items.step)
                  ? [{ value: props.step.items.step, label: `${props.step.items.step} (not available)` }]
                  : []),
                ...structuredPredecessors().map((name) => ({ value: name, label: name })),
              ]}
              onChange={(step) => props.onChange({ items: step ? { step, pointer: props.step.items?.pointer ?? '' } : undefined })}
            />
            <Field label="Array JSON Pointer" error={pointerProblem(props.step.items?.pointer ?? '')} group>
              <Input size="sm" assist={false} label="Array JSON Pointer" disabled={props.disabled}
                value={props.step.items?.pointer ?? ''} placeholder="/tickets"
                onInput={(pointer) => props.onChange({ items: { step: props.step.items?.step ?? '', pointer } })} />
            </Field>
          </Stack>
        </Field>
        <Field
          label="Item key pointer"
          hint="The selected value must be a nonempty string."
          error={!props.step.itemKey ? 'Enter the JSON Pointer for each item key.' : pointerProblem(props.step.itemKey)}
          group
        >
          <Input size="sm" assist={false} label="Item key pointer" disabled={props.disabled}
            value={props.step.itemKey ?? ''} placeholder="/id"
            onInput={(itemKey) => props.onChange({ itemKey: itemKey || undefined })} />
        </Field>
        <Fold label="Child task title" level="group" defaultOpen>
          <Stack gap="row">
            <Field label="Title template" hint={'Use placeholders such as ${ticket}, then bind each one below.'} error={!props.step.title?.template?.trim() ? 'Write a child task title.' : undefined} group>
              <Input size="sm" label="Title template" disabled={props.disabled} value={props.step.title?.template ?? ''}
                placeholder="Review ${ticket}"
                onInput={(template) => props.onChange({ title: { template, bindings: props.step.title?.bindings } })} />
            </Field>
            <For each={titleNames()}>{(name) => (
              <BindingField
                label={name}
                binding={props.step.title?.bindings?.[name]}
                parentInputs={parentInputs()}
                predecessors={structuredPredecessors()}
                allowItem
                required
                disabled={props.disabled}
                onChange={(binding) => {
                  const bindings = { ...props.step.title?.bindings }
                  if (binding) bindings[name] = binding
                  else delete bindings[name]
                  props.onChange({ title: { template: props.step.title?.template ?? '', bindings } })
                }}
              />
            )}</For>
          </Stack>
        </Fold>
      </Show>
    </Stack>
  )
}
