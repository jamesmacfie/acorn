import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import {
  dashboardPanelContentSchema,
  dashboardViewKinds,
  type DashboardDraft,
  type DashboardPanelContent,
  type DashboardView,
} from '@acorn/protocol/dashboards.ts'
import type { SourceQueryEditorState } from '../dataSources/SourceQueryEditor'
import SourceQueryEditor from '../dataSources/SourceQueryEditor'
import AuthoringConversation from '../dataSources/AuthoringConversation'
import { mergeAuthoringCandidate } from '../dataSources/authoringMerge'
import type { AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import { projectDashboardPanel, suggestStateCategoryMapping, type DashboardQueryProjection } from '@acorn/dashboards-core/projection'
import { activeCacheId } from '../../infra/node/activeNode'
import { Alert, Badge, Button, Checkbox, EmptyState, Field, Input, Select } from '../../kit/components/primitives'
import { Fold } from '../../kit/components/layout/Fold'
import { Inline } from '../../kit/components/layout/Inline'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import { Modal } from '../../kit/components/overlays/Modal'
import PanelBody from './views/PanelBody'
import { dashboardClient, publishedDashboardPanelKey } from './dashboardClient'
import { dashboardRecoveryStore } from './dashboardRecovery'
import {
  availableDashboardViews,
  displaySchema,
  emptyDashboardContent,
  exactStatusOptions,
  latestUnpublishedDashboard,
  mapExactStatus,
  removeDashboardQuery,
  setDashboardQuery,
  setRoleField,
  suggestRoleFields,
  unavailableViewReason,
} from './dashboardEditorModel'
import { dashboards, homeTabs, homeTabScope, type PlacementScope } from './persist'
import type { PanelViewKind } from './model'
import './dashboards.css'

const AUTOSAVE_MS = 750
type SaveState = 'not-saved' | 'saved-on-device' | 'saving' | 'draft-saved' | 'conflict'

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
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage
  const recovery = dashboardRecoveryStore(storage)
  const recoveryId = props.dashboardId ?? `new:${scope.workspaceId}`
  const [content, setContent] = createSignal<DashboardPanelContent>(emptyDashboardContent())
  const [slots, setSlots] = createSignal<string[]>([])
  const [states, setStates] = createSignal<Record<string, SourceQueryEditorState | undefined>>({})
  const [draft, setDraft] = createSignal<DashboardDraft>()
  const [saveState, setSaveState] = createSignal<SaveState>('not-saved')
  const [problem, setProblem] = createSignal<string>()
  const [aiUndo, setAiUndo] = createSignal<DashboardPanelContent>()
  const [placement, setPlacement] = createSignal(props.scope.ownerId ?? '')
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => saveTimer && clearTimeout(saveTimer))

  const addSlot = () => setSlots(current => [...current, crypto.randomUUID()])
  onMount(async () => {
    const restore = (loaded: DashboardDraft): void => {
      const copy = recovery.read(nodeId, loaded.id)
      const restored = copy?.content ?? loaded.content
      setDraft(loaded)
      setContent(restored)
      setSlots(restored.queries.length ? restored.queries.map(query => query.id) : [crypto.randomUUID()])
      setSaveState(copy ? 'saved-on-device' : 'draft-saved')
    }
    if (!props.dashboardId) {
      const local = recovery.read(nodeId, recoveryId)
      if (local) {
        setContent(local.content)
        setSlots(local.content.queries.length ? local.content.queries.map(query => query.id) : [crypto.randomUUID()])
        setSaveState('saved-on-device')
        return
      }
      try {
        const existing = latestUnpublishedDashboard(await client.list())
        if (existing) { restore(existing); return }
      } catch { /* A new local draft can still begin while the Node reconnects. */ }
      addSlot()
      return
    }
    try {
      const loaded = await client.get(props.dashboardId)
      restore(loaded)
    } catch { setProblem('This dashboard draft could not be loaded. Its placement remains unchanged.') }
  })

  const copyFor = (next: DashboardPanelContent, current = draft()) => ({
    nodeId, entityId: current?.id ?? recoveryId, baseRevision: current?.draftRevision ?? 0,
    baseContent: current?.content ?? emptyDashboardContent(), content: next, savedAt: Date.now(),
  })

  const persist = (next: DashboardPanelContent): void => {
    setSaveState(recovery.save(copyFor(next)))
    if (saveTimer) clearTimeout(saveTimer)
    if (!dashboardPanelContentSchema.safeParse(next).success) return
    saveTimer = setTimeout(() => void flush(next), AUTOSAVE_MS)
  }

  const change = (update: (current: DashboardPanelContent) => DashboardPanelContent): void => {
    setContent(current => {
      const next = update(current)
      persist(next)
      return next
    })
  }

  async function flush(next = content()): Promise<DashboardDraft> {
    setSaveState('saving')
    setProblem(undefined)
    try {
      const current = draft()
      const saved = current
        ? await client.save(current.id, current.draftRevision, next)
        : await client.create(next)
      setDraft(saved)
      recovery.acknowledge(copyFor(next, current), saved.content)
      if (!current && recoveryId !== saved.id) recovery.discard(nodeId, recoveryId)
      setSaveState('draft-saved')
      return saved
    } catch {
      setSaveState('conflict')
      setProblem('The draft changed elsewhere or the Node could not save it. Your local copy is retained.')
      throw new Error('dashboard-save-failed')
    }
  }

  const removeSlot = (id: string) => {
    setSlots(current => current.filter(candidate => candidate !== id))
    setStates(current => { const { [id]: _removed, ...rest } = current; return rest })
    change(current => removeDashboardQuery(current, id))
  }

  const updateState = (id: string, state: SourceQueryEditorState): void => {
    setStates(current => ({ ...current, [id]: state }))
    if (!state.description) return
    const mapping = suggestRoleFields(content().mapping, id, state.description.fields)
    if (JSON.stringify(mapping.fields[id]) !== JSON.stringify(content().mapping.fields[id])) {
      change(current => ({ ...current, mapping: suggestRoleFields(current.mapping, id, state.description!.fields) }))
    }
  }

  const previews = createMemo((): DashboardQueryProjection[] => content().queries.flatMap(entry => {
    const state = states()[entry.id]
    return state?.query && state.description && state.preview
      ? [{ instanceId: entry.id, label: entry.label, query: state.query, description: state.description, result: state.preview }]
      : []
  }))
  const projected = createMemo(() => previews().length === content().queries.length && previews().length
    ? projectDashboardPanel(content(), previews()) : undefined)
  const available = createMemo(() => availableDashboardViews(states(), content().mapping))
  const tabs = () => props.scope.surface === 'home' ? homeTabs(dashboards(), props.scope.workspaceId) : []
  const destination = (): PlacementScope => props.scope.surface === 'home'
    ? homeTabScope(placement(), props.scope.workspaceId)
    : props.scope

  const addColumnsFromStates = (): void => change(current => {
    const existing = new Map(current.mapping.columns.map(column => [column.id, column]))
    const values = structuredClone(current.mapping.values)
    for (const entry of current.queries) {
      for (const choice of exactStatusOptions(states()[entry.id], current.mapping.fields[entry.id]?.status)) {
        existing.set(choice.id, existing.get(choice.id) ?? { id: choice.id, label: choice.label })
        values[entry.id] ??= {}
        values[entry.id]![choice.id] = [...new Set([...(values[entry.id]![choice.id] ?? []), choice.id])]
      }
    }
    return { ...current, mapping: { ...current.mapping, columns: [...existing.values()], values }, display: { ...current.display, groupBy: 'status' } }
  })

  const suggestCategories = (entryId: string): void => {
    const state = states()[entryId]
    const preview = previews().find(candidate => candidate.instanceId === entryId)
    const status = content().mapping.fields[entryId]?.status
    const category = state?.description?.fields.find(field => /category/i.test(field.label) || /category/i.test(field.pointer))
    if (!preview || !status || !category) return
    const suggestion = suggestStateCategoryMapping(preview, status, category.pointer)
    change(current => ({
      ...current,
      mapping: {
        ...current.mapping,
        columns: [...new Map([...current.mapping.columns, ...suggestion.columns].map(column => [column.id, column])).values()],
        values: { ...current.mapping.values, [entryId]: suggestion.values },
      },
      display: { ...current.display, groupBy: 'status' },
    }))
  }

  const applyAiProposal = async (proposal: Extract<AuthoringTurnResult, { state: 'proposal' }>): Promise<string | undefined> => {
    const current = content()
    const merged = mergeAuthoringCandidate(proposal.base as DashboardPanelContent, proposal.candidate as DashboardPanelContent, current)
    if (merged.conflicts.length) return `The dashboard changed while AI was working: ${merged.conflicts.map(value => value.path).join(', ')}.`
    const parsed = dashboardPanelContentSchema.safeParse(merged.value)
    if (!parsed.success) return 'The reconciled dashboard no longer has a valid typed shape.'
    try { await client.validate(parsed.data) }
    catch (error) { return error instanceof Error ? error.message : 'The reconciled dashboard is no longer valid.' }
    setAiUndo(structuredClone(current))
    change(() => parsed.data)
    setSlots(parsed.data.queries.map(query => query.id))
    return undefined
  }

  const publish = async (): Promise<void> => {
    if (!dashboardPanelContentSchema.safeParse(content()).success) {
      setProblem('Choose at least one complete data query before publishing.')
      return
    }
    try {
      const saved = await flush()
      await client.publish(saved.id, saved.draftRevision)
      void queryClient.invalidateQueries({ queryKey: publishedDashboardPanelKey(nodeId, scope, saved.id) }).catch(() => {})
      recovery.discard(nodeId, saved.id)
      const sourceMetadata = Object.values(states()).flatMap(state => state?.query && state.description
        ? [{ key: `${state.query.source.pluginId}:${state.query.source.sourceId}`, roles: state.description.fields.flatMap(field => field.display?.role ?? []) }]
        : [])
      props.onPublished(
        saved.id,
        content().title,
        destination(),
        content().display.view,
        [...new Set(sourceMetadata.map(entry => entry.key))],
        [...new Set(sourceMetadata.flatMap(entry => entry.roles))],
      )
      props.onClose()
    } catch { /* flush and publication leave an actionable problem above. */ }
  }

  return <Modal title={props.dashboardId ? 'Edit dashboard panel' : 'Add dashboard panel'} size="lg" onDismiss={props.onClose}>
    <Modal.Body>
      <div class="dash-v2-editor">
        <Stack gap="stack">
          <Inline gap="inline" wrap>
            <Badge>{saveState().replaceAll('-', ' ')}</Badge>
            <Text emphasis="muted">Workspace: {scope.workspaceId || 'Unavailable'}</Text>
          </Inline>
          <Show when={problem()}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
          <AuthoringConversation
            endpoint="/v1/core/authoring/turn"
            target="dashboard"
            targetId={draft()?.id ?? recoveryId}
            scope={scope}
            baseRevision={draft()?.draftRevision ?? 0}
            base={content()}
            label={content().title || 'Dashboard'}
            onApply={applyAiProposal}
          />
          <Show when={aiUndo()}>{previous => <Button size="sm" variant="bare" onPress={() => {
            change(() => previous())
            setSlots(previous().queries.length ? previous().queries.map(query => query.id) : [crypto.randomUUID()])
            setAiUndo(undefined)
          }}>Undo AI edit</Button>}</Show>
          <Fold label="Data" level="group" defaultOpen>
            <Stack gap="stack">
              <For each={slots()}>{(id, index) => <Fold label={`Data ${index() + 1}`} level="sub" defaultOpen>
                <Stack gap="row">
                  <SourceQueryEditor
                    workspaceId={scope.workspaceId}
                    value={content().queries.find(query => query.id === id)?.reference}
                    onChange={reference => change(current => setDashboardQuery(current, id, reference))}
                    onStateChange={state => updateState(id, state)}
                  />
                  <Button size="sm" variant="bare" onPress={() => removeSlot(id)}>Remove data query</Button>
                </Stack>
              </Fold>}</For>
              <Button size="sm" onPress={addSlot}>Add another query</Button>
            </Stack>
          </Fold>

          <Fold label="Display" level="group" defaultOpen>
            <Stack gap="stack">
              <Field label="Panel title"><Input label="Panel title" assist={false} value={content().title} onInput={title => change(current => ({ ...current, title }))} /></Field>
              <Field label="View" hint="Display changes redraw the retained preview without querying the source.">
                <Select label="View" size="sm" value={content().display.view.kind}
                  options={available().map(kind => ({ value: kind, label: kind[0]!.toUpperCase() + kind.slice(1) }))}
                  onChange={kind => change(current => ({ ...current, display: { ...current.display, view: { kind: kind as PanelViewKind } } }))} />
                <For each={dashboardViewKinds.filter(kind => !available().includes(kind))}>{kind => <Text emphasis="muted">{`${kind}: ${unavailableViewReason(kind)}`}</Text>}</For>
              </Field>
              <Inline gap="inline" wrap>
                <Button size="sm" onPress={addColumnsFromStates}>Use exact source states</Button>
                <Button size="sm" onPress={() => change(current => ({ ...current, mapping: { ...current.mapping, columns: [...current.mapping.columns, { id: crypto.randomUUID(), label: `Column ${current.mapping.columns.length + 1}` }] } }))}>Add board column</Button>
              </Inline>
              <For each={content().queries}>{entry => <Fold label={`${entry.label} mappings`} level="sub">
                <Stack gap="row">
                  <For each={(['title', 'status', 'assignee', 'updated', 'url'] as const)}>{role => <Select
                    label={role[0]!.toUpperCase() + role.slice(1)} size="sm"
                    value={content().mapping.fields[entry.id]?.[role] ?? ''}
                    options={(() => {
                      const described = states()[entry.id]?.description?.fields ?? []
                      const retained = content().mapping.fields[entry.id]?.[role]
                      return [
                        { value: '', label: 'Not mapped' },
                        ...(retained && !described.some(field => field.pointer === retained) ? [{ value: retained, label: `Unavailable · ${retained}` }] : []),
                        ...described.map(field => ({ value: field.pointer, label: `${field.label} · ${field.pointer}` })),
                      ]
                    })()}
                    onChange={pointer => change(current => ({ ...current, mapping: setRoleField(current.mapping, entry.id, role, pointer) }))}
                  />}</For>
                  <For each={exactStatusOptions(states()[entry.id], content().mapping.fields[entry.id]?.status)}>{status => <Select
                    label={`State: ${status.label}`} size="sm"
                    value={content().mapping.columns.find(column => content().mapping.values[entry.id]?.[column.id]?.includes(status.id))?.id ?? ''}
                    options={[{ value: '', label: 'Unmapped' }, ...content().mapping.columns.map(column => ({ value: column.id, label: column.label }))]}
                    onChange={columnId => change(current => ({ ...current, mapping: mapExactStatus(current.mapping, entry.id, status.id, columnId) }))}
                  />}</For>
                  <Show when={(() => {
                    const described = new Set(exactStatusOptions(states()[entry.id], content().mapping.fields[entry.id]?.status).map(value => value.id))
                    const retained = Object.values(content().mapping.values[entry.id] ?? {}).flat().filter(id => !described.has(id))
                    return retained.length ? [...new Set(retained)] : undefined
                  })()}>{retained => <Alert tone="warn">{`Unavailable state mappings retained for repair: ${retained().join(', ')}.`}</Alert>}</Show>
                  <Show when={states()[entry.id]?.description?.fields.some(field => /category/i.test(field.label) || /category/i.test(field.pointer))}>
                    <Button size="sm" variant="bare" onPress={() => suggestCategories(entry.id)}>Suggest columns from state categories</Button>
                  </Show>
                </Stack>
              </Fold>}</For>
              <Show when={displaySchema(states(), content().mapping).fields.length}>
                <Field label="Visible fields">
                  <Inline gap="inline" wrap>
                    <For each={displaySchema(states(), content().mapping).fields}>{field => <Checkbox label={field.name} checked={!content().display.fields.length || content().display.fields.includes(field.id)}
                      onChange={checked => change(current => {
                        const all = displaySchema(states(), current.mapping).fields.map(candidate => candidate.id)
                        const selected = current.display.fields.length ? current.display.fields : all
                        const fields = checked ? [...new Set([...selected, field.id])] : selected.filter(id => id !== field.id)
                        return { ...current, display: { ...current.display, fields } }
                      })} />}</For>
                  </Inline>
                </Field>
              </Show>
              <Show when={!props.dashboardId && tabs().length > 1}><Select label="Dashboard" size="sm" value={placement()} options={tabs().map(tab => ({ value: tab.id, label: tab.name }))} onChange={setPlacement} /></Show>
            </Stack>
          </Fold>
        </Stack>

        <div class="dash-v2-preview" aria-label="Persistent panel preview">
          <div class="dash-panel-head"><span class="dash-panel-title">{content().title}</span><Show when={Object.values(states()).some(state => state?.stale)}><Badge tone="warn">Preview is out of date</Badge></Show></div>
          <div class="dash-panel-body">
            <Show when={projected()} fallback={<EmptyState align="start" size="sm" title="Preview ready after refresh">Configure each query, then choose Refresh preview. Display changes use those retained records.</EmptyState>}>
              {value => <PanelBody view={value().definition.view} schema={value().schema} fields={value().fields} rows={value().rows}
                {...(value().definition.shaping.groupBy ? { groupBy: value().definition.shaping.groupBy } : {})}
                provenance={content().queries.length > 1} onActivate={() => {}} />}
            </Show>
          </div>
        </div>
      </div>
    </Modal.Body>
    <Modal.Actions>
      <Button variant="ghost" onPress={props.onClose}>Close</Button>
      <Button variant="solid" tone="accent" onPress={() => void publish()}>Publish</Button>
    </Modal.Actions>
  </Modal>
}
