import { Field, Textarea } from '@acorn/plugin-api/ui'
import { SourceQueryEditor, TypedBindingPicker } from '@acorn/plugin-api/ui/data-sources'
import type { AgentProviderDescriptor } from '@acorn/plugin-agents/contract/wire.ts'
import { For, Show } from 'solid-js'
import type { StepField, WorkflowCatalog, WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS, readStepField } from '../../shared/stepFields'
import { unavailableCatalogKind } from '../../shared/stepKindAvailability'
import { workflowBindingOrigins } from './bindingOrigins'
import ConditionEditor from './ConditionEditor'
import FieldControl from './FieldControl'
import PromptField from './PromptField'
import SchemaFieldEditor from './SchemaFieldEditor'
import WriteDatasetEditor from './WriteDatasetEditor'

const kindOf = (step: WorkflowStepDef): string => step.kind ?? 'agent'

/** Renders the fields declared by a step kind. Data-aware fields stay here so queries, bindings,
 * conditions, and output schemas share one dispatch point without leaking their controls into the
 * inspector's selection and graph orchestration. */
export default function StepConfigurationFields(props: {
  step: WorkflowStepDef
  def: WorkflowDef
  catalog: WorkflowCatalog | undefined
  providers: readonly AgentProviderDescriptor[] | undefined
  projectId: string
  workspaceId: string
  references: readonly string[]
  disabled?: boolean
  onFieldChange: (fieldId: string, value: unknown) => void
  onStepChange: (patch: Partial<WorkflowStepDef>) => void
}) {
  const kind = () => kindOf(props.step)
  const described = () =>
    props.catalog?.kinds.find((entry) => entry.id === kind())?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind()]
  const pluginId = () => props.catalog?.kinds.find((entry) => entry.id === kind())?.pluginId ?? null

  const optionsFor = (
    field: StepField,
  ): readonly { value: string; label: string; description?: string }[] | undefined => {
    if (field.id === 'policy')
      return props.catalog?.policies.map((policy) => ({
        value: policy.id,
        label: policy.describe?.label ?? policy.id,
        description: policy.describe?.description,
      }))
    return undefined
  }
  // A policy gate also draws the chosen policy's own settings. They always land in `with`, even when a
  // setting shares a name with one of the gate's own fields, such as a command's `timeoutMs`.
  const policy = () =>
    kind() === 'gate-policy' ? props.catalog?.policies.find((entry) => entry.id === props.step.policy) : undefined
  const setSetting = (id: string, value: unknown): void => {
    const table: Record<string, unknown> = { ...props.step.with }
    if (value === '' || value === undefined || value === null) delete table[id]
    else table[id] = value
    props.onStepChange({ with: Object.keys(table).length ? table : undefined })
  }

  return (
    <Show
      when={described()}
      fallback={
        <Field
          label="Settings"
          hint={
            unavailableCatalogKind(kind(), props.catalog)
              ? "The plugin isn't on this computer. Its settings are kept as JSON."
              : 'This step has no form, so its settings show as JSON.'
          }
          group
        >
          <Textarea
            rows={6}
            mono
            assist={false}
            label="Settings"
            disabled={props.disabled}
            value={JSON.stringify(props.step.with ?? {}, null, 2)}
            onChange={(value) => {
              try {
                props.onStepChange({ with: JSON.parse(value) as Record<string, unknown> })
              } catch {
                // Keep invalid text in the control without changing the draft.
              }
            }}
          />
        </Field>
      }
    >
      {(description) => (
        <Show
          when={kind() !== 'write-dataset'}
          fallback={
            <WriteDatasetEditor
              step={props.step}
              def={props.def}
              catalog={props.catalog}
              disabled={props.disabled}
              onChange={(value) => props.onFieldChange('dataset', value)}
            />
          }
        >
          <For each={description().fields}>
            {(field) => (
              <Show
                when={
                  !field.type.startsWith('workflow-') && field.type !== 'child-workflow' && field.type !== 'gate-form'
                }
              >
                <Show
                  when={field.type === 'prompt'}
                  fallback={
                    <Show
                      when={['schema', 'query', 'record', 'condition'].includes(field.id)}
                      fallback={
                        <FieldControl
                          field={field}
                          pluginId={pluginId()}
                          projectId={props.projectId}
                          disabled={props.disabled}
                          options={optionsFor(field)}
                          value={readStepField(props.step as never, kind(), field.id)}
                          onChange={(value) => props.onFieldChange(field.id, value)}
                        />
                      }
                    >
                      <Show
                        when={field.id === 'query'}
                        fallback={
                          field.id === 'record' ? (
                            <TypedBindingPicker
                              label={field.label}
                              origins={workflowBindingOrigins(props.def, props.step, props.catalog)}
                              destination={{ type: 'object' }}
                              destinationRequired
                              disabled={props.disabled}
                              value={props.step.record}
                              onChange={(value) => props.onFieldChange(field.id, value)}
                            />
                          ) : field.id === 'schema' ? (
                            <SchemaFieldEditor
                              label={field.label}
                              disabled={props.disabled}
                              value={readStepField(props.step as never, kind(), field.id)}
                              onChange={(value) => props.onFieldChange(field.id, value)}
                            />
                          ) : (
                            <ConditionEditor
                              disabled={props.disabled}
                              value={props.step.condition}
                              origins={workflowBindingOrigins(props.def, props.step, props.catalog)}
                              onChange={(value) => props.onFieldChange(field.id, value)}
                            />
                          )
                        }
                      >
                        <SourceQueryEditor
                          workspaceId={props.workspaceId}
                          projectId={props.projectId}
                          disabled={props.disabled}
                          value={props.step.query}
                          onChange={(value) => props.onFieldChange(field.id, value)}
                        />
                      </Show>
                    </Show>
                  }
                >
                  <PromptField
                    label={field.label}
                    hint={field.hint}
                    placeholder={field.placeholder}
                    required={field.required}
                    disabled={props.disabled}
                    references={props.references}
                    value={String(readStepField(props.step as never, kind(), field.id) ?? '')}
                    onChange={(value) => props.onFieldChange(field.id, value)}
                  />
                </Show>
              </Show>
            )}
          </For>
          <For each={policy()?.describe?.fields ?? []}>
            {(field) => (
              <Show
                when={field.type === 'prompt'}
                fallback={
                  <FieldControl
                    field={field}
                    pluginId={policy()?.pluginId ?? null}
                    projectId={props.projectId}
                    disabled={props.disabled}
                    value={props.step.with?.[field.id]}
                    onChange={(value) => setSetting(field.id, value)}
                  />
                }
              >
                <PromptField
                  label={field.label}
                  hint={field.hint}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={props.disabled}
                  references={props.references}
                  value={String(props.step.with?.[field.id] ?? '')}
                  onChange={(value) => setSetting(field.id, value)}
                />
              </Show>
            )}
          </For>
        </Show>
      )}
    </Show>
  )
}
