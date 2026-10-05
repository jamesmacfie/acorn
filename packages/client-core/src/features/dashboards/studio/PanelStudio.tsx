import { createMemo, createResource, createSignal, createUniqueId, For, onCleanup, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { panelPlanSchema, type DashboardView, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import { eventChord, isTypingTarget } from '@acorn/protocol/keybindings.ts'
import type { PlanProblem, SourceFailure } from '@acorn/dashboards-core/plan.ts'
import { columnParts, diffOutline, partForPath, planOutline, type OutlineDiff, type PartChange, type PlanPart, type PlanPartKey } from '@acorn/dashboards-core/outline.ts'
import { planPartLabel, REQUIREMENT_STATUS_LABELS } from '@acorn/dashboards-core/labels.ts'
import { activeCacheId } from '../../../infra/node/activeNode'
import { reloadNodePlugin } from '../../../infra/node/nodePlugins'
import { distribution } from '../../../host/plugins/distribution'
import { integrationsOptions } from '../../../infra/queries'
import { dataSourceCatalogOptions } from '../../dataSources/queries'
import { sourceKey, unboundInputs } from '../../dataSources/sourceEntries'
import { failureContext, planInputs } from '../planInputs'
import { describeSourceFailure } from '../sourceErrors'
import { openPluginSettings } from '../SourceFailureAlert'
import AuthoringConversation from '../../dataSources/AuthoringConversation'
import {
  Alert, Badge, Button, CodeBlock, DetailColumn, EmptyState, Field, ListColumn, ListDetail, Row, Toolbar, ToolbarSpacer,
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
import { dashboardRecoveryStore } from '../dashboardRecovery'
import { LabeledSelect, TitleField } from '../fields'
import type { Rect } from '../layout'
import { describePanelSources, publishFailureMessage, publishPanelPlan } from '../panelPublish'
import { dashboards, homeTabs, homeTabScope, type PlacementScope } from '../persist'
import { regionRefusal, type PanelRegion } from '../region'
import {
  addColumnTo, addSourceTo, addStageTo, createSourceTracking, INSPECTORS, moveStageIn, NewSourceInspector, partKind, removeSourceFrom,
  removeStageFrom, SourceInspector, type InspectorContext,
} from './inspectors'
import type { LaunchResult } from './PanelLauncher'
import { createStudioStore } from './studioStore'
import DevelopmentStrip, { DroppedRecords, type DevelopingPlugin } from './DevelopmentStrip'
import { markPanelStudioOpen } from './studioOpen'
import StudioOutline, { type OutlineAddition } from './StudioOutline'
import StudioPreview, { type PreviewSide } from './StudioPreview'
import '../dashboards.css'

// The panel studio: a full-window layer for building and editing one dashboard panel
// (docs/dashboards/mapping-and-editor.md § The generated editor). A layer rather than a route, like
// Settings, because a route would unmount the task's panes, plugin frames, and terminal drawer behind
// it (docs/ui-design/overlays.md § Chrome and overlays). The layout copies the Workflows editor:
// toolbar, tabs, outline and detail, status bar.

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
const CHANGE_WORDS: Record<Exclude<PartChange, 'same'>, string> = { added: 'Added', changed: 'Changed', removed: 'Removed' }
type Requirement = NonNullable<PanelPlan['requirements']>[number]
const REQUIREMENT_ICONS: Record<Requirement['status'], string> = {
  covered: 'circle-check', partial: 'circle-dashed', choice: 'circle-question-mark', unavailable: 'circle-x',
}
/** A request the studio sends to the docked AI: what the box starts with, the part it is about, and
 *  whether to send it straight away. */
type AiRequest = { instruction?: string; focus?: { paths: string[]; title: string }; send?: boolean }

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
  /** What the launcher chose for a new panel: a request for the AI, or a source and maybe a starter. */
  start?: Exclude<LaunchResult, { kind: 'draft' }>
  /** Opens with the AI docked and its box focused, from a panel's Edit with AI. */
  withAi?: boolean
  onPublished(id: string, title: string, scope: PlacementScope, view: DashboardView, sources: string[], fieldRoles: string[]): void
  onDeleted(id: string): void
  onClose(): void
}) {
  markPanelStudioOpen()
  const nodeId = activeCacheId()
  const scope = { workspaceId: props.scope.workspaceId ?? '' }
  const client = dashboardClient(nodeId, scope)
  const queryClient = useQueryClient()
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage
  const recovery = dashboardRecoveryStore(storage)
  const recoveryId = props.dashboardId ?? `new:${scope.workspaceId}`
  const store = createStudioStore({ nodeId, client, recovery, recoveryId, conversations: storage })
  onCleanup(store.dispose)
  const plan = store.plan
  const sources = createSourceTracking({ change: store.apply, validate: content => client.validate(content) })
  const [tab, setTab] = createSignal<'outline' | 'plan'>('outline')
  const [addingSource, setAddingSource] = createSignal(false)
  const [editingTitle, setEditingTitle] = createSignal(false)
  // The dock mounts on first use and stays mounted while closed, so a reply still on its way lands.
  const [dockStarted, setDockStarted] = createSignal(false)
  const [dockOpen, setDockOpen] = createSignal(false)
  const [aiRequest, setAiRequest] = createSignal<AiRequest>({})
  const [showing, setShowing] = createSignal<PreviewSide>('after')
  /** What the last applied proposal said it didn't cover, for the publish review. */
  const [unaddressed, setUnaddressed] = createSignal<string[]>([])
  const [reviewing, setReviewing] = createSignal(false)
  const [publishing, setPublishing] = createSignal(false)
  const [placement, setPlacement] = createSignal(props.scope.ownerId ?? '')

  onMount(async () => {
    if (!props.dashboardId) return
    try {
      const loaded = await client.get(props.dashboardId)
      if (!store.edited()) store.open(loaded)
      return
    } catch { /* This computer's copy stands in while the Node reconnects. */ }
    store.restoreLocal()
  })

  // ── Sources, inputs, and accounts ───────────────────────────────────────────────────────────
  const catalog = createQuery(() => dataSourceCatalogOptions(nodeId, { ...scope, parameters: {} }))
  const integrations = createQuery(() => integrationsOptions(true))
  const catalogSources = () => catalog.data?.sources ?? []
  const connections = () => integrations.data?.integrations ?? []
  /** Each derived source's inputs in the outline's words. */
  const inputs = createMemo(() => planInputs(plan(), catalogSources(), connections()))
  const contextFor = (problem: PlanProblem & { failure: SourceFailure }) => failureContext(problem, plan(), catalogSources(), connections())
  /** "Pull requests needs a GitHub account.", for each required input without one, before a run says so. */
  const missingAccounts = createMemo(() => plan().sources.flatMap((source, index) => {
    if (source.reference.kind !== 'inline') return []
    const query = source.reference.content.query
    const entry = catalogSources().find(candidate => sourceKey(candidate) === sourceKey(query.source))
    return unboundInputs(entry, query.scope, catalogSources()).map(input => describeSourceFailure({ code: 'input-required', input },
      contextFor({ path: `/sources/${index}`, message: '', severity: 'error', failure: { code: 'input-required', source: sourceKey(query.source), input } }).names).message)
  }))

  // ── Plugins in development ───────────────────────────────────────────────────────────────────
  /** Plugins in development mode on this node, from its roster (docs/plugins/dev-loop.md). Each reload
   *  moves `reloadedAt`, which is in the preview's key, so a save shows without pressing refresh. */
  const developingOnNode = createMemo((): DevelopingPlugin[] => (distribution().byNode.get(nodeId)?.rows ?? [])
    .filter(row => row.development?.on)
    .map(row => ({ id: row.name, ...(row.development?.reloadedAt ? { reloadedAt: row.development.reloadedAt } : {}),
      ...(row.state === 'failed' && row.reason ? { failure: row.reason } : {}) })))
  const reloads = () => developingOnNode().map(plugin => `${plugin.id}:${plugin.reloadedAt ?? 0}:${plugin.failure ?? ''}`).join()

  // ── Runs and problems ────────────────────────────────────────────────────────────────────────
  const parsed = createMemo(() => panelPlanSchema.safeParse(plan()))
  /** A draft preview run of a plan, while it has a source and parses. */
  const previewRun = (content: () => PanelPlan | undefined) => createQuery(() => ({
    queryKey: ['dashboard-preview', nodeId, scope.workspaceId, JSON.stringify(content() ?? null), reloads()],
    queryFn: ({ signal }: { signal: AbortSignal }) => client.run({ kind: 'draft', content: copy(content()!) }, 'preview', Intl.DateTimeFormat().resolvedOptions().timeZone, signal),
    enabled: !!content()?.sources.length && panelPlanSchema.safeParse(content()).success,
    staleTime: 0,
  }))
  const preview = previewRun(plan)
  const run = createMemo(() => preview.data ? copy(preview.data) : undefined)
  // The proposal under review runs as its own draft preview, so Before and After switch without a wait.
  const proposedPreview = previewRun(() => store.review()?.merged)
  const proposedRun = createMemo(() => proposedPreview.data ? copy(proposedPreview.data) : undefined)
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
    // A source's failure reads in the words the placed panel uses; anything else names its part.
    return [...schema, ...reported.map(entry => ({ ...entry, message: entry.failure
      ? describeSourceFailure(entry.failure, contextFor({ ...entry, failure: entry.failure }).names).message
      : `${planPartLabel(plan(), entry.path)}: ${entry.message}` }))]
  })
  /** The plugins in development mode this panel reads, and the last run's numbers for their sources. */
  const developing = createMemo(() => {
    const read = new Set([...plan().sources.flatMap(source => source.reference.kind === 'inline' ? [source.reference.content.query.source.pluginId] : []),
      ...run()?.diagnostics.plugins ?? []])
    return developingOnNode().filter(plugin => read.has(plugin.id))
  })
  const developmentSources = createMemo(() => (run()?.diagnostics.sources ?? []).filter(source => source.development))
  const [showingRecords, setShowingRecords] = createSignal(false)
  /** Show records swaps the preview for the dropped records, except while a proposal is under review. */
  const recordsShown = () => showingRecords() && !review() && developing().length > 0
  const [reloadingPlugin, setReloadingPlugin] = createSignal(false)
  const reloadPlugin = async (pluginId: string): Promise<void> => {
    setReloadingPlugin(true)
    try {
      const result = await reloadNodePlugin(pluginId)
      if (result.state === 'failed') store.setProblem(`${pluginId} didn't reload: ${result.reason ?? 'its new version failed to start'}. The previous version is still running.`)
    } catch (error) {
      store.setProblem(`${pluginId} didn't reload: ${error instanceof Error ? error.message : String(error)}`)
    } finally { setReloadingPlugin(false) }
  }
  const selectPath = (path: string, inPlan = plan()): void => {
    const key = partForPath(inPlan, path, inPlan === plan() ? inputs() : outlineInputs())
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
  const parts = createMemo((): PlanPart[] => [...planOutline(plan(), [], inputs()), ...columnParts(plan())])
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
  // The launcher's choice is where editing starts, so it isn't an undo step.
  const start = props.start
  if (start?.kind === 'describe') {
    store.apply(current => ({ ...current, request: start.request }), { derived: true })
    openAi({ instruction: start.request, send: true })
  } else if (start?.starter) store.apply(() => start.starter!, { derived: true })
  else if (start) {
    // The source's default columns arrive once it is described, so the Columns part shows what they are.
    store.apply(current => addSourceTo(current, start.reference), { derived: true })
    select('columns')
  }
  if (props.withAi) openAi()
  const inspectorContext: InspectorContext = {
    plan, change: store.apply, select, workspaceId: scope.workspaceId, run, problems, sources, inputs, failureContext: contextFor,
    ...(props.region ? { region: props.region } : {}),
    askAi: key => { const part = parts().find(entry => entry.key === key); if (part) askAbout(part) },
    refreshQueries: () => void queryClient.invalidateQueries(),
  }
  // Keyed by id rather than by source object, so an edit to one source doesn't remount its picker.
  const sourceIds = createMemo(() => plan().sources.map(source => source.id), undefined, { equals: (a, b) => a.join() === b.join() })

  // ── AI ───────────────────────────────────────────────────────────────────────────────────────
  let dock: HTMLDivElement | undefined
  function openAi(request: AiRequest = {}): void {
    setAiRequest(request)
    setDockStarted(true)
    setDockOpen(true)
    queueMicrotask(() => dock?.querySelector('textarea')?.focus())
  }
  function askAbout(part: PlanPart): void {
    openAi({ instruction: `About ${part.title}: `, focus: { paths: part.paths, title: part.title } })
  }
  const review = store.review
  const reviewDiff = createMemo(() => review() ? diffOutline(plan(), review()!.merged) : undefined)
  /** What the outline and the preview draw: the proposed plan while one is under review. */
  const outlinePlan = () => review()?.merged ?? plan()
  const outlineInputs = createMemo(() => review() ? planInputs(outlinePlan(), catalogSources(), connections()) : inputs())
  const previewPlan = () => review() && showing() === 'after' ? review()!.merged : plan()
  const previewData = () => review() && showing() === 'after' ? proposedRun() : run()
  const onProposal = (proposal: Parameters<typeof store.reviewProposal>[0]): void => {
    setShowing('after')
    store.reviewProposal(proposal)
  }
  /** Applying the proposal under review accepts it, after the Node validates it, as one undo step. */
  const applyAiProposal = async (proposal: Extract<AuthoringTurnResult, { state: 'proposal' }>): Promise<string | undefined> => {
    const current = review()
    if (current?.proposal !== proposal) return 'This panel changed while the proposal was prepared.'
    const result = panelPlanSchema.safeParse(current.merged)
    if (!result.success) return 'The proposed plan does not fit this panel.'
    try { if ((await client.validate(result.data)).problems.length) return 'The proposed plan has source or column problems.' }
    catch { return 'The Node could not validate this proposal.' }
    setUnaddressed(proposal.unaddressed ?? [])
    store.applyReview()
    return undefined
  }
  /** The proposal's requirements, one line each. A line that names plan paths selects its part. */
  const proposalRequirements = () => (
    <For each={review()?.merged.requirements ?? []}>{item => (
      <Row density="compact" leading={<Icon name={REQUIREMENT_ICONS[item.status]} />}
        {...(item.paths?.[0] ? { onPress: () => selectPath(item.paths![0]!, outlinePlan()) } : {})}>
        <Stack gap="none">
          <Text wrap>{`${REQUIREMENT_STATUS_LABELS[item.status]}: ${item.text}`}</Text>
          <Show when={item.status !== 'covered' && item.reason}>{reason => <Text emphasis="muted" wrap>{reason()}</Text>}</Show>
        </Stack>
      </Row>
    )}</For>
  )
  /** Requirements the plan doesn't fully cover, which the publish review warns about. */
  const notCovered = createMemo(() => [
    ...(plan().requirements ?? []).filter(item => item.status !== 'covered')
      .map(item => `${REQUIREMENT_STATUS_LABELS[item.status]}: ${item.text}${item.reason ? ` (${item.reason})` : ''}`),
    ...unaddressed().map(item => `Not covered: ${item}`),
  ])

  // ── Publish ──────────────────────────────────────────────────────────────────────────────────
  const tabs = () => props.scope.surface === 'home' ? homeTabs(dashboards(), props.scope.workspaceId) : []
  const destination = (): PlacementScope => props.scope.surface === 'home' ? homeTabScope(placement(), props.scope.workspaceId) : props.scope
  // Checked when the review opens, by describing each source, so a panel the region would hide is
  // refused before it is published.
  const [regionCheck] = createResource(
    () => reviewing() && props.region && parsed().success ? JSON.stringify(plan()) : undefined,
    async () => regionRefusal(props.region!, plan().view.kind, await describePanelSources(nodeId, scope, plan())),
  )
  // A missing input account is also a run error once the preview runs, so each message shows once.
  const blockers = createMemo(() => [...new Set([
    ...(plan().sources.length ? [] : ['Pick data first.']),
    ...missingAccounts(),
    ...problems().filter(problem => problem.severity === 'error').map(problem => problem.message),
    ...(regionCheck.error ? [] : regionCheck() ? [regionCheck()!] : []),
  ])])
  const publish = async (): Promise<void> => {
    const result = parsed()
    if (!result.success) return
    setPublishing(true)
    try {
      const published = await publishPanelPlan({ nodeId, scope, plan: result.data, region: props.region, flush: store.flush, queryClient, recovery })
      props.onPublished(published.id, plan().title, destination(), plan().view, published.sources, published.fieldRoles)
      props.onClose()
    } catch (error) {
      store.setProblem(publishFailureMessage(error, "Couldn't publish this panel."))
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
      <Show when={review()}><Badge tone="accent">Reviewing AI proposal</Badge></Show>
      <Show when={developing().length}><Badge tone="warn">Source in development</Badge></Show>
      <ToolbarSpacer />
      <Button size="sm" onPress={() => dockOpen() ? setDockOpen(false) : openAi()}><Icon name="sparkles" /> Ask AI</Button>
      <IconButton icon="undo-2" label="Undo" disabled={!store.canUndo()} onPress={store.undo} />
      <IconButton icon="redo-2" label="Redo" disabled={!store.canRedo()} onPress={store.redo} />
      <Button size="sm" variant="solid" opens="dialog" disabled={!plan().sources.length || !!review()} onPress={() => setReviewing(true)}>Publish…</Button>
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
      <Show when={reviewDiff()} fallback={<Show when={unpublished().length}><Text emphasis="muted">{`Unpublished: ${unpublished().join(', ')}`}</Text></Show>}>
        {changes => <Text emphasis="muted">{`Proposal: ${diffSummary(changes()).join(', ') || 'no changes to the panel'}`}</Text>}
      </Show>
      <Show when={notCovered().length}>{count => <Link onPress={() => openAi()}>{`${plural(count(), 'requirement')} not fully covered`}</Link>}</Show>
    </Toolbar>
  )

  // During review the forms show the plan as it is, and take no input until the proposal is applied or
  // discarded.
  const inspector = (
    <aside class="dash-studio-inspector" aria-label="Inspector" hidden={dockOpen()}>
      <Stack gap="stack">
        <Heading level={3}>{addingSource() ? 'Pick data' : selectedPart()?.title ?? 'This panel'}</Heading>
        <Show when={review()}><Text emphasis="muted" wrap>Apply or discard the proposal to keep editing.</Text></Show>
        <div class="dash-studio-forms" inert={!!review()}>
          <Show when={addingSource()}>
            <NewSourceInspector workspaceId={scope.workspaceId} onPick={pickSource}
              {...(plan().sources.length ? { onCancel: () => setAddingSource(false) } : {})} />
          </Show>
          {/* Every source's picker stays mounted, hidden unless selected, because the column and step
              forms read each source's described fields from what its picker reports. */}
          <For each={sourceIds()}>{id => (
            <div class="dash-studio-source" hidden={addingSource() || (store.selected() !== `source:${id}` && !store.selected()?.startsWith(`input:${id}:`))}>
              <SourceInspector context={inspectorContext} part={`source:${id}`} />
            </div>
          )}</For>
          <Show when={!addingSource() && selectedPart()?.key} keyed>{key => (
            <Show when={!key.startsWith('source:') && !key.startsWith('input:')}><Dynamic component={INSPECTORS[partKind(key)]} context={inspectorContext} part={key} /></Show>
          )}</Show>
          <Show when={!addingSource() && !selectedPart()}>
            <Show when={plan().request}>{request => <Text wrap>{request()}</Text>}</Show>
            <Text emphasis="muted" wrap>Select a part of the panel to change it.</Text>
          </Show>
        </div>
      </Stack>
    </aside>
  )

  const empty = <EmptyState title="Choose what this panel shows">Add a source from the outline, or ask AI to build the panel.</EmptyState>

  return (
    <div ref={root} class="dash-studio" role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1" onKeyDown={onKeyDown}>
      {header}
      <DevelopmentStrip plugins={developing()} sources={developmentSources()} showingRecords={showingRecords()} reloading={reloadingPlugin()}
        onShowRecords={() => setShowingRecords(!showingRecords())} onReload={id => void reloadPlugin(id)} onLogs={id => openPluginSettings(id, 'logs')} />
      <Tabs idPrefix="dashboards-studio" ariaLabel="Studio view" active={tab()} onChange={id => setTab(id as 'outline' | 'plan')}
        tabs={[{ id: 'outline', label: 'Outline' }, { id: 'plan', label: 'Plan' }]} />
      <Show when={store.problem()}>{message => <Alert tone="warn">{message()}</Alert>}</Show>
      <div class="dash-studio-body">
        <Show when={tab() === 'outline'} fallback={<div class="dash-studio-code"><CodeBlock copy>{JSON.stringify(plan(), null, 2)}</CodeBlock></div>}>
          <ListDetail split listLabel="Outline">
            <ListColumn>
              <StudioOutline plan={outlinePlan()} inputs={outlineInputs()} stageCounts={(review() ? proposedRun() : run())?.diagnostics.stages ?? []}
                sourceCounts={(review() ? proposedRun() : run())?.diagnostics.sources ?? []}
                problems={review() ? [] : problems()} selected={store.selected()}
                onSelect={select} onAdd={addPart} onMoveStage={moveStage} onRemove={removePart} onAskAi={askAbout}
                {...(reviewDiff() ? { review: { diff: reviewDiff()!, before: plan() } } : {})} />
            </ListColumn>
            <DetailColumn>
              <div class="dash-studio-detail">
                <Show when={recordsShown()} fallback={
                  <Show when={previewPlan().sources.length || review()} fallback={<div class="dash-studio-preview">{empty}</div>}>
                    <StudioPreview plan={previewPlan()} run={previewData()} loading={review() && showing() === 'after' ? proposedPreview.isFetching : preview.isFetching}
                      {...(props.placed ? { placed: props.placed } : {})}
                      onRefresh={() => void (review() && showing() === 'after' ? proposedPreview : preview).refetch()}
                      onSelectPart={key => { if (parts().some(part => part.key === key)) select(key) }}
                      onEditTitle={() => setEditingTitle(true)}
                      {...(review() ? { review: { showing: showing(), onShow: setShowing, ...(run() ? { beforeRows: run()!.rows.length } : {}) } } : {})} />
                  </Show>
                }>
                  <DroppedRecords sources={developmentSources()} onClose={() => setShowingRecords(false)} />
                </Show>
                {inspector}
                <Show when={dockStarted()}>
                  <div class="dash-studio-dock" ref={dock} hidden={!dockOpen()}>
                    <AuthoringConversation layout="dock" onClose={() => setDockOpen(false)} endpoint="/v1/core/authoring/turn" target="dashboard"
                      targetId={store.draft()?.id ?? recoveryId} scope={scope} baseRevision={store.draft()?.draftRevision ?? 0} base={plan()} label={plan().title}
                      {...(aiRequest().instruction ? { instruction: aiRequest().instruction } : {})} {...(aiRequest().focus ? { focus: aiRequest().focus } : {})}
                      sendOnOpen={aiRequest().send} onApply={applyAiProposal} onProposal={onProposal} proposalDetail={proposalRequirements} />
                  </div>
                </Show>
              </div>
            </DetailColumn>
          </ListDetail>
        </Show>
      </div>
      {statusBar}

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
            <Show when={props.scope.surface === 'home' && store.draft()?.publishedRevision == null && tabs().length > 1}
              fallback={<Field label="Where it goes"><Text>{props.returnLabel}</Text></Field>}>
              <LabeledSelect label="Where it goes" value={placement()} options={tabs().map(entry => ({ value: entry.id, label: entry.name }))} onChange={setPlacement} />
            </Show>
            <Show when={developing().length}>
              <Alert tone="warn">This panel reads a source in development. Others will see it change as you edit the plugin.</Alert>
            </Show>
            <Show when={notCovered().length}>
              <Alert tone="warn" title="Not fully covered"><Stack gap="none"><For each={notCovered()}>{item => <Text wrap>{item}</Text>}</For></Stack></Alert>
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
