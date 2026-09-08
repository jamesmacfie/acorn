import { createMemo, createSignal, For, Index, Show } from 'solid-js'
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
  Textarea,
} from '@acorn/plugin-api/ui'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type {
  StepField,
  WorkflowBudget,
  WorkflowCatalog,
  WorkflowDef,
  WorkflowInput,
  WorkflowStepDef,
} from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS, readStepField } from '../../shared/stepFields'
import AgentNodeForm from './AgentNodeForm'
import BranchesField from './BranchesField'
import FieldControl from './FieldControl'
import JoinField from './JoinField'
import PromptField from './PromptField'
import {
  canConnect,
  effectiveAfter,
  INPUT_NAME_RE,
  precedes,
  renameProblem,
  type WorkflowDraft,
} from './draft'

// The inspector: whatever the list column has selected, as a form.
//
// Three subjects, because "Definition" and "Inputs" are rows in that list too. A node's form is drawn
// from its kind's description, so a plugin's own step kind gets an inspector without shipping a
// component (docs/workflows.md § Contributed step kinds). The two shapes a field cannot express —
// a decide's branches and a join's fan-out — are drawn beside it.

export type InspectorActions = {
  rename: (from: string, to: string) => void
  setField: (name: string, kind: string, fieldId: string, value: unknown) => void
  setStep: (name: string, patch: Partial<WorkflowStepDef>) => void
  setDefinition: (patch: Partial<WorkflowDef>) => void
  setInputs: (inputs: WorkflowInput[]) => void
  connect: (from: string, to: string) => void
  disconnect: (from: string, to: string) => void
  remove: (name: string) => void
}

const kindOf = (step: WorkflowStepDef): string => step.kind ?? 'agent'

/** A textarea over a JSON object field, such as a step's result schema. The text is local so an
 *  in-progress edit is not thrown away, and only a document that parses reaches the draft. */
function JsonField(props: {
  field: StepField
  value: unknown
  disabled?: boolean
  onChange: (value: unknown) => void
}) {
  const [text, setText] = createSignal<string | null>(null)
  const shown = () => text() ?? (props.value ? JSON.stringify(props.value, null, 2) : '')
  const [error, setError] = createSignal<string | undefined>()
  const commit = (next: string): void => {
    setText(next)
    if (!next.trim()) {
      setError(undefined)
      return props.onChange(undefined)
    }
    try {
      props.onChange(JSON.parse(next) as unknown)
      setError(undefined)
    } catch {
      setError('That is not JSON yet, so it has not been saved into the step.')
    }
  }
  return (
    <Field label={props.field.label} hint={props.field.hint} error={error()} group>
      <Textarea
        size="sm"
        rows={6}
        mono
        assist={false}
        label={props.field.label}
        disabled={props.disabled}
        invalid={!!error()}
        value={shown()}
        onInput={commit}
      />
    </Field>
  )
}

