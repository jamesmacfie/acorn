import { stepIdentity } from '../../shared/workflowIdentity'
import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  Badge,
  Alert,
  Button,
  Chip,
  ChipRow,
  ConfirmButton,
  Field,
  Fold,
  Heading,
  Icon,
  IconButton,
  Input,
  Select,
  Stack,
  Text,
  Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui'
import type { AgentProviderDescriptor } from '@acorn/plugin-agents/contract/wire.ts'
import type {
  WorkflowCatalog,
  WorkflowDef,
  WorkflowInput,
  WorkflowStepDef,
} from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { unavailableCatalogKind, unavailableStepKindMessage } from '../../shared/stepKindAvailability'
import AgentNodeForm from './AgentNodeForm'
import BranchesField from './BranchesField'
import DefinitionInspector from './DefinitionInspector'
import InputsInspector from './InputsInspector'
import GateFormEditor from './GateFormEditor'
import WorkflowDispatchForm from './WorkflowDispatchForm'
import StepConfigurationFields from './StepConfigurationFields'
import StepPreview from './StepPreview'
import TimeBudgetField from './TimeBudgetField'
import { referencingSteps } from './outlineModel'
import {
  canConnect,
  effectiveAfter,
  precedes,
  renameProblem,
  type WorkflowDraft,
} from './draft'

