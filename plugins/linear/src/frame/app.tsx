import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Alert, EmptyState, ListDetail, renderMarkdown, Row } from '@acorn/plugin-api/ui'
import { openLinkOnClick, type AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { Task } from '@acorn/protocol/api.ts'
import {
  linearCommentsRoute,
  linearIssueRoute,
  linearUploadRoute,
  type LinearIssueDetail,
  type LinearUploadResponse,
} from '../shared/api'
import { parseLinearRailItemId, type LinearRailTarget } from '../shared/rail'
import { canonicalIdentifier, linearIdentifierFromHref, targetKey, taskLinearTargets } from './model'
import { LinearIssueView } from './LinearIssueView'
import { inlineUploadImages, uploadImageUrls } from './uploads'

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
  // Private Linear uploads, keyed by their https URL, resolved to `data:` URLs the frame's CSP allows.
  // Cumulative across tickets on purpose: it is a pure URL→bytes map, the URLs are content-addressed by
  // Linear, and re-pointing the view at a related ticket and back should not refetch the screenshots.
  const [images, setImages] = createSignal<Record<string, string>>({})
  let load = 0

  const activeIdentifier = () => override() ?? target()?.identifier ?? ''

  /**
   * Resolve every upload this ticket draws, in ONE state write.
   *
   * The batch matters more than it looks. Each resolution changes `renderBody`, which changes an
   * `innerHTML`, and an innerHTML rewrite drops whatever the reader had selected in that block. Writing
   * the map once per ticket means one rewrite; writing it per image means one per screenshot.
   *
   * Fire-and-forget beside the detail render rather than in front of it: the text is the thing someone
   * opened the ticket for, and it should not wait on a picture.
   */
  const resolveImages = async (detail: LinearIssueDetail, connectionId?: string): Promise<void> => {
    const known = images()
    const wanted = uploadImageUrls([detail.description ?? '', ...detail.comments.map((entry) => entry.body)].join('\n'))
      .filter((url) => !known[url])
    if (!wanted.length) return
    const fetched = await Promise.all(wanted.map(async (url) => {
      try {
        const body = await props.bridge.api.get<LinearUploadResponse>(linearUploadRoute(url, connectionId))
        return [url, body.dataUrl] as const
      } catch {
        // A single unreachable upload is not worth an error banner over a ticket that otherwise read
        // fine. It stays an unresolved https URL, which the CSP shows as a broken image.
        return null
      }
    }))
    const resolved = fetched.filter((entry): entry is NonNullable<typeof entry> => !!entry)
    if (resolved.length) setImages((prev) => ({ ...prev, ...Object.fromEntries(resolved) }))
  }

  /** Markdown to HTML, with this ticket's private uploads swapped in. Reactive through `images()`. */
  const renderBody = (markdown: string): string => renderMarkdown(inlineUploadImages(markdown, images()))

  const fetchIssue = async (identifier: string, connectionId?: string): Promise<void> => {
    const request = ++load
    setPage({ kind: 'loading' })
    try {
      const detail = await props.bridge.api.get<LinearIssueDetail>(linearIssueRoute(identifier, connectionId))
      if (request !== load) return
      setIssue(detail)
      void resolveImages(detail, connectionId)
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

  // Every link in rendered content, in the order the two answers are worth trying.
  //
  // A linear.app ticket link is kept LOCAL rather than handed to the host, and that is a real preference
  // rather than a leftover. Going through `ui.openUrl` would work — the host's recogniser claims the URL
  // and this frame is what it would resolve into — but the trip is lossy in both directions: from a ref
  // panel it swaps the panel and remounts the frame, throwing away the tab and the scroll position and
  // the back affordance; from the project surface there is no task, so the pane rung cannot fire and the
  // reader gets an overlay on top of the surface they are already reading the ticket in. Re-pointing in
  // place keeps `override`, which is what makes "← back" mean anything.
  //
  // Everything else goes over the port. The host resolves it in-app if some provider recognises it — a
  // GitHub PR in a ticket description, another provider's item — and opens the owner's browser if not.
  // Which of those happened is deliberately not reported back.
  const onContentClick = (event: MouseEvent): void => {
    const identifier = linearIdentifierFromHref((event.target as HTMLElement | null)?.closest('a')?.getAttribute('href'))
    if (identifier) {
      event.preventDefault()
      return openRelated(identifier)
    }
    openLinkOnClick(props.bridge, event)
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
      {/* The mark inlined, not an <Icon name="brand:linear" />: this frame is a separate origin and a
          separate JS realm, so the host's brand-mark registry is not reachable from here. Same path
          data as the manifest's `icon`, and `currentColor` still lets .ln-brand-mark colour it. */}
        <span class="ln-brand-mark">
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
          </svg>
        </span>
        <strong class="ln-brand">Linear</strong>
      </header>
      {/* The ticket switcher for a task linking several is ListDetail's list column. It is the app
          shell's concern rather than the view's, and the ref-panel contract's own multi-ref chip strip
          does not cross the port — no single-ref host needs it, and this is where a multi-ticket TASK
          gets one anyway. */}
      <ListDetail
        class="ln-layout"
        listWidth="narrow"
        listLabel="Linked Linear issues"
        listClass="ln-targets"
        detailClass="ln-content"
        detailAs="main"
        scrollDetail
        list={linked().length > 1
          ? (
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
          )
          : undefined}
      >
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
              onContentClick={onContentClick}
              renderBody={renderBody}
              onComment={(body, parentId) => void comment(body, parentId)}
              onCopy={(text) => void copy(text)}
            />
          )}
        </Show>
      </ListDetail>
    </div>
  )
}

function PageStatus(props: { state: Page }) {
  return props.state.kind === 'error'
    ? (
      <Alert variant="banner" title={props.state.title}>{props.state.detail}</Alert>
    )
    : (
      <EmptyState busy={props.state.kind === 'loading'}>
        {props.state.kind === 'loading' ? 'Loading Linear…' : props.state.kind === 'empty' ? props.state.message : ''}
      </EmptyState>
    )
}
