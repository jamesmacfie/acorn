import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Button, DetailColumn, EmptyState, ListColumn, ListDetail, Row } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { Task } from '@acorn/protocol/api.ts'
import { sentryIssueRoute, type SentryIssueDetail, type SentryIssueSummary } from '../shared/api'
import { parseSentryRailItemId, type SentryRailTarget } from '../shared/rail'
import { failureReason, targetKey, taskSentryTargets } from './model'
import { SentryIssueView } from './SentryIssueView'

type PageState =
  | { kind: 'empty'; title: string }
  | { kind: 'loading' }
  | { kind: 'error'; title: string; detail: string; retry: () => void }

/** What the host mounts this tree with: the rail row id of the issue beside the list, or the task
 *  whose linked issues the task pane draws. */
export type SentryPaneProps = { taskId?: string; item?: string }

/** One Sentry issue beside the rail list, or a task's linked issues. The bridge is the only data seam. */
export function SentryPane(props: SentryPaneProps & { bridge: AcornBridge }) {
  const [linked, setLinked] = createSignal<SentryRailTarget[]>([])
  // The last read of each linked issue, for the list's titles and counts, keyed by `targetKey`.
  const [summaries, setSummaries] = createSignal<Record<string, SentryIssueSummary>>({})
  const remember = (summary: SentryIssueSummary) =>
    setSummaries((known) => ({ ...known, [targetKey(summary)]: summary }))
  const [issue, setIssue] = createSignal<SentryIssueDetail | null>(null)
  const [page, setPage] = createSignal<PageState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshError, setRefreshError] = createSignal('')
  // A newer read aborts the one before, so a slow answer for the last issue never draws over this one.
  let read = new AbortController()

  const load = async (target: SentryRailTarget, refresh = false): Promise<void> => {
    if (refresh && refreshing()) return
    read.abort()
    read = new AbortController()
    const request = read.signal
    // A refresh keeps the issue on screen and reports a failure above it.
    const keep = refresh && issue() !== null
    setRefreshError('')
    if (keep) setRefreshing(true)
    else {
      setIssue(null)
      setPage({ kind: 'loading' })
    }
    try {
      const detail = await props.bridge.api.get<SentryIssueDetail>(sentryIssueRoute(target.connectionId, target.id))
      remember(detail)
      if (!request.aborted) setIssue(detail)
    } catch (error) {
      if (request.aborted) return
      if (keep) setRefreshError(failureReason(error))
      else
        setPage({
          kind: 'error',
          title: "Couldn't load this issue",
          detail: failureReason(error),
          retry: () => void load(target),
        })
    } finally {
      if (!request.aborted) setRefreshing(false)
    }
  }

  onMount(() => {
    onCleanup(
      props.bridge.onSelect((item) => {
        const target = parseSentryRailItemId(item)
        if (target) void load(target)
      }),
    )
    // The subject comes from the mount props, which are this slot's. The bridge is the bundle's.
    const selected = props.item ? parseSentryRailItemId(props.item) : null
    if (selected) void load(selected)
    else if (props.taskId) void loadTask(props.taskId)
    else setPage({ kind: 'empty', title: 'Choose an issue' })
  })

  const loadTask = async (taskId: string): Promise<void> => {
    let targets: SentryRailTarget[]
    try {
      const tasks = await props.bridge.api.get<Task[]>('/v1/core/tasks')
      targets = taskSentryTargets(tasks.find((task) => task.id === taskId))
    } catch (error) {
      setPage({
        kind: 'error',
        title: "Couldn't load this task",
        detail: failureReason(error),
        retry: () => void loadTask(taskId),
      })
      return
    }
    setLinked(targets)
    const [first, ...rest] = targets
    if (!first) {
      setPage({ kind: 'empty', title: 'This task has no Sentry issues' })
      return
    }
    // The first is drawn, and the rest are read for the list's counts. A row that fails to read keeps
    // its id, and picking it says why.
    for (const target of rest) {
      props.bridge.api.get<SentryIssueDetail>(sentryIssueRoute(target.connectionId, target.id)).then(remember, () => {})
    }
    await load(first)
  }

  const body = () => (
    <Show when={issue()} fallback={<PageStatus state={page()} />}>
      {(detail) => (
        <SentryIssueView
          issue={detail()}
          refreshing={refreshing()}
          refreshError={refreshError()}
          onRefresh={() => void load(detail(), true)}
          onOpen={(url) => void props.bridge.ui.openUrl(url)}
        />
      )}
    </Show>
  )

  // A task linking several issues gets a list column, as Rollbar's task pane does. `split` with two
  // column nodes, because a tree's props are JSON and can't carry an element.
  return (
    <Show when={linked().length > 1} fallback={body()}>
      <ListDetail split listWidth="narrow" selection={issue() ? targetKey(issue()!) : null}>
        <ListColumn label="Linked Sentry issues">
          <For each={linked()}>
            {(target) => {
              const known = () => summaries()[targetKey(target)]
              return (
                <Row
                  density="compact"
                  selected={issue() ? targetKey(issue()!) === targetKey(target) : false}
                  onPress={() => void load(target)}
                  meta={known()?.count.toLocaleString()}
                  tip={known()?.title}
                >
                  {known()?.title ?? target.id}
                </Row>
              )
            }}
          </For>
        </ListColumn>
        <DetailColumn scroll>{body()}</DetailColumn>
      </ListDetail>
    </Show>
  )
}

// `Show`s, not a ternary: a component body runs once, so a ternary would stay on whichever state the
// pane mounted with (plugins/rollbar/src/tree/app.tsx says more).
function PageStatus(props: { state: PageState }) {
  const failure = () => (props.state.kind === 'error' ? props.state : undefined)
  const empty = () => (props.state.kind === 'empty' ? props.state : undefined)
  return (
    <Show
      when={failure()}
      fallback={
        <Show
          when={empty()}
          fallback={
            <EmptyState busy align="start" size="sm">
              Loading…
            </EmptyState>
          }
        >
          {(state) => <EmptyState title={state().title} />}
        </Show>
      }
    >
      {(error) => (
        <EmptyState title={error().title}>
          {error().detail}{' '}
          {/* A child, not `action`: a tree's props are JSON, so an element-valued prop never arrives. */}
          <Button size="sm" variant="ghost" onPress={error().retry}>
            Try again
          </Button>
        </EmptyState>
      )}
    </Show>
  )
}
