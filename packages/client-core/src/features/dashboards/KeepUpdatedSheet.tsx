import { createSignal, For, Show } from 'solid-js'
import type { PanelPlan, SuppliedRows } from '@acorn/protocol/dashboards.ts'
import type { DatasetMode } from '@acorn/protocol/datasets.ts'
import type { Cadence } from '@acorn/protocol/schedules.ts'
import { writeJson } from '../../infra/node/apiClient'
import { clientCapability } from '../../infra/node/clientCapabilities'
import { confirmAction } from '../../host/registries/shell/willPhase'
import { Alert, Button, Checkbox, Input, Select } from '../../kit/components/primitives'
import { Modal } from '../../kit/components/overlays/Modal'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import {
  identityProblem,
  keepProblem,
  keptDatasetInput,
  keptPlan,
  refreshPrompt,
  suggestIdentity,
  suggestMode,
  timeFields,
} from './keepUpdated'
import { AGENT_PROMPT_SCHEDULES } from './refreshCapabilities'

// Keep it up to date, from Add to dashboard on a panel over supplied rows
// (docs/dashboards/supplied-rows.md § Keeping it up to date): one sheet that makes the snapshot an
// agent-fed dataset, optionally schedules its refresh, and places the panel reading it.

const modes: { value: DatasetMode; label: string; answer: string }[] = [
  {
    value: 'current-mirror',
    label: 'Latest state',
    answer: 'Each refresh replaces the row it matches, such as a forecast that is read again each day.',
  },
  {
    value: 'snapshot-history',
    label: 'Daily snapshots',
    answer: 'Each refresh adds a copy of every row, so a number can be tracked over time.',
  },
  {
    value: 'event-archive',
    label: 'Every event',
    answer: 'Each row happened once, such as a release, and a refresh adds the new ones.',
  },
]

const cadences: { value: string; label: string; words: string; cadence?: Cadence; every?: number }[] = [
  { value: 'none', label: 'Only when asked', words: '' },
  {
    value: 'daily',
    label: 'Every day at 09:00',
    words: 'every day at 09:00',
    cadence: { daily: '09:00' },
    every: 86_400,
  },
  { value: 'hourly', label: 'Every hour', words: 'every hour', cadence: { every: 3600 }, every: 3600 },
]