// The inspector: whatever the list column has selected, as a form under a header bar.
//
// Three subjects, because "Definition" and "Inputs" are rows in that list too. Each opens with the
// same bar the run pane's step detail has (../runs/NodeDetail.tsx): the mark, the title at level 2,
// and for a step, its kind and the controls that act on it. A node's form is drawn
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
  move: (name: string, direction: -1 | 1) => void
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

  const stepName = (id: string): string => def().steps.find((entry) => stepIdentity(entry) === id)?.name ?? id
  const index = () => {
    const current = step()
    return current ? def().steps.findIndex((entry) => stepIdentity(entry) === stepIdentity(current)) : -1
  }
  /** The steps a delete would change. A step nothing touches deletes on one press. */
  const users = createMemo(() => {
    const current = step()
    return current ? referencingSteps(stepIdentity(current), def()) : []
  })
  const deleteLabel = () => {
    const count = users().length
    return count ? `Delete step? ${count} ${count === 1 ? 'step uses' : 'steps use'} it.` : 'Delete step?'
  }

  const branchTargets = createMemo(() => {
    const current = step()
    if (!current) return []
    return def().steps
      .filter((entry, index) => stepIdentity(entry) !== stepIdentity(current) && effectiveAfter(def(), index).includes(stepIdentity(current)))
      .map((entry) => stepIdentity(entry))
  })

  // A fragment, so each bar is a direct child of the detail column: there it spans the column and sits
  // on its top edge, while the form under it stops at the page measure (docs/ui-design.md
  // § Two-column panes).
  return (
    <>
      <Show when={selection().kind === 'definition'}>
        <Toolbar ariaLabel="Definition">
          <Icon name="workflow" />
          <Heading level={2}>Definition</Heading>
        </Toolbar>
        <DefinitionInspector def={def()} disabled={props.readOnly} onChange={props.actions.setDefinition} />
      </Show>

      <Show when={selection().kind === 'inputs'}>
        <Toolbar ariaLabel="Inputs">
          <Icon name="list" />
          <Heading level={2} help="Values you give the workflow when it starts. Use one in a prompt as ${inputs.name}.">Inputs</Heading>
        </Toolbar>
        <InputsInspector inputs={def().inputs ?? []} disabled={props.readOnly} onChange={props.actions.setInputs} />
      </Show>

      <Show when={step()}>
        {(current) => (
          <>
            <Toolbar ariaLabel="Step">
              <Show when={describe()?.icon}>{(name) => <Icon name={name()} />}</Show>
              {/* The kind's description goes behind the heading's mark. It used to sit under the
                  heading, in the Add menu's tip, on the outline row, and in Preview: four copies. */}
              <Heading level={2} help={describe()?.description}>{current().name}</Heading>
              <Badge>{describe()?.label ?? kindOf(current())}</Badge>
              <ToolbarSpacer />
              <Show when={!props.readOnly}>
                <IconButton icon="arrow-up" label="Move up" disabled={index() <= 0}
                  onPress={() => props.actions.move(stepIdentity(current()), -1)} />
                <IconButton icon="arrow-down" label="Move down" disabled={index() < 0 || index() >= def().steps.length - 1}
                  onPress={() => props.actions.move(stepIdentity(current()), 1)} />
                <ConfirmButton
                  variant="ghost"
                  skipConfirm={!waitsOn().length && !users().length}
                  confirmLabel={deleteLabel()}
                  onConfirm={() => props.actions.remove(stepIdentity(current()))}
                >
                  Delete
                </ConfirmButton>
              </Show>
            </Toolbar>
            <Stack gap="section">
                <Show when={!props.readOnly && users().length}>
                  <Text emphasis="muted" wrap>{`Deleting this step also changes ${users().join(', ')}.`}</Text>
                </Show>
                <Show when={unavailableCatalogKind(kindOf(current()), props.catalog)}>
                  <Alert tone="warn" title="Step unavailable">
                    {unavailableStepKindMessage(kindOf(current()))} Its settings are kept below.
                  </Alert>
                </Show>

                <Field label="Name" error={renameError()} group>
                  <Input
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

                <Field label="Waits on" group>
                  <Stack gap="row">
                    <ChipRow ariaLabel="Waits on">
                      <For each={waitsOn()}>
                        {(name) => (
                          <Chip
                            size="sm"
                            onRemove={props.readOnly ? undefined : () => props.actions.disconnect(name, stepIdentity(current()))}
                          >
                            {stepName(name)}
                          </Chip>
                        )}
                      </For>
                      <Show when={!waitsOn().length}><Text emphasis="muted">Nothing. This step starts the run.</Text></Show>
                    </ChipRow>
                    <Show when={!props.readOnly && connectable().length}>
                      <Select
                        label="Add a step to wait on"
                        value=""
                        options={[
                          { value: '', label: 'Wait on another step…' },
                          ...connectable().map((name) => ({ value: name, label: stepName(name) })),
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

                <TimeBudgetField label="Step timeout in minutes"
                  hint={def().budget?.maxWallTimeMs !== undefined
                    ? 'Leave empty to use the workflow timeout. The run stops when its remaining time runs out.'
                    : runsAgent()
                      ? 'Leave empty for the 10-minute agent turn default. A custom timeout covers the whole step, including agent loops.'
                      : 'Limits active step execution, including child workflows. Leave empty for no workflow step limit.'}
                  budget={current().budget} maxWallTimeMs={def().budget?.maxWallTimeMs}
                  disabled={props.readOnly}
                  onChange={(budget) => props.actions.setStep(stepIdentity(current()), { budget })} />

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

                <Show when={kindOf(current()) === 'gate-human'}>
                  <GateFormEditor
                    def={def()}
                    step={current()}
                    catalog={props.catalog}
                    disabled={props.readOnly}
                    onChange={(form) => props.actions.setStep(stepIdentity(current()), { form })}
                  />
                </Show>

                <Show when={kindOf(current()) === 'find-records' && !props.readOnly}>
                  <Button size="sm" onPress={() => props.actions.addForEach(stepIdentity(current()))}>Run a workflow for each record</Button>
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
                    <Fold label="What it returns" level="sub">
                      <Text emphasis="muted" wrap>{output().description}</Text>
                    </Fold>
                  )}
                </Show>
                <StepPreview step={current()} def={def()} catalog={props.catalog} />
            </Stack>
          </>
        )}
      </Show>
    </>
  )
}
