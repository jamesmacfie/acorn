import { createMemo, createSignal, Show, type JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { type DataSourceDescription, type DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { DashboardRevision } from '@acorn/protocol/dashboards.ts'
import { projectDashboardPanel, type DashboardQueryProjection } from '@acorn/dashboards-core/projection'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import { runChromeAction } from '../../host/chrome/actions'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { activeCacheId } from '../../infra/node/activeNode'
import { writeJson } from '../../infra/node/apiClient'
import { Alert, Button, Card, EmptyState } from '../../kit/components/primitives'
import { Heading } from '../../kit/components/content/Heading'
import Icon from '../../kit/components/content/Icon'
import { dataSourceCatalogOptions } from '../dataSources/queries'
import { queriesClient } from '../queries/queriesClient'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import type { PanelDefinition } from './model'
import PanelBody from './views/PanelBody'

type PublishedPanelData = { published: DashboardRevision; results: DashboardQueryProjection[] }

// TanStack's Solid adapter exposes cached objects through reactive accessors. Projection accepts only
// protocol data: remove the adapter's bookkeeping at this boundary, as the shared query editor does.
const plainPanelData = (data: PublishedPanelData): PublishedPanelData => JSON.parse(JSON.stringify(data)) as PublishedPanelData

/** What the host asks before a row action that is not a read. The plugin declares a tier, never the
 *  sentence: a plugin that wrote the prompt could write a reassuring one over a destructive call. */
const RISK_CONFIRM: Record<string, { says: string; verb: string }> = {
  write: { says: 'change something', verb: 'Make this change?' },
  execute: { says: 'run something', verb: 'Run this action?' },
}

export default function PublishedDashboardPanel(props: {
  definition: PanelDefinition
  workspaceId?: string
  actions?: JSX.Element
  headProps?: JSX.HTMLAttributes<HTMLDivElement>
  /** Opens the panel editor, offered when the panel cannot load. */
  onEdit?: () => void
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
        const description = await writeJson<DataSourceDescription>('/v1/core/data-sources/describe', {
          method: 'POST', nodeId, signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation: 'describe', source: resolved.query.source, scope: resolved.query.scope }),
        })
        const result = await writeJson<DataSourceResult>('/v1/core/data-sources/query', {
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
  const incomplete = createMemo(() => plainLoaded()?.results.some(source => source.result.completeness.kind === 'incomplete') ?? false)
  // The stat's "2 tasks". A panel over one kind of source says its plural; a mixed one says items.
  const catalog = createQuery(() => dataSourceCatalogOptions(nodeId, { ...scope(), parameters: {} }))
  const plural = createMemo(() => {
    const keys = new Set(plainLoaded()?.results.map(entry => `${entry.query.source.pluginId}:${entry.query.source.sourceId}`))
    const [only] = keys.size === 1 ? [...keys] : []
    return catalog.data?.sources.find(entry => `${entry.pluginId}:${entry.sourceId}` === only)?.plural.toLowerCase()
  })

  // A row's own declared verb, through the host's dispatcher: the same closed set a rail row runs.
  // `prefer: 'route'` because a dashboard row is a jumping-off point. The item id is what the target
  // pane selects on (git show 6734ce55^:packages/client-core/src/features/dashboards/Panel.tsx).
  const navigate = useNavigate()
  const [pending, setPending] = createSignal<DashboardDisplayRow>()
  const dispatch = (row: DashboardDisplayRow): void => {
    if (!row.action) return
    void runChromeAction(row.action, {
      pluginId: row.pluginId,
      nodeId,
      navigate,
      prefer: 'route',
      ...(row.taskId ? { taskId: row.taskId } : {}),
      item: { id: row.sourceRowId ?? row.id, title: row.id },
    })
  }
  const activate = (row: DashboardDisplayRow): void => {
    if (row.action?.risk && row.action.risk !== 'read') setPending(row)
    else dispatch(row)
  }

  return <Card>
    <div class="dash-panel-head" {...props.headProps}>
      <Heading level={3}>{loaded.data?.published.content.title ?? props.definition.title}</Heading>
      <Button size="xs" variant="ghost" iconOnly busy={loaded.isFetching} label={`Refresh ${props.definition.title}`} onPress={() => void loaded.refetch()}>
        <Icon name="refresh-cw" />
      </Button>
      {props.actions}
    </div>
    <div class="dash-panel-body">
      <Show when={!loaded.error || loaded.data} fallback={(
        <EmptyState align="start" size="sm" title="Couldn't load this panel" action={(
          <>
            <Button size="sm" onPress={() => void loaded.refetch()}>Try again</Button>
            <Show when={props.onEdit}><Button size="sm" variant="ghost" onPress={() => props.onEdit?.()}>Edit panel</Button></Show>
          </>
        )}>
          Its source may be disconnected, or a field it uses changed.
        </EmptyState>
      )}>
        <Show when={loaded.error && loaded.data}><Alert tone="warn">Couldn't refresh. Showing the last data we got.</Alert></Show>
        <Show when={incomplete()}><Alert tone="warn">Only part of the data loaded. Narrow the query to see all of it.</Alert></Show>
        {/* A strip rather than a modal, because the row it is about stays on screen behind it. Nothing
            runs until Continue. */}
        <Show when={pending()}>
          {(row) => (
            <Alert tone="warn" actions={(
              <>
                <Button size="sm" variant="ghost" onPress={() => setPending(undefined)}>Cancel</Button>
                <Button size="sm" variant="solid" tone="danger" onPress={() => { setPending(undefined); dispatch(row()) }}>
                  {RISK_CONFIRM[row().action?.risk ?? '']?.verb ?? 'Continue?'}
                </Button>
              </>
            )}>
              {`This asks ${pluginLabel(row().pluginId)} to ${RISK_CONFIRM[row().action?.risk ?? '']?.says ?? 'act'}.`}
            </Alert>
          )}
        </Show>
        <Show when={projection()} fallback={<EmptyState align="start" size="sm" busy={loaded.isPending}>Loading…</EmptyState>}>
          {value => <PanelBody
            view={value().definition.view}
            panelId={props.definition.id}
            schema={value().schema}
            fields={value().fields}
            rows={value().rows}
            {...(value().definition.shaping.groupBy ? { groupBy: value().definition.shaping.groupBy } : {})}
            {...(plural() ? { plural: plural() } : {})}
            provenance={value().sources.length > 1}
            onActivate={activate}
          />}
        </Show>
      </Show>
    </div>
  </Card>
}
