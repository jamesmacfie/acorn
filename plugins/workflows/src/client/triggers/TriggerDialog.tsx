import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { clientEvents, projectsOptions, tasksOptions } from '@acorn/plugin-api/client'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmButton,
  Field,
  Fold,
  Inline,
  Input,
  Modal,
  ModalActions,
  ModalBody,
  SectionHeader,
  Select,
  Stack,
  Text,
  Toolbar,
} from '@acorn/plugin-api/ui'
import { SuggestedTriggers, TypedBindingPicker, type SuggestedTrigger } from '@acorn/plugin-api/ui/data-sources'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import type {
  WorkflowTriggerDraftInput,
  WorkflowTriggerFirstCheck,
  WorkflowTriggerLimits,
  WorkflowTriggerLoopSetting,
  WorkflowTriggerPreparation,
  WorkflowTriggerPreview,
  WorkflowTriggerView,
  WorkflowTriggerWhen,
} from '../../shared/workflowTriggers'
import { RECORD_FILLED_INPUTS } from '../../contract/itemInputs.ts'
import TypedValueField from '../editor/TypedValueField'
import { openWorkflowRun } from '../runs/runStore'
import { workflowsSurfacePath } from '../surfacePath'
import { workflowApi } from '../workflowsClient'
import { closeWorkflowTrigger, triggerRequest, type TriggerRequest } from './triggerRequest'
import { RecordMatchHistory, recordOrigin, RecordsWhenFields, type RecordsDraft } from './RecordsWhen'
import {
  cadenceChoice,
  cadenceForChoice,
  formatOccurrence,
  limitsSummary,
  nextScheduleOccurrences,
  starterChange,
  triggerStateLabel,
} from './triggerModel'

/** Every zone this runtime knows, with the chosen one kept even when it does not. */
const timezoneOptions = (current: string) => {
  const zones = Intl.supportedValuesOf('timeZone')
  return (current && !zones.includes(current) ? [current, ...zones] : zones).map((zone) => ({
    value: zone,
    label: zone.replaceAll('_', ' '),
  }))
}

/** A record trigger's times read in this device's zone. */
const zoneOf = (when: WorkflowTriggerWhen): string =>
  when.kind === 'clock' ? when.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone

const STATE_TONE = {
  draft: 'neutral',
  activating: 'warn',
  active: 'ok',
  paused: 'neutral',
  'needs-review': 'warn',
  unavailable: 'danger',
} as const

export default function TriggerDialogHost() {
  return <Show when={triggerRequest()}>{(request) => <TriggerDialog request={request()} />}</Show>
}

