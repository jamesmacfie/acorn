import { createMemo, createSignal, Show, type JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { displayPlanGroups, displayPlanRun } from '@acorn/dashboards-core/plan.ts'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import { runChromeAction } from '../../host/chrome/actions'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { activeCacheId } from '../../infra/node/activeNode'
import { Alert, Button, Card, EmptyState } from '../../kit/components/primitives'
import { Heading } from '../../kit/components/content/Heading'
import Icon from '../../kit/components/content/Icon'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import type { PanelDefinition } from './model'
import PanelBody from './views/PanelBody'

const RISK_CONFIRM: Record<string, { says: string; verb: string }> = {
  write: { says: 'change something', verb: 'Make this change?' },
  execute: { says: 'run something', verb: 'Run this action?' },
}

export default function PublishedDashboardPanel(props: {
  definition: PanelDefinition
  workspaceId?: string
  actions?: JSX.Element
  headProps?: JSX.HTMLAttributes<HTMLDivElement>
  onEdit?: () => void
}) {
  const nodeId = activeCacheId()
  const scope = () => ({ workspaceId: props.workspaceId ?? '' })
  const client = dashboardClient(nodeId, scope())
  const published = createQuery(() => ({
    queryKey: ['dashboard-revision', nodeId, scope().workspaceId, props.definition.publication!.dashboardId],
    queryFn: ({ signal }: { signal: AbortSignal }) => client.published(props.definition.publication!.dashboardId, undefined, signal),
    staleTime: 30_000,
  }))
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const loaded = createQuery(() => ({
    queryKey: publishedDashboardPanelKey(nodeId, scope(), props.definition.publication!.dashboardId, published.data?.revision, zone),
    queryFn: ({ signal }: { signal: AbortSignal }) => client.run({ kind: 'published', id: props.definition.publication!.dashboardId, revision: published.data!.revision }, 'execution', zone, signal),
    enabled: !!published.data,
    staleTime: 30_000,
    refetchInterval: (published.data?.content.refresh ?? 0) * 1000 || false,
  }))
  const run = createMemo(() => loaded.data ? JSON.parse(JSON.stringify(loaded.data)) as NonNullable<typeof loaded.data> : undefined)
  const display = createMemo(() => run() ? displayPlanRun(run()!.plan, run()!.rows) : undefined)
  const navigate = useNavigate()
  const [pending, setPending] = createSignal<DashboardDisplayRow>()
  const dispatch = (row: DashboardDisplayRow): void => {
    if (!row.action) return
    void runChromeAction(row.action, {
      pluginId: row.pluginId, nodeId, navigate, prefer: 'route',
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
      <Heading level={3}>{published.data?.content.title ?? props.definition.title}</Heading>
      <Button size="xs" variant="ghost" iconOnly busy={loaded.isFetching} label={`Refresh ${props.definition.title}`} onPress={() => void loaded.refetch()}><Icon name="refresh-cw" /></Button>
      {props.actions}
    </div>
    <div class="dash-panel-body">
      <Show when={!loaded.error || loaded.data} fallback={<EmptyState align="start" size="sm" title="Couldn't load this panel" action={<Button size="sm" onPress={() => void loaded.refetch()}>Try again</Button>}>Edit the panel to repair its source or column.</EmptyState>}>
        <Show when={loaded.error && loaded.data}><Alert tone="warn">Couldn't refresh. Showing the last data we got.</Alert></Show>
        <Show when={run()?.diagnostics.problems.length}><Alert tone="warn">{run()!.diagnostics.problems.map(problem => `${problem.path}: ${problem.message}`).join(' ')}</Alert></Show>
        <Show when={pending()}>{row => <Alert tone="warn" actions={<>
          <Button size="sm" variant="ghost" onPress={() => setPending(undefined)}>Cancel</Button>
          <Button size="sm" variant="solid" tone="danger" onPress={() => { setPending(undefined); dispatch(row()) }}>{RISK_CONFIRM[row().action?.risk ?? '']?.verb ?? 'Continue?'}</Button>
        </>}>{`This asks ${pluginLabel(row().pluginId)} to ${RISK_CONFIRM[row().action?.risk ?? '']?.says ?? 'act'}.`}</Alert>}</Show>
        <Show when={display()} fallback={<EmptyState align="start" size="sm" busy={loaded.isPending}>Loading…</EmptyState>}>
          {value => <PanelBody view={run()!.plan.view} panelId={props.definition.id} schema={value().schema} fields={value().fields} rows={value().rows}
            groups={displayPlanGroups(run()!.groups, value().rows)}
            {...(run()!.plan.group?.[0] ? { groupBy: run()!.plan.group![0]!.column } : {})}
            provenance={run()!.plan.sources.length > 1} onActivate={activate} />}
        </Show>
      </Show>
    </div>
  </Card>
}
