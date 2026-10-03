import { createMemo, createSignal, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { deriveDrilldownPlan, displayPlanGroups, displayPlanRun, type DisplayPlanGroup, type DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import type { DataRecordAction } from '@acorn/protocol/dataActions.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PlanRecordItem } from '@acorn/dashboards-core/plan.ts'
import { runChromeAction } from '../../host/chrome/actions'
import { availableContentPresentations, openInAppUrl, openNamedContentTarget } from '../../host/registries/panes/contentLinks'
import { taskById } from '../tasks/taskLookup'
import { allProjects } from '../projects/projectLookup'
import { descriptorPromotion } from '../../host/chrome/promotion'
import { writeJson } from '../../infra/node/apiClient'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { activeCacheId } from '../../infra/node/activeNode'
import { Alert, Button, Card, EmptyState, Select } from '../../kit/components/primitives'
import { Heading } from '../../kit/components/content/Heading'
import Icon from '../../kit/components/content/Icon'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import { placePanelAt, savePanel, type PlacementScope } from './persist'
import { sizePresets } from './layout'
import type { PanelDefinition } from './model'
import PanelBody from './views/PanelBody'

const RISK_CONFIRM: Record<string, { says: string; verb: string }> = {
  write: { says: 'change something', verb: 'Make this change?' },
  execute: { says: 'run something', verb: 'Run this action?' },
}
const opensRecord = (action: DataRecordAction | undefined): action is DataRecordAction => !!action &&
  ['openPane', 'openTask', 'openUrl', 'openOverlay', 'navigate'].includes(action.verb)

export default function PublishedDashboardPanel(props: {
  definition: PanelDefinition
  workspaceId?: string
  placement: PlacementScope
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
  const [pending, setPending] = createSignal<{ row: DashboardDisplayRow; action: DataRecordAction; actionId?: string }>()
  const [taskRow, setTaskRow] = createSignal<DashboardDisplayRow>()
  const [taskProject, setTaskProject] = createSignal('')
  const [outcome, setOutcome] = createSignal('')
  const [drill, setDrill] = createSignal<{ plan: PanelPlan; snapshot: DashboardRun; result?: DashboardRun; loading: boolean; error?: string }>()
  const rowTitle = (row: DashboardDisplayRow): string => {
    const titleColumn = run()?.plan.columns.find(column => column.id === 'title')
    const value = row.values[titleColumn?.id ?? 'title']
    return typeof value === 'string' && value ? value : row.id
  }
  const press = (): NonNullable<PanelPlan['actions']>['press'] => run()?.plan.actions?.press
  const canActivate = (row: DashboardDisplayRow): boolean => {
    const reference = press()
    if (!reference) return !!row.action
    if (reference.kind === 'task') return !!row.taskId && !!taskById(row.taskId)
    if (reference.kind === 'link') return typeof row.values[reference.column ?? ''] === 'string'
      && /^https?:\/\//.test(row.values[reference.column ?? ''] as string)
    const item = reference.source ? row.recordItems?.find(candidate => candidate.ref.sourceId === reference.source) : row.recordItems?.[0]
    return opensRecord(item?.action) || !!item?.target && availableContentPresentations({ kind: item.target.kind, item: item.target.item, taskId: item.taskId }).length > 0
  }
  const openReference = (row: DashboardDisplayRow, reference: NonNullable<PanelPlan['actions']>['press']): void => {
    if (!reference) return
    const selected = reference.source ? row.recordItems?.find(item => item.ref.sourceId === reference.source) : row.recordItems?.[0]
    if (reference.kind === 'task') {
      if (row.taskId) void runChromeAction({ verb: 'openTask' }, { pluginId: row.pluginId, nodeId, taskId: row.taskId, navigate })
      else setOutcome('This row has no task.')
      return
    }
    if (reference.kind === 'link') {
      const value = row.values[reference.column ?? '']
      if (typeof value !== 'string' || !/^https?:\/\//.test(value)) { setOutcome('This row has no usable link.'); return }
      if (reference.prefer === 'external' || !openInAppUrl(value, { taskId: row.taskId, prefer: reference.prefer, navigate })) window.open(value, '_blank', 'noopener,noreferrer')
      return
    }
    if (!selected) { setOutcome('This row has no source record.'); return }
    if (reference.prefer === 'external' && selected.action?.verb === 'openUrl') { dispatch(row, selected.action, undefined, 'external'); return }
    if (selected.target) {
      const opened = openNamedContentTarget(selected.target.kind, selected.target.item, { taskId: selected.taskId, prefer: reference.prefer === 'external' ? undefined : reference.prefer, navigate })
      if (opened !== 'external') return
    }
    if (opensRecord(selected.action)) dispatch(row, selected.action, undefined, reference.prefer)
    else setOutcome('This source has no destination for the record.')
  }
  const dispatch = (row: DashboardDisplayRow, action: DataRecordAction, actionId?: string, prefer: 'route' | 'refPanel' | 'pane' | 'overlay' | 'external' = 'route'): void => {
    if (action.verb === 'createTask') { setTaskRow(row); setTaskProject(taskById(row.taskId ?? '')?.projectId ?? row.records?.[0]?.scope?.projectId ?? ''); return }
    if (actionId) {
      const ref = row.records?.[0]
      if (!ref) { setOutcome('This row has no source record.'); return }
      void writeJson<{ outcome: 'done' | 'ready' | 'no-longer-available'; action?: DataRecordAction }>('/v1/core/data-sources/act', { method: 'POST', nodeId, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ ref, actionId, confirmedRisk: action.risk ?? 'read' }) }).then(result => {
          if (result.outcome === 'ready' && result.action) dispatch(row, result.action)
          else setOutcome(result.outcome === 'done' ? 'Action completed.' : 'This action no longer applies.')
        }).catch(() => setOutcome('The action failed.'))
      return
    }
    if (action.verb === 'openUrl' && prefer === 'external') { window.open(action.url, '_blank', 'noopener,noreferrer'); return }
    void runChromeAction(action, { pluginId: row.pluginId, nodeId, navigate, prefer: prefer === 'external' || prefer === 'overlay' ? 'route' : prefer,
      ...(row.taskId ? { taskId: row.taskId } : {}), projectId: taskById(row.taskId ?? '')?.projectId ?? row.records?.[0]?.scope?.projectId,
      item: { id: row.sourceRowId ?? row.id, title: rowTitle(row) } })
  }
  const activateAction = (row: DashboardDisplayRow, action: DataRecordAction, actionId?: string, risk = action.risk): void => {
    const checked = { ...action, risk: risk ?? 'read' }
    if (risk && risk !== 'read') setPending({ row, action: checked, actionId })
    else dispatch(row, checked, actionId)
  }
  const activate = (row: DashboardDisplayRow): void => {
    if (press()) { openReference(row, press()); return }
    if (row.action) activateAction(row, row.action)
  }
  const activateButton = (row: DashboardDisplayRow, button: NonNullable<PanelPlan['actions']>['buttons'][number]): void => {
    if (button.kind === 'open') openReference(row, button.reference)
    else if (button.kind === 'createTask') dispatch(row, { verb: 'createTask' })
    else {
      const named = row.actions?.find(action => action.id === button.actionId)
      if (named) activateAction(row, named.action, named.id, named.risk)
      else setOutcome('This action no longer applies.')
    }
  }
  const openRecordItem = (row: DashboardDisplayRow, item: PlanRecordItem): void => {
    if (item.target && openNamedContentTarget(item.target.kind, item.target.item, { taskId: item.taskId, prefer: 'refPanel', navigate }) !== 'external') return
    if (opensRecord(item.action)) dispatch(row, item.action, undefined, 'refPanel')
    else setOutcome('This record has no destination.')
  }
  const openDrilldown = (group: DisplayPlanGroup): void => {
    const current = run()
    if (!current) return
    const ids = new Set(group.rows.map(row => row.id))
    const sourceRows = current.rows.filter(row => ids.has(row.id))
    const plan = deriveDrilldownPlan(current.plan, sourceRows)
    const snapshot = { ...current, plan, rows: sourceRows, groups: [] }
    setDrill({ plan, snapshot, loading: true })
    void client.run({ kind: 'draft', content: plan }, 'execution', zone, undefined, current.diagnostics.evaluationTime)
      .then(result => setDrill({ plan, snapshot, result, loading: false }))
      .catch(() => setDrill({ plan, snapshot, loading: false, error: 'Could not prepare this as a panel.' }))
  }
  const addDrilldownPanel = async (): Promise<void> => {
    const value = drill()
    if (!value?.result || value.result.diagnostics.problems.some(problem => problem.severity === 'error')) return
    try {
      const saved = await client.create(value.plan)
      await client.publish(saved.id, saved.draftRevision)
      savePanel({ id: saved.id, title: value.plan.title, shaping: {}, view: value.plan.view,
        publication: { dashboardId: saved.id, sources: props.definition.publication?.sources, fieldRoles: props.definition.publication?.fieldRoles } })
      placePanelAt(props.placement, saved.id, sizePresets(value.plan.view.kind).m)
      setDrill(undefined)
      setOutcome('Panel added.')
    } catch { setOutcome('Could not add the panel.') }
  }
  const startTaskFromRow = async (row: DashboardDisplayRow): Promise<void> => {
    const item = { id: row.sourceRowId ?? row.id, title: rowTitle(row) }
    const promotion = descriptorPromotion(row.pluginId)
    const context = { projectId: taskProject(), owner: '', repo: '' }
    try {
      const seed = await promotion.prepare(item, context)
      const task = await promotion.create(seed)
      await promotion.afterCreate?.(task, item, context)
      setTaskRow(undefined)
      setOutcome('Task created.')
    } catch { setOutcome('Could not create the task.') }
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
        <Show when={outcome()}>{message => <Alert tone="muted">{message()}</Alert>}</Show>
        <Show when={taskRow()}>{row => <Alert tone="muted" actions={<>
          <Select label="Project" size="sm" value={taskProject()} options={allProjects().map(project => ({ value: project.id, label: project.name }))} onChange={setTaskProject} />
          <Button size="sm" variant="ghost" onPress={() => setTaskRow(undefined)}>Cancel</Button>
          <Button size="sm" disabled={!taskProject()} onPress={() => void startTaskFromRow(row())}>Create task</Button>
        </>}>Start a task from this row</Alert>}</Show>
        <Show when={pending()}>{item => <Alert tone="warn" actions={<>
          <Button size="sm" variant="ghost" onPress={() => setPending(undefined)}>Cancel</Button>
          <Button size="sm" variant="solid" tone="danger" onPress={() => { setPending(undefined); dispatch(item().row, item().action, item().actionId) }}>{RISK_CONFIRM[item().action.risk ?? '']?.verb ?? 'Continue?'}</Button>
        </>}>{`This asks ${pluginLabel(item().row.pluginId)} to ${RISK_CONFIRM[item().action.risk ?? '']?.says ?? 'act'}.`}</Alert>}</Show>
        <Show when={display()} fallback={<EmptyState align="start" size="sm" busy={loaded.isPending}>Loading…</EmptyState>}>
          {value => <PanelBody view={run()!.plan.view} panelId={props.definition.id} schema={value().schema} fields={value().fields} rows={value().rows}
            groups={displayPlanGroups(run()!.groups, value().rows)}
            {...(run()!.plan.group?.[0] ? { groupBy: run()!.plan.group![0]!.column } : {})}
            provenance={run()!.plan.sources.length > 1} onActivate={activate} canActivate={canActivate} pressConfigured={!!press()} onButton={activateButton} onOpenRecord={openRecordItem} onDrilldown={openDrilldown} buttons={run()!.plan.actions?.buttons ?? []} />}
        </Show>
      </Show>
    </div>
    <Show when={drill()}>{value => <Portal><div class="dash-drill-backdrop" onClick={() => setDrill(undefined)} /><aside class="dash-drill-panel" role="dialog" aria-modal="true" aria-label="Rows behind this result">
      <div class="dash-panel-head"><Heading level={3}>{value().plan.title}</Heading><Button size="sm" variant="ghost" onPress={() => setDrill(undefined)}>Close</Button></div>
      <Show when={value().loading}><Alert tone="muted">Preparing the panel at the original evaluation instant…</Alert></Show>
      <Show when={value().error}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
      <PanelBody view={value().plan.view} schema={displayPlanRun(value().plan, value().snapshot.rows).schema} fields={displayPlanRun(value().plan, value().snapshot.rows).fields} rows={displayPlanRun(value().plan, value().snapshot.rows).rows} />
      <Button size="sm" disabled={!value().result || value().result!.diagnostics.problems.some(problem => problem.severity === 'error')} onPress={() => void addDrilldownPanel()}>Add as panel</Button>
    </aside></Portal>}</Show>
  </Card>
}
