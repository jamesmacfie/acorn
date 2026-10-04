import { createSignal, Show } from 'solid-js'
import type { DataSourceDescription, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import type { DatasetMode } from '@acorn/protocol/datasets.ts'
import { writeJson } from '../../infra/node/apiClient'
import { confirmAction } from '../../host/registries/shell/willPhase'
import { Alert, Button, Input, Select } from '../../kit/components/primitives'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'

const modes: { value: DatasetMode; label: string; answer: string }[] = [
  { value: 'event-archive', label: 'Keep every event', answer: 'Keeps every event seen from the chosen start day. Complete history requires proof from the source.' },
  { value: 'snapshot-history', label: 'Keep daily snapshots', answer: 'Shows how each item changed at capture times; an item absent on a later day stops counting that day.' },
  { value: 'current-mirror', label: 'Keep the latest state', answer: 'Keeps the latest state of each item and marks removals only after a complete read.' },
]

export default function KeepHistory(props: { query: DataSourceQuery; description: DataSourceDescription; sourceName: string; onCreated(): void }) {
  const [open, setOpen] = createSignal(false)
  const [name, setName] = createSignal(`${props.sourceName} history`)
  const [mode, setMode] = createSignal<DatasetMode>('event-archive')
  const [eventTime, setEventTime] = createSignal('')
  const [cadence, setCadence] = createSignal('daily')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [created, setCreated] = createSignal(false)
  const dates = () => props.description.fields.filter(field => field.display?.kind === 'datetime')
  const create = async () => {
    if (!props.query.scope.workspaceId || mode() === 'event-archive' && !eventTime()) return
    const accepted = await confirmAction({ title: `Keep ${props.sourceName} history`, actionLabel: 'Create dataset and daily capture',
      goes: `This node will store ${modes.find(item => item.value === mode())?.label.toLowerCase()} in ${name()}, up to 500,000 rows or 512 MB, for 90 days. The capture will run ${cadence()}.`,
      stays: 'You can delete the dataset and its schedule in Settings.' })
    if (!accepted) return
    setBusy(true)
    setError('')
    let createdDatasetId: string | undefined
    try {
      const schema = props.description.schema
      if (schema.type !== 'object') throw new Error('Only object records can be kept as a dataset.')
      const result = await writeJson<{ dataset: { id: string } }>('/v1/core/datasets', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          name: name().trim(), workspaceId: props.query.scope.workspaceId, projectId: props.query.scope.projectId,
          mode: mode(), feeder: 'capture', captureQuery: props.query,
          schema: { ...schema, properties: { ...schema.properties, _recordId: { type: 'string' } }, required: [...schema.required ?? [], '_recordId'] },
          fields: [...props.description.fields, { pointer: '/_recordId', label: 'Source record ID', origin: 'declared' }],
          identityFields: ['/_recordId'], ...(mode() === 'event-archive' ? { eventTimeField: eventTime(), backfillFrom: Date.now() } : {}),
          retentionDays: 90, maxRows: 500_000, maxBytes: 512 * 1024 * 1024,
        }),
      })
      createdDatasetId = result.dataset.id
      await writeJson('/v1/core/schedules', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `Capture ${name().trim()}`, kind: 'dataset-capture', target: { datasetId: result.dataset.id },
          cadence: cadence() === 'hourly' ? { every: 3600 } : { daily: '09:00' } }),
      })
      setCreated(true)
      props.onCreated()
    } catch (failure) {
      if (createdDatasetId) await writeJson(`/v1/core/datasets/${encodeURIComponent(createdDatasetId)}?workspaceId=${encodeURIComponent(props.query.scope.workspaceId ?? '')}${props.query.scope.projectId ? `&projectId=${encodeURIComponent(props.query.scope.projectId)}` : ''}`,
        { method: 'DELETE' }).catch(() => {})
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    finally { setBusy(false) }
  }
  return <Stack gap="inline">
    <Button size="sm" variant="ghost" onPress={() => setOpen(!open())}>Keep history</Button>
    <Show when={open()}><Stack gap="row">
      <Show when={created()} fallback={<>
        <Input label="Dataset name" assist={false} value={name()} onInput={setName} />
        <Select label="What to keep" value={mode()} options={modes.map(item => ({ value: item.value, label: item.label }))} onChange={value => setMode(value as DatasetMode)} />
        <Text emphasis="muted" wrap>{modes.find(item => item.value === mode())?.answer}</Text>
        <Show when={mode() === 'event-archive'}><Select label="Event time field" value={eventTime()}
          options={[{ value: '', label: 'Choose event time…' }, ...dates().map(field => ({ value: field.pointer, label: field.label }))]}
          onChange={setEventTime} /></Show>
        <Select label="Capture cadence" value={cadence()} options={[{ value: 'daily', label: 'Every day at 09:00' }, { value: 'hourly', label: 'Every hour' }]} onChange={setCadence} />
        <Button size="sm" disabled={busy() || !name().trim() || mode() === 'event-archive' && !eventTime()} onPress={() => void create()}>Create dataset</Button>
      </>}>
        <Text>Dataset created. It is available in Pick data, and its captures are listed in Settings → Schedules.</Text>
      </Show>
      <Show when={error()}>{message => <Alert tone="danger">{message()}</Alert>}</Show>
    </Stack></Show>
  </Stack>
}
