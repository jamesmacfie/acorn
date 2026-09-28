import { For, Show } from 'solid-js'
import { dataBindingSchema, type DataBinding } from '@acorn/protocol/dataBindings.ts'
import { TypedBindingPicker } from '@acorn/plugin-api/ui/data-sources'
import { Button, Fold, Inline, Stack, Text } from '@acorn/plugin-api/ui'
import type { WorkflowCatalog, WorkflowDef, WorkflowGateForm, WorkflowStepDef, WorkflowValueBinding } from '../../shared/workflowContracts'
import { GATE_FORM_MAX_FIELDS } from '../../shared/gateForm'
import { workflowBindingOrigins } from './bindingOrigins'
import InputsInspector from './InputsInspector'

const typedBinding = (value: WorkflowValueBinding | undefined): DataBinding | undefined => {
  const parsed = dataBindingSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** The Form section of a human gate (docs/workflows/execution.md § Human gates). The field list is
 *  the one the workflow's own inputs use, and each field's proposal is picked the way a child
 *  input's is. */
export default function GateFormEditor(props: {
  def: WorkflowDef
  step: WorkflowStepDef
  catalog: WorkflowCatalog | undefined
  disabled?: boolean
  onChange: (form: WorkflowGateForm | undefined) => void
}) {
  const form = () => props.step.form
  const origins = () => workflowBindingOrigins(props.def, props.step, props.catalog)
  // A rename leaves the old name's binding in place, and validation names it, rather than the
  // editor guessing which field the binding was meant for.
  const setFields = (fields: WorkflowGateForm['fields']): void =>
    props.onChange(fields.length ? { ...form(), fields } : undefined)
  const setBinding = (name: string, binding: WorkflowValueBinding | undefined): void => {
    const values = { ...form()?.values }
    if (binding) values[name] = binding
    else delete values[name]
    props.onChange({ fields: form()?.fields ?? [], values: Object.keys(values).length ? values : undefined })
  }

  return <Fold label="Form" level="group" defaultOpen>
    <Stack gap="stack">
      <Text emphasis="muted" wrap>
        Fields the reviewer checks and corrects before approving. A later step reads the approved values
        under /values.
      </Text>
      <Show when={form()} fallback={(
        <Show when={!props.disabled}>
          <Inline gap="inline">
            <Button size="sm" onPress={() => props.onChange({ fields: [{ name: 'value', schema: { type: 'string' } }] })}>Add a form</Button>
          </Inline>
        </Show>
      )}>
        {(current) => <>
          <InputsInspector inputs={current().fields} disabled={props.disabled} onChange={setFields}
            intro="The values the reviewer sees. Remove every field to go back to a plain gate."
            addLabel="Add a field" max={GATE_FORM_MAX_FIELDS} />
          <Fold label="Proposed from" level="group" defaultOpen>
            <Stack gap="row">
              <For each={current().fields}>{field =>
                <TypedBindingPicker label={field.label || field.name} origins={origins()}
                  destination={field.schema ?? { type: 'string' }} disabled={props.disabled}
                  value={typedBinding(current().values?.[field.name])}
                  onChange={binding => setBinding(field.name, binding)} />}
              </For>
            </Stack>
          </Fold>
        </>}
      </Show>
    </Stack>
  </Fold>
}