function InputsInspector(props: { inputs: readonly WorkflowInput[]; disabled?: boolean; onChange: (inputs: WorkflowInput[]) => void }) {
  const patch = (at: number, change: Partial<WorkflowInput>): void =>
    props.onChange(props.inputs.map((input, index) => (index === at ? { ...input, ...change } : input)))
  const add = (): void => {
    const taken = new Set(props.inputs.map((input) => input.name))
    let name = 'input'
    for (let n = 2; taken.has(name); n += 1) name = `input${n}`
    props.onChange([...props.inputs, { name }])
  }
  return (
    <Stack gap="stack">
      <Text emphasis="muted" wrap>
        What the run is started with. A prompt reaches one as ${'{'}inputs.name{'}'}, and so does any
        string in a step's own settings.
      </Text>
      {/* `Index`, so editing one input's description does not remount the row under the caret. */}
      <Index each={props.inputs}>
        {(input, at) => (
          <Fold label={input().name || 'unnamed'} level="group" defaultOpen>
            <Stack gap="row">
              <Field
                label="Name"
                error={INPUT_NAME_RE.test(input().name) ? undefined : 'A letter, then letters, numbers or underscores.'}
                group
              >
                <Input
                  size="sm"
                  label="Name"
                  assist={false}
                  disabled={props.disabled}
                  invalid={!INPUT_NAME_RE.test(input().name)}
                  value={input().name}
                  onInput={(value) => patch(at, { name: value })}
                />
              </Field>
              <Field label="Description" hint="Shown beside the box when a run is started." group>
                <Input
                  size="sm"
                  label="Description"
                  disabled={props.disabled}
                  value={input().description ?? ''}
                  onInput={(value) => patch(at, { description: value || undefined })}
                />
              </Field>
              <Field label="Default" group>
                <Input
                  size="sm"
                  label="Default"
                  disabled={props.disabled}
                  value={input().default ?? ''}
                  onInput={(value) => patch(at, { default: value || undefined })}
                />
              </Field>
              <Inline gap="inline">
                <Button
                  size="sm"
                  variant={input().required ? 'solid' : 'outline'}
                  disabled={props.disabled}
                  onPress={() => patch(at, { required: !input().required })}
                >
                  {input().required ? 'Required' : 'Optional'}
                </Button>
                <Button
                  size="sm"
                  variant="bare"
                  disabled={props.disabled}
                  onPress={() => props.onChange(props.inputs.filter((_entry, index) => index !== at))}
                >
                  Remove
                </Button>
              </Inline>
            </Stack>
          </Fold>
        )}
      </Index>
      <Show when={!props.disabled}>
        <Inline gap="inline"><Button size="sm" onPress={add}>Add an input</Button></Inline>
      </Show>
    </Stack>
  )
}

function DefinitionInspector(props: {
  def: WorkflowDef
  disabled?: boolean
  onChange: (patch: Partial<WorkflowDef>) => void
}) {
  const budget = (): WorkflowBudget => props.def.budget ?? {}
  const setBudget = (key: keyof WorkflowBudget, value: string): void => {
    const next = { ...budget() }
    if (value.trim()) next[key] = Number(value)
    else delete next[key]
    props.onChange({ budget: Object.keys(next).length ? next : undefined })
  }
  return (
    <Stack gap="stack">
      <Field label="Name" group>
        <Input
          size="sm"
          label="Name"
          disabled={props.disabled}
          value={props.def.name}
          onInput={(value) => props.onChange({ name: value })}
        />
      </Field>
      <Field label="Posture" hint="An autonomous run passes a human gate without stopping, so it needs a tool ceiling." group>
        <Select
          size="sm"
          label="Posture"
          disabled={props.disabled}
          value={props.def.posture ?? 'gated'}
          options={[{ value: 'gated', label: 'Gated' }, { value: 'autonomous', label: 'Autonomous' }]}
          onChange={(value) => props.onChange({ posture: value === 'gated' ? undefined : 'autonomous' })}
        />
      </Field>
      <Fold label="Tools" level="group">
        <Stack gap="row">
          <Field label="Highest risk allowed" group>
            <Select
              size="sm"
              label="Highest risk allowed"
              disabled={props.disabled}
              value={props.def.tools?.maxRisk ?? ''}
              options={[
                { value: '', label: 'No ceiling' },
                { value: 'read', label: 'Read' },
                { value: 'write', label: 'Write' },
                { value: 'execute', label: 'Execute' },
              ]}
              onChange={(value) => props.onChange({
                tools: { ...props.def.tools, maxRisk: (value || undefined) as 'read' | 'write' | 'execute' | undefined },
              })}
            />
          </Field>
          <Field label="Only these tools" hint="One name per line. Leave it empty to allow every tool inside the risk ceiling." group>
            <Textarea
              size="sm"
              rows={3}
              mono
              assist={false}
              label="Only these tools"
              disabled={props.disabled}
              value={(props.def.tools?.allow ?? []).join('\n')}
              onInput={(value) => {
                const allow = value.split('\n').map((line) => line.trim()).filter(Boolean)
                props.onChange({ tools: { ...props.def.tools, allow: allow.length ? allow : undefined } })
              }}
            />
          </Field>
        </Stack>
      </Fold>
      <Fold label="Budget" level="group">
        <Stack gap="row">
          <Field label="Cost ceiling, in dollars" group>
            <Input size="sm" type="number" width="narrow" label="Cost ceiling" disabled={props.disabled}
              value={budget().maxCostUsd ?? ''} onInput={(value) => setBudget('maxCostUsd', value)} />
          </Field>
          <Field label="Wall clock, in milliseconds" group>
            <Input size="sm" type="number" width="narrow" label="Wall clock" disabled={props.disabled}
              value={budget().maxWallTimeMs ?? ''} onInput={(value) => setBudget('maxWallTimeMs', value)} />
          </Field>
          <Field label="Turns" group>
            <Input size="sm" type="number" width="narrow" label="Turns" disabled={props.disabled}
              value={budget().maxTurns ?? ''} onInput={(value) => setBudget('maxTurns', value)} />
          </Field>
        </Stack>
      </Fold>
    </Stack>
  )
}