function TriggerDialog(props: { request: TriggerRequest }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const tasks = createQuery(() => tasksOptions(true))
  const [existing] = createResource(
    () => props.request.triggerId,
    (id) => (id ? workflowApi.trigger(id) : Promise.resolve(undefined)),
  )
  const [defaults] = createResource(() => workflowApi.triggerDefaults().catch(() => ({ timezone: 'UTC' })))
  const [trigger, setTrigger] = createSignal<WorkflowTriggerView>()
  const [projectId, setProjectId] = createSignal(props.request.projectId)
  const [values, setValues] = createSignal<Record<string, DataValue>>(
    Object.fromEntries(
      props.request.inputs.flatMap((input) => (input.default === undefined ? [] : [[input.name, input.default]])),
    ),
  )
  const [timezone, setTimezone] = createSignal('')
  const [kind, setKind] = createSignal<WorkflowTriggerWhen['kind']>('clock')
  const [records, setRecords] = createSignal<RecordsDraft>({ change: { on: 'new' } })
  // Per input, whether a record trigger fills it from the record rather than a value.
  const [fromRecord, setFromRecord] = createSignal<Record<string, boolean>>({})
  const [preview, setPreview] = createSignal<WorkflowTriggerPreview>()
  const [cadence, setCadence] = createSignal<Cadence>({ daily: '09:00' })
  const [preparation, setPreparation] = createSignal<WorkflowTriggerPreparation>()
  const [loops, setLoops] = createSignal<WorkflowTriggerLoopSetting[]>([])
  const [firstCheck, setFirstCheck] = createSignal<WorkflowTriggerFirstCheck>('process-current')
  const [freshStart, setFreshStart] = createSignal(false)
  const [requestedLimits, setRequestedLimits] = createSignal<WorkflowTriggerDraftInput['limits']>()
  const [busy, setBusy] = createSignal('')
  const [error, setError] = createSignal('')
  const [invalid, setInvalid] = createSignal<Record<string, boolean>>({})
  // A new trigger opens on its sources' suggestions.
  const [suggesting, setSuggesting] = createSignal(!props.request.triggerId)
  let initialized = false

  /** Which inputs a record fills: the bound ones, and the item rule's names that have no value. */
  const recordModes = (
    inputs: Record<string, DataValue>,
    bindings: RecordsDraft['bindings'] = {},
  ): Record<string, boolean> =>
    Object.fromEntries(
      props.request.inputs.map((item) => [
        item.name,
        item.name in bindings || (RECORD_FILLED_INPUTS.includes(item.name) && !(item.name in inputs)),
      ]),
    )

  createEffect(() => {
    if (initialized || (props.request.triggerId ? !existing() : !defaults())) return
    const row = existing()
    setTrigger(row)
    setProjectId(row?.projectId ?? props.request.projectId)
    setValues(row?.inputs ?? values())
    const when = row?.when
    if (when?.kind === 'records') {
      const { kind: _kind, ...draft } = when
      setKind('records')
      setRecords(draft)
      setFromRecord(recordModes(row!.inputs, draft.bindings))
    }
    setTimezone(when?.kind === 'clock' ? when.timezone : (defaults()?.timezone ?? ''))
    setCadence(row?.cadence ?? { daily: '09:00' })
    setLoops(row?.loops ?? [])
    setFirstCheck(row?.firstCheck ?? 'process-current')
    setRequestedLimits(row?.limits)
    initialized = true
  })

  const recordsWhen = (): WorkflowTriggerWhen => {
    const { bindings = {}, ...draft } = records()
    const kept = Object.entries(bindings).filter(([name]) => fromRecord()[name])
    return {
      kind: 'records',
      ...draft,
      query: draft.query!,
      ...(kept.length ? { bindings: Object.fromEntries(kept) } : {}),
    }
  }

  const input = (): WorkflowTriggerDraftInput => ({
    ...(trigger()?.id ? { id: trigger()!.id } : {}),
    name: `${props.request.name} trigger`,
    projectId: projectId(),
    workflowId: props.request.workflowId,
    inputs:
      kind() === 'records'
        ? Object.fromEntries(Object.entries(values()).filter(([name]) => !fromRecord()[name]))
        : values(),
    when: kind() === 'records' ? recordsWhen() : { kind: 'clock', timezone: timezone() },
    cadence: cadence(),
    loops: loops(),
    ...(requestedLimits() ? { limits: requestedLimits() } : {}),
  })

  const editSetup = (change: () => void): void => {
    change()
    setPreparation(undefined)
  }

  const chooseKind = (next: WorkflowTriggerWhen['kind']): void =>
    editSetup(() => {
      setKind(next)
      setCadence(next === 'records' ? { every: 300 } : { daily: '09:00' })
      if (next === 'records') setFromRecord(recordModes({}, records().bindings))
    })
  const pickSuggestion = (suggestion: SuggestedTrigger): void =>
    editSetup(() => {
      setKind('records')
      setCadence({ every: 300 })
      setRecords({ query: suggestion.reference, change: starterChange(suggestion.change) })
      setFromRecord(recordModes({}))
      setPreview(undefined)
      setSuggesting(false)
    })
  const editRecords = (patch: Partial<RecordsDraft>): void =>
    editSetup(() => {
      setRecords((current) => ({ ...current, ...patch }))
      if ('query' in patch) setPreview(undefined)
    })
  const bindInput = (name: string, binding: DataBinding | undefined): void =>
    editRecords({
      bindings: Object.fromEntries(
        Object.entries({ ...records().bindings, [name]: binding }).filter(
          (entry): entry is [string, DataBinding] => !!entry[1],
        ),
      ),
    })

  const filledByRecord = (name: string): boolean => !!records().bindings?.[name] || RECORD_FILLED_INPUTS.includes(name)
  const missingInputs = () =>
    props.request.inputs.some((item) =>
      kind() === 'records' && fromRecord()[item.name]
        ? item.required && !filledByRecord(item.name)
        : item.required && values()[item.name] === undefined,
    )
  const invalidFields = () => Object.values(invalid()).some(Boolean)
  const whenReady = (): boolean => {
    if (kind() === 'clock') return !!timezone()
    const { query, change } = records()
    return !!query && (change.on !== 'changes' || change.fields.length > 0)
  }
  const readyForReview = () => !!projectId() && whenReady() && !missingInputs() && !invalidFields()

  const act = async (label: string, work: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setError('')
    try {
      await work()
      await queryClient.invalidateQueries({ queryKey: ['workflow-triggers'] })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy('')
    }
  }

  const review = () =>
    act('review', async () => {
      const result = await workflowApi.prepareTrigger(input())
      setPreparation(result)
      setLoops(result.loops.map((loop) => loops().find((item) => item.loopId === loop.loopId) ?? loop.setting))
      if (!requestedLimits()) setRequestedLimits(result.limits)
    })

  const save = async (): Promise<WorkflowTriggerView> => {
    const saved = await workflowApi.saveTrigger(input())
    setTrigger(saved)
    return saved
  }

  const previewMatches = () =>
    act('preview', async () => {
      setPreview(await workflowApi.previewTrigger(input()))
    })

  const saveDraft = () =>
    act('save', async () => {
      await save()
    })

  const activate = () =>
    act('activate', async () => {
      if (!preparation()) throw new Error('Review the activation setup first.')
      if (loops().some((loop) => loop.repeat.mode === 'changed' && !loop.repeat.fields?.length)) {
        throw new Error('Choose at least one field for every “Run again when these fields change” loop.')
      }
      const saved = await save()
      const active = await workflowApi.approveTrigger(saved.id, firstCheck(), freshStart())
      setTrigger(active)
      setFreshStart(false)
    })

  const patchLoop = (id: string, patch: Partial<WorkflowTriggerLoopSetting>): void => {
    setLoops((current) => current.map((loop) => (loop.loopId === id ? { ...loop, ...patch } : loop)))
  }

  const updateTrackedField = (
    loop: WorkflowTriggerLoopSetting,
    index: number,
    binding: DataBinding | undefined,
  ): void => {
    const fields = [...(loop.repeat.fields ?? [])]
    const address = binding?.address
    fields[index] = address?.from === 'item' ? address.pointer : ''
    patchLoop(loop.loopId, { repeat: { ...loop.repeat, fields: fields.filter(Boolean) } })
  }

  const limitValue = (key: 'maxDescendants' | 'maxConcurrency', fallback: number): number =>
    requestedLimits()?.[key] ?? fallback
  const setLimit = (key: 'maxDescendants' | 'maxConcurrency', raw: string): void => {
    const value = Number(raw)
    setRequestedLimits((current) => ({ ...current, [key]: value }))
  }
  // Shown in minutes, the unit the Definition inspector uses; stored in milliseconds.
  const wallMinutes = (limits: WorkflowTriggerLimits): number =>
    (requestedLimits()?.budget?.maxWallTimeMs ?? limits.budget.maxWallTimeMs) / 60_000
  const setWallMinutes = (raw: string): void => {
    setRequestedLimits((current) => ({
      ...current,
      budget: { ...current?.budget, maxWallTimeMs: Number(raw) * 60_000 },
    }))
  }

  const effectiveLimits = () =>
    (requestedLimits() as WorkflowTriggerLimits | undefined) ?? preparation()?.limits ?? trigger()?.limits
  const occurrences = createMemo(() => {
    try {
      return kind() === 'clock' && timezone() ? nextScheduleOccurrences(cadence(), timezone()) : []
    } catch {
      return []
    }
  })

  const pause = (paused: boolean) =>
    act(paused ? 'pause' : 'resume', async () => {
      setTrigger(await workflowApi.pauseTrigger(trigger()!.id, paused))
    })
  const runNow = () =>
    act('run', async () => {
      setTrigger(await workflowApi.runTriggerNow(trigger()!.id))
    })
  const remove = () =>
    act('delete', async () => {
      await workflowApi.deleteTrigger(trigger()!.id)
      closeWorkflowTrigger()
    })
  const openRun = (run: { taskId: string; runId: string } | undefined): void => {
    const task = (tasks.data ?? []).find((candidate) => candidate.id === run?.taskId)
    if (!run || !task) return
    closeWorkflowTrigger()
    openWorkflowRun(task, run.runId, navigate)
  }
  const workspaceId = () => (projects.data ?? []).find((project) => project.id === projectId())?.workspaceId ?? ''
  const reviewWorkflow = (): void => {
    closeWorkflowTrigger()
    navigate(workflowsSurfacePath(projectId(), `db:${props.request.workflowId}`))
  }

  const valueField = (item: TriggerRequest['inputs'][number]) => (
    <TypedValueField
      label={item.required ? `${item.label ?? item.name} *` : (item.label ?? item.name)}
      schema={item.schema}
      hint={item.description}
      value={values()[item.name]}
      required={item.required}
      onValidity={(valid) => setInvalid((current) => ({ ...current, [item.name]: !valid }))}
      onChange={(value) =>
        editSetup(() =>
          setValues((current) => {
            const next = { ...current }
            if (value === undefined) delete next[item.name]
            else next[item.name] = value
            return next
          }),
        )
      }
    />
  )

  return (
    <Modal onDismiss={closeWorkflowTrigger} title={`Trigger for ${props.request.name}`} size="lg">
      <ModalBody>
        <Stack gap="stack">
          <Show when={trigger()}>
            {(row) => (
              <Inline gap="inline" wrap>
                <Badge tone={STATE_TONE[row().state]}>{triggerStateLabel(row().state)}</Badge>
                <Show when={row().nextRunAt}>
                  <Text emphasis="muted">Next {formatOccurrence(row().nextRunAt!, zoneOf(row().when))}</Text>
                </Show>
              </Inline>
            )}
          </Show>
          <Show when={error()}>
            <Alert tone="danger">{error()}</Alert>
          </Show>
          <Show when={trigger()?.error}>
            {(message) => (
              <Alert tone="warn" title={triggerStateLabel(trigger()!.state)}>
                <Stack gap="row">
                  <Text wrap>{message()}</Text>
                  <Show when={trigger()?.state === 'needs-review'}>
                    <Inline gap="inline" wrap>
                      <Button size="sm" onPress={() => void review()}>
                        Review activation
                      </Button>
                      <Show when={/workflow dependency|shared query/i.test(message())}>
                        <Button size="sm" onPress={reviewWorkflow}>
                          Review published workflow
                        </Button>
                      </Show>
                    </Inline>
                  </Show>
                </Stack>
              </Alert>
            )}
          </Show>

          <Show when={suggesting()}>
            <SectionHeader level="group">Start from a suggestion</SectionHeader>
            <Text emphasis="muted" wrap>
              {`Pick what should start ${props.request.name}, or set it up yourself. You choose the inputs next.`}
            </Text>
            <SuggestedTriggers workspaceId={workspaceId()} projectId={projectId()} onPick={pickSuggestion} />
            <Inline gap="inline">
              <Button size="sm" onPress={() => setSuggesting(false)}>
                Set it up yourself
              </Button>
            </Inline>
          </Show>
          <Show when={!suggesting()}>
            <SectionHeader level="group">When</SectionHeader>
            <Field label="When" group>
              <Select
                label="When"
                value={kind()}
                disabled={!!trigger()?.id}
                options={[
                  { value: 'clock', label: 'On a schedule' },
                  { value: 'records', label: 'When records change' },
                ]}
                onChange={(value) => chooseKind(value as WorkflowTriggerWhen['kind'])}
              />
            </Field>
            <Show when={kind() === 'records'}>
              <RecordsWhenFields
                workspaceId={workspaceId()}
                projectId={projectId()}
                draft={records()}
                cadence={cadence()}
                preview={preview()}
                previewing={busy() === 'preview'}
                onDraft={editRecords}
                onCadence={(next) => editSetup(() => setCadence(next))}
                onPreview={() => void previewMatches()}
              />
            </Show>
            <Show when={kind() === 'clock'}>
              <Field label="Cadence" group>
                <Select
                  label="Cadence"
                  value={cadenceChoice(cadence())}
                  options={[
                    { value: 'hourly', label: 'Every hour' },
                    { value: 'daily', label: 'Every day at 09:00' },
                    { value: 'weekly', label: 'Every Monday at 09:00' },
                  ]}
                  onChange={(value) =>
                    editSetup(() => setCadence(cadenceForChoice(value as 'hourly' | 'daily' | 'weekly')))
                  }
                />
              </Field>
              <Field label="Timezone" group>
                <Select
                  label="Timezone"
                  value={timezone()}
                  options={timezoneOptions(timezone())}
                  onChange={(value) => editSetup(() => setTimezone(value))}
                />
              </Field>
            </Show>

            <Show when={occurrences().length}>
              <Stack gap="row">
                <SectionHeader level="sub">Next three checks</SectionHeader>
                <For each={occurrences()}>
                  {(instant) => <Text emphasis="muted">{formatOccurrence(instant, timezone())}</Text>}
                </For>
              </Stack>
            </Show>

            <SectionHeader level="group">{`Then start ${props.request.name}`}</SectionHeader>
            <Field label="Project" hint="Each run this trigger starts makes its task in this project." group>
              <Select
                label="Project"
                value={projectId()}
                options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))}
                onChange={(value) => editSetup(() => setProjectId(value))}
              />
            </Field>

            <For each={props.request.inputs}>
              {(item) => (
                <Show when={kind() === 'records'} fallback={valueField(item)}>
                  <Field label={item.required ? `${item.label ?? item.name} *` : (item.label ?? item.name)} group>
                    <Select
                      label={`${item.label ?? item.name} comes from`}
                      value={fromRecord()[item.name] ? 'record' : 'value'}
                      options={[
                        { value: 'record', label: 'From the record' },
                        { value: 'value', label: 'Value' },
                      ]}
                      onChange={(value) =>
                        editSetup(() => setFromRecord((current) => ({ ...current, [item.name]: value === 'record' })))
                      }
                    />
                  </Field>
                  <Show when={fromRecord()[item.name]} fallback={valueField(item)}>
                    <Show
                      when={preview()}
                      fallback={
                        <Text emphasis="muted" wrap>
                          {RECORD_FILLED_INPUTS.includes(item.name)
                            ? 'Filled the way Start workflow… fills it. Preview the matches to pick a field instead.'
                            : 'Preview the matches to pick a field.'}
                        </Text>
                      }
                    >
                      {(described) => (
                        <TypedBindingPicker
                          label={`${item.label ?? item.name} field`}
                          origins={recordOrigin(described())}
                          destination={item.schema}
                          value={records().bindings?.[item.name]}
                          onChange={(binding) => bindInput(item.name, binding)}
                        />
                      )}
                    </Show>
                  </Show>
                </Show>
              )}
            </For>

            <Show when={preparation()?.loops}>
              {(described) => (
                <For each={described()}>
                  {(descriptor) => {
                    const setting = () =>
                      loops().find((loop) => loop.loopId === descriptor.loopId) ?? descriptor.setting
                    const tracked = () => (setting().repeat.fields?.length ? setting().repeat.fields! : [''])
                    return (
                      <Fold label={`${descriptor.label} · repeat handling`} level="group" defaultOpen>
                        <Stack gap="row">
                          <Text emphasis="muted">{descriptor.sourceLabel}</Text>
                          <Field label="When a record matches" group>
                            <Select
                              label="Repeat handling"
                              value={setting().repeat.mode}
                              options={[
                                { value: 'every-match', label: 'Every match' },
                                { value: 'unseen', label: 'Previously unseen records' },
                                { value: 'changed', label: 'Run again when these fields change' },
                              ]}
                              onChange={(mode) =>
                                patchLoop(descriptor.loopId, {
                                  repeat:
                                    mode === 'changed'
                                      ? {
                                          mode: 'changed',
                                          fields: setting().repeat.fields?.length ? setting().repeat.fields : [],
                                        }
                                      : { mode: mode as 'every-match' | 'unseen' },
                                })
                              }
                            />
                          </Field>
                          <Show when={setting().repeat.mode === 'changed'}>
                            <For each={tracked()}>
                              {(pointer, index) => (
                                <TypedBindingPicker
                                  label={`Tracked field ${index() + 1}`}
                                  origins={[
                                    {
                                      kind: 'item',
                                      label: descriptor.sourceLabel,
                                      schema: descriptor.schema,
                                      fields: descriptor.fields,
                                    },
                                  ]}
                                  value={pointer ? { address: { from: 'item', pointer } } : undefined}
                                  onChange={(value) => updateTrackedField(setting(), index(), value)}
                                />
                              )}
                            </For>
                            <Button
                              size="sm"
                              onPress={() =>
                                patchLoop(descriptor.loopId, {
                                  repeat: { ...setting().repeat, fields: [...(setting().repeat.fields ?? []), ''] },
                                })
                              }
                            >
                              Add tracked field
                            </Button>
                          </Show>
                          <Field label="Time window" group>
                            <Select
                              label="Time window"
                              value={setting().incremental ? 'checkpoint' : 'window'}
                              options={[
                                { value: 'window', label: 'Use the workflow query window' },
                                ...(descriptor.checkpointAvailable
                                  ? [{ value: 'checkpoint', label: 'Since the last completed check' }]
                                  : []),
                              ]}
                              onChange={(value) =>
                                patchLoop(descriptor.loopId, { incremental: value === 'checkpoint' })
                              }
                            />
                          </Field>
                          <Show when={!descriptor.checkpointAvailable}>
                            <Text emphasis="muted" wrap>
                              {descriptor.checkpointReason}
                            </Text>
                          </Show>
                        </Stack>
                      </Fold>
                    )
                  }}
                </For>
              )}
            </Show>

            <Show when={preparation()}>
              {(reviewed) => (
                <Stack gap="stack">
                  <Field
                    label="First check"
                    help="Start tracking from now notes today's matches without running anything. Process current matches runs them on the first check."
                    group
                  >
                    <Select
                      label="First check"
                      value={firstCheck()}
                      options={[
                        { value: 'process-current', label: 'Process current matches' },
                        { value: 'track-now', label: 'Start tracking from now' },
                      ]}
                      onChange={(value) => setFirstCheck(value as WorkflowTriggerFirstCheck)}
                    />
                  </Field>
                  <Alert title="Limits">{limitsSummary(effectiveLimits() ?? reviewed().limits)}</Alert>
                  <Fold label="Execution limits" level="group">
                    <Stack gap="row">
                      <Field label="Most child tasks" group>
                        <Input
                          type="number"
                          width="narrow"
                          label="Most child tasks"
                          value={String(limitValue('maxDescendants', reviewed().limits.maxDescendants))}
                          onInput={(raw) => setLimit('maxDescendants', raw)}
                        />
                      </Field>
                      <Field label="Agents at once" group>
                        <Input
                          type="number"
                          width="narrow"
                          label="Agents at once"
                          value={String(limitValue('maxConcurrency', reviewed().limits.maxConcurrency))}
                          onInput={(raw) => setLimit('maxConcurrency', raw)}
                        />
                      </Field>
                      <Field label="Workflow timeout in minutes" group>
                        <Input
                          type="number"
                          width="narrow"
                          label="Workflow timeout in minutes"
                          value={String(wallMinutes(reviewed().limits))}
                          onInput={setWallMinutes}
                        />
                      </Field>
                    </Stack>
                  </Fold>
                  <Show when={reviewed().changes.length}>
                    <Alert tone="warn" title="Published dependencies changed">
                      <Stack gap="row">
                        <For each={reviewed().changes}>
                          {(change) => (
                            <Text>{`${change.kind === 'query' ? 'Query' : change.kind === 'field' ? 'Record policy' : change.kind === 'source' ? 'Source' : 'Workflow'}: ${change.label}`}</Text>
                          )}
                        </For>
                        <Text wrap>Records that already ran won't run again unless they change.</Text>
                        <Button size="sm" onPress={reviewWorkflow}>
                          Review published workflow
                        </Button>
                      </Stack>
                    </Alert>
                  </Show>
                  <Show when={trigger()?.id}>
                    <Fold label="Advanced change review" level="group">
                      <Checkbox
                        label="Start fresh"
                        checked={freshStart()}
                        onChange={setFreshStart}
                        hint="Forget which records already ran. They may run again. Past runs stay in history."
                      />
                    </Fold>
                  </Show>
                </Stack>
              )}
            </Show>

            <Show when={trigger()?.when.kind === 'records' ? trigger() : undefined}>
              {(row) => <RecordMatchHistory trigger={row()} onOpenRun={openRun} />}
            </Show>
            <Show when={trigger()?.when.kind === 'clock' ? trigger()?.latest : undefined}>
              {(latest) => (
                <Alert
                  title={`${latest().kind === 'manual' ? 'Run now' : latest().kind === 'baseline' ? 'Baseline' : 'Latest check'} · ${latest().state}`}
                >
                  <Stack gap="row">
                    <Show when={latest().detail}>
                      <Text wrap>{latest().detail}</Text>
                    </Show>
                    <Button size="sm" onPress={() => openRun(latest())}>
                      Open run{latest().state === 'active' ? ' to cancel' : ''}
                    </Button>
                  </Stack>
                </Alert>
              )}
            </Show>
            <Show when={trigger()?.state === 'unavailable'}>
              <Button
                size="sm"
                onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}
              >
                Reconnect in Settings
              </Button>
            </Show>
          </Show>
        </Stack>
      </ModalBody>
      <ModalActions>
        <Show when={trigger()?.id}>
          <Button
            variant="ghost"
            disabled={!!busy() || !['active', 'paused'].includes(trigger()!.state)}
            onPress={() => void runNow()}
          >
            Run now
          </Button>
          <Show
            when={trigger()?.state === 'active'}
            fallback={
              <Show when={trigger()?.state === 'paused'}>
                <Button variant="ghost" disabled={!!busy()} onPress={() => void pause(false)}>
                  Resume
                </Button>
              </Show>
            }
          >
            <Button variant="ghost" disabled={!!busy()} onPress={() => void pause(true)}>
              Pause
            </Button>
          </Show>
          <ConfirmButton
            tone="danger"
            confirmLabel="Delete trigger?"
            disabled={!!busy()}
            onConfirm={() => void remove()}
          >
            Delete trigger
          </ConfirmButton>
          <Toolbar.Spacer />
        </Show>
        <Button variant="ghost" onPress={closeWorkflowTrigger}>
          Close
        </Button>
        <Show when={!suggesting()}>
          <Button disabled={!readyForReview() || !!busy()} busy={busy() === 'review'} onPress={() => void review()}>
            Review activation
          </Button>
          <Button disabled={!readyForReview() || !!busy()} busy={busy() === 'save'} onPress={() => void saveDraft()}>
            Save draft
          </Button>
          <Button
            variant="solid"
            disabled={!preparation() || !!busy()}
            busy={busy() === 'activate'}
            title="Activation never waits in a queue while you're offline."
            onPress={() => void activate()}
          >
            {trigger()?.state === 'needs-review' ? 'Approve changes' : 'Activate'}
          </Button>
        </Show>
      </ModalActions>
    </Modal>
  )
}
