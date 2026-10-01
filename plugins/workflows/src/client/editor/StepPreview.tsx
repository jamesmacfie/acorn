import { For, Show } from 'solid-js'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { Badge, Fold, Inline, SectionHeader, Stack, Text } from '@acorn/plugin-api/ui'
import { dataBindingSchema } from '@acorn/protocol/dataBindings.ts'
import type { WorkflowCatalog, WorkflowDef, WorkflowInput, WorkflowStepDef } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'
import { branchLabel } from './outlineModel'
import { workflowOutputSchema } from './bindingOrigins'

/** The names a later step can read, as the person who wrote the schema named them: the leaf field,
 *  not its path (`version`, not `values.version`). Paths are for the plugin's author. */
const schemaFields = (schema: DataSchema | undefined, name = ''): string[] => {
  if (!schema) return []
  const type = Array.isArray(schema.type) ? schema.type.find(value => value !== 'null') : schema.type
  if (type === 'array') return schemaFields(schema.items, name)
  if (type !== 'object') return name ? [name] : []
  return [...new Set(Object.entries(schema.properties ?? {}).flatMap(([child, value]) => schemaFields(value, child)))]
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

/** Contextual contract preview: no fake executor, just the typed output the run will see. What
 *  the step is and what it waits on are said once already, in the heading and in Waits on. */
export default function StepPreview(props: { step: WorkflowStepDef; def: WorkflowDef; catalog?: WorkflowCatalog }) {
  const fields = () => schemaFields(workflowOutputSchema(props.step, props.catalog))
  return <Fold label="Preview" level="sub" defaultOpen>
    <Stack gap="row">
      <Show when={branchLabel(props.step, props.def)}>{label => <Inline gap="inline"><Badge>{label()}</Badge></Inline>}</Show>
      <Show when={props.step.form?.fields.length}>
        <SectionHeader level="sub">Form fields</SectionHeader>
        <For each={props.step.form!.fields}>{field =>
          <Text emphasis="muted">{`${field.label || field.name}: ${proposedFrom(field, props.step.form!.values?.[field.name], props.def)}`}</Text>}
        </For>
      </Show>
      <Show when={fields().length} fallback={<Text emphasis="muted">Returns no fields.</Text>}>
        <SectionHeader level="sub">Later steps can use</SectionHeader>
        <Inline gap="inline" wrap><For each={fields()}>{field => <Badge>{field}</Badge>}</For></Inline>
        <Show when={props.step.kind === 'find-records'}>
          <Text emphasis="muted">Preview values appear in field pickers after a source query is tested.</Text>
        </Show>
      </Show>
    </Stack>
  </Fold>
}
