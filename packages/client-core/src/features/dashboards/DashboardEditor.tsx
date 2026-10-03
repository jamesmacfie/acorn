import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { panelPlanSchema, type DashboardDraft, type DashboardView, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import { dashboardFields } from '@acorn/dashboards-core/projection'
import { describePanelPlan, displayPlanGroups, displayPlanRun } from '@acorn/dashboards-core/plan.ts'
import { PANEL_CAPABILITIES } from '@acorn/dashboards-core/capabilities.ts'
import type { SourceQueryEditorState } from '../dataSources/SourceQueryEditor'
import SourceQueryEditor from '../dataSources/SourceQueryEditor'
import AuthoringConversation from '../dataSources/AuthoringConversation'
import { mergeAuthoringCandidate } from '../dataSources/authoringMerge'
import type { AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import { activeCacheId } from '../../infra/node/activeNode'
import { ApiError, writeJson } from '../../infra/node/apiClient'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { queriesClient } from '../queries/queriesClient'
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select } from '../../kit/components/primitives'
import { Heading } from '../../kit/components/content/Heading'
import { Fold } from '../../kit/components/layout/Fold'
import { Inline } from '../../kit/components/layout/Inline'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import { Modal } from '../../kit/components/overlays/Modal'
import PanelBody from './views/PanelBody'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import { dashboardRecoveryStore } from './dashboardRecovery'
import { latestUnpublishedDashboard } from './dashboardEditorModel'
import { dashboards, homeTabs, homeTabScope, type PlacementScope } from './persist'
import './dashboards.css'

const AUTOSAVE_MS = 750
const blank = (): PanelPlan => ({
  version: 2, title: 'New panel', time: { zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [], columns: [], stages: [], view: { kind: 'list' },
})
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const safeId = (value: string): string => value.replace(/^\//, '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || crypto.randomUUID()
const firstPredicate = (column: string): DataPredicate => ({
  kind: 'comparison', left: { address: { from: 'item', pointer: `/${column}` } }, operator: 'eq', right: { address: { from: 'literal', value: '' } },
})
type Comparison = Extract<DataPredicate, { kind: 'comparison' }>
const comparison = (predicate: DataPredicate): Comparison | undefined => predicate.kind === 'comparison' ? predicate : undefined
const filterColumn = (predicate: DataPredicate): string => {
  const address = comparison(predicate)?.left.address
  return address?.from === 'item' ? address.pointer.slice(1) : ''
}
const operand = (predicate: DataPredicate): string => {
  const right = comparison(predicate)?.right?.address
  return right?.from === 'literal' ? String(right.value ?? '') : ''
}

export default function DashboardEditor(props: {
  scope: PlacementScope
  dashboardId?: string
  onPublished(id: string, title: string, scope: PlacementScope, view: DashboardView, sources: string[], fieldRoles: string[]): void
  onClose(): void
}) {
  const nodeId = activeCacheId()
  const scope = { workspaceId: props.scope.workspaceId ?? '' }
  const client = dashboardClient(nodeId, scope)
  const queryClient = useQueryClient()
  const recovery = dashboardRecoveryStore(typeof localStorage === 'undefined' ? undefined : localStorage)
  const recoveryId = props.dashboardId ?? `new:${scope.workspaceId}`
  const [plan, setPlan] = createSignal<PanelPlan>(blank())
  const [draft, setDraft] = createSignal<DashboardDraft>()
  const [states, setStates] = createSignal<Record<string, SourceQueryEditorState | undefined>>({})
  const [starters, setStarters] = createSignal<Record<string, PanelPlan[]>>({})
  const [entrance, setEntrance] = createSignal<'pick' | 'describe' | undefined>(props.dashboardId ? 'pick' : undefined)
  const [saveState, setSaveState] = createSignal('Not saved')
  const [problem, setProblem] = createSignal<string>()
  const [aiUndo, setAiUndo] = createSignal<PanelPlan>()
  const [aiSummary, setAiSummary] = createSignal('')
  const [confirmedRequirements, setConfirmedRequirements] = createSignal<string[]>([])
  const [placement, setPlacement] = createSignal(props.scope.ownerId ?? '')
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => saveTimer && clearTimeout(saveTimer))

  const tabs = () => props.scope.surface === 'home' ? homeTabs(dashboards(), props.scope.workspaceId) : []
  const destination = (): PlacementScope => props.scope.surface === 'home' ? homeTabScope(placement(), props.scope.workspaceId) : props.scope
  const recoveryCopy = (content: PanelPlan, current = draft()) => ({
    nodeId, entityId: current?.id ?? recoveryId, baseRevision: current?.draftRevision ?? 0,
    baseContent: current?.content ?? blank(), content, savedAt: Date.now(),
  })
  const persist = (next: PanelPlan): void => {
    setSaveState(recovery.save(recoveryCopy(next)) === 'saved-on-device' ? 'Saved on this computer' : 'Not saved')
    if (saveTimer) clearTimeout(saveTimer)
    if (!panelPlanSchema.safeParse(next).success) return
    saveTimer = setTimeout(() => void flush(next).catch(() => {}), AUTOSAVE_MS)
  }
  const change = (update: (current: PanelPlan) => PanelPlan): void => { setPlan(current => {
    const next = update(current)
    if (next !== current) persist(next)
    return next
  }) }
  async function flush(next = plan()): Promise<DashboardDraft> {
    setSaveState('Saving…')
    try {
      const current = draft()
      const saved = current ? await client.save(current.id, current.draftRevision, next) : await client.create(next)
      setDraft(saved)
      recovery.acknowledge(recoveryCopy(next, current), saved.content)
      if (!current) recovery.discard(nodeId, recoveryId)
      setSaveState('Saved')
      return saved
    } catch {
      setSaveState("Couldn't save")
      setProblem("Couldn't save. Your edits remain on this computer.")
      throw new Error('dashboard-save-failed')
    }
  }
  onMount(async () => {
    try {
      const loaded = props.dashboardId ? await client.get(props.dashboardId) : latestUnpublishedDashboard(await client.list())
      if (loaded) {
        setDraft(loaded)
        const restored = recovery.read(nodeId, loaded.id)?.content
        setPlan(restored && 'version' in restored ? restored : loaded.content)
        setEntrance('pick')
        setSaveState(restored ? 'Saved on this computer' : 'Saved')
        return
      }
    } catch { /* A local draft can begin while the Node reconnects. */ }
    const local = recovery.read(nodeId, recoveryId)?.content
    if (local && 'version' in local) { setPlan(local); setEntrance('pick'); setSaveState('Saved on this computer') }
  })

  const addSource = (): void => change(current => ({ ...current, sources: [...current.sources, {
    id: crypto.randomUUID(), label: `Source ${current.sources.length + 1}`, role: 'primary',
    reference: { kind: 'inline', content: { name: 'Choose data', parameters: { type: 'object' }, query: { source: { pluginId: 'core', sourceId: 'choose' }, scope: { ...scope, parameters: {} }, sort: [] }, sourceParameters: {} }, bindings: {} },
  }] }))
  const setSource = (id: string, reference: QueryReference | undefined): void => change(current => ({
    ...current, sources: reference
      ? current.sources.map(source => source.id === id ? { ...source, reference } : source)
      : current.sources.filter(source => source.id !== id),
    columns: reference ? current.columns : current.columns.map(column => { const { [id]: _removed, ...bind } = column.bind; return { ...column, bind } }),
  }))
  const updateState = (id: string, state: SourceQueryEditorState): void => {
    const priorRevision = states()[id]?.description?.revision
    setStates(current => ({ ...current, [id]: state }))
    if (!state.description || !state.query) return
    if (priorRevision !== state.description.revision) void Promise.all((state.description.starterPlans ?? []).flatMap(candidate => {
      const parsed = panelPlanSchema.safeParse(candidate)
      return parsed.success ? [client.validate(parsed.data).then(result => result.problems.length ? undefined : parsed.data).catch(() => undefined)] : []
    })).then(values => setStarters(current => ({ ...current, [id]: values.filter((value): value is PanelPlan => !!value) })))
    const available = dashboardFields(state.description)
    change(current => {
      const source = current.sources.find(entry => entry.id === id)
      if (!source) return current
      const label = state.source?.name ?? source.label
      const sources = current.sources.map(entry => entry.id === id ? { ...entry, label } : entry)
      if (current.sources.length !== 1 || current.columns.length) return JSON.stringify(sources) === JSON.stringify(current.sources) ? current : { ...current, sources }
      const columns = available.slice(0, 30).map(field => ({ id: safeId(field.id), label: field.name, type: field.type, bind: { [id]: { field: field.id } }, ...(field.unit ? { unit: field.unit } : {}), ...(field.values ? { choices: field.values } : {}) }))
      return { ...current, sources, columns }
    })
  }
  const addColumn = (): void => change(current => ({ ...current, columns: [...current.columns, { id: `column_${crypto.randomUUID().replaceAll('-', '')}`, label: 'New column', type: 'text', bind: {} }] }))
  const bindColumn = (columnId: string, sourceId: string, pointer: string): void => change(current => ({ ...current, columns: current.columns.map(column => {
    if (column.id !== columnId) return column
    const bind = { ...column.bind }
    if (pointer) bind[sourceId] = { field: pointer }
    else delete bind[sourceId]
    return { ...column, bind }
  }) }))
  const suggestedBinding = (column: PanelPlan['columns'][number], sourceId: string): { pointer: string; name: string } | undefined => {
    if (column.bind[sourceId]) return undefined
    const description = states()[sourceId]?.description
    if (!description) return undefined
    const fields = dashboardFields(description)
    const match = fields.find(field => field.type === column.type && field.name.toLowerCase() === column.label.toLowerCase())
      ?? fields.find(field => field.type === column.type && field.role === column.id)
    return match ? { pointer: match.id, name: match.name } : undefined
  }
  const mapChoice = (columnId: string, sourceId: string, valueId: string, choiceId: string): void => change(current => ({
    ...current, columns: current.columns.map(column => {
      if (column.id !== columnId) return column
      const binding = column.bind[sourceId]
      if (!binding || !('field' in binding)) return column
      const values = Object.fromEntries(Object.entries(binding.values ?? {}).map(([id, sourceValues]) => [id, sourceValues.filter(value => value !== valueId)]))
      if (choiceId) values[choiceId] = [...(values[choiceId] ?? []), valueId]
      return { ...column, bind: { ...column.bind, [sourceId]: { ...binding, values } } }
    }),
  }))
  const addFilter = (): void => {
    const column = plan().columns[0]
    if (column) change(current => ({ ...current, stages: [...current.stages, { op: 'filter', where: firstPredicate(column.id) }] }))
  }
  const editFilter = (index: number, changes: { column?: string; operator?: Comparison['operator']; value?: string }): void => change(current => ({
    ...current, stages: current.stages.map((stage, at) => {
      if (at !== index) return stage
      const old = comparison(stage.where)
      const column = changes.column ?? (old?.left.address.from === 'item' ? old.left.address.pointer.slice(1) : current.columns[0]?.id ?? '')
      const operator = changes.operator ?? old?.operator ?? 'eq'
      const raw = changes.value ?? operand(stage.where)
      const type = current.columns.find(entry => entry.id === column)?.type
      const value = operator === 'in' ? raw.split(',').map(item => item.trim()).filter(Boolean)
        : type === 'number' && raw.trim() && Number.isFinite(Number(raw)) ? Number(raw)
          : type === 'boolean' && ['true', 'false'].includes(raw.toLowerCase()) ? raw.toLowerCase() === 'true' : raw
      return { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: `/${column}` } }, operator,
        ...(['missing', 'present'].includes(operator) ? {} : { right: { address: { from: 'literal', value } } }),
      } }
    }),
  }))

  const preview = createQuery(() => ({
    queryKey: ['dashboard-preview', nodeId, scope.workspaceId, JSON.stringify(plan())],
    queryFn: ({ signal }: { signal: AbortSignal }) => client.run({ kind: 'draft', content: copy(plan()) }, 'preview', Intl.DateTimeFormat().resolvedOptions().timeZone, signal),
    enabled: !!entrance() && plan().sources.length > 0 && panelPlanSchema.safeParse(plan()).success,
    staleTime: 0,
  }))
  const run = createMemo(() => preview.data ? copy(preview.data) : undefined)
  const display = createMemo(() => run() ? displayPlanRun(run()!.plan, run()!.rows) : undefined)
  const applyAiProposal = async (proposal: Extract<AuthoringTurnResult, { state: 'proposal' }>): Promise<string | undefined> => {
    const merged = mergeAuthoringCandidate(proposal.base as PanelPlan, proposal.candidate as PanelPlan, plan())
    if (merged.conflicts.length) return 'This panel changed while the proposal was prepared.'
    const parsed = panelPlanSchema.safeParse(merged.value)
    if (!parsed.success) return 'The proposed plan does not fit this panel.'
    try { if ((await client.validate(parsed.data)).problems.length) return 'The proposed plan has source or column problems.' }
    catch { return 'The Node could not validate this proposal.' }
    setAiUndo(copy(plan()))
    setAiSummary(proposal.summary)
    setConfirmedRequirements([])
    change(() => parsed.data)
    setEntrance('pick')
    return undefined
  }
  const publish = async (): Promise<void> => {
    if (plan().requirements?.some(item => !confirmedRequirements().includes(item.id))) {
      setProblem('Confirm each requirement before publishing.'); return
    }
    const parsed = panelPlanSchema.safeParse(plan())
    if (!parsed.success) { setProblem('Choose data and complete the plan before publishing.'); return }
    try {
      const saved = await flush(parsed.data)
      const metadata = await Promise.all(plan().sources.map(async source => {
        const resolved = await queriesClient(nodeId, scope).resolve(source.reference, {})
        const description = await writeJson<DataSourceDescription>('/v1/core/data-sources/describe', {
          method: 'POST', nodeId, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation: 'describe', source: resolved.query.source, scope: resolved.query.scope }),
        })
        return { key: `${resolved.query.source.pluginId}:${resolved.query.source.sourceId}`, roles: description.fields.flatMap(field => field.display?.role ?? []) }
      }))
      const sources = [...new Set(metadata.map(entry => entry.key))]
      const roles = [...new Set(metadata.flatMap(entry => entry.roles))]
      await client.publish(saved.id, saved.draftRevision)
      void queryClient.invalidateQueries({ queryKey: publishedDashboardPanelKey(nodeId, scope, saved.id).slice(0, 5) }).catch(() => {})
      void queryClient.invalidateQueries({ queryKey: ['dashboard-revision', nodeId, scope.workspaceId, saved.id] }).catch(() => {})
      recovery.discard(nodeId, saved.id)
      props.onPublished(saved.id, plan().title, destination(), plan().view, sources, roles)
      props.onClose()
    } catch (error) {
      setProblem(error instanceof ApiError && error.code === 'invalid-dashboard' ? error.message : "Couldn't publish this panel.")
    }
  }

  return <Modal title={props.dashboardId ? 'Edit panel' : 'Add panel'} size="lg" onDismiss={props.onClose}>
    <Modal.Body><div class="dash-v2-editor"><Stack gap="stack">
      <Badge tone={saveState() === "Couldn't save" ? 'warn' : undefined}>{saveState()}</Badge>
      <Show when={problem()}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
      <Show when={!entrance()}><Inline gap="row"><Button variant="solid" onPress={() => { setEntrance('pick'); addSource() }}>Pick data</Button><Button onPress={() => setEntrance('describe')}>Describe it</Button></Inline></Show>
      <Show when={entrance() === 'describe' || plan().sources.length > 0}>
        <AuthoringConversation endpoint="/v1/core/authoring/turn" target="dashboard" targetId={draft()?.id ?? recoveryId}
          scope={scope} baseRevision={draft()?.draftRevision ?? 0} base={plan()} label={plan().title} defaultOpen={entrance() === 'describe'} onApply={applyAiProposal} />
        <Show when={aiUndo()}>{previous => <Button size="sm" variant="bare" onPress={() => { change(() => previous()); setAiUndo(undefined); setAiSummary(''); setConfirmedRequirements([]) }}>Undo AI edit</Button>}</Show>
      </Show>
      <Show when={entrance() === 'pick'}>
        <Fold label="Data" level="group" defaultOpen><Stack gap="stack">
          <For each={plan().sources}>{source => <Fold label={source.label} level="sub" defaultOpen><SourceQueryEditor
            workspaceId={scope.workspaceId} value={source.reference} previewOnOpen={!!props.dashboardId}
            hideAuthoring pickSourceAccount onChange={reference => setSource(source.id, reference)} onStateChange={state => updateState(source.id, state)} />
            <For each={starters()[source.id] ?? []}>{starter => <Button size="sm" variant="ghost" onPress={() => change(() => starter)}>{`Start with ${starter.title} · ${describePanelPlan(starter)[0]}`}</Button>}</For>
            <Button size="sm" variant="ghost" onPress={() => setSource(source.id, undefined)}>Remove source</Button>
          </Fold>}</For>
          <Button size="sm" disabled={plan().sources.length >= 8} onPress={addSource}>Add another source</Button>
        </Stack></Fold>
        <Fold label="Columns" level="group" defaultOpen><Stack gap="row">
          <For each={plan().columns}>{column => <Card><Stack gap="row">
            <Field label="Column name"><Input label="Column name" assist={false} value={column.label} onInput={label => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, label } : entry) }))} /></Field>
            <Select label={`${column.label} type`} size="sm" value={column.type ?? 'text'} options={['text', 'number', 'boolean', 'datetime', 'enum', 'person', 'link'].map(value => ({ value, label: value }))} onChange={type => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, type: type as NonNullable<PanelPlan['columns'][number]['type']> } : entry) }))} />
            <Checkbox label="List of values" checked={!!column.list} onChange={list => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, list } : entry) }))} />
            <Show when={column.type === 'number'}><Input label="Fixed unit (currency, percent, ms, s, bytes)" assist={false} value={typeof column.unit === 'string' ? column.unit : ''} onInput={unit => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, unit: unit || undefined } : entry) }))} />
              <Select label="Or unit from column" size="sm" value={typeof column.unit === 'object' ? column.unit.column : ''} options={[{ value: '', label: 'Fixed unit' }, ...plan().columns.filter(entry => entry.id !== column.id).map(entry => ({ value: entry.id, label: entry.label }))]} onChange={unitColumn => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, unit: unitColumn ? { column: unitColumn } : undefined } : entry) }))} /></Show>
            <Show when={column.type === 'datetime'}><Select label="Date precision" size="sm" value={column.precision ?? 'instant'} options={[{ value: 'instant', label: 'Instant' }, { value: 'day', label: 'Calendar day' }]} onChange={precision => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, precision: precision as 'instant' | 'day' } : entry) }))} /></Show>
            <Show when={column.type === 'enum'}><Select label="New values" size="sm" value={column.unmatched ?? 'catch-all'} options={[{ value: 'catch-all', label: 'Show unmatched' }, { value: 'hidden', label: 'Hide unmatched' }]} onChange={unmatched => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, unmatched: unmatched as 'catch-all' | 'hidden' } : entry) }))} />
              <For each={column.choices ?? []}>{(choice, index) => <Inline gap="inline" wrap>
                <Input label="Choice name" assist={false} value={choice.label} onInput={label => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, choices: entry.choices?.map((value, at) => at === index() ? { ...value, label } : value) } : entry) }))} />
                <Select label="Choice tone" size="sm" value={choice.tone ?? 'muted'} options={['ok', 'warn', 'bad', 'muted', 'accent'].map(value => ({ value, label: value }))} onChange={tone => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, choices: entry.choices?.map((value, at) => at === index() ? { ...value, tone: tone as NonNullable<typeof choice.tone> } : value) } : entry) }))} />
                <Input label="Choice rank" assist={false} value={String(choice.rank ?? '')} onInput={rank => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, choices: entry.choices?.map((value, at) => at === index() ? { ...value, rank: rank ? Number(rank) : undefined } : value) } : entry) }))} />
              </Inline>}</For>
              <Button size="sm" onPress={() => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, choices: [...(entry.choices ?? []), { id: crypto.randomUUID(), label: 'New choice' }] } : entry) }))}>Add choice</Button>
            </Show>
            <For each={plan().sources}>{source => <Field label={`${source.label} binding`}><Select size="sm" label={`${column.label} from ${source.label}`}
              value={'field' in (column.bind[source.id] ?? {}) ? (column.bind[source.id] as { field: string }).field : ''}
              options={[{ value: '', label: 'No binding' }, ...((() => { const binding = column.bind[source.id]; return binding && 'field' in binding && !states()[source.id]?.description?.fields.some(field => field.pointer === binding.field) ? [{ value: binding.field, label: `Missing field ${binding.field} · rebind` }] : [] })()), ...(states()[source.id]?.description?.fields ?? []).map(field => ({ value: field.pointer, label: field.label }))]}
              onChange={pointer => bindColumn(column.id, source.id, pointer)} />
              <Show when={suggestedBinding(column, source.id)}>{suggestion => <Button size="sm" variant="bare" onPress={() => bindColumn(column.id, source.id, suggestion().pointer)}>{`Bind suggested ${suggestion().name}`}</Button>}</Show>
              <Show when={column.type === 'enum' && 'field' in (column.bind[source.id] ?? {})}>
                <For each={(() => {
                  const binding = column.bind[source.id]
                  const field = binding && 'field' in binding ? states()[source.id]?.description?.fields.find(item => item.pointer === binding.field) : undefined
                  return field?.choices?.kind === 'static' ? field.choices.values : []
                })()}>{value => <Select label={`Map ${value.label}`} size="sm"
                  value={(() => { const binding = column.bind[source.id]; return binding && 'field' in binding ? Object.entries(binding.values ?? {}).find(([, ids]) => ids.includes(value.id))?.[0] ?? '' : '' })()}
                  options={[{ value: '', label: 'Unmatched' }, ...(column.choices ?? []).map(choice => ({ value: choice.id, label: choice.label }))]}
                  onChange={choiceId => mapChoice(column.id, source.id, value.id, choiceId)} />}</For>
              </Show>
            </Field>}</For>
            <Button size="sm" variant="bare" onPress={() => change(current => ({ ...current, columns: current.columns.filter(entry => entry.id !== column.id) }))}>Remove column</Button>
          </Stack></Card>}</For>
          <Button size="sm" onPress={addColumn}>Add column</Button>
        </Stack></Fold>
        <Fold label="Stages" level="group" defaultOpen><Stack gap="row">
          <For each={plan().stages}>{(stage, index) => <Fold label={`Keep matching rows · ${index() + 1}`} level="sub"><Stack gap="row">
            <Select label="Column" size="sm" value={filterColumn(stage.where)}
              options={plan().columns.map(column => ({ value: column.id, label: column.label }))} onChange={column => editFilter(index(), { column })} />
            <Select label="Comparison" size="sm" value={comparison(stage.where)?.operator ?? 'eq'}
              options={['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'in', 'missing', 'present'].map(value => ({ value, label: value }))}
              onChange={operator => editFilter(index(), { operator: operator as Comparison['operator'] })} />
            <Show when={!['missing', 'present'].includes(comparison(stage.where)?.operator ?? '')}><Input label="Value" assist={false} value={operand(stage.where)} onInput={value => editFilter(index(), { value })} /></Show>
            <Button size="sm" variant="bare" onPress={() => change(current => ({ ...current, stages: current.stages.filter((_entry, at) => at !== index()) }))}>Remove stage</Button>
          </Stack></Fold>}</For>
          <Button size="sm" disabled={!plan().columns.length || plan().stages.length >= 12} onPress={addFilter}>Add stage · {PANEL_CAPABILITIES.operations[0].label}</Button>
          <Show when={!plan().columns.length}><Text emphasis="muted">Add a column before filtering rows.</Text></Show>
        </Stack></Fold>
        <Fold label="View and timing" level="group" defaultOpen><Stack gap="row">
          <Field label="Panel title"><Input label="Panel title" assist={false} value={plan().title} onInput={title => change(current => ({ ...current, title }))} /></Field>
          <Select label="View" size="sm" value={plan().view.kind} options={Object.keys(PANEL_CAPABILITIES.views).map(kind => ({ value: kind, label: kind }))} onChange={kind => change(current => ({ ...current, view: { ...current.view, kind: kind as PanelPlan['view']['kind'] } }))} />
          <Select label="Aggregate" size="sm" value={plan().view.aggregate ?? 'count'} options={['count', 'sum', 'avg', 'min', 'max'].map(value => ({ value, label: value }))} onChange={aggregate => change(current => ({ ...current, view: { ...current.view, aggregate: aggregate as NonNullable<PanelPlan['view']['aggregate']> } }))} />
          <For each={(['field', 'x', 'series'] as const)}>{key => <Select label={key} size="sm" value={plan().view[key] ?? ''} options={[{ value: '', label: 'None' }, ...plan().columns.map(column => ({ value: column.id, label: column.label }))]} onChange={value => change(current => ({ ...current, view: { ...current.view, [key]: value || undefined } }))} />}</For>
          <Select label="Chart shape" size="sm" value={plan().view.shape ?? 'bar'} options={['bar', 'line'].map(value => ({ value, label: value }))} onChange={shape => change(current => ({ ...current, view: { ...current.view, shape: shape as 'bar' | 'line' } }))} />
          <Select label="Trend" size="sm" value={plan().view.trend ?? ''} options={[{ value: '', label: 'None' }, { value: 'history', label: 'History' }, { value: 'activity', label: 'Activity' }]} onChange={trend => change(current => ({ ...current, view: { ...current.view, trend: trend ? trend as 'history' | 'activity' : undefined } }))} />
          <Select label="Compare" size="sm" value={plan().view.compare ?? ''} options={[{ value: '', label: 'None' }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} onChange={compare => change(current => ({ ...current, view: { ...current.view, compare: compare ? compare as 'day' | 'week' : undefined } }))} />
          <Select label="Good direction" size="sm" value={plan().view.good ?? ''} options={[{ value: '', label: 'Neutral' }, { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]} onChange={good => change(current => ({ ...current, view: { ...current.view, good: good ? good as 'up' | 'down' : undefined } }))} />
          <Select label="Sort column" size="sm" value={plan().sort?.[0]?.column ?? ''} options={[{ value: '', label: 'No sort' }, ...plan().columns.map(column => ({ value: column.id, label: column.label }))]} onChange={column => change(current => ({ ...current, sort: column ? [{ column, direction: current.sort?.[0]?.direction ?? 'asc' }] : [] }))} />
          <Select label="Sort direction" size="sm" value={plan().sort?.[0]?.direction ?? 'asc'} options={[{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]} onChange={direction => change(current => ({ ...current, sort: current.sort?.[0] ? [{ ...current.sort[0], direction: direction as 'asc' | 'desc' }] : [] }))} />
          <Select label="Group column" size="sm" value={plan().group?.[0]?.column ?? ''} options={[{ value: '', label: 'No grouping' }, ...plan().columns.map(column => ({ value: column.id, label: column.label }))]} onChange={column => change(current => ({ ...current, group: column ? [{ column, bucket: 'value' }] : [] }))} />
          <Select label="Group bucket" size="sm" value={plan().group?.[0]?.bucket ?? 'value'} options={PANEL_CAPABILITIES.buckets.map(value => ({ value, label: value }))} onChange={bucket => change(current => ({ ...current, group: current.group?.[0] ? [{ ...current.group[0], bucket: bucket as NonNullable<PanelPlan['group']>[number]['bucket'] }] : [] }))} />
          <Input label="Limit" assist={false} value={String(plan().limit ?? '')} onInput={value => change(current => ({ ...current, limit: value ? Number(value) : undefined }))} />
          <Input label="Refresh seconds" assist={false} value={String(plan().refresh ?? '')} onInput={value => change(current => ({ ...current, refresh: value ? Number(value) : undefined }))} />
          <Input label="Time zone" assist={false} value={plan().time.zone} onInput={zone => change(current => ({ ...current, time: { ...current.time, zone } }))} />
          <Select label="Time mode" size="sm" value={plan().time.mode} options={[{ value: 'fixed', label: 'Fixed' }, { value: 'viewer', label: 'Viewer' }]} onChange={mode => change(current => ({ ...current, time: { ...current.time, mode: mode as 'fixed' | 'viewer' } }))} />
          <Select label="Week starts" size="sm" value={plan().time.weekStart} options={['monday', 'sunday', 'saturday'].map(value => ({ value, label: value }))} onChange={weekStart => change(current => ({ ...current, time: { ...current.time, weekStart: weekStart as PanelPlan['time']['weekStart'] } }))} />
          <Show when={!props.dashboardId && tabs().length > 1}><Select label="Dashboard" size="sm" value={placement()} options={tabs().map(tab => ({ value: tab.id, label: tab.name }))} onChange={setPlacement} /></Show>
        </Stack></Fold>
      </Show>
    </Stack>
    <div class="dash-v2-preview" aria-label="Panel preview"><Card><div class="dash-panel-head"><Heading level={3}>{plan().title}</Heading></div><div class="dash-panel-body">
      <For each={describePanelPlan(plan())}>{line => <Text wrap>{line}</Text>}</For>
      <Show when={aiSummary()}>{summary => <Text wrap>{`AI summary: ${summary()}`}</Text>}</Show>
      <Show when={plan().requirements?.length}><Fold label="Requirements to confirm" level="sub"><For each={plan().requirements}>{requirement => <Checkbox
        label={`${requirement.status}: ${requirement.text}${requirement.reason ? ` — ${requirement.reason}` : ''}`}
        checked={confirmedRequirements().includes(requirement.id)}
        onChange={checked => setConfirmedRequirements(current => checked ? [...new Set([...current, requirement.id])] : current.filter(id => id !== requirement.id))}
      />}</For></Fold></Show>
      <Show when={run()?.diagnostics.problems.length}><Alert tone="warn">{run()!.diagnostics.problems.map(entry => `${entry.path}: ${entry.message}`).join(' ')}</Alert></Show>
      <For each={run()?.diagnostics.stages}>{stage => <Text emphasis="muted">{`${stage.path}: ${stage.input} → ${stage.output} rows`}</Text>}</For>
      <Show when={display()} fallback={<EmptyState align="start" size="sm" title="No preview yet">Choose a source to see its rows.</EmptyState>}>
        {value => <PanelBody view={plan().view} schema={value().schema} fields={value().fields} rows={value().rows} groups={displayPlanGroups(run()!.groups, value().rows)}
          {...(plan().group?.[0] ? { groupBy: plan().group![0]!.column } : {})} provenance={plan().sources.length > 1} />}
      </Show>
    </div></Card></div>
    </div></Modal.Body>
    <Modal.Actions><Button variant="ghost" onPress={props.onClose}>Close</Button><Button variant="solid" tone="accent" disabled={!plan().sources.length} onPress={() => void publish()}>Publish</Button></Modal.Actions>
  </Modal>
}
