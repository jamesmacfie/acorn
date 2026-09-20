import { createMemo, Show, type JSX } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { type DataSourceDescription, type DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { DashboardRevision } from '@acorn/protocol/dashboards.ts'
import { projectDashboardPanel, type DashboardQueryProjection } from '@acorn/dashboards-core/typedProjection.ts'
import { activeCacheId } from '../../infra/node/activeNode'
import { writeJson } from '../../infra/node/apiClient'
import { Alert, Button, Card, EmptyState } from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import { queriesClient } from '../queries/queriesClient'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import type { PanelDefinition } from './model'
import PanelBody from './views/PanelBody'

type PublishedPanelData = { published: DashboardRevision; results: DashboardQueryProjection[] }

// TanStack's Solid adapter exposes cached objects through reactive accessors. Projection accepts only
// protocol data: remove the adapter's bookkeeping at this boundary, as the shared query editor does.
const plainPanelData = (data: PublishedPanelData): PublishedPanelData => JSON.parse(JSON.stringify(data)) as PublishedPanelData

export default function PublishedDashboardPanel(props: {
  definition: PanelDefinition
  workspaceId?: string
  actions?: JSX.Element
  headProps?: JSX.HTMLAttributes<HTMLDivElement>
}) {
  const nodeId = activeCacheId()
  const scope = () => ({ workspaceId: props.workspaceId ?? '' })
  const loaded = createQuery(() => ({
    queryKey: publishedDashboardPanelKey(nodeId, scope(), props.definition.publication!.dashboardId),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const published = await dashboardClient(nodeId, scope()).published(props.definition.publication!.dashboardId, undefined, signal)
      const results: DashboardQueryProjection[] = []
      for (const entry of published.content.queries) {
        const resolved = await queriesClient(nodeId, scope()).resolve(entry.reference, {}, signal)
        const description = await writeJson<DataSourceDescription>('/v2/core/data-sources/describe', {
          method: 'POST', nodeId, signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation: 'describe', source: resolved.query.source, scope: resolved.query.scope }),
        })
        const result = await writeJson<DataSourceResult>('/v2/core/data-sources/query', {
          method: 'POST', nodeId, signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation: 'query', query: resolved.query, mode: 'execution', evaluationTime: Date.now(), pageSize: DATA_LIMITS.options }),
        })
        results.push({ instanceId: entry.id, label: entry.label, query: resolved.query, description, result })
      }
      return { published, results }
    },
    staleTime: 30_000,
  }))
  const plainLoaded = createMemo(() => loaded.data ? plainPanelData(loaded.data) : undefined)
  const projection = createMemo(() => {
    const data = plainLoaded()
    return data ? projectDashboardPanel(data.published.content, data.results) : undefined
  })
  const incomplete = createMemo(() => plainLoaded()?.results.flatMap(source => source.result.completeness.kind === 'incomplete'
    ? [source.result.completeness.cause.replaceAll('-', ' ')] : []) ?? [])

  return <Card pad="sm">
    <div class="dash-panel-head" {...props.headProps}>
      <span class="dash-panel-title">{loaded.data?.published.content.title ?? props.definition.title}</span>
      <Button size="xs" variant="ghost" iconOnly busy={loaded.isFetching} label={`Refresh ${props.definition.title}`} onPress={() => void loaded.refetch()}>
        <Icon name="refresh-cw" />
      </Button>
      {props.actions}
    </div>
    <div class="dash-panel-body">
      <Show when={!loaded.error || loaded.data} fallback={<Alert tone="warn" title="Panel unavailable">Reconnect the source or edit this panel to repair its query and field mappings.</Alert>}>
        <Show when={loaded.error && loaded.data}><Alert tone="warn">Refresh failed. Showing the last cached data.</Alert></Show>
        <Show when={incomplete().length}><Alert tone="warn">{`Some sources returned partial data: ${[...new Set(incomplete())].join(', ')}.`}</Alert></Show>
        <Show when={projection()} fallback={<EmptyState align="start" size="sm" busy={loaded.isPending}>Loading published panel…</EmptyState>}>
          {value => <PanelBody
            view={value().definition.view}
            schema={value().schema}
            fields={value().fields}
            rows={value().rows}
            {...(value().definition.shaping.groupBy ? { groupBy: value().definition.shaping.groupBy } : {})}
            provenance={value().sources.length > 1}
            onActivate={() => {}}
          />}
        </Show>
      </Show>
    </div>
  </Card>
}
