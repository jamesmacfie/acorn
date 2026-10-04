import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { panelPlanSchema, type DashboardDraft, type DashboardView, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import { dashboardFields } from '@acorn/dashboards-core/projection'
import { describePanelPlan, displayPlanGroups, displayPlanRun, outputPlanColumns } from '@acorn/dashboards-core/plan.ts'
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
import CompositionStageForm from './CompositionStageForm'
import EquivalenceForm from './EquivalenceForm'
import KeepHistory from './KeepHistory'
import WriteValueControls from './WriteValueControls'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import { dashboardRecoveryStore } from './dashboardRecovery'
import { availableContentPresentations } from '../../host/registries/panes/contentLinks'
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
  let edited = false
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
  const change = (update: (current: PanelPlan) => PanelPlan): void => {
    const current = plan()
    const next = update(current)
    if (next === current) return
    edited = true
    setPlan(next)
    persist(next)
  }
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
        if (edited) return
        setDraft(loaded)
        const restored = recovery.read(nodeId, loaded.id)?.content
        setPlan(restored && 'version' in restored ? restored : loaded.content)
        setEntrance('pick')
        setSaveState(restored ? 'Saved on this computer' : 'Saved')
        return
      }
    } catch { /* A local draft can begin while the Node reconnects. */ }
    const local = recovery.read(nodeId, recoveryId)?.content
    if (!edited && local && 'version' in local) { setPlan(local); setEntrance('pick'); setSaveState('Saved on this computer') }
  })

  const addSource = (): void => change(current => ({ ...current, sources: [...current.sources, {
    id: crypto.randomUUID(), label: `Source ${current.sources.length + 1}`, role: 'primary',
    reference: { kind: 'inline', content: { name: 'Choose data', parameters: { type: 'object', properties: {}, additionalProperties: false }, query: { source: { pluginId: 'core', sourceId: 'choose' }, scope: { ...scope, parameters: {} }, sort: [] }, sourceParameters: {} }, bindings: {} },
  }] }))
  const setSource = (id: string, reference: QueryReference | undefined): void => change(current => ({
    ...current, sources: reference
      ? current.sources.map(source => source.id === id ? { ...source, reference } : source)
      : current.sources.filter(source => source.id !== id),
    relations: reference ? current.relations : current.relations?.filter(relation => relation.from !== id && relation.to !== id),
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
      const columns = available.slice(0, 30).map(field => ({ id: safeId(field.id), label: field.name, type: field.type, bind: { [id]: { field: field.id } }, ...(field.unit ? { unit: field.unit } : {}), ...(field.precision ? { precision: field.precision } : {}), ...(field.list ? { list: true } : {}), ...(field.values ? { choices: field.values } : {}) }))
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
  const editStage = (index: number, stage: PanelPlan['stages'][number]): void => change(current => ({ ...current,
    stages: current.stages.map((entry, at) => at === index ? stage : entry),
  }))
  const addOperation = (op: PanelPlan['stages'][number]['op']): void => {
    const columns = outputPlanColumns(plan())
    const first = columns[0]?.id ?? ''
    const dates = columns.filter(column => column.type === 'datetime')
    const list = columns.find(column => column.list)
    const stage: PanelPlan['stages'][number] | undefined = op === 'filter' ? { op, where: firstPredicate(first) }
      : op === 'compute' ? { op, columns: [{ id: `computed${plan().stages.length}`, label: 'Calculated value', type: 'number', expression: { kind: 'column', column: first } }] }
      : op === 'summarize' ? { op, by: [], measures: [{ id: `count${plan().stages.length}`, label: 'Count', kind: 'count' }] }
      : op === 'expand' && list ? { op, column: list.id, output: `element${plan().stages.length}`, perRow: 100 }
      : op === 'overlap' && dates.length >= 2 ? { op, start: dates[0]!.id, end: dates[1]!.id, maxPairs: 5000 } : undefined
    if (stage) change(current => ({ ...current, stages: [...current.stages, stage] }))
  }
  const addDeclaredRelation = (from: string, to: string, declared: NonNullable<DataSourceDescription['relations']>[number]): void => {
    const output = declared.cardinality === 'one-to-many' ? `${to}Children` : undefined
    change(current => ({ ...current,
      relations: [...current.relations ?? [], { id: declared.id, from, to, kind: declared.kind, cardinality: declared.cardinality,
        keys: declared.keys, unmatched: 'keep', maxMatches: 5000, ...(output ? { output } : {}) }],
      columns: output && !current.columns.some(column => column.id === output)
        ? [...current.columns, { id: output, label: declared.label, type: 'text', list: true, bind: {} }] : current.columns,
    }))
  }
  const editFilter = (index: number, changes: { column?: string; operator?: Comparison['operator']; value?: string }): void => change(current => ({
    ...current, stages: current.stages.map((stage, at) => {
      if (at !== index || stage.op !== 'filter') return stage
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
  const filterValueMode = (predicate: DataPredicate): string => {
    const address = comparison(predicate)?.right?.address
    return address?.from === 'context' ? address.name === 'calendar' ? address.boundary : address.name : 'literal'
  }
  const filterOffset = (predicate: DataPredicate): string => {
    const address = comparison(predicate)?.right?.address
    return address?.from === 'context' && (address.name === 'now' || address.name === 'calendar') ? address.offset ?? '' : ''
  }
  const viewerPointer = (columnId: string): string | undefined => {
    if (plan().sources.length !== 1) return undefined
    const source = plan().sources[0]!
    const binding = plan().columns.find(column => column.id === columnId)?.bind[source.id]
    return binding && 'field' in binding ? states()[source.id]?.description?.fields.find(field => field.pointer === binding.field)?.viewerMatch : undefined
  }
  const editFilterContext = (index: number, mode: string): void => change(current => ({
    ...current, stages: current.stages.map((stage, at) => {
      if (at !== index || stage.op !== 'filter' || stage.where.kind !== 'comparison') return stage
      const address = mode === 'viewer' ? { from: 'context' as const, name: 'viewer' as const, pointer: viewerPointer(filterColumn(stage.where)) ?? '/login' }
        : mode === 'now' ? { from: 'context' as const, name: 'now' as const, offset: '-P7D' }
          : mode === 'literal' ? { from: 'literal' as const, value: '' }
            : { from: 'context' as const, name: 'calendar' as const, boundary: mode as 'startOfDay' | 'startOfWeek' | 'startOfMonth' }
      return { ...stage, where: { ...stage.where, right: { address } } }
    }),
  }))
  const editFilterOffset = (index: number, offset: string): void => change(current => ({
    ...current, stages: current.stages.map((stage, at) => {
      if (at !== index || stage.op !== 'filter' || stage.where.kind !== 'comparison' || stage.where.right?.address.from !== 'context') return stage
      const address = stage.where.right.address
      return address.name === 'now' || address.name === 'calendar'
        ? { ...stage, where: { ...stage.where, right: { address: { ...address, ...(offset ? { offset } : {}) } } } } : stage
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
  const pressPresentations = createMemo(() => {
    const selected = plan().actions?.press
    if (!selected) return []
    if (selected.kind === 'task') return run()?.rows.some(row => row.taskId) ? ['pane', 'route'] : []
    const choices = (run()?.rows ?? []).flatMap(row => selected.kind === 'link'
      ? (() => { const value = row.values[selected.column ?? '']; return typeof value === 'string' ? availableContentPresentations({ href: value, taskId: row.taskId }) : [] })()
      : row.target ? availableContentPresentations({ kind: row.target.kind, item: row.target.item, taskId: row.taskId })
        : row.action?.verb === 'openUrl' ? availableContentPresentations({ href: row.action.url, taskId: row.taskId }) : [])
    return [...new Set(choices)]
  })
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
            <Select label="Row role" size="sm" value={source.role} options={['primary', 'lookup', 'children'].map(value => ({ value, label: value }))}
              onChange={role => change(current => ({ ...current, sources: current.sources.map(entry => entry.id === source.id ? { ...entry, role: role as typeof source.role } : entry) }))} />
            <For each={starters()[source.id] ?? []}>{starter => <Button size="sm" variant="ghost" onPress={() => change(() => starter)}>{`Start with ${starter.title} · ${describePanelPlan(starter)[0]}`}</Button>}</For>
            <Show when={states()[source.id]?.query && states()[source.id]?.description && states()[source.id]?.source}>
              <KeepHistory query={states()[source.id]!.query!} description={states()[source.id]!.description!}
                sourceName={states()[source.id]!.source!.name} onCreated={() => void queryClient.invalidateQueries()} />
            </Show>
            <Button size="sm" variant="ghost" onPress={() => setSource(source.id, undefined)}>Remove source</Button>
          </Fold>}</For>
          <Button size="sm" disabled={plan().sources.length >= 8} onPress={addSource}>Add another source</Button>
        </Stack></Fold>
        <Fold label="Relations" level="group"><Stack gap="row">
          <EquivalenceForm sources={plan().sources} columns={plan().columns} onAdd={relation => change(current => ({ ...current, relations: [...current.relations ?? [], relation] }))} />
          <For each={plan().relations ?? []}>{(relation, index) => <Card><Stack gap="row">
            <Text>{`${relation.kind} · ${relation.from} to ${relation.to} · ${relation.cardinality}`}</Text>
            <Select label="Unmatched rows" size="sm" value={relation.unmatched} options={[{ value: 'keep', label: 'Keep' }, { value: 'drop', label: 'Drop' }]}
              onChange={unmatched => change(current => ({ ...current, relations: current.relations?.map((entry, at) => at === index() ? { ...entry, unmatched: unmatched as 'keep' | 'drop' } : entry) }))} />
            <Button size="sm" variant="bare" onPress={() => change(current => ({ ...current, relations: current.relations?.filter((_entry, at) => at !== index()) }))}>Remove relation</Button>
          </Stack></Card>}</For>
          <For each={plan().sources}>{from => <For each={states()[from.id]?.description?.relations ?? []}>{declared => <For each={plan().sources.filter(to => to.id !== from.id && states()[to.id]?.source?.pluginId === declared.target.pluginId && states()[to.id]?.source?.sourceId === declared.target.sourceId)}>{to => <Button size="sm" disabled={(plan().relations ?? []).some(relation => relation.id === declared.id && relation.from === from.id && relation.to === to.id)} onPress={() => addDeclaredRelation(from.id, to.id, declared)}>{`Add ${declared.label}: ${from.label} to ${to.label}`}</Button>}</For>}</For>}</For>
        </Stack></Fold>
        <Fold label="Columns" level="group" defaultOpen><Stack gap="row">
          <For each={plan().columns}>{column => <Card><Stack gap="row">
            <Field label="Column name"><Input label="Column name" assist={false} value={column.label} onInput={label => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, label } : entry) }))} /></Field>
            <Select label={`${column.label} type`} size="sm" value={column.type ?? 'text'} options={['text', 'number', 'boolean', 'datetime', 'enum', 'person', 'link'].map(value => ({ value, label: value }))} onChange={type => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, type: type as NonNullable<PanelPlan['columns'][number]['type']> } : entry) }))} />
            <Show when={plan().relations?.some(relation => relation.kind === 'equivalence')}><Select label="Preferred source for equivalent records" size="sm" value={column.precedence?.[0] ?? ''}
              options={[{ value: '', label: 'First available' }, ...plan().sources.filter(source => source.role === 'primary').map(source => ({ value: source.id, label: source.label }))]}
              onChange={sourceId => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, precedence: sourceId ? [sourceId] : undefined } : entry) }))} /></Show>
            <Checkbox label="List of values" checked={!!column.list} onChange={list => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, list } : entry) }))} />
            <Show when={column.type === 'number'}><Input label="Fixed unit (currency, percent, ms, s, bytes)" assist={false} value={typeof column.unit === 'string' ? column.unit : ''} onInput={unit => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, unit: unit || undefined } : entry) }))} />
              <Select label="Or unit from column" size="sm" value={typeof column.unit === 'object' ? column.unit.column : ''} options={[{ value: '', label: 'Fixed unit' }, ...plan().columns.filter(entry => entry.id !== column.id).map(entry => ({ value: entry.id, label: entry.label }))]} onChange={unitColumn => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, unit: unitColumn ? { column: unitColumn } : undefined } : entry) }))} /></Show>
            <Show when={column.type === 'datetime'}><Select label="Date precision" size="sm" value={column.precision ?? 'instant'} options={[{ value: 'instant', label: 'Instant' }, { value: 'day', label: 'Calendar day' }]} onChange={precision => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, precision: precision as 'instant' | 'day' } : entry) }))} /></Show>
            <Show when={column.type === 'enum'}><Select label="New values" size="sm" value={column.unmatched ?? 'catch-all'} options={[{ value: 'catch-all', label: 'Show unmatched' }, { value: 'hidden', label: 'Hide unmatched' }]} onChange={unmatched => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, unmatched: unmatched as 'catch-all' | 'hidden' } : entry) }))} />
              <For each={column.choices ?? []}>{(choice, index) => <Inline gap="inline" wrap>
                <Input label="Choice name" assist={false} value={choice.label} onInput={label => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, choices: entry.choices?.map((value, at) => at === index() ? { ...value, label } : value) } : entry) }))} />
                <Select label="Choice tone" size="sm" value={choice.tone ?? 'muted'} options={['ok', 'warn', 'bad', 'muted', 'accent'].map(value => ({ value, label: value }))} onChange={tone => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, choices: entry.choices?.map((value, at) => at === index() ? { ...value, tone: tone as NonNullable<typeof choice.tone> } : value) } : entry) }))} />
                <Input label="Choice rank" assist={false} value={String(choice.rank ?? '')} onInput={rank => change(current => ({ ...current, columns: current.columns.map(entry => entry.id === column.id ? { ...entry, choices: entry.choices?.map((value, at) => at === index() ? { ...value, rank: rank ? Number(rank) : undefined } : value) } : entry) }))} />
                <WriteValueControls column={column} choice={choice} sources={plan().sources}
                  descriptions={Object.fromEntries(Object.entries(states()).map(([id, state]) => [id, state?.description]))}
                  onChange={(sourceId, value, present) => change(current => ({ ...current, columns: current.columns.map(entry =>
                    entry.id === column.id ? { ...entry, choices: entry.choices?.map(candidate => {
                      if (candidate.id !== choice.id) return candidate
                      const writeValues = { ...candidate.writeValues }
                      if (present) writeValues[sourceId] = value!
                      else delete writeValues[sourceId]
                      return { ...candidate, writeValues }
                    }) } : entry) }))} />
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
          <For each={plan().stages}>{(stage, index) => <Fold label={`${stage.op} · ${index() + 1}`} level="sub"><Stack gap="row">
            <Show when={stage.op === 'filter' ? stage : undefined}>{filter => <>
            <Select label="Column" size="sm" value={filterColumn(filter().where)}
              options={plan().columns.map(column => ({ value: column.id, label: column.label }))} onChange={column => editFilter(index(), { column })} />
            <Select label="Comparison" size="sm" value={comparison(filter().where)?.operator ?? 'eq'}
              options={['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'in', 'missing', 'present'].map(value => ({ value, label: value }))}
              onChange={operator => editFilter(index(), { operator: operator as Comparison['operator'] })} />
            <Show when={!['missing', 'present'].includes(comparison(filter().where)?.operator ?? '')}>
              <Show when={plan().columns.find(column => column.id === filterColumn(filter().where))?.type === 'datetime' || plan().columns.find(column => column.id === filterColumn(filter().where))?.type === 'person'}>
                <Select label="Value" size="sm" value={filterValueMode(filter().where)} options={[
                  { value: 'literal', label: 'Fixed value' },
                  ...(viewerPointer(filterColumn(filter().where)) ? [{ value: 'viewer', label: 'You' }] : plan().columns.find(column => column.id === filterColumn(filter().where))?.type === 'person' ? [] : [
                    { value: 'now', label: 'Relative to now' }, { value: 'startOfDay', label: 'Start of today' },
                    { value: 'startOfWeek', label: 'Start of this week' }, { value: 'startOfMonth', label: 'Start of this month' },
                  ]),
                ]} onChange={mode => editFilterContext(index(), mode)} />
              </Show>
              <Show when={filterValueMode(filter().where) === 'literal'}><Input label="Value" assist={false} value={operand(filter().where)} onInput={value => editFilter(index(), { value })} /></Show>
              <Show when={['now', 'startOfDay', 'startOfWeek', 'startOfMonth'].includes(filterValueMode(filter().where))}>
                <Input label="Offset (for example -P7D or -P1W)" assist={false} value={filterOffset(filter().where)} onInput={value => editFilterOffset(index(), value)} />
              </Show>
            </Show>
            </>}</Show>
            <Show when={stage.op !== 'filter'}><CompositionStageForm stage={stage} columns={plan().columns} onChange={next => editStage(index(), next)} /></Show>
            <Button size="sm" variant="bare" disabled={index() === 0} onPress={() => change(current => { const stages = [...current.stages]; [stages[index() - 1], stages[index()]] = [stages[index()]!, stages[index() - 1]!]; return { ...current, stages } })}>Move up</Button>
            <Button size="sm" variant="bare" onPress={() => change(current => ({ ...current, stages: current.stages.filter((_entry, at) => at !== index()) }))}>Remove stage</Button>
          </Stack></Fold>}</For>
          <For each={PANEL_CAPABILITIES.operations}>{operation => <Button size="sm" disabled={!plan().columns.length || plan().stages.length >= 8
            || operation.id === 'summarize' && plan().stages.filter(stage => stage.op === 'summarize').length >= 3
            || operation.id === 'overlap' && (plan().stages.some(stage => stage.op === 'overlap') || outputPlanColumns(plan()).filter(column => column.type === 'datetime').length < 2)
            || operation.id === 'expand' && !outputPlanColumns(plan()).some(column => column.list)} onPress={() => addOperation(operation.id)}>Add stage · {operation.label}</Button>}</For>
          <Show when={!plan().columns.length}><Text emphasis="muted">Add a column before filtering rows.</Text></Show>
        </Stack></Fold>
        <Fold label="When a row is pressed" level="group"><Stack gap="row">
          <Select label="Open" size="sm" value={plan().actions?.press?.kind ?? ''}
            options={[{ value: '', label: 'Record default' },
              ...(run()?.rows.some(row => !!row.action || !!row.target) ? [{ value: 'record', label: 'Source record' }] : []),
              ...(run()?.rows.some(row => !!row.taskId) ? [{ value: 'task', label: 'Its task' }] : []),
              ...(plan().columns.some(column => column.type === 'link') ? [{ value: 'link', label: 'Link column' }] : [])]}
            onChange={kind => change(current => ({ ...current, actions: {
              buttons: current.actions?.buttons ?? [],
              ...(kind ? { press: { kind: kind as 'record' | 'task' | 'link', prefer: kind === 'task' ? 'pane' : 'refPanel',
                ...(kind === 'link' ? { column: current.columns.find(column => column.type === 'link')?.id } : {}) } } : {}),
            } }))} />
          <Show when={plan().actions?.press} keyed>{press => <>
            <Show when={press.kind === 'link'}><Select label="Link column" size="sm" value={press.column ?? ''}
              options={plan().columns.filter(column => column.type === 'link').map(column => ({ value: column.id, label: column.label }))}
              onChange={column => change(current => ({ ...current, actions: { buttons: current.actions?.buttons ?? [], press: { ...current.actions!.press!, column } } }))} /></Show>
            <Select label="Presentation" size="sm" value={press.prefer}
              options={([{ value: 'route', label: 'Full page' }, { value: 'refPanel', label: 'Side panel' }, { value: 'pane', label: 'Task pane' }, { value: 'overlay', label: 'Overlay' }, { value: 'external', label: 'Browser' }]).filter(option => pressPresentations().includes(option.value))}
              onChange={prefer => change(current => ({ ...current, actions: { buttons: current.actions?.buttons ?? [], press: { ...current.actions!.press!, prefer: prefer as 'route' | 'refPanel' | 'pane' | 'overlay' | 'external' } } }))} />
          </>}</Show>
        </Stack></Fold>
        <Fold label="Row buttons" level="group"><Stack gap="row">
          <For each={plan().actions?.buttons ?? []}>{(button, index) => <Card><Stack gap="row">
            <Input label="Button label" assist={false} value={button.label} onInput={label => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: (current.actions?.buttons ?? []).map((entry, at) => at === index() ? { ...entry, label } : entry) } }))} />
            <Input label="Icon (optional)" assist={false} value={button.icon ?? ''} onInput={icon => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: (current.actions?.buttons ?? []).map((entry, at) => at === index() ? { ...entry, icon: icon || undefined } : entry) } }))} />
            <Show when={button.kind === 'open'}><>
              <Select label="Reference" size="sm" value={button.kind === 'open' ? button.reference.kind === 'link' ? `link:${button.reference.column ?? ''}` : button.reference.kind : 'record'}
                options={[{ value: 'record', label: 'Source record' }, { value: 'task', label: 'Its task' }, ...plan().columns.filter(column => column.type === 'link').map(column => ({ value: `link:${column.id}`, label: column.label }))]}
                onChange={value => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: (current.actions?.buttons ?? []).map((entry, at) => at === index() && entry.kind === 'open' ? { ...entry, reference: value.startsWith('link:') ? { kind: 'link', column: value.slice(5), prefer: entry.reference.prefer } : { kind: value as 'record' | 'task', prefer: entry.reference.prefer } } : entry) } }))} />
              <Select label="Presentation" size="sm" value={button.kind === 'open' ? button.reference.prefer : 'refPanel'}
                options={[{ value: 'route', label: 'Full page' }, { value: 'refPanel', label: 'Side panel' }, { value: 'pane', label: 'Task pane' }, { value: 'overlay', label: 'Overlay' }, { value: 'external', label: 'Browser' }]}
                onChange={prefer => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: (current.actions?.buttons ?? []).map((entry, at) => at === index() && entry.kind === 'open' ? { ...entry, reference: { ...entry.reference, prefer: prefer as 'route' | 'refPanel' | 'pane' | 'overlay' | 'external' } } : entry) } }))} />
            </></Show>
            <Button size="sm" variant="bare" onPress={() => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: (current.actions?.buttons ?? []).filter((_entry, at) => at !== index()) } }))}>Remove button</Button>
          </Stack></Card>}</For>
          <Button size="sm" disabled={(plan().actions?.buttons.length ?? 0) >= 3} onPress={() => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: [...(current.actions?.buttons ?? []), { kind: 'createTask', label: 'Start task' }] } }))}>Add Start task button</Button>
          <Button size="sm" disabled={(plan().actions?.buttons.length ?? 0) >= 3} onPress={() => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: [...(current.actions?.buttons ?? []), { kind: 'open', label: 'Open', reference: { kind: 'record', prefer: 'refPanel' } }] } }))}>Add Open button</Button>
          <Show when={run()?.rows.some(row => row.action?.verb === 'openUrl')}><Button size="sm" disabled={(plan().actions?.buttons.length ?? 0) >= 3} onPress={() => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: [...(current.actions?.buttons ?? []), { kind: 'open', label: 'Open in browser', reference: { kind: 'record', prefer: 'external' } }] } }))}>Add Open in browser button</Button></Show>
          <For each={run()?.rows.flatMap(row => row.actions ?? []).filter((action, index, all) => all.findIndex(item => item.id === action.id) === index)}>{action => <Button size="sm" disabled={(plan().actions?.buttons.length ?? 0) >= 3} onPress={() => change(current => ({ ...current, actions: { press: current.actions?.press, buttons: [...(current.actions?.buttons ?? []), { kind: 'action', label: action.label, actionId: action.id }] } }))}>Add {action.label} button</Button>}</For>
        </Stack></Fold>
        <Fold label="View and timing" level="group" defaultOpen><Stack gap="row">
          <Field label="Panel title"><Input label="Panel title" assist={false} value={plan().title} onInput={title => change(current => ({ ...current, title }))} /></Field>
          <Select label="View" size="sm" value={plan().view.kind} options={Object.keys(PANEL_CAPABILITIES.views).map(kind => ({ value: kind, label: kind }))} onChange={kind => change(current => { const summary = [...current.stages].reverse().find(stage => stage.op === 'summarize'); return { ...current, view: { ...current.view, kind: kind as PanelPlan['view']['kind'], ...(summary?.op === 'summarize' && (kind === 'stat' || kind === 'chart') ? { aggregate: 'sum' as const, field: summary.measures[0]?.id, ...(kind === 'chart' ? { x: summary.by[0]?.column } : {}) } : {}) } } })} />
          <Select label="Aggregate" size="sm" value={plan().view.aggregate ?? 'count'} options={['count', 'sum', 'avg', 'min', 'max'].map(value => ({ value, label: value }))} onChange={aggregate => change(current => ({ ...current, view: { ...current.view, aggregate: aggregate as NonNullable<PanelPlan['view']['aggregate']> } }))} />
          <For each={(['field', 'x', 'series'] as const)}>{key => <Select label={key} size="sm" value={plan().view[key] ?? ''} options={[{ value: '', label: 'None' }, ...outputPlanColumns(plan()).map(column => ({ value: column.id, label: column.label }))]} onChange={value => change(current => ({ ...current, view: { ...current.view, [key]: value || undefined } }))} />}</For>
          <Select label="Chart shape" size="sm" value={plan().view.shape ?? 'bar'} options={['bar', 'line'].map(value => ({ value, label: value }))} onChange={shape => change(current => ({ ...current, view: { ...current.view, shape: shape as 'bar' | 'line' } }))} />
          <Select label="Trend" size="sm" value={plan().view.trend ?? ''} options={[{ value: '', label: 'None' }, { value: 'history', label: 'History' }, { value: 'activity', label: 'Activity' }]} onChange={trend => change(current => ({ ...current, view: { ...current.view, trend: trend ? trend as 'history' | 'activity' : undefined } }))} />
          <Select label="Compare" size="sm" value={plan().view.compare ?? ''} options={[{ value: '', label: 'None' }, { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} onChange={compare => change(current => ({ ...current, view: { ...current.view, compare: compare ? compare as 'day' | 'week' : undefined } }))} />
          <Select label="Good direction" size="sm" value={plan().view.good ?? ''} options={[{ value: '', label: 'Neutral' }, { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]} onChange={good => change(current => ({ ...current, view: { ...current.view, good: good ? good as 'up' | 'down' : undefined } }))} />
          <Select label="Sort column" size="sm" value={plan().sort?.[0]?.column ?? ''} options={[{ value: '', label: 'No sort' }, ...outputPlanColumns(plan()).map(column => ({ value: column.id, label: column.label }))]} onChange={column => change(current => ({ ...current, sort: column ? [{ column, direction: current.sort?.[0]?.direction ?? 'asc' }] : [] }))} />
          <Select label="Sort direction" size="sm" value={plan().sort?.[0]?.direction ?? 'asc'} options={[{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]} onChange={direction => change(current => ({ ...current, sort: current.sort?.[0] ? [{ ...current.sort[0], direction: direction as 'asc' | 'desc' }] : [] }))} />
          <Select label="Group column" size="sm" value={plan().group?.[0]?.column ?? ''} options={[{ value: '', label: 'No grouping' }, ...outputPlanColumns(plan()).map(column => ({ value: column.id, label: column.label }))]} onChange={column => change(current => ({ ...current, group: column ? [{ column, bucket: 'value' }] : [] }))} />
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
      <For each={run()?.diagnostics.stages}>{stage => <Text emphasis="muted">{`${stage.path}: ${stage.input} → ${stage.output} rows${stage.meaning ? ` · ${stage.meaning}` : ''}`}</Text>}</For>
      <Show when={display()} fallback={<EmptyState align="start" size="sm" title="No preview yet">Choose a source to see its rows.</EmptyState>}>
        {value => <PanelBody view={plan().view} schema={value().schema} fields={value().fields} rows={value().rows} groups={displayPlanGroups(run()!.groups, value().rows)}
          {...(plan().group?.[0] ? { groupBy: plan().group![0]!.column } : {})} provenance={plan().sources.length > 1} />}
      </Show>
    </div></Card></div>
    </div></Modal.Body>
    <Modal.Actions><Button variant="ghost" onPress={props.onClose}>Close</Button><Button variant="solid" tone="accent" disabled={!plan().sources.length} onPress={() => void publish()}>Publish</Button></Modal.Actions>
  </Modal>
}
