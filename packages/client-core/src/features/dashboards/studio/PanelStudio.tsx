import { createMemo, createResource, createSignal, createUniqueId, For, onCleanup, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { panelPlanSchema, type DashboardDraft, type DashboardView, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import { eventChord, isTypingTarget } from '@acorn/protocol/keybindings.ts'
import type { PlanProblem } from '@acorn/dashboards-core/plan.ts'
import { columnParts, diffOutline, partForPath, planOutline, type OutlineDiff, type PartChange, type PlanPart, type PlanPartKey } from '@acorn/dashboards-core/outline.ts'
import { planPartLabel } from '@acorn/dashboards-core/labels.ts'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
import { activeCacheId } from '../../../infra/node/activeNode'
import { ApiError } from '../../../infra/node/apiClient'
import AuthoringConversation from '../../dataSources/AuthoringConversation'
import { mergeAuthoringCandidate } from '../../dataSources/authoringMerge'
import {
  Alert, Badge, Button, Checkbox, CodeBlock, DetailColumn, EmptyState, Field, Input, ListColumn, ListDetail, Row, Toolbar, ToolbarSpacer,
} from '../../../kit/components/primitives'
import { Heading } from '../../../kit/components/content/Heading'
import Icon from '../../../kit/components/content/Icon'
import { Link } from '../../../kit/components/content/Link'
import { Text } from '../../../kit/components/content/Text'
import { IconButton } from '../../../kit/components/inputs/IconButton'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'
import { Tabs } from '../../../kit/components/layout/Tabs'
import { Menu } from '../../../kit/components/overlays/Menu'
import { Modal } from '../../../kit/components/overlays/Modal'
import { createDismissable } from '../../../kit/lib/controls/dismissable'
import { restoreFocusOnCleanup } from '../../../kit/keys/trap'
import { dashboardClient } from '../dashboardClient'
import { latestUnpublishedDashboard } from '../dashboardEditorModel'
import { dashboardRecoveryStore } from '../dashboardRecovery'
import { LabeledSelect } from '../fields'
import type { Rect } from '../layout'
import { describePanelSources, PanelRegionRefusal, publishPanelPlan } from '../panelPublish'
import { dashboards, homeTabs, homeTabScope, type PlacementScope } from '../persist'
import { regionRefusal, type PanelRegion } from '../region'
import {
  addColumnTo, addSourceTo, addStageTo, createSourceTracking, INSPECTORS, moveStageIn, NewSourceInspector, partKind, removeSourceFrom,
  removeStageFrom, SourceInspector, type InspectorContext,
} from './inspectors'
import { createStudioStore } from './studioStore'
import { markPanelStudioOpen } from './studioOpen'
import StudioOutline, { type OutlineAddition } from './StudioOutline'
import StudioPreview from './StudioPreview'
import '../dashboards.css'

// The panel studio: a full-window layer for building and editing one dashboard panel
// (docs/dashboards/mapping-and-editor.md § The generated editor). A layer rather than a route, like
// Settings, because a route would unmount the task's panes, plugin frames, and terminal drawer behind
// it (docs/ui-design/overlays.md § Chrome and overlays). The layout copies the Workflows editor:
// toolbar, tabs, outline and detail, status bar.

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
const CHANGE_WORDS: Record<Exclude<PartChange, 'same'>, string> = { added: 'Added', changed: 'Changed', removed: 'Removed' }

/** "1 step added, 1 column changed", from a diff against the published plan. Empty when they match. */
export function diffSummary(diff: OutlineDiff): string[] {
  const steps = Object.entries(diff.parts).filter(([key]) => key.startsWith('stage:')).map(([, change]) => change)
  const others = Object.entries(diff.parts).filter(([key, change]) => !key.startsWith('stage:') && key !== 'columns' && change !== 'same')
  const counted = (count: number, noun: string, verb: string) => count ? [`${plural(count, noun)} ${verb}`] : []
  return [
    ...counted(steps.filter(change => change === 'added').length, 'step', 'added'),
    ...counted(steps.filter(change => change === 'changed').length, 'step', 'changed'),
    ...counted(diff.removed.length, 'step', 'removed'),
    ...counted(diff.columnChanges.added.length, 'column', 'added'),
    ...counted(diff.columnChanges.changed.length, 'column', 'changed'),
    ...counted(diff.columnChanges.removed.length, 'column', 'removed'),
    ...counted(others.length, 'other part', 'changed'),
  ]
}

export default function PanelStudio(props: {
  scope: PlacementScope
  dashboardId?: string
  /** A plugin's region the panel will show in, which publishing checks it against. */
  region?: PanelRegion
  /** Where the studio was opened from, for the back button: a Home tab, a plugin source, or a task. */
  returnLabel: string
  /** Where the panel is placed now, so the preview starts at that size. */
  placed?: Rect
  onPublished(id: string, title: string, scope: PlacementScope, view: DashboardView, sources: string[], fieldRoles: string[]): void
  onDeleted(id: string): void
  onClose(): void
}) {
  markPanelStudioOpen()
  const nodeId = activeCacheId()
  const scope = { workspaceId: props.scope.workspaceId ?? '' }
  const client = dashboardClient(nodeId, scope)
  const queryClient = useQueryClient()
  const recovery = dashboardRecoveryStore(typeof localStorage === 'undefined' ? undefined : localStorage)
  const recoveryId = props.dashboardId ?? `new:${scope.workspaceId}`
  const store = createStudioStore({ nodeId, client, recovery, recoveryId })
  onCleanup(store.dispose)
  const plan = store.plan
  const sources = createSourceTracking({ change: store.apply, validate: content => client.validate(content) })
  const [tab, setTab] = createSignal<'outline' | 'plan'>('outline')
  const [addingSource, setAddingSource] = createSignal(false)
  const [editingTitle, setEditingTitle] = createSignal(false)
  const [ai, setAi] = createSignal<{ instruction?: string }>()
  const [reviewing, setReviewing] = createSignal(false)
  const [publishing, setPublishing] = createSignal(false)
  const [confirmedRequirements, setConfirmedRequirements] = createSignal<string[]>([])
  const [placement, setPlacement] = createSignal(props.scope.ownerId ?? '')
  // The newest draft never published, offered rather than reopened, so Add panel always starts blank.
  const [unfinished, setUnfinished] = createSignal<DashboardDraft>()

  onMount(async () => {
    try {
      if (props.dashboardId) {
        const loaded = await client.get(props.dashboardId)
        if (!store.edited()) store.open(loaded)
        return
      }
      setUnfinished(latestUnpublishedDashboard(await client.list()))
    } catch { /* A local draft can begin while the Node reconnects. */ }
    store.restoreLocal()
  })
  const discardUnfinished = async (abandoned: DashboardDraft): Promise<void> => {
    try {
      await client.delete(abandoned.id, abandoned.draftRevision)
      recovery.discard(nodeId, abandoned.id)
      setUnfinished(undefined)
    } catch { store.setProblem("Couldn't discard the unfinished panel.") }
  }

  // ── Runs and problems ────────────────────────────────────────────────────────────────────────
  const parsed = createMemo(() => panelPlanSchema.safeParse(plan()))
  const preview = createQuery(() => ({
    queryKey: ['dashboard-preview', nodeId, scope.workspaceId, JSON.stringify(plan())],
    queryFn: ({ signal }: { signal: AbortSignal }) => client.run({ kind: 'draft', content: copy(plan()) }, 'preview', Intl.DateTimeFormat().resolvedOptions().timeZone, signal),
    enabled: plan().sources.length > 0 && parsed().success,
    staleTime: 0,
  }))
  const run = createMemo(() => preview.data ? copy(preview.data) : undefined)
  /** Nothing before a source is picked, so a blank panel doesn't open on a list of errors. The run and
   *  the Node's validator can report the same problem, so each message shows once. */
  const problems = createMemo((): PlanProblem[] => {
    if (!plan().sources.length) return []
    const result = parsed()
    const schema = result.success ? [] : result.error.issues.map(issue => {
      const path = `/${issue.path.map(String).join('/')}`
      return { path, severity: 'error' as const, message: `${planPartLabel(plan(), path)} is incomplete.` }
    })
    const reported = [...new Map((run()?.diagnostics.problems ?? []).map(entry => [entry.message, entry])).values()]
    return [...schema, ...reported.map(entry => ({ ...entry, message: `${planPartLabel(plan(), entry.path)}: ${entry.message}` }))]
  })
  const selectPath = (path: string): void => {
    const key = partForPath(plan(), path)
    if (key) select(key)
  }

  // ── Published revision ───────────────────────────────────────────────────────────────────────
  const published = createQuery(() => ({
    queryKey: ['dashboard-revision', nodeId, scope.workspaceId, store.draft()?.id],
    queryFn: ({ signal }: { signal: AbortSignal }) => client.published(store.draft()!.id, undefined, signal),
    enabled: store.draft()?.publishedRevision != null,
    staleTime: 30_000,
  }))
  const publishedPlan = (): PanelPlan | undefined => store.draft()?.publishedRevision != null && published.data ? copy(published.data.content) : undefined
  const diff = createMemo(() => publishedPlan() ? diffOutline(publishedPlan()!, plan()) : undefined)
  const unpublished = createMemo(() => diff() ? diffSummary(diff()!) : [])

  // ── Selection and edits ──────────────────────────────────────────────────────────────────────
  const parts = createMemo((): PlanPart[] => [...planOutline(plan()), ...columnParts(plan())])
  /** The selected part, while the plan still has it. A removed step leaves nothing selected. */
  const selectedPart = () => parts().find(part => part.key === store.selected())
  const select = (key: PlanPartKey | undefined): void => {
    setAddingSource(false)
    store.select(key)
  }
  const addPart = (addition: OutlineAddition): void => {
    if (addition === 'source') { store.select(undefined); setAddingSource(true); return }
    if (addition === 'column') {
      store.apply(addColumnTo)
      select(`column:${plan().columns.at(-1)!.id}`)
      return
    }
    const before = plan().stages.length
    store.apply(current => addStageTo(current, addition))
    if (plan().stages.length > before) select(`stage:${before}`)
  }
  const pickSource = (reference: Parameters<typeof addSourceTo>[1]): void => {
    store.apply(current => addSourceTo(current, reference))
    select(`source:${plan().sources.at(-1)!.id}`)
  }
  const removePart = (key: PlanPartKey): void => {
    if (key.startsWith('source:')) store.apply(current => removeSourceFrom(current, key.slice('source:'.length)))
    if (key.startsWith('stage:')) store.apply(current => removeStageFrom(current, Number(key.slice('stage:'.length))))
    select(undefined)
  }
  const moveStage = (index: number, by: -1 | 1): void => {
    store.apply(current => moveStageIn(current, index, by))
    select(`stage:${index + by}`)
  }
  const inspectorContext: InspectorContext = {
    plan, change: store.apply, select, workspaceId: scope.workspaceId, run, sources,
    refreshQueries: () => void queryClient.invalidateQueries(),
  }
  // Keyed by id rather than by source object, so an edit to one source doesn't remount its picker.
  const sourceIds = createMemo(() => plan().sources.map(source => source.id), undefined, { equals: (a, b) => a.join() === b.join() })

  // ── AI ───────────────────────────────────────────────────────────────────────────────────────
  const applyAiProposal = async (proposal: Extract<AuthoringTurnResult, { state: 'proposal' }>): Promise<string | undefined> => {
    const merged = mergeAuthoringCandidate(proposal.base as PanelPlan, proposal.candidate as PanelPlan, plan())
    if (merged.conflicts.length) return 'This panel changed while the proposal was prepared.'
    const result = panelPlanSchema.safeParse(merged.value)
    if (!result.success) return 'The proposed plan does not fit this panel.'
    try { if ((await client.validate(result.data)).problems.length) return 'The proposed plan has source or column problems.' }
    catch { return 'The Node could not validate this proposal.' }
    setConfirmedRequirements([])
    store.apply(() => result.data)
    return undefined
  }

  // ── Publish ──────────────────────────────────────────────────────────────────────────────────
  const tabs = () => props.scope.surface === 'home' ? homeTabs(dashboards(), props.scope.workspaceId) : []
  const destination = (): PlacementScope => props.scope.surface === 'home' ? homeTabScope(placement(), props.scope.workspaceId) : props.scope
  // Checked when the review opens, by describing each source, so a panel the region would hide is
  // refused before it is published.
  const [regionCheck] = createResource(
    () => reviewing() && props.region && parsed().success ? JSON.stringify(plan()) : undefined,
    async () => regionRefusal(props.region!, plan().view.kind, await describePanelSources(nodeId, scope, plan())),
  )
  const unconfirmed = () => plan().requirements?.some(item => !confirmedRequirements().includes(item.id)) ?? false
  const blockers = createMemo(() => [
    ...(plan().sources.length ? [] : ['Pick data first.']),
    ...problems().filter(problem => problem.severity === 'error').map(problem => problem.message),
    ...(regionCheck.error ? [] : regionCheck() ? [regionCheck()!] : []),
    ...(unconfirmed() ? ['Confirm each requirement before publishing.'] : []),
  ])
  const publish = async (): Promise<void> => {
    const result = parsed()
    if (!result.success) return
    setPublishing(true)
    try {
      const published = await publishPanelPlan({ nodeId, scope, plan: result.data, region: props.region, flush: store.flush, queryClient, recovery })
      props.onPublished(published.id, plan().title, destination(), plan().view, published.sources, published.fieldRoles)
      props.onClose()
    } catch (error) {
      store.setProblem(error instanceof PanelRegionRefusal ? error.message
        : error instanceof ApiError && error.code === 'invalid-dashboard' ? error.message : "Couldn't publish this panel.")
    } finally { setPublishing(false) }
  }
  const remove = async (): Promise<void> => {
    store.dispose()
    try {
      const current = store.draft()
      if (current) {
        await client.delete(current.id, current.draftRevision)
        recovery.discard(nodeId, current.id)
        props.onDeleted(current.id)
      }
      recovery.discard(nodeId, recoveryId)
      props.onClose()
    } catch { store.setProblem("Couldn't delete this panel.") }
  }

  // ── The layer ────────────────────────────────────────────────────────────────────────────────
  let root!: HTMLDivElement
  const titleId = createUniqueId()
  const dismiss = createDismissable({ onDismiss: () => props.onClose(), container: () => root, on: ['escape'] })
  restoreFocusOnCleanup()
  onMount(() => root.focus({ preventScroll: true }))
  // Focus that lands under the layer comes back into it, as in Settings: a terminal or a pane behind
  // the studio would otherwise take what the person types. A dialog or popover above it keeps focus.
  let lastInside: HTMLElement | undefined
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (root.contains(target)) { lastInside = target; return }
    if (target.closest('[aria-modal="true"], .ui-popover')) return
    ;(lastInside?.isConnected ? lastInside : root).focus()
  }
  document.addEventListener('focusin', onFocusIn)
  onCleanup(() => document.removeEventListener('focusin', onFocusIn))
  const onKeyDown = (event: KeyboardEvent): void => {
    // Something inside took this key already, such as the title field cancelling an edit.
    if (event.defaultPrevented) return
    const chord = eventChord(event)
    if (!isTypingTarget(event.target) && (chord === 'meta+z' || chord === 'ctrl+z' || chord === 'meta+shift+z' || chord === 'ctrl+shift+z')) {
      event.preventDefault()
      if (chord.includes('shift')) store.redo()
      else store.undo()
      return
    }
    dismiss.onKeyDown(event)
  }

  const publishBadge = () => !store.draft()?.publishedRevision ? 'Not published' : unpublished().length ? 'Unpublished changes' : 'Published'
  const header = (
    <Toolbar ariaLabel="Panel">
      <Button size="xs" variant="ghost" onPress={() => props.onClose()}><Icon name="arrow-left" /> {props.returnLabel}</Button>
      <div id={titleId} class="dash-studio-title">
        <Show when={editingTitle()} fallback={<Heading level={2}><Button variant="bare" onPress={() => setEditingTitle(true)}>{plan().title}</Button></Heading>}>
          <TitleField value={plan().title} onDone={title => {
            setEditingTitle(false)
            if (title !== undefined && title !== plan().title) store.apply(current => ({ ...current, title }))
          }} />
        </Show>
      </div>
      <Badge tone={store.saveState() === "Couldn't save" ? 'warn' : undefined}>{store.saveState()}</Badge>
      <Badge>{publishBadge()}</Badge>
      <ToolbarSpacer />
      <Button size="sm" opens="dialog" onPress={() => setAi({})}><Icon name="sparkles" /> Ask AI</Button>
      <IconButton icon="undo-2" label="Undo" disabled={!store.canUndo()} onPress={store.undo} />
      <IconButton icon="redo-2" label="Redo" disabled={!store.canRedo()} onPress={store.redo} />
      <Button size="sm" variant="solid" opens="dialog" disabled={!plan().sources.length} onPress={() => setReviewing(true)}>Publish…</Button>
      <Menu ariaLabel="More panel actions" placement="bottom-end"
        trigger={({ open, toggle }) => <IconButton icon="ellipsis" label="More actions" opens="menu" expanded={open()} onPress={toggle} />}>
        {menu => <>
          <Show when={publishedPlan()}>{previous => (
            <Menu.Item context={menu} disabled={!unpublished().length} onSelect={() => store.apply(() => previous())}>Discard changes</Menu.Item>
          )}</Show>
          <Menu.Item context={menu} tone="danger" confirm="Delete panel?" onSelect={() => void remove()}>Delete panel</Menu.Item>
        </>}
      </Menu>
    </Toolbar>
  )

  const statusBar = (
    <Toolbar size="sm" ariaLabel="Panel status">
      <Show when={problems()[0]}
        fallback={<Text emphasis="muted">{`${plural(plan().stages.length, 'step')} · ${plural(plan().columns.length, 'column')} · no problems`}</Text>}>
        {first => <Inline gap="inline">
          <Link onPress={() => selectPath(first().path)}>{first().message}</Link>
          <Show when={problems().length > 1}><Text emphasis="muted">{`and ${problems().length - 1} more`}</Text></Show>
        </Inline>}
      </Show>
      <Show when={unpublished().length}><Text emphasis="muted">{`Unpublished: ${unpublished().join(', ')}`}</Text></Show>
    </Toolbar>
  )

  const inspector = (
    <aside class="dash-studio-inspector" aria-label="Inspector">
      <Stack gap="stack">
        <Heading level={3}>{addingSource() ? 'Pick data' : selectedPart()?.title ?? 'This panel'}</Heading>
        <Show when={addingSource()}>
          <NewSourceInspector workspaceId={scope.workspaceId} onPick={pickSource}
            {...(plan().sources.length ? { onCancel: () => setAddingSource(false) } : {})} />
        </Show>
        {/* Every source's picker stays mounted, hidden unless selected, because the column and step
            forms read each source's described fields from what its picker reports. */}
        <For each={sourceIds()}>{id => (
          <div class="dash-studio-source" hidden={addingSource() || store.selected() !== `source:${id}`}>
            <SourceInspector context={inspectorContext} part={`source:${id}`} />
          </div>
        )}</For>
        <Show when={!addingSource() && selectedPart()?.key} keyed>{key => (
          <Show when={partKind(key) !== 'source'}><Dynamic component={INSPECTORS[partKind(key)]} context={inspectorContext} part={key} /></Show>
        )}</Show>
        <Show when={!addingSource() && !selectedPart()}>
          <Show when={plan().request}>{request => <Text wrap>{request()}</Text>}</Show>
          <Text emphasis="muted" wrap>Select a part of the panel to change it.</Text>
        </Show>
      </Stack>
    </aside>
  )

  const entrances = (
    <Stack gap="stack">
      <Show when={unfinished()}>{abandoned => <Inline gap="inline" wrap>
        <Text wrap>{`You have an unfinished panel, ${abandoned().content.title}, edited ${formatRelativeTime(abandoned().updatedAt)}.`}</Text>
        <Button size="sm" onPress={() => { store.open(abandoned()); setUnfinished(undefined) }}>Continue</Button>
        <Button size="sm" variant="ghost" onPress={() => void discardUnfinished(abandoned())}>Discard</Button>
      </Inline>}</Show>
      <EmptyState title="Choose what this panel shows" action={<Inline gap="row">
        <Button variant="solid" onPress={() => { store.select(undefined); setAddingSource(true) }}>Pick data</Button>
        <Button opens="dialog" onPress={() => setAi({})}>Describe it</Button>
      </Inline>}>Pick a source and account, or describe the panel and let AI build it.</EmptyState>
    </Stack>
  )

  return (
    <div ref={root} class="dash-studio" role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1" onKeyDown={onKeyDown}>
      {header}
      <Tabs idPrefix="dashboards-studio" ariaLabel="Studio view" active={tab()} onChange={id => setTab(id as 'outline' | 'plan')}
        tabs={[{ id: 'outline', label: 'Outline' }, { id: 'plan', label: 'Plan' }]} />
      <Show when={store.problem()}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
      <div class="dash-studio-body">
        <Show when={tab() === 'outline'} fallback={<div class="dash-studio-code"><CodeBlock copy>{JSON.stringify(plan(), null, 2)}</CodeBlock></div>}>
          <ListDetail split listLabel="Outline">
            <ListColumn>
              <StudioOutline plan={plan()} stageCounts={run()?.diagnostics.stages ?? []} problems={problems()} selected={store.selected()}
                onSelect={select} onAdd={addPart} onMoveStage={moveStage} onRemove={removePart}
                onAskAi={part => setAi({ instruction: `About "${part.title}": ` })} />
            </ListColumn>
            <DetailColumn>
              <div class="dash-studio-detail">
                <Show when={plan().sources.length} fallback={<div class="dash-studio-preview">{entrances}</div>}>
                  <StudioPreview plan={plan()} run={run()} loading={preview.isFetching} {...(props.placed ? { placed: props.placed } : {})}
                    onRefresh={() => void preview.refetch()} onSelectPart={key => { if (parts().some(part => part.key === key)) select(key) }}
                    onEditTitle={() => setEditingTitle(true)} />
                </Show>
                {inspector}
              </div>
            </DetailColumn>
          </ListDetail>
        </Show>
      </div>
      {statusBar}

      <Show when={ai()}>{request => (
        <Modal title={`Edit ${plan().title} with AI`} size="lg" onDismiss={() => setAi(undefined)}>
          <AuthoringConversation onClose={() => setAi(undefined)} endpoint="/v1/core/authoring/turn" target="dashboard" targetId={store.draft()?.id ?? recoveryId}
            scope={scope} baseRevision={store.draft()?.draftRevision ?? 0} base={plan()} label={plan().title}
            {...(request().instruction ? { instruction: request().instruction } : {})} onApply={applyAiProposal} />
        </Modal>
      )}</Show>

      <Show when={reviewing()}>
        <Modal title="Publish panel" size="md" onDismiss={() => setReviewing(false)}>
          <Modal.Body><Stack gap="stack">
            <Field label="What changes" group>
              <Show when={diff()} fallback={<Text>New panel</Text>}>{changes => <Stack gap="none">
                <For each={parts().filter(part => changes().parts[part.key] && changes().parts[part.key] !== 'same')}>{part => (
                  <Row density="compact" leading={<Icon name={part.icon} />} meta={<Badge size="xs">{CHANGE_WORDS[changes().parts[part.key] as Exclude<PartChange, 'same'>]}</Badge>}>{part.title}</Row>
                )}</For>
                <For each={changes().removed}>{part => <Row density="compact" leading={<Icon name={part.icon} />} meta={<Badge size="xs">Removed</Badge>}>{part.title}</Row>}</For>
                <Show when={!unpublished().length}><Text emphasis="muted">Nothing has changed since the last publish.</Text></Show>
              </Stack>}</Show>
            </Field>
            <Show when={props.scope.surface === 'home' && !props.dashboardId && tabs().length > 1}
              fallback={<Field label="Where it goes"><Text>{props.returnLabel}</Text></Field>}>
              <LabeledSelect label="Where it goes" value={placement()} options={tabs().map(entry => ({ value: entry.id, label: entry.name }))} onChange={setPlacement} />
            </Show>
            <Show when={plan().requirements?.length}>
              <Field label="Requirements to confirm" group><Stack gap="row">
                <For each={plan().requirements}>{requirement => <Checkbox
                  label={`${requirement.status}: ${requirement.text}${requirement.reason ? ` — ${requirement.reason}` : ''}`}
                  checked={confirmedRequirements().includes(requirement.id)}
                  onChange={checked => setConfirmedRequirements(current => checked ? [...new Set([...current, requirement.id])] : current.filter(id => id !== requirement.id))}
                />}</For>
              </Stack></Field>
            </Show>
            <Show when={blockers().length}>
              <Alert tone="warn" title="Fix these before publishing"><Stack gap="none"><For each={blockers()}>{blocker => <Text wrap>{blocker}</Text>}</For></Stack></Alert>
            </Show>
            <Show when={store.problem()}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
          </Stack></Modal.Body>
          <Modal.Actions>
            <Button variant="ghost" onPress={() => setReviewing(false)}>Cancel</Button>
            <Button variant="solid" tone="accent" busy={publishing() || regionCheck.loading} disabled={!!blockers().length || regionCheck.loading}
              onPress={() => void publish()}>Publish</Button>
          </Modal.Actions>
        </Modal>
      </Show>
    </div>
  )
}

/** The toolbar title, edited in place. Enter or leaving the field commits; Escape cancels. */
function TitleField(props: { value: string; onDone: (title: string | undefined) => void }) {
  const [value, setValue] = createSignal(props.value)
  let done = false
  const finish = (title: string | undefined) => {
    if (done) return
    done = true
    props.onDone(title?.trim() ? title : undefined)
  }
  return <Input label="Panel title" value={value()} onInput={setValue}
    ref={element => queueMicrotask(() => { element.focus(); element.select() })}
    onBlur={() => finish(value())}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(value()) }
      if (event.key === 'Escape') { event.preventDefault(); finish(undefined) }
    }} />
}
