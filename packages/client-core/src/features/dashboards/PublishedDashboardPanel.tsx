import { createEffect, createMemo, createSignal, For, Show, type Accessor, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { deriveDrilldownPlan, displayPlanGroups, displayPlanRun, type DisplayPlanGroup, type DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import type { DataRecordAction } from '@acorn/protocol/dataActions.ts'
import type { DashboardRevision, PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PlanRecordItem } from '@acorn/dashboards-core/plan.ts'
import { planPartLabel } from '@acorn/dashboards-core/labels.ts'
import { integrationsOptions } from '../../infra/queries'
import { dataSourceCatalogOptions } from '../dataSources/queries'
import { failureContext } from './planInputs'
import SourceFailureAlert from './SourceFailureAlert'
import { runChromeAction } from '../../host/chrome/actions'
import { availableContentPresentations, openInAppUrl, openNamedContentTarget } from '../../host/registries/panes/contentLinks'
import { taskById } from '../tasks/taskLookup'
import { allProjects } from '../projects/projectLookup'
import { descriptorPromotion } from '../../host/chrome/promotion'
import { writeJson } from '../../infra/node/apiClient'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { activeCacheId } from '../../infra/node/activeNode'
import { Alert, Button, Card, EmptyState, Select, Textarea } from '../../kit/components/primitives'
import { Heading } from '../../kit/components/content/Heading'
import Icon from '../../kit/components/content/Icon'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import { dashboardRecoveryStore } from './dashboardRecovery'
import { TitleField } from './fields'
import { publishNewPanel } from './panelPublish'
import { toast } from '../notifications/toast'
import { placePanelAt, savePanel, type PlacementScope } from './persist'
import { sizePresets } from './layout'
import type { PanelDefinition } from './model'
import PanelBody from './views/PanelBody'
import { boardMove, type BoardMove } from './boardMoves'
import { createBoardWrite } from './boardWrite'
import { groupField } from './shaping'

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
  /** The header's actions, given the live published revision so a menu can offer edits to it. */
  actions?: (published: Accessor<DashboardRevision | undefined>) => JSX.Element
  headProps?: JSX.HTMLAttributes<HTMLDivElement>
  /** Present while the title is being renamed in place. */
  rename?: { onDone: (title: string | undefined) => void }
  /** Opens the studio on a panel, such as one just added from a drill-down. */
  onEditPanel?: (dashboardId: string) => void
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
  const fresh = createMemo(() => loaded.data ? JSON.parse(JSON.stringify(loaded.data)) as NonNullable<typeof loaded.data> : undefined)
  // A source that can't answer now, such as a derived source whose plugin is off, keeps the last data
  // the panel got on screen, greyed out under the reason and its fix (docs/dashboards.md § Published
  // panels), rather than emptying the panel.
  const sourceFailed = (value: DashboardRun) => value.diagnostics.problems.some(problem => problem.severity === 'error' && problem.failure)
  const [lastAnswered, setLastAnswered] = createSignal<DashboardRun>()
  createEffect(() => { const current = fresh(); if (current && !sourceFailed(current)) setLastAnswered(current) })
  const stale = createMemo(() => !!fresh() && sourceFailed(fresh()!) && !!lastAnswered())
  const run = createMemo(() => stale() ? lastAnswered() : fresh())
  const catalog = createQuery(() => ({ ...dataSourceCatalogOptions(nodeId, { ...scope(), parameters: {} }), enabled: !!fresh()?.diagnostics.problems.some(problem => problem.failure) }))
  const integrations = createQuery(() => integrationsOptions(true))
  const [optimisticBoard, setOptimisticBoard] = createSignal<{ rowId: string; move: BoardMove; startedAt: number }>()
  createEffect(() => {
    const pending = optimisticBoard()
    if (pending && loaded.dataUpdatedAt > pending.startedAt) setOptimisticBoard(undefined)
  })
  const display = createMemo(() => {
    const current = run()
    if (!current) return undefined
    const result = displayPlanRun(current.plan, current.rows)
    const moving = optimisticBoard()
    return moving ? { ...result, rows: result.rows.map(row => row.id === moving.rowId
      ? { ...row, values: { ...row.values, [moving.move.columnId]: moving.move.choiceId } } : row) } : result
  })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pending, setPending] = createSignal<{ row: DashboardDisplayRow; action: DataRecordAction; actionId?: string }>()
  const [taskRow, setTaskRow] = createSignal<DashboardDisplayRow>()
  const [taskProject, setTaskProject] = createSignal('')
  const [outcome, setOutcome] = createSignal('')
  const [correcting, setCorrecting] = createSignal<DashboardDisplayRow>()
  const [correction, setCorrection] = createSignal('null')
  const [drill, setDrill] = createSignal<{ plan: PanelPlan; snapshot: DashboardRun; result?: DashboardRun; loading: boolean; error?: string; total?: number; truncated?: boolean }>()
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
  const moveReason = (row: DashboardDisplayRow, choiceId: string): string | undefined => {
    const current = run()
    const group = display() && groupField(display()!.schema, { groupBy: current?.plan.group?.[0]?.column })?.id
    return current && group ? boardMove(current, row, group, choiceId).reason : 'This board has no grouped column.'
  }
  const boardWrite = createBoardWrite({
    resolve: (row, choiceId) => {
      const current = run()
      const group = display() && groupField(display()!.schema, { groupBy: current?.plan.group?.[0]?.column })?.id
      return current && group ? boardMove(current, row, group, choiceId) : { reason: 'This board has no grouped column.' }
    },
    send: async intent => {
      const result = await writeJson<{ outcome: 'done' | 'stale' | 'not-writable' | 'invalid-target' }>('/v1/core/data-sources/act', {
        method: 'POST', nodeId, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key },
        body: JSON.stringify({ ref: intent.move.ref, field: intent.move.field, expected: intent.move.expected,
          target: intent.move.target, confirmedRisk: intent.move.risk }),
      })
      return result.outcome
    },
    refresh: async () => { const result = await loaded.refetch(); if (result.isError) throw new Error('Refresh failed') },
    onOptimistic: setOptimisticBoard, onMessage: setOutcome, key: () => crypto.randomUUID(), now: Date.now,
  })
  const openRecordItem = (row: DashboardDisplayRow, item: PlanRecordItem): void => {
    if (item.target && openNamedContentTarget(item.target.kind, item.target.item, { taskId: item.taskId, prefer: 'refPanel', navigate }) !== 'external') return
    if (opensRecord(item.action)) dispatch(row, item.action, undefined, 'refPanel')
    else setOutcome('This record has no destination.')
  }
  const openDrilldown = (group: DisplayPlanGroup): void => {
    const current = run()
    if (!current) return
    const ids = new Set(group.rows.map(row => row.id))
    const selected = current.rows.filter(row => ids.has(row.id))
    if (selected.length === 1 && selected[0]?.summaryStage !== undefined &&
      (!selected[0].representedRows || selected[0].datasetGroups)) {
      void openStoredDrilldown(current, selected[0])
      return
    }
    const sourceRows = selected.flatMap(row => row.representedRows ?? [row])
    const stageIndex = selected.length && selected.every(row => row.summaryStage === selected[0]?.summaryStage) ? selected[0]?.summaryStage : undefined
    const plan = deriveDrilldownPlan(current.plan, sourceRows, { stageIndex })
    const snapshot = { ...current, plan, rows: sourceRows, groups: [] }
    setDrill({ plan, snapshot, loading: true })
    void client.run({ kind: 'draft', content: plan }, 'execution', zone, undefined, current.diagnostics.evaluationTime)
      .then(result => setDrill({ plan, snapshot, result, loading: false }))
      .catch(() => setDrill({ plan, snapshot, loading: false, error: 'Could not prepare this as a panel.' }))
  }
  const openMeasureDrilldown = (row: DashboardDisplayRow, measure: string): void => {
    const current = run()
    const source = current?.rows.find(item => item.id === row.id)
    if (!current || !source || source.summaryStage === undefined) return
    if (source.datasetGroups?.[measure]) { void openStoredDrilldown(current, source, measure); return }
    if (!source.measureRows?.[measure]) return
    const stage = current.plan.stages[source.summaryStage]
    if (stage?.op !== 'summarize') return
    const rows = source.measureRows[measure]
    const filter = stage.measures.find(item => item.id === measure)?.where
    const keys = Object.fromEntries(stage.by.filter(by => !by.bucket || by.bucket === 'value').map(by => [by.column, source.values[by.column] ?? null]))
    const buckets = stage.by.flatMap(by => by.bucket && by.bucket !== 'value'
      ? [{ column: by.column, bucket: by.bucket, value: source.values[by.column] ?? null }] : [])
    const plan = deriveDrilldownPlan(current.plan, rows, { stageIndex: source.summaryStage, measureFilter: filter,
      summaryKeys: keys, summaryBuckets: buckets, zone })
    const snapshot = { ...current, plan, rows, groups: [] }
    setDrill({ plan, snapshot, loading: true })
    void client.run({ kind: 'draft', content: plan }, 'execution', zone, undefined, current.diagnostics.evaluationTime)
      .then(result => setDrill({ plan, snapshot, result, loading: false }))
      .catch(() => setDrill({ plan, snapshot, loading: false, error: 'Could not prepare this as a panel.' }))
  }
  const openStoredDrilldown = async (current: DashboardRun, source: DashboardRun['rows'][number], measureId?: string): Promise<void> => {
    const stage = current.plan.stages[source.summaryStage ?? -1]
    if (stage?.op !== 'summarize') return
    const mapping = measureId ? source.datasetGroups?.[measureId] : undefined
    const keys = mapping?.groupValues ?? Object.fromEntries(stage.by.map(by => [by.column, source.values[by.column] ?? null]))
    const selectedMeasure = mapping?.measureId ?? measureId
    const filter = stage.measures.find(item => item.id === selectedMeasure)?.where
    const plan = deriveDrilldownPlan(current.plan, [], { stageIndex: source.summaryStage, measureFilter: filter,
      summaryKeys: Object.fromEntries(stage.by.filter(by => !by.bucket || by.bucket === 'value').map(by => [by.column, source.values[by.column] ?? null])),
      summaryBuckets: stage.by.flatMap(by => by.bucket && by.bucket !== 'value'
        ? [{ column: by.column, bucket: by.bucket, value: source.values[by.column] ?? null }] : []), zone })
    setDrill({ plan, snapshot: { ...current, plan, rows: [], groups: [] }, loading: true })
    try {
      const result = await writeJson<{ rows: DashboardRun['rows']; total: number; truncated: boolean }>('/v1/core/datasets/drilldown', {
        method: 'POST', headers: { 'content-type': 'application/json' }, nodeId,
        body: JSON.stringify({ scope: scope(), plan: current.plan, groupValues: keys, measureId: selectedMeasure,
          evaluationTime: current.diagnostics.evaluationTime }),
      })
      const snapshot = { ...current, plan, rows: result.rows, groups: [] }
      setDrill({ plan, snapshot, loading: false, total: result.total, truncated: result.truncated })
      void client.run({ kind: 'draft', content: plan }, 'execution', zone, undefined, current.diagnostics.evaluationTime)
        .then(prepared => setDrill(value => value?.plan === plan ? { ...value, result: prepared } : value))
        .catch(() => {})
    } catch { setDrill(value => value ? { ...value, loading: false, error: 'Could not load the stored rows.' } : value) }
  }
  const addDrilldownPanel = async (): Promise<void> => {
    const value = drill()
    if (!value?.result || value.result.diagnostics.problems.some(problem => problem.severity === 'error')) return
    try {
      const saved = await publishNewPanel({ nodeId, scope: scope(), plan: value.plan, queryClient,
        recovery: dashboardRecoveryStore(typeof localStorage === 'undefined' ? undefined : localStorage) })
      savePanel({ id: saved.id, title: value.plan.title, shaping: {}, view: value.plan.view,
        publication: { dashboardId: saved.id, sources: saved.sources, fieldRoles: saved.fieldRoles } })
      placePanelAt(props.placement, saved.id, sizePresets(value.plan.view.kind).m)
      setDrill(undefined)
      toast('Panel added.', props.onEditPanel ? { action: { label: 'Edit…', onPress: () => props.onEditPanel!(saved.id) } } : {})
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
  const saveCorrection = async (): Promise<void> => {
    const row = correcting()
    if (!row?.correctableDatasetId || !row.sourceRowId) return
    let value: unknown
    try { value = JSON.parse(correction()) }
    catch { setOutcome('Correction must be valid JSON.'); return }
    try {
      await writeJson('/v1/core/datasets/correct', { method: 'POST', nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ datasetId: row.correctableDatasetId, identity: row.sourceRowId, value }) })
      setCorrecting(undefined)
      setOutcome('Correction saved. Future feeder writes will preserve it.')
      void loaded.refetch()
    } catch (error) { setOutcome(error instanceof Error ? error.message : 'Could not save correction.') }
  }

  return <Card>
    <div class="dash-panel-head" {...props.headProps}>
      <Show when={props.rename} fallback={<Heading level={3}>{published.data?.content.title ?? props.definition.title}</Heading>}>
        {rename => <TitleField value={published.data?.content.title ?? props.definition.title} onDone={rename().onDone} />}
      </Show>
      <Button size="xs" variant="ghost" iconOnly busy={loaded.isFetching} label={`Refresh ${props.definition.title}`} onPress={() => void loaded.refetch()}><Icon name="refresh-cw" /></Button>
      {props.actions?.(() => published.data)}
    </div>
    <div class="dash-panel-body">
      <Show when={!loaded.error || loaded.data} fallback={<EmptyState align="start" size="sm" title="Couldn't load this panel" action={<Button size="sm" onPress={() => void loaded.refetch()}>Try again</Button>}>Edit the panel to repair its source or column.</EmptyState>}>
        <Show when={loaded.error && loaded.data}><Alert tone="warn">Couldn't refresh. Showing the last data we got.</Alert></Show>
        <For each={fresh()?.diagnostics.problems ?? []}>{problem => <Show when={problem.failure}
          fallback={<Alert tone="warn">{`${planPartLabel(fresh()!.plan, problem.path)}: ${problem.message}`}</Alert>}>{failure => (
          <SourceFailureAlert failure={failure()} severity={problem.severity}
            context={failureContext({ ...problem, failure: failure() }, fresh()!.plan, catalog.data?.sources ?? [], integrations.data?.integrations ?? [])}
            onRetry={() => void loaded.refetch()}
            {...(props.onEditPanel ? { onChooseAccount: () => props.onEditPanel!(props.definition.publication!.dashboardId) } : {})} />
        )}</Show>}</For>
        <Show when={run()?.diagnostics.asOf}>{time => <span>{`As of ${new Date(time()).toLocaleString()}`}</span>}</Show>
        <Show when={run()?.diagnostics.sources.some(source => source.coverageWindows?.length)}><Alert tone="muted">
          {run()!.diagnostics.sources.flatMap(source => (source.coverageWindows ?? []).slice(0, 3).map(window =>
            `${source.label}: ${window.kind === 'complete' ? 'events covered' : 'coverage gap'} ${new Date(window.fromTime).toLocaleDateString()}–${new Date(window.toTime).toLocaleDateString()}${window.reason ? ` (${window.reason})` : ''}`)).join(' · ')}
        </Alert></Show>
        <Show when={run()?.rows.some(row => row.partial && Object.keys(row.partial).length)}><Alert tone="warn">{[...new Set(run()!.rows.flatMap(row => Object.values(row.partial ?? {})))].join(' ')} Measures marked partial may leave out unknown values.</Alert></Show>
        <Show when={outcome()}>{message => <Alert tone="muted">{message()}</Alert>}</Show>
        <Show when={boardWrite.retry()}>{intent => <Alert tone="warn" actions={<Button size="sm" onPress={() => void boardWrite.send(intent())}>Retry move</Button>}>
          The {intent().move.sourceLabel} change could not be confirmed.
        </Alert>}</Show>
        <Show when={boardWrite.pending()}>{intent => <Alert tone="warn" actions={<>
          <Button size="sm" variant="ghost" onPress={boardWrite.cancel}>Cancel</Button>
          <Button size="sm" variant="solid" tone="danger" onPress={() => void boardWrite.send(intent())}>Confirm move</Button>
        </>}>Change {intent().move.sourceLabel} to {String(intent().move.target)}?</Alert>}</Show>
        <Show when={correcting()}>{row => <Alert tone="muted" actions={<>
          <Button size="sm" variant="ghost" onPress={() => setCorrecting(undefined)}>Cancel</Button>
          <Button size="sm" onPress={() => void saveCorrection()}>Save correction</Button>
        </>}>Correct {rowTitle(row())}. Enter the corrected value as JSON; it remains attached to this record across later writes.
          <Textarea label="Corrected value" rows={3} value={correction()} onChange={setCorrection} />
        </Alert>}</Show>
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
          {value => <div class="dash-panel-data" data-stale={stale() ? '' : undefined} inert={stale()}><PanelBody view={run()!.plan.view} panelId={props.definition.id} schema={value().schema} fields={value().fields} rows={value().rows}
            groups={displayPlanGroups(run()!.groups, value().rows)}
            {...(run()!.plan.group?.[0] ? { groupBy: run()!.plan.group![0]!.column } : {})}
            provenance={run()!.plan.sources.length > 1} onActivate={activate} canActivate={canActivate} pressConfigured={!!press()} onButton={activateButton} onOpenRecord={openRecordItem} onDrilldown={openDrilldown} onMeasureDrilldown={openMeasureDrilldown}
            onCorrect={row => { setCorrecting(row); setCorrection('null') }} buttons={run()!.plan.actions?.buttons ?? []}
            boardChoices={run()!.plan.columns.find(column => column.id === groupField(value().schema, { groupBy: run()!.plan.group?.[0]?.column })?.id)?.choices ?? []}
            boardMoveReason={moveReason} onBoardMove={boardWrite.request} /></div>}
        </Show>
      </Show>
    </div>
    <Show when={drill()}>{value => <Portal><div class="dash-drill-backdrop" onClick={() => setDrill(undefined)} /><aside class="dash-drill-panel" role="dialog" aria-modal="true" aria-label="Rows behind this result">
      <div class="dash-panel-head"><Heading level={3}>{value().plan.title}</Heading><Button size="sm" variant="ghost" onPress={() => setDrill(undefined)}>Close</Button></div>
      <Show when={value().loading}><Alert tone="muted">Preparing the panel at the original evaluation instant…</Alert></Show>
      <Show when={value().error}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
      <Show when={value().truncated}><Alert tone="muted">{`Showing the first ${value().snapshot.rows.length} of ${value().total} rows.`}</Alert></Show>
      <PanelBody view={value().plan.view} schema={displayPlanRun(value().plan, value().snapshot.rows).schema} fields={displayPlanRun(value().plan, value().snapshot.rows).fields} rows={displayPlanRun(value().plan, value().snapshot.rows).rows} />
      <Button size="sm" disabled={!value().result || value().result!.diagnostics.problems.some(problem => problem.severity === 'error')} onPress={() => void addDrilldownPanel()}>Add as panel</Button>
    </aside></Portal>}</Show>
  </Card>
}
