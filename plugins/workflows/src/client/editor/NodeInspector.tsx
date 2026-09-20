import { stepIdentity } from '../../shared/workflowIdentity'
import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  Badge,
  Button,
  Chip,
  ChipRow,
  Field,
  Fold,
  Heading,
  Inline,
  Input,
  Select,
  Stack,
  Text,
} from '@acorn/plugin-api/ui'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type {
  WorkflowCatalog,
  WorkflowDef,
  WorkflowInput,
  WorkflowStepDef,
} from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import AgentNodeForm from './AgentNodeForm'
import BranchesField from './BranchesField'
import DefinitionInspector from './DefinitionInspector'
import InputsInspector from './InputsInspector'
import WorkflowDispatchForm from './WorkflowDispatchForm'
import StepConfigurationFields from './StepConfigurationFields'
import StepPreview from './StepPreview'
import {
  canConnect,
  effectiveAfter,
  precedes,
  renameProblem,
  type WorkflowDraft,
} from './draft'

// The inspector: whatever the list column has selected, as a form.
//
// Three subjects, because "Definition" and "Inputs" are rows in that list too. A node's form is drawn
// from its kind's description, so a plugin's own step kind gets an inspector without shipping a
// component (docs/workflows.md § Contributed step kinds). The two shapes a field cannot express —
// a decide's branches are drawn beside it.

export type InspectorActions = {
  rename: (from: string, to: string) => void
  setField: (name: string, kind: string, fieldId: string, value: unknown) => void
  setStep: (name: string, patch: Partial<WorkflowStepDef>) => void
  setDefinition: (patch: Partial<WorkflowDef>) => void
  setInputs: (inputs: WorkflowInput[]) => void
  connect: (from: string, to: string) => void
  disconnect: (from: string, to: string) => void
  remove: (name: string) => void
  addForEach: (sourceId: string) => void
  createChild: (stepId: string, itemSchema: import('@acorn/protocol/dataSchemas.ts').DataSchema) => void
}

const kindOf = (step: WorkflowStepDef): string => step.kind ?? 'agent'

