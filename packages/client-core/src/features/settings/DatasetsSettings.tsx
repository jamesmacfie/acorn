import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { DatasetSummary } from '@acorn/protocol/datasets.ts'
import { readJson, writeJson } from '../../infra/node/apiClient'
import { confirmAction } from '../../host/registries/shell/willPhase'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { Stack } from '../../kit/components/layout/Stack'
import { Inline } from '../../kit/components/layout/Inline'
import { Alert, Button, EmptyState, Row } from '../../kit/components/primitives'
import { Text } from '../../kit/components/content/Text'
import { formatBytes } from '../../kit/lib/rendering/formatSize'

const modeLabel: Record<DatasetSummary['mode'], string> = {
  'current-mirror': 'Latest state of each item', 'event-archive': 'Every event', 'snapshot-history': 'State at each capture',
}

export default function DatasetsSettings(props: { nodeId: string | null }) {
  const cache = useQueryClient()
  const [error, setError] = createSignal('')
  const [deleting, setDeleting] = createSignal('')
  const query = createQuery(() => ({
    queryKey: ['datasets', props.nodeId],
    queryFn: () => readJson<{ datasets: DatasetSummary[] }>('/v1/core/datasets', { nodeId: props.nodeId ?? undefined }),
  }))
  const remove = async (dataset: DatasetSummary) => {
    const accepted = await confirmAction({ title: `Delete ${dataset.name}`, actionLabel: 'Delete dataset', danger: true,
      goes: `${dataset.rowCount} stored rows, captures, corrections, and coverage records will be deleted.`,
      stays: 'Other datasets and dashboard measure history remain.' })
    if (!accepted) return
    setDeleting(dataset.id)
    try {
      await writeJson(`/v1/core/datasets/${encodeURIComponent(dataset.id)}?workspaceId=${encodeURIComponent(dataset.workspaceId)}${dataset.projectId ? `&projectId=${encodeURIComponent(dataset.projectId)}` : ''}`,
        { method: 'DELETE', nodeId: props.nodeId ?? undefined })
      await cache.invalidateQueries({ queryKey: ['datasets', props.nodeId] })
      setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setDeleting('') }
  }
  return <SettingsSection id="datasets" label="Datasets">
    <Stack gap="stack">
      <Text emphasis="muted" wrap>Datasets keep provider and workflow data on this node for the listed period. Capture schedules are managed in Schedules.</Text>
      <Show when={error()}>{message => <Alert tone="danger">{message()}</Alert>}</Show>
      <Show when={query.isError}><Alert tone="danger">Could not load datasets.</Alert></Show>
      <Show when={query.isPending}><EmptyState busy align="start" size="sm">Loading datasets…</EmptyState></Show>
      <Show when={query.isSuccess && !query.data?.datasets.length}><EmptyState align="start" size="sm">No datasets are stored on this node.</EmptyState></Show>
      <For each={query.data?.datasets ?? []}>{dataset => <Row variant="stacked"
        trailing={<Button size="sm" disabled={deleting() === dataset.id} onPress={() => void remove(dataset)}>Delete</Button>}>
        <Stack gap="inline">
          <Text>{dataset.name}</Text>
          <Text emphasis="muted" wrap>{`${modeLabel[dataset.mode]} · ${dataset.feeder} · schema v${dataset.currentVersion} · ${dataset.rowCount} rows · ${formatBytes(dataset.bytes)} · ${dataset.retentionDays} days`}</Text>
          <Inline gap="row"><Text emphasis="muted">{`Cap: ${dataset.maxRows} rows / ${formatBytes(dataset.maxBytes)}`}</Text></Inline>
          <Show when={dataset.lastCapture}>{capture => <Text emphasis="muted" wrap>
            {`Last capture: ${capture().complete ? `${capture().rowCount} rows read` : `failed: ${capture().reason ?? 'unknown reason'}`} · ${new Date(capture().finishedAt).toLocaleString()}`}
          </Text>}</Show>
          <For each={dataset.coverage.slice(0, 5)}>{window => <Text emphasis="muted" wrap>
            {`${window.kind === 'gap' ? 'Gap' : 'Complete'} ${new Date(window.fromTime).toLocaleDateString()}–${new Date(window.toTime).toLocaleDateString()}${window.reason ? `: ${window.reason}` : ''}`}
          </Text>}</For>
        </Stack>
      </Row>}</For>
    </Stack>
  </SettingsSection>
}
