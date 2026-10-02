import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { clientEvents, pathForTask, projectsOptions, tasksOptions } from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, Checkbox, ConfirmButton, Field, Fold, Inline, Input,
  Modal, ModalActions, ModalBody, Select, Stack, Text, Toolbar,
} from '@acorn/plugin-api/ui'
import { TypedBindingPicker } from '@acorn/plugin-api/ui/data-sources'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import type {
  WorkflowScheduleDraftInput,
  WorkflowScheduleFirstCheck,
  WorkflowScheduleLimits,
  WorkflowScheduleLoopSetting,
  WorkflowSchedulePreparation,
  WorkflowScheduleView,
} from '../../shared/workflowSchedules'
import TypedValueField from '../editor/TypedValueField'
import { rememberWorkflowRun } from '../runs/runStore'
import { workflowsSurfacePath } from '../surfacePath'
import { workflowApi } from '../workflowsClient'
import { closeWorkflowSchedule, scheduleRequest, type ScheduleRequest } from './scheduleRequest'
import {
  cadenceChoice, cadenceForChoice, formatOccurrence, limitsSummary,
  nextScheduleOccurrences, scheduleStateLabel,
} from './scheduleModel'

const STATE_TONE = {
  draft: 'neutral', activating: 'warn', active: 'ok', paused: 'neutral',
  'needs-review': 'warn', unavailable: 'danger',
} as const

export default function ScheduleDialogHost() {
  return <Show when={scheduleRequest()}>{request => <ScheduleDialog request={request()} />}</Show>
}