export default function NodeInspector(props: {
  draft: WorkflowDraft
  catalog: WorkflowCatalog | undefined
  providers: readonly AgentProviderDescriptor[] | undefined
  projectId: string
  workspaceId: string
  readOnly?: boolean
  actions: InspectorActions
}) {
  const def = () => props.draft.def
  const selection = () => props.draft.selection
  const step = createMemo<WorkflowStepDef | undefined>(() => {
    const current = selection()
    return current.kind === 'node' ? def().steps.find((entry) => stepIdentity(entry) === current.name) : undefined
  })

  const describe = createMemo(() => {
    const current = step()
    if (!current) return undefined
    const kind = kindOf(current)
    return props.catalog?.kinds.find((entry) => entry.id === kind)?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind]
  })
  const runsAgent = () => describe()?.runsAgent === true

  const waitsOn = createMemo<readonly string[]>(() => {
    const current = step()
    if (!current) return []
    return effectiveAfter(def(), def().steps.findIndex((entry) => stepIdentity(entry) === stepIdentity(current)))
  })

  /** Every node that could become a predecessor without closing a loop. The picker offers these and
   *  nothing else, so an edge it draws is always one the validator accepts. */
  const connectable = createMemo(() => {
    const current = step()
    if (!current) return []
    return def().steps.map((entry) => stepIdentity(entry)).filter((name) => canConnect(def(), name, stepIdentity(current)))
  })

  /** What a prompt in this node may reference: every declared input, and every step that is certain
   *  to have finished by the time this one runs. */
  const references = createMemo(() => {
    const current = step()
    if (!current) return []
    return [
      ...(def().inputs ?? []).map((input) => `\${inputs.${input.name}}`),
      ...def().steps
        .filter((entry) => stepIdentity(entry) !== stepIdentity(current) && precedes(def(), stepIdentity(entry), stepIdentity(current)))
        .map((entry) => `\${steps.${stepIdentity(entry)}.output}`),
    ]
  })

  const [renaming, setRenaming] = createSignal<string | null>(null)
  const renameText = () => renaming() ?? step()?.name ?? ''
  const renameError = () => {
    const current = step()
    const text = renaming()
    return current && text !== null ? renameProblem(def(), stepIdentity(current), text) : undefined
  }
  const commitRename = (): void => {
    const current = step()
    const text = renaming()
    setRenaming(null)
    if (!current || text === null || text === current.name || renameProblem(def(), stepIdentity(current), text)) return
    props.actions.rename(stepIdentity(current), text)
  }

  const branchTargets = createMemo(() => {
    const current = step()
    if (!current) return []
    return def().steps
      .filter((entry, index) => stepIdentity(entry) !== stepIdentity(current) && effectiveAfter(def(), index).includes(stepIdentity(current)))
      .map((entry) => stepIdentity(entry))
  })

  return (
    <Stack gap="section">
      <Show when={selection().kind === 'definition'}>
        <DefinitionInspector def={def()} disabled={props.readOnly} onChange={props.actions.setDefinition} />
      </Show>

      <Show when={selection().kind === 'inputs'}>
        <InputsInspector inputs={def().inputs ?? []} disabled={props.readOnly} onChange={props.actions.setInputs} />
      </Show>

      <Show when={step()}>
        {(current) => (
          <Stack gap="section">
            <Inline gap="inline">
              <Heading level={3}>{current().name}</Heading>
              <Badge>{describe()?.label ?? kindOf(current())}</Badge>
              <Show when={!props.readOnly}>
                <Button size="sm" variant="bare" onPress={() => props.actions.remove(stepIdentity(current()))}>Delete node</Button>
              </Show>
            </Inline>
            <Show when={describe()?.description}>
              {(text) => <Text emphasis="muted" wrap>{text()}</Text>}
            </Show>

            <Field
              label="Name"
              hint="Change the displayed label. References keep this step's stable ID."
              error={renameError()}
              group
            >
              <Input
                size="sm"
                label="Name"
                assist={false}
                disabled={props.readOnly}
                invalid={!!renameError()}
                value={renameText()}
                onInput={setRenaming}
                onChange={commitRename}
                onSubmit={commitRename}
              />
            </Field>

            <Field label="Waits on" hint="Nothing here makes this a starting step." group>
              <Stack gap="row">
                <ChipRow ariaLabel="Waits on">
                  <For each={waitsOn()}>
                    {(name) => (
                      <Chip
                        size="sm"
                        onRemove={props.readOnly ? undefined : () => props.actions.disconnect(name, stepIdentity(current()))}
                      >
                        {def().steps.find(step => stepIdentity(step) === name)?.name ?? name}
                      </Chip>
                    )}
                  </For>
                  <Show when={!waitsOn().length}><Text emphasis="muted">Nothing — it starts the run.</Text></Show>
                </ChipRow>
                <Show when={!props.readOnly && connectable().length}>
                  <Select
                    size="sm"
                    label="Add a step to wait on"
                    value=""
                    options={[
                      { value: '', label: 'Wait on another step…' },
                      ...connectable().map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={(name) => name && props.actions.connect(name, stepIdentity(current()))}
                  />
                </Show>
              </Stack>
            </Field>

            <Show when={runsAgent()}>
              <AgentNodeForm
                step={current()}
                catalog={props.catalog}
                providers={props.providers}
                disabled={props.readOnly}
                onStep={(patch) => props.actions.setStep(stepIdentity(current()), patch)}
              />
            </Show>

            <StepConfigurationFields
              step={current()}
              def={def()}
              catalog={props.catalog}
              providers={props.providers}
              projectId={props.projectId}
              workspaceId={props.workspaceId}
              references={references()}
              disabled={props.readOnly}
              onFieldChange={(fieldId, value) => props.actions.setField(stepIdentity(current()), kindOf(current()), fieldId, value)}
              onStepChange={(patch) => props.actions.setStep(stepIdentity(current()), patch)}
            />

            <Show when={kindOf(current()) === 'workflow' || kindOf(current()) === 'workflow-map'}>
              <WorkflowDispatchForm
                def={def()}
                step={current()}
                catalog={props.catalog}
                disabled={props.readOnly}
                onChange={(patch) => props.actions.setStep(stepIdentity(current()), patch)}
                onCreateChild={(schema) => props.actions.createChild(stepIdentity(current()), schema)}
              />
            </Show>

            <Show when={kindOf(current()) === 'find-records' && !props.readOnly}>
              <Button size="sm" onPress={() => props.actions.addForEach(stepIdentity(current()))}>Add For each for these records</Button>
            </Show>

            <Show when={['decide', 'if'].includes(kindOf(current()))}>
              <BranchesField
                branches={current().branches ?? {}}
                targets={branchTargets()}
                disabled={props.readOnly}
                onChange={(branches) => props.actions.setStep(stepIdentity(current()), {
                  branches: Object.keys(branches).length ? branches : undefined,
                })}
              />
            </Show>

            <Show when={describe()?.output}>
              {(output) => (
                <Fold label="What it returns" level="group">
                  <Text emphasis="muted" wrap>{output().description}</Text>
                </Fold>
              )}
            </Show>
            <StepPreview step={current()} def={def()} catalog={props.catalog} />
          </Stack>
        )}
      </Show>
    </Stack>
  )
}
