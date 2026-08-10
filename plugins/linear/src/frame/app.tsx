import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Row, Spinner } from '@acorn/plugin-api/ui'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { Task } from '@acorn/protocol/api.ts'
import { linearCommentsRoute, linearIssueRoute, type LinearIssueDetail } from '../shared/api'
import { parseLinearRailItemId, type LinearRailTarget } from '../shared/rail'
import { canonicalIdentifier, targetKey, taskLinearTargets } from './model'
import { LinearIssueView } from './LinearIssueView'

// One bundle, two manifest surfaces. What it renders is decided by `bridge.context`, which is the whole
// point of the frame contract: the HOST says what this rectangle was opened to look at, and the plugin
// never gets to name a surface, a node or a task.
//
//   refPanel   `context.refId` — a ticket another plugin found in its own content. Unscoped by design:
//              a PR body carries `ENG-42` and not which of several connected Linears owns it, so the
//              connection stays absent and the route resolves it across all of them.
//   pane       `context.item` when a rail row opened it, `context.taskId` otherwise — in which case the
//              tickets are whatever this task links, read once from core.
//
// Both pane surfaces — the task one and the project-scoped one — come through the same branch, and they do
// not need telling apart beyond what `context` already says. The project surface arrives with an `item` and
// no `taskId`, so it takes the same path a rail selection into a task pane takes; the difference is only
// that its selection comes from the URL, which is the HOST's problem and never reaches here.
//
// A selection into an ALREADY-mounted pane arrives as `onSelect` rather than a new context, because
// remounting per click would throw away everything drawn so far.

type Target = { connectionId?: string; identifier: string }

type Page =
  | { kind: 'empty'; message: string }
  | { kind: 'loading' }
  | { kind: 'error'; title: string; detail: string }

const detailOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