function ScheduleDialog(props: { request: ScheduleRequest }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const tasks = createQuery(() => tasksOptions(true))
  const [existing] = createResource(() => props.request.scheduleId, id => id ? workflowApi.schedule(id) : Promise.resolve(undefined))
  const [defaults] = createResource(() => workflowApi.scheduleDefaults().catch(() => ({ timezone: 'UTC' })))
  const [schedule, setSchedule] = createSignal<WorkflowScheduleView>()
  const [projectId, setProjectId] = createSignal(props.request.projectId)
  const [values, setValues] = createSignal<Record<string, DataValue>>(
    Object.fromEntries(props.request.inputs.flatMap(input => input.default === undefined ? [] : [[input.name, input.default]])),
  )
  const [timezone, setTimezone] = createSignal('')
  const [cadence, setCadence] = createSignal<Cadence>({ daily: '09:00' })
  const [preparation, setPreparation] = createSignal<WorkflowSchedulePreparation>()
  const [loops, setLoops] = createSignal<WorkflowScheduleLoopSetting[]>([])
  const [firstCheck, setFirstCheck] = createSignal<WorkflowScheduleFirstCheck>('process-current')
  const [freshStart, setFreshStart] = createSignal(false)
  const [requestedLimits, setRequestedLimits] = createSignal<WorkflowScheduleDraftInput['limits']>()
  const [busy, setBusy] = createSignal('')
  const [error, setError] = createSignal('')
  const [invalid, setInvalid] = createSignal<Record<string, boolean>>({})
  let initialized = false

  createEffect(() => {
    if (initialized || (props.request.scheduleId ? !existing() : !defaults())) return
    const row = existing()
    setSchedule(row)
    setProjectId(row?.projectId ?? props.request.projectId)
    setValues(row?.inputs ?? values())
    setTimezone(row?.timezone ?? defaults()?.timezone ?? '')
    setCadence(row?.cadence ?? { daily: '09:00' })
    setLoops(row?.loops ?? [])
    setFirstCheck(row?.firstCheck ?? 'process-current')
    setRequestedLimits(row?.limits)
    initialized = true
  })

  const input = (): WorkflowScheduleDraftInput => ({
    ...(schedule()?.id ? { id: schedule()!.id } : {}),
    name: `${props.request.name} schedule`,
    projectId: projectId(),
    workflowId: props.request.workflowId,
    inputs: values(),
    timezone: timezone(),
    cadence: cadence(),
    loops: loops(),
    ...(requestedLimits() ? { limits: requestedLimits() } : {}),
  })

  const editSetup = (change: () => void): void => {
    change()
    setPreparation(undefined)
  }

  const missingInputs = () => props.request.inputs.some(item => item.required && values()[item.name] === undefined)
  const invalidFields = () => Object.values(invalid()).some(Boolean)
  const readyForReview = () => !!projectId() && !!timezone() && !missingInputs() && !invalidFields()

  const act = async (label: string, work: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setError('')
    try {
      await work()
      await queryClient.invalidateQueries({ queryKey: ['workflow-schedules'] })
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy('') }
  }

  const review = () => act('review', async () => {
    const result = await workflowApi.prepareSchedule(input())
    setPreparation(result)
    setLoops(result.loops.map(loop => loops().find(item => item.loopId === loop.loopId) ?? loop.setting))
    if (!requestedLimits()) setRequestedLimits(result.limits)
  })

  const save = async (): Promise<WorkflowScheduleView> => {
    const saved = await workflowApi.saveSchedule(input())
    setSchedule(saved)
    return saved
  }

  const saveDraft = () => act('save', async () => { await save() })

  const activate = () => act('activate', async () => {
    if (!preparation()) throw new Error('Review the activation setup first.')
    if (loops().some(loop => loop.repeat.mode === 'changed' && !(loop.repeat.fields?.length))) {
      throw new Error('Choose at least one field for every “Run again when these fields change” loop.')
    }
    const saved = await save()
    const active = await workflowApi.approveSchedule(saved.id, firstCheck(), freshStart())
    setSchedule(active)
    setFreshStart(false)
  })

  const patchLoop = (id: string, patch: Partial<WorkflowScheduleLoopSetting>): void => {
    setLoops(current => current.map(loop => loop.loopId === id ? { ...loop, ...patch } : loop))
  }

  const updateTrackedField = (loop: WorkflowScheduleLoopSetting, index: number, binding: DataBinding | undefined): void => {
    const fields = [...(loop.repeat.fields ?? [])]
    const address = binding?.address
    fields[index] = address?.from === 'item' ? address.pointer : ''
    patchLoop(loop.loopId, { repeat: { ...loop.repeat, fields: fields.filter(Boolean) } })
  }

  const limitValue = (key: 'maxDescendants' | 'maxConcurrency', fallback: number): number => requestedLimits()?.[key] ?? fallback
  const setLimit = (key: 'maxDescendants' | 'maxConcurrency', raw: string): void => {
    const value = Number(raw)
    setRequestedLimits(current => ({ ...current, [key]: value }))
  }
  // Shown in minutes, the unit the Definition inspector uses; stored in milliseconds.
  const wallMinutes = (limits: WorkflowScheduleLimits): number => (requestedLimits()?.budget?.maxWallTimeMs ?? limits.budget.maxWallTimeMs) / 60_000
  const setWallMinutes = (raw: string): void => {
    setRequestedLimits(current => ({ ...current, budget: { ...current?.budget, maxWallTimeMs: Number(raw) * 60_000 } }))
  }

  const effectiveLimits = () => requestedLimits() as WorkflowScheduleLimits | undefined ?? preparation()?.limits ?? schedule()?.limits
  const occurrences = createMemo(() => {
    try { return timezone() ? nextScheduleOccurrences(cadence(), timezone()) : [] }
    catch { return [] }
  })

  const pause = (paused: boolean) => act(paused ? 'pause' : 'resume', async () => {
    setSchedule(await workflowApi.pauseSchedule(schedule()!.id, paused))
  })
  const runNow = () => act('run', async () => { setSchedule(await workflowApi.runScheduleNow(schedule()!.id)) })
  const remove = () => act('delete', async () => { await workflowApi.deleteSchedule(schedule()!.id); closeWorkflowSchedule() })
  const openRun = (): void => {
    const latest = schedule()?.latest
    const task = (tasks.data ?? []).find(candidate => candidate.id === latest?.taskId)
    if (!latest || !task) return
    rememberWorkflowRun(task.id)
    closeWorkflowSchedule()
    navigate(`${pathForTask(task)}?pane=workflows&item=${encodeURIComponent(latest.runId)}`)
  }
  const reviewWorkflow = (): void => {
    closeWorkflowSchedule()
    navigate(workflowsSurfacePath(projectId(), `db:${props.request.workflowId}`))
  }

  return (
    <Modal onDismiss={closeWorkflowSchedule} title={`Schedule ${props.request.name}`} size="lg">
      <ModalBody>
        <Stack gap="stack">
          <Show when={schedule()}>{row => (
            <Inline gap="inline" wrap>
              <Badge tone={STATE_TONE[row().state]}>{scheduleStateLabel(row().state)}</Badge>
              <Show when={row().nextRunAt}><Text emphasis="muted">Next {formatOccurrence(row().nextRunAt!, row().timezone)}</Text></Show>
            </Inline>
          )}</Show>
          <Show when={error()}><Alert tone="danger">{error()}</Alert></Show>
          <Show when={schedule()?.error}>{message => (
            <Alert tone="warn" title={scheduleStateLabel(schedule()!.state)}>
              <Stack gap="row">
                <Text wrap>{message()}</Text>
                <Show when={schedule()?.state === 'needs-review'}>
                  <Inline gap="inline" wrap>
                    <Button size="sm" onPress={() => void review()}>Review activation</Button>
                    <Show when={/workflow dependency|shared query/i.test(message())}>
                      <Button size="sm" onPress={reviewWorkflow}>Review published workflow</Button>
                    </Show>
                  </Inline>
                </Show>
              </Stack>
            </Alert>
          )}</Show>

          <Field label="Project" hint="Every unattended run creates its root task in this project." group>
            <Select label="Project" value={projectId()} options={(projects.data ?? []).map(project => ({ value: project.id, label: project.name }))}
              onChange={value => editSetup(() => setProjectId(value))} />
          </Field>

          <For each={props.request.inputs}>{item => (
            <TypedValueField
              label={item.required ? `${item.label ?? item.name} *` : item.label ?? item.name}
              schema={item.schema}
              hint={item.description}
              value={values()[item.name]}
              required={item.required}
              onValidity={valid => setInvalid(current => ({ ...current, [item.name]: !valid }))}
              onChange={value => editSetup(() => setValues(current => {
                const next = { ...current }
                if (value === undefined) delete next[item.name]
                else next[item.name] = value
                return next
              }))}
            />
          )}</For>

          <Field label="Cadence" group>
            <Select label="Cadence" value={cadenceChoice(cadence())} options={[
              { value: 'hourly', label: 'Every hour' },
              { value: 'daily', label: 'Every day at 09:00' },
              { value: 'weekly', label: 'Every Monday at 09:00' },
            ]} onChange={value => editSetup(() => setCadence(cadenceForChoice(value as 'hourly' | 'daily' | 'weekly')))} />
          </Field>
          <Field label="Timezone" hint="Calendar schedules and time windows use this IANA timezone." group>
            <Input label="Timezone" value={timezone()} placeholder="Pacific/Auckland" onInput={value => editSetup(() => setTimezone(value))} />
          </Field>

          <Show when={occurrences().length}>
            <Stack gap="row">
              <Text emphasis="strong">Next three checks</Text>
              <For each={occurrences()}>{instant => <Text emphasis="muted">{formatOccurrence(instant, timezone())}</Text>}</For>
            </Stack>
          </Show>

          <Show when={preparation()?.loops}>{described => (
            <For each={described()}>{descriptor => {
              const setting = () => loops().find(loop => loop.loopId === descriptor.loopId) ?? descriptor.setting
              const tracked = () => setting().repeat.fields?.length ? setting().repeat.fields! : ['']
              return (
                <Fold label={`${descriptor.label} · repeat handling`} level="group" defaultOpen>
                  <Stack gap="row">
                    <Text emphasis="muted">{descriptor.sourceLabel}</Text>
                    <Field label="When a record matches" group>
                      <Select label="Repeat handling" value={setting().repeat.mode} options={[
                        { value: 'every-match', label: 'Every match' },
                        { value: 'unseen', label: 'Previously unseen records' },
                        { value: 'changed', label: 'Run again when these fields change' },
                      ]} onChange={mode => patchLoop(descriptor.loopId, {
                        repeat: mode === 'changed'
                          ? { mode: 'changed', fields: setting().repeat.fields?.length ? setting().repeat.fields : [] }
                          : { mode: mode as 'every-match' | 'unseen' },
                      })} />
                    </Field>
                    <Show when={setting().repeat.mode === 'changed'}>
                      <For each={tracked()}>{(pointer, index) => (
                        <TypedBindingPicker
                          label={`Tracked field ${index() + 1}`}
                          origins={[{ kind: 'item', label: descriptor.sourceLabel, schema: descriptor.schema, fields: descriptor.fields }]}
                          value={pointer ? { address: { from: 'item', pointer } } : undefined}
                          onChange={value => updateTrackedField(setting(), index(), value)}
                        />
                      )}</For>
                      <Button size="sm" onPress={() => patchLoop(descriptor.loopId, { repeat: { ...setting().repeat, fields: [...(setting().repeat.fields ?? []), ''] } })}>
                        Add tracked field
                      </Button>
                    </Show>
                    <Field label="Time window" group>
                      <Select label="Time window" value={setting().incremental ? 'checkpoint' : 'window'} options={[
                        { value: 'window', label: 'Use the workflow query window' },
                        ...(descriptor.checkpointAvailable ? [{ value: 'checkpoint', label: 'Since the last completed check' }] : []),
                      ]} onChange={value => patchLoop(descriptor.loopId, { incremental: value === 'checkpoint' })} />
                    </Field>
                    <Show when={!descriptor.checkpointAvailable}><Text emphasis="muted" wrap>{descriptor.checkpointReason}</Text></Show>
                  </Stack>
                </Fold>
              )
            }}</For>
          )}</Show>

          <Show when={preparation()}>{reviewed => (
            <Stack gap="stack">
              <Field label="First check" group>
                <Select label="First check" value={firstCheck()} options={[
                  { value: 'process-current', label: 'Process current matches' },
                  { value: 'track-now', label: 'Start tracking from now' },
                ]} onChange={value => setFirstCheck(value as WorkflowScheduleFirstCheck)} />
              </Field>
              <Text emphasis="muted" wrap>
                {firstCheck() === 'track-now'
                  ? 'The initial baseline records current matches without running child workflows. Activation completes only after that baseline succeeds.'
                  : 'Current matches inside the workflow query window are eligible on the first check.'}
              </Text>
              <Alert title="Effective limits">{limitsSummary(effectiveLimits() ?? reviewed().limits)}</Alert>
              <Fold label="Execution limits" level="group">
                <Stack gap="row">
                  <Field label="Most child tasks" group><Input type="number" width="narrow" label="Most child tasks" value={String(limitValue('maxDescendants', reviewed().limits.maxDescendants))} onInput={raw => setLimit('maxDescendants', raw)} /></Field>
                  <Field label="Agents at once" group><Input type="number" width="narrow" label="Agents at once" value={String(limitValue('maxConcurrency', reviewed().limits.maxConcurrency))} onInput={raw => setLimit('maxConcurrency', raw)} /></Field>
                  <Field label="Time limit in minutes" group><Input type="number" width="narrow" label="Time limit in minutes" value={String(wallMinutes(reviewed().limits))} onInput={setWallMinutes} /></Field>
                </Stack>
              </Fold>
              <Show when={reviewed().changes.length}>
                <Alert tone="warn" title="Published dependencies changed">
                  <Stack gap="row">
                    <For each={reviewed().changes}>{change => <Text>{`${change.kind === 'query' ? 'Query' : change.kind === 'field' ? 'Record policy' : change.kind === 'source' ? 'Source' : 'Workflow'}: ${change.label}`}</Text>}</For>
                    <Text wrap>Existing processing history is retained, so unchanged records do not run again.</Text>
                    <Button size="sm" onPress={reviewWorkflow}>Review published workflow</Button>
                  </Stack>
                </Alert>
              </Show>
              <Show when={schedule()?.id}>
                <Fold label="Advanced change review" level="group">
                  <Checkbox label="Start fresh" checked={freshStart()} onChange={setFreshStart}
                    hint="Creates a new processing history. Matching records may run again; old attempts remain available." />
                </Fold>
              </Show>
            </Stack>
          )}</Show>

          <Show when={schedule()?.latest}>{latest => (
            <Alert title={`${latest().kind === 'manual' ? 'Run now' : latest().kind === 'baseline' ? 'Baseline' : 'Latest check'} · ${latest().state}`}>
              <Stack gap="row">
                <Show when={latest().detail}><Text wrap>{latest().detail}</Text></Show>
                <Button size="sm" onPress={openRun}>Open run{latest().state === 'active' ? ' to cancel' : ''}</Button>
              </Stack>
            </Alert>
          )}</Show>
          <Show when={schedule()?.state === 'unavailable'}>
            <Button size="sm" onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>Reconnect in Settings</Button>
          </Show>
          <Text emphasis="muted" wrap>Saving keeps this draft on the Node. Activation is a separate device action and is never queued while offline.</Text>
        </Stack>
      </ModalBody>
      <ModalActions>
        <Show when={schedule()?.id}>
          <Button variant="ghost" disabled={!!busy() || !['active', 'paused'].includes(schedule()!.state)} onPress={() => void runNow()}>Run now</Button>
          <Show when={schedule()?.state === 'active'} fallback={<Show when={schedule()?.state === 'paused'}><Button variant="ghost" disabled={!!busy()} onPress={() => void pause(false)}>Resume</Button></Show>}>
            <Button variant="ghost" disabled={!!busy()} onPress={() => void pause(true)}>Pause</Button>
          </Show>
          <ConfirmButton tone="danger" confirmLabel="Delete schedule?" disabled={!!busy()} onConfirm={() => void remove()}>Delete schedule</ConfirmButton>
          <Toolbar.Spacer />
        </Show>
        <Button variant="ghost" onPress={closeWorkflowSchedule}>Close</Button>
        <Button disabled={!readyForReview() || !!busy()} busy={busy() === 'review'} onPress={() => void review()}>Review activation</Button>
        <Button disabled={!readyForReview() || !!busy()} busy={busy() === 'save'} onPress={() => void saveDraft()}>Save draft</Button>
        <Button variant="solid" disabled={!preparation() || !!busy()} busy={busy() === 'activate'} onPress={() => void activate()}>
          {schedule()?.state === 'needs-review' ? 'Approve changes' : 'Activate'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
