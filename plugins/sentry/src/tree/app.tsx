import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { Button, EmptyState } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { sentryIssueRoute, type SentryIssueDetail } from '../shared/api'
import { parseSentryRailItemId, type SentryRailTarget } from '../shared/rail'
import { failureReason } from './model'
import { SentryIssueView } from './SentryIssueView'

type PageState =
  | { kind: 'empty'; title: string }
  | { kind: 'loading' }
  | { kind: 'error'; title: string; detail: string; retry: () => void }

/** What the host mounts this tree with: the rail row id of the issue beside the list. */
export type SentryPaneProps = { item?: string }

/** One Sentry issue beside the rail list. The bridge is the only data seam. */
export function SentryPane(props: SentryPaneProps & { bridge: AcornBridge }) {
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
    else setPage({ kind: 'empty', title: 'Choose an issue' })
  })

  return (
    <Show when={issue()} fallback={<PageStatus state={page()} />}>
      {(detail) => (
        <SentryIssueView
          issue={detail()}
          refreshing={refreshing()}
          refreshError={refreshError()}
          onRefresh={() => void load(detail(), true)}
        />
      )}
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
