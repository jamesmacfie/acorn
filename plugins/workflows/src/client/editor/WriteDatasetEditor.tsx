import { Field, Input } from '@acorn/plugin-api/ui'
import { TypedBindingPicker } from '@acorn/plugin-api/ui/data-sources'
import type { WorkflowCatalog, WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'
import { workflowBindingOrigins } from './bindingOrigins'

/** Dataset definitions live in the device host. A plugin frame edits only an opaque id and a
 * typed predecessor binding; the host checks the task scope and version when the step runs. */
export default function WriteDatasetEditor(props: {
  step: WorkflowStepDef
  def: WorkflowDef
  catalog?: WorkflowCatalog
  disabled?: boolean
  onChange: (value: WorkflowStepDef['dataset']) => void
}) {
  const update = (patch: Partial<NonNullable<WorkflowStepDef['dataset']>>) =>
    props.onChange({ id: '', version: 1, ...props.step.dataset, ...patch } as NonNullable<WorkflowStepDef['dataset']>)
  return <Field label="Dataset output" hint="Use a workflow-fed dataset in this task's project. The current schema version and row shape are checked by the node." group>
    <Input label="Dataset ID" value={props.step.dataset?.id ?? ''} disabled={props.disabled}
      onInput={value => update({ id: value })} />
    <Input label="Schema version" type="number" value={String(props.step.dataset?.version ?? 1)} disabled={props.disabled}
      onInput={value => update({ version: Number(value) })} />
    <TypedBindingPicker label="Rows from previous step" origins={workflowBindingOrigins(props.def, props.step, props.catalog)}
      destination={{ type: 'array', items: { type: 'object' } }} destinationRequired disabled={props.disabled}
      value={props.step.dataset?.rows} onChange={value => { if (value) update({ rows: value }) }} />
  </Field>
}
