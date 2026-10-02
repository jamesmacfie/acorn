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
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select } from '../../kit/components/primitives'
import { Heading } from '../../kit/components/content/Heading'
import Icon from '../../kit/components/content/Icon'
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
const SAVE_WORDS: Record<SaveState, string> = {
  'not-saved': 'Not saved',
  'saved-on-device': 'Saved on this computer',
  saving: 'Saving…',
  'draft-saved': 'Saved',
  conflict: "Couldn't save",
}
const AI_MISFIT = "The AI's suggestion doesn't fit this panel, so it wasn't applied."

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
    } catch { setProblem("Couldn't load this panel's draft. The panel on your dashboard hasn't changed.") }
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
      setProblem("Couldn't save. The panel changed somewhere else, or the node didn't answer. Your edits are kept on this computer.")
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
    if (merged.conflicts.length) return 'This panel changed since you opened it.'
    const parsed = dashboardPanelContentSchema.safeParse(merged.value)
    if (!parsed.success) return AI_MISFIT
    try { await client.validate(parsed.data) }
    catch { return AI_MISFIT }
    setAiUndo(structuredClone(current))
    change(() => parsed.data)
    setSlots(parsed.data.queries.map(query => query.id))
    return undefined
  }

  const publish = async (): Promise<void> => {
    if (!dashboardPanelContentSchema.safeParse(content()).success) {
      setProblem('Choose what to show before you publish.')
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

  // The stat's count names the source when every query reads the same kind.
  const plural = () => {
    const sources = new Set(Object.values(states()).flatMap(state => state?.source ? [state.source.plural.toLowerCase()] : []))
    return sources.size === 1 ? [...sources][0] : undefined
  }
  const isBoard = () => content().display.view.kind === 'board'

  return <Modal title={props.dashboardId ? 'Edit panel' : 'Add panel'} size="lg" onDismiss={props.onClose}>
    <Modal.Body>
      <div class="dash-v2-editor">
        <Stack gap="stack">
          <Inline gap="inline" wrap>
            <Badge tone={saveState() === 'conflict' ? 'warn' : undefined}>{SAVE_WORDS[saveState()]}</Badge>
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
              <For each={slots()}>{(id, index) => <Fold label={`Query ${index() + 1}`} level="sub" defaultOpen>
                <Stack gap="row">
                  <SourceQueryEditor
                    workspaceId={scope.workspaceId}
                    previewOnOpen={!!props.dashboardId}
                    value={content().queries.find(query => query.id === id)?.reference}
                    onChange={reference => change(current => setDashboardQuery(current, id, reference))}
                    onStateChange={state => updateState(id, state)}
                  />
                  <Inline gap="row">
                    <Button size="sm" variant="ghost" onPress={() => removeSlot(id)}>Remove data query</Button>
                  </Inline>
                </Stack>
              </Fold>}</For>
              <Inline gap="row">
                <Button size="sm" onPress={addSlot}><Icon name="plus" /> Add another query</Button>
              </Inline>
            </Stack>
          </Fold>

          <Fold label="Display" level="group" defaultOpen>
            <Stack gap="stack">
              <Field label="Panel title"><Input label="Panel title" assist={false} value={content().title} onInput={title => change(current => ({ ...current, title }))} /></Field>
              <Field label="View">
                <Select label="View" size="sm" value={content().display.view.kind}
                  options={available().map(kind => ({ value: kind, label: kind[0]!.toUpperCase() + kind.slice(1) }))}
                  onChange={kind => change(current => ({ ...current, display: { ...current.display, view: { kind: kind as PanelViewKind } } }))} />
                <For each={dashboardViewKinds.filter(kind => !available().includes(kind))}>{kind => <Text emphasis="muted" wrap>{unavailableViewReason(kind)}</Text>}</For>
              </Field>
              <Show when={isBoard()}>
                <Inline gap="row" wrap>
                  <Button size="sm" onPress={addColumnsFromStates}>One column per state</Button>
                  <Button size="sm" onPress={() => change(current => ({ ...current, mapping: { ...current.mapping, columns: [...current.mapping.columns, { id: crypto.randomUUID(), label: `Column ${current.mapping.columns.length + 1}` }] } }))}><Icon name="plus" /> Add board column</Button>
                </Inline>
              </Show>
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
                        ...(retained && !described.some(field => field.pointer === retained) ? [{ value: retained, label: `${retained} (no longer in the source)` }] : []),
                        ...described.map(field => ({ value: field.pointer, label: field.label, title: field.pointer })),
                      ]
                    })()}
                    onChange={pointer => change(current => ({ ...current, mapping: setRoleField(current.mapping, entry.id, role, pointer) }))}
                  />}</For>
                  <For each={exactStatusOptions(states()[entry.id], content().mapping.fields[entry.id]?.status)}>{status => <Select
                    label={`State: ${status.label}`} size="sm"
                    value={content().mapping.columns.find(column => content().mapping.values[entry.id]?.[column.id]?.includes(status.id))?.id ?? ''}
                    options={[{ value: '', label: 'No column' }, ...content().mapping.columns.map(column => ({ value: column.id, label: column.label }))]}
                    onChange={columnId => change(current => ({ ...current, mapping: mapExactStatus(current.mapping, entry.id, status.id, columnId) }))}
                  />}</For>
                  <Show when={(() => {
                    const described = new Set(exactStatusOptions(states()[entry.id], content().mapping.fields[entry.id]?.status).map(value => value.id))
                    const retained = Object.values(content().mapping.values[entry.id] ?? {}).flat().filter(id => !described.has(id))
                    return retained.length ? [...new Set(retained)] : undefined
                  })()}>{retained => <Alert tone="warn">{`Some states no longer exist in the source: ${retained().join(', ')}. Map them again or remove them.`}</Alert>}</Show>
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

        <div class="dash-v2-preview" aria-label="Panel preview">
          <Card>
            <div class="dash-panel-head">
              <Heading level={3}>{content().title}</Heading>
              <Show when={Object.values(states()).some(state => state?.stale)}><Badge tone="warn">Preview is out of date</Badge></Show>
            </div>
            <div class="dash-panel-body">
              <Show when={projected()} fallback={<EmptyState align="start" size="sm" title="No preview yet">Choose Refresh preview on each query to see it here.</EmptyState>}>
                {value => <PanelBody view={value().definition.view} schema={value().schema} fields={value().fields} rows={value().rows}
                  {...(value().definition.shaping.groupBy ? { groupBy: value().definition.shaping.groupBy } : {})}
                  {...(plural() ? { plural: plural() } : {})}
                  provenance={content().queries.length > 1} />}
              </Show>
            </div>
          </Card>
        </div>
      </div>
    </Modal.Body>
    <Modal.Actions>
      <Button variant="ghost" onPress={props.onClose}>Close</Button>
      <Button variant="solid" tone="accent" disabled={!content().queries.length} onPress={() => void publish()}>Publish</Button>
    </Modal.Actions>
  </Modal>
}
