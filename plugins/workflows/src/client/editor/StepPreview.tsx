import { For, Show } from 'solid-js'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { Badge, Chip, ChipRow, Fold, Stack, Text } from '@acorn/plugin-api/ui'
import type { WorkflowCatalog, WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'
import { dependencyLabels, branchLabel, stepSummary } from './outlineModel'
import { workflowOutputSchema } from './bindingOrigins'

const schemaFields = (schema: DataSchema | undefined, prefix = ''): string[] => {
  if (!schema) return []
  const type = Array.isArray(schema.type) ? schema.type.find(value => value !== 'null') : schema.type
  if (type === 'array') return schemaFields(schema.items, `${prefix}[]`)
  if (type !== 'object') return prefix ? [`${prefix} · ${type}`] : [type ?? 'value']
  return Object.entries(schema.properties ?? {}).flatMap(([name, child]) => schemaFields(child, prefix ? `${prefix}.${name}` : name))
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
      <Show when={fields().length} fallback={<Text emphasis="muted">No structured output fields declared.</Text>}>
        <Text emphasis="strong">Available output fields</Text>
        <For each={fields()}>{field => <Text emphasis="muted">{field}</Text>}</For>
        <Text emphasis="muted">Preview values appear in field pickers after a source query is tested.</Text>
      </Show>
    </Stack>
  </Fold>
}