export default function NodeInspector(props: {
  draft: WorkflowDraft
  catalog: WorkflowCatalog | undefined
  providers: readonly AgentProviderDescriptor[] | undefined
  projectId: string
  readOnly?: boolean
  actions: InspectorActions
}) {
  const def = () => props.draft.def
  const selection = () => props.draft.selection
  const step = createMemo<WorkflowStepDef | undefined>(() => {
    const current = selection()
    return current.kind === 'node' ? def().steps.find((entry) => entry.name === current.name) : undefined
  })

  const describe = createMemo(() => {
    const current = step()
    if (!current) return undefined
    const kind = kindOf(current)
    return props.catalog?.kinds.find((entry) => entry.id === kind)?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind]
  })
  const pluginId = () => props.catalog?.kinds.find((entry) => entry.id === kindOf(step()!))?.pluginId ?? null
  const runsAgent = () => describe()?.runsAgent === true

  const waitsOn = createMemo<readonly string[]>(() => {
    const current = step()
    if (!current) return []
    return effectiveAfter(def(), def().steps.findIndex((entry) => entry.name === current.name))
  })

  /** Every node that could become a predecessor without closing a loop. The picker offers these and
   *  nothing else, so an edge it draws is always one the validator accepts. */
  const connectable = createMemo(() => {
    const current = step()
    if (!current) return []
    return def().steps.map((entry) => entry.name).filter((name) => canConnect(def(), name, current.name))
  })

  /** What a prompt in this node may reference: every declared input, and every step that is certain
   *  to have finished by the time this one runs. */
  const references = createMemo(() => {
    const current = step()
    if (!current) return []
    return [
      ...(def().inputs ?? []).map((input) => `\${inputs.${input.name}}`),
      ...def().steps
        .filter((entry) => entry.name !== current.name && precedes(def(), entry.name, current.name))
        .map((entry) => `\${steps.${entry.name}.output}`),
    ]
  })

  const [renaming, setRenaming] = createSignal<string | null>(null)
  const renameText = () => renaming() ?? step()?.name ?? ''
  const renameError = () => {
    const current = step()
    const text = renaming()
    return current && text !== null ? renameProblem(def(), current.name, text) : undefined
  }
  const commitRename = (): void => {
    const current = step()
    const text = renaming()
    setRenaming(null)
    if (!current || text === null || text === current.name || renameProblem(def(), current.name, text)) return
    props.actions.rename(current.name, text)
  }

  /** The choices the editor knows and a description cannot: the node's policies, its profiles, and
   *  the models the chosen child harness offers. */
  const staticOptions = (field: StepField): readonly { value: string; label: string; description?: string }[] | undefined => {
    if (field.id === 'policy') return props.catalog?.policies.map((policy) => ({ value: policy.id, label: policy.id }))
    if (field.id === 'childStep.profileId') return props.catalog?.profiles.map((profile) => ({ value: profile.id, label: profile.label }))
    if (field.id === 'childStep.model') {
      const provider = (props.providers ?? []).find((entry) => entry.profileId === step()?.childStep?.profileId)
      return provider?.configOptions.find((option) => option.category === 'model')?.values
    }
    return undefined
  }

  const fanOuts = createMemo(() => {
    const current = step()
    if (!current) return []
    return def().steps
      .filter((entry) => entry.kind === 'fan-out' && precedes(def(), entry.name, current.name))
      .map((entry) => entry.name)
  })

  const branchTargets = createMemo(() => {
    const current = step()
    if (!current) return []
    return def().steps
      .filter((entry, index) => entry.name !== current.name && effectiveAfter(def(), index).includes(current.name))
      .map((entry) => entry.name)
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
                <Button size="sm" variant="bare" onPress={() => props.actions.remove(current().name)}>Delete node</Button>
              </Show>
            </Inline>
            <Show when={describe()?.description}>
              {(text) => <Text emphasis="muted" wrap>{text()}</Text>}
            </Show>

            <Field
              label="Name"
              hint="Renaming rewrites every reference to this step in the draft."
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
                        onRemove={props.readOnly ? undefined : () => props.actions.disconnect(name, current().name)}
                      >
                        {name}
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
                    onChange={(name) => name && props.actions.connect(name, current().name)}
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
                onStep={(patch) => props.actions.setStep(current().name, patch)}
              />
            </Show>

            <Show
              when={describe()}
              fallback={(
                <Field
                  label="Settings"
                  hint="This step kind has not described its form, so its settings are raw JSON."
                  group
                >
                  <Textarea
                    size="sm"
                    rows={6}
                    mono
                    assist={false}
                    label="Settings"
                    disabled={props.readOnly}
                    value={JSON.stringify(current().with ?? {}, null, 2)}
                    onChange={(value) => {
                      try {
                        props.actions.setStep(current().name, { with: JSON.parse(value) as Record<string, unknown> })
                      } catch {
                        // Kept in the box until it parses. The draft is not touched.
                      }
                    }}
                  />
                </Field>
              )}
            >
              {(described) => (
                <For each={described().fields}>
                  {(field) => (
                    <Show when={field.id !== 'joins'}>
                      <Show
                        when={field.type === 'prompt'}
                        fallback={(
                          <Show
                            when={field.id === 'schema'}
                            fallback={(
                              <FieldControl
                                field={field}
                                pluginId={pluginId()}
                                projectId={props.projectId}
                                disabled={props.readOnly}
                                options={staticOptions(field)}
                                value={readStepField(current() as never, kindOf(current()), field.id)}
                                onChange={(value) => props.actions.setField(current().name, kindOf(current()), field.id, value)}
                              />
                            )}
                          >
                            <JsonField
                              field={field}
                              disabled={props.readOnly}
                              value={readStepField(current() as never, kindOf(current()), field.id)}
                              onChange={(value) => props.actions.setField(current().name, kindOf(current()), field.id, value)}
                            />
                          </Show>
                        )}
                      >
                        <PromptField
                          label={field.label}
                          hint={field.hint}
                          required={field.required}
                          disabled={props.readOnly}
                          references={references()}
                          value={String(readStepField(current() as never, kindOf(current()), field.id) ?? '')}
                          onChange={(value) => props.actions.setField(current().name, kindOf(current()), field.id, value)}
                        />
                      </Show>
                    </Show>
                  )}
                </For>
              )}
            </Show>

            <Show when={kindOf(current()) === 'decide'}>
              <BranchesField
                branches={current().branches ?? {}}
                targets={branchTargets()}
                disabled={props.readOnly}
                onChange={(branches) => props.actions.setStep(current().name, {
                  branches: Object.keys(branches).length ? branches : undefined,
                })}
              />
            </Show>

            <Show when={kindOf(current()) === 'join'}>
              <JoinField
                value={current().joins ?? ''}
                fanOuts={fanOuts()}
                disabled={props.readOnly}
                onChange={(value) => props.actions.setStep(current().name, { joins: value || undefined })}
              />
            </Show>

            <Show when={describe()?.output}>
              {(output) => (
                <Fold label="What it returns" level="group">
                  <Text emphasis="muted" wrap>{output().description}</Text>
                </Fold>
              )}
            </Show>
          </Stack>
        )}
      </Show>
    </Stack>
  )
}
