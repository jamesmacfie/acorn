import { For, Show } from 'solid-js'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { Badge, Chip, ChipRow, Fold, Stack, Text } from '@acorn/plugin-api/ui'
import { dataBindingSchema } from '@acorn/protocol/dataBindings.ts'
import type { WorkflowCatalog, WorkflowDef, WorkflowInput, WorkflowStepDef } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'
import { dependencyLabels, branchLabel, stepSummary } from './outlineModel'
import { workflowOutputSchema } from './bindingOrigins'

const schemaFields = (schema: DataSchema | undefined, prefix = ''): string[] => {
  if (!schema) return []
  const type = Array.isArray(schema.type) ? schema.type.find(value => value !== 'null') : schema.type
  if (type === 'array') return schemaFields(schema.items, `${prefix}[]`)
  if (type !== 'object') return prefix ? [`${prefix} · ${type}`] : [type ?? 'value']
  return Object.entries(schema.properties ?? {}).flatMap(([name, child]) => schemaFields(child, prefix ? `${prefix}.${name}` : name))
}

/** Where a gate form field's proposal comes from, in the words the reviewer's author would use. */
const proposedFrom = (field: WorkflowInput, binding: unknown, def: WorkflowDef): string => {
  const parsed = dataBindingSchema.safeParse(binding)
  if (parsed.success) {
    const address = parsed.data.address
    if (address.from === 'input') return `the input ${address.name}${address.pointer}`
    if (address.from === 'step') return `${def.steps.find(step => stepIdentity(step) === address.stepId)?.name ?? address.stepId}${address.pointer}`
    if (address.from === 'literal') return 'a fixed value'
  }
  return field.default !== undefined ? 'its default' : 'left for the reviewer to fill'
}

/** Contextual contract preview: no fake executor, just the graph and typed output the run will see. */
export default function StepPreview(props: { step: WorkflowStepDef; def: WorkflowDef; catalog?: WorkflowCatalog }) {
  const dependencies = () => dependencyLabels(props.step, props.def)
  const fields = () => schemaFields(workflowOutputSchema(props.step, props.catalog))
  const summary = () => stepSummary(props.step, props.def, props.catalog)
  return <Fold label="Preview" level="group" defaultOpen>
    <Stack gap="row">
      <Text wrap>{summary()}</Text>
      <ChipRow ariaLabel="Step context">
        <Show when={branchLabel(props.step, props.def)}>{label => <Badge>{label()}</Badge>}</Show>
        <For each={dependencies()}>{name => <Chip size="sm">{`After ${name}`}</Chip>}</For>
      </ChipRow>
      <Show when={!dependencies().length}><Text emphasis="muted">Starts the run.</Text></Show>
      <Show when={props.step.form?.fields.length}>
        <Text emphasis="strong">Form fields</Text>
        <For each={props.step.form!.fields}>{field =>
          <Text emphasis="muted">{`${field.label || field.name}: ${proposedFrom(field, props.step.form!.values?.[field.name], props.def)}`}</Text>}
        </For>
      </Show>
      <Show when={fields().length} fallback={<Text emphasis="muted">No structured output fields declared.</Text>}>
        <Text emphasis="strong">Available output fields</Text>
        <For each={fields()}>{field => <Text emphasis="muted">{field}</Text>}</For>
        <Text emphasis="muted">Preview values appear in field pickers after a source query is tested.</Text>
      </Show>
    </Stack>
  </Fold>
}