export function LinearFrameApp(props: { bridge: AcornBridge }) {
  const [linked, setLinked] = createSignal<LinearRailTarget[]>([])
  const [target, setTarget] = createSignal<Target | null>(null)
  const [issue, setIssue] = createSignal<LinearIssueDetail | null>(null)
  const [page, setPage] = createSignal<Page>({ kind: 'loading' })
  const [activeTab, setActiveTab] = createSignal('overview')
  // A relation row re-points the detail request without disturbing which ticket the HOST opened, so the
  // back affordance has somewhere to return to and a later `onSelect` still lands on the host's choice.
  const [override, setOverride] = createSignal<string | null>(null)
  const [refreshing, setRefreshing] = createSignal(false)
  const [posting, setPosting] = createSignal(false)
  const [postError, setPostError] = createSignal('')
  let load = 0

  const activeIdentifier = () => override() ?? target()?.identifier ?? ''

  const fetchIssue = async (identifier: string, connectionId?: string): Promise<void> => {
    const request = ++load
    setPage({ kind: 'loading' })
    try {
      const detail = await props.bridge.api.get<LinearIssueDetail>(linearIssueRoute(identifier, connectionId))
      if (request !== load) return
      setIssue(detail)
    } catch (error) {
      if (request !== load) return
      setIssue(null)
      setPage({ kind: 'error', title: 'Could not load this Linear ticket.', detail: detailOf(error) })
    }
  }

  /** Point the whole view at a ticket the HOST named: clears the relation override and the tab. */
  const open = (next: Target): void => {
    setOverride(null)
    setActiveTab('overview')
    setPostError('')
    setTarget(next)
    void fetchIssue(canonicalIdentifier(next.identifier), next.connectionId)
  }

  const openRelated = (identifier: string): void => {
    setOverride(canonicalIdentifier(identifier))
    setActiveTab('overview')
    void fetchIssue(canonicalIdentifier(identifier), target()?.connectionId)
  }

  const refresh = async (): Promise<void> => {
    if (refreshing()) return
    setRefreshing(true)
    try {
      await fetchIssue(activeIdentifier(), target()?.connectionId)
    } finally {
      setRefreshing(false)
    }
  }

  const comment = async (body: string, parentId?: string): Promise<void> => {
    setPosting(true)
    setPostError('')
    try {
      await props.bridge.api.post(linearCommentsRoute(activeIdentifier(), target()?.connectionId), { body, parentId })
      await fetchIssue(activeIdentifier(), target()?.connectionId)
    } catch (error) {
      setPostError(detailOf(error) || 'Failed to add comment.')
    } finally {
      setPosting(false)
    }
  }

  const copy = async (text: string): Promise<void> => {
    await props.bridge.ui.copy(text)
    void props.bridge.ui.toast('Copied to the clipboard')
  }

  onMount(() => {
    const off = props.bridge.onSelect((item) => {
      const selected = parseLinearRailItemId(item)
      // A rail row is `<connection>:<identifier>`; a content link delivers a bare path segment, which is
      // not that shape. Both arrive on this one channel, so both have to be accepted here.
      open(selected ?? { identifier: item })
    })
    onCleanup(off)

    void (async () => {
      const context = props.bridge.context
      // A ref panel is told exactly one thing and needs nothing else — in particular no task, which is
      // why the host's binding does not give a refPanel frame one.
      if (context.refId) return open({ identifier: context.refId })
      if (context.item) {
        const selected = parseLinearRailItemId(context.item)
        return open(selected ?? { identifier: context.item })
      }
      // No task and no item: the project-scoped surface, sitting beside the rail list with nothing
      // addressed yet. `taskId` is what tells the two pane surfaces apart, because the host gives one to a
      // task pane and never to a project-scoped one — the frame does not get to ask which it is.
      if (!context.taskId) {
        return setPage({ kind: 'empty', message: 'Pick an issue from the list.' })
      }
      try {
        const tasks = await props.bridge.api.get<Task[]>('/v2/core/tasks')
        const targets = taskLinearTargets(tasks.find((task) => task.id === context.taskId))
        setLinked(targets)
        const first = targets[0]
        if (first) return open(first)
        setPage({
          kind: 'empty',
          message: 'No Linear issues are linked to this task. Pick one from the Linear rail, or use +TASK to attach it.',
        })
      } catch (error) {
        setPage({ kind: 'error', title: 'Could not read this task.', detail: detailOf(error) })
      }
    })()
  })

  return (
    <div class="ln-app">
      <header class="ln-brandbar">
        <span class="ln-brand-mark">◷</span>
        <strong class="ln-brand">Linear</strong>
      </header>
      <div class="ln-layout">
        {/* The ticket switcher for a task linking several. It is the app shell's concern rather than the
            view's, and the ref-panel contract's own multi-ref chip strip does not cross the port — no
            single-ref host needs it, and this is where a multi-ticket TASK gets one anyway. */}
        <Show when={linked().length > 1}>
          <aside class="ln-targets" aria-label="Linked Linear issues">
            <For each={linked()}>
              {(entry) => (
                <Row
                  class="ln-target"
                  density="compact"
                  selected={target() ? targetKey(target()!) === targetKey(entry) : false}
                  onActivate={() => open(entry)}
                >
                  {entry.identifier}
                </Row>
              )}
            </For>
          </aside>
        </Show>
        <main class="ln-content">
          <Show when={issue()} fallback={<PageStatus state={page()} />}>
            {(detail) => (
              <LinearIssueView
                issue={detail()}
                activeTab={activeTab()}
                refreshing={refreshing()}
                posting={posting()}
                postError={postError()}
                overridden={!!override()}
                onTab={setActiveTab}
                onRefresh={() => void refresh()}
                onBack={() => {
                  const current = target()
                  if (current) open(current)
                }}
                onOpenRelated={openRelated}
                onComment={(body, parentId) => void comment(body, parentId)}
                onCopy={(text) => void copy(text)}
              />
            )}
          </Show>
        </main>
      </div>
    </div>
  )
}

function PageStatus(props: { state: Page }) {
  return props.state.kind === 'error'
    ? (
      <div class="ln-error" role="alert">
        <strong>{props.state.title}</strong>
        <span>{props.state.detail}</span>
      </div>
    )
    : (
      <div class="ln-placeholder">
        <Show when={props.state.kind === 'loading'} fallback={<span>{props.state.kind === 'empty' ? props.state.message : ''}</span>}>
          <Spinner label="Loading Linear" />
        </Show>
      </div>
    )
}