export default function KeepUpdatedSheet(props: {
  nodeId: string | null
  workspaceId: string
  projectId: string
  taskId: string
  plan: PanelPlan
  rows: SuppliedRows
  /** Where the panel goes, named in the sheet. */
  destination: string
  /** Places the plan that reads the dataset. A throw undoes the dataset and its schedule. */
  onKeep: (plan: PanelPlan) => Promise<void>
  onClose: () => void
}) {
  const suggested = suggestMode(props.rows)
  const [name, setName] = createSignal(props.plan.title.slice(0, 120))
  const [mode, setMode] = createSignal(suggested.mode)
  const [eventTime, setEventTime] = createSignal(suggested.eventTimeField ?? timeFields(props.rows)[0] ?? '')
  const [identity, setIdentity] = createSignal(suggestIdentity(props.rows))
  const [cadence, setCadence] = createSignal('none')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const schedules = clientCapability(AGENT_PROMPT_SCHEDULES)
  const problem = () =>
    keepProblem(props.rows) ??
    identityProblem(props.rows.rows, identity()) ??
    (mode() === 'event-archive' && !eventTime() ? 'Every event needs a field that says when each happened.' : undefined)
  const chosen = () => cadences.find((item) => item.value === cadence())!

  const create = async () => {
    const refresh = chosen()
    if (
      refresh.cadence &&
      !(await confirmAction({
        title: `Refresh ${name().trim()} on a schedule`,
        actionLabel: 'Create and schedule',
        goes: `An agent will run in this task's project ${refresh.words} to gather fresh rows for ${name().trim()}, with the tools agents have there.`,
        stays: 'You can pause or delete the schedule in Workflows, and the dataset in Settings → Datasets.',
      }))
    )
      return
    setBusy(true)
    setError('')
    let datasetId: string | undefined
    let schedule: { undo(): Promise<void> } | undefined
    try {
      const { dataset } = await writeJson<{ dataset: { id: string } }>('/v1/core/datasets', {
        method: 'POST',
        nodeId: props.nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          keptDatasetInput(props.rows, {
            name: name().trim(),
            workspaceId: props.workspaceId,
            mode: mode(),
            identityFields: identity(),
            ...(mode() === 'event-archive' ? { eventTimeField: eventTime() } : {}),
            refresh: {
              projectId: props.projectId,
              taskId: props.taskId,
              ...(refresh.every ? { every: refresh.every } : {}),
            },
          }),
        ),
      })
      datasetId = dataset.id
      if (refresh.cadence && schedules)
        schedule = await schedules.schedule({
          workspaceId: props.workspaceId,
          projectId: props.projectId,
          name: `Refresh ${name().trim()}`,
          prompt: refreshPrompt(dataset.id, name().trim(), props.rows.origin),
          cadence: refresh.cadence,
        })
      await props.onKeep(keptPlan(props.plan, dataset.id, props.workspaceId))
      props.onClose()
    } catch (failure) {
      await schedule?.undo().catch(() => {})
      if (datasetId)
        await writeJson(
          `/v1/core/datasets/${encodeURIComponent(datasetId)}?workspaceId=${encodeURIComponent(props.workspaceId)}`,
          { method: 'DELETE', nodeId: props.nodeId },
        ).catch(() => {})
      setError(failure instanceof Error ? failure.message : "Couldn't keep the panel. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Keep it up to date" size="md" onDismiss={() => !busy() && props.onClose()}>
      <Modal.Body>
        <Stack gap="row">
          <Text wrap>
            {`The panel goes on ${props.destination} and reads a dataset that starts with these rows. An agent in this task's project refreshes it, and each row keeps where it came from: ${props.rows.origin.says}.`}
          </Text>
          <Input label="Dataset name" assist={false} value={name()} onInput={setName} />
          <Select
            label="What to keep"
            value={mode()}
            options={modes.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value) => setMode(value as DatasetMode)}
          />
          <Text tone="muted" wrap>
            {modes.find((item) => item.value === mode())?.answer}
          </Text>
          <Show when={mode() === 'event-archive'}>
            <Select
              label="When each happened"
              value={eventTime()}
              options={[
                { value: '', label: 'Choose a time field…' },
                ...props.rows.fields
                  .filter((field) => timeFields(props.rows).includes(field.pointer))
                  .map((field) => ({ value: field.pointer, label: field.label })),
              ]}
              onChange={setEventTime}
            />
          </Show>
          <Text>Fields that tell the rows apart</Text>
          <For each={props.rows.fields}>
            {(field) => (
              <Checkbox
                label={field.label}
                checked={identity().includes(field.pointer)}
                onChange={(checked) =>
                  setIdentity((current) =>
                    checked ? [...current, field.pointer] : current.filter((pointer) => pointer !== field.pointer),
                  )
                }
              />
            )}
          </For>
          <Show when={schedules}>
            <Select
              label="Refresh"
              value={cadence()}
              options={cadences.map((item) => ({ value: item.value, label: item.label }))}
              onChange={setCadence}
            />
          </Show>
          <Show when={problem()}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
          <Show when={error()}>{(message) => <Alert tone="danger">{message()}</Alert>}</Show>
        </Stack>
      </Modal.Body>
      <Modal.Actions>
        <Button size="sm" variant="ghost" disabled={busy()} onPress={props.onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="solid"
          busy={busy()}
          disabled={!!problem() || !name().trim()}
          onPress={() => void create()}
        >
          Create
        </Button>
      </Modal.Actions>
    </Modal>
  )
}
