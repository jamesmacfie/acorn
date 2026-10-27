import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import {
  activeNodeId,
  elementRectKey,
  latestSignal,
  observeNativePage,
  previewViews,
  toast,
  visibleElementRect,
} from '@acorn/plugin-api/client'
import type { PreviewBlockedReason } from '@acorn/plugin-api/client'
import { Alert, Button, EmptyState, IconButton, Input, Rectangle, Spinner, Toolbar } from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import {
  PREVIEW_TOOLBAR_ACTIONS_POINT,
  type PreviewReloadPayload,
  type PreviewToolbarProps,
  type PreviewToolbarResult,
} from '../contract/toolbarActions'

const withScheme = (v: string) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)

export default function PreviewPane(props: {
  taskId: string
  projectId?: string
  url: string | null
  remoteBlocked: boolean
  /** Why nothing is loaded, when `remoteBlocked`. The default is a computer that can't show a remote page. */
  blockedReason?: PreviewBlockedReason | null
  /** An address the page tried to open and the shell refused, such as a link off the app. */
  blockedNavigation?: string | null
  resolving?: boolean
  resolutionFailed?: boolean
  retryResolution?: () => void
}) {
  let host!: HTMLElement
  const preview = previewViews()
  const [loading, setLoading] = createSignal(false)
  const [addr, setAddr] = createSignal('')
  // The page the native view last reported. `addr` is the address box, which the person edits, so a
  // contributor's `expectedUrl` is checked against this instead.
  const [pageUrl, setPageUrl] = createSignal('')
  const [canBack, setCanBack] = createSignal(false)
  const [canFwd, setCanFwd] = createSignal(false)
  const [suppressed, setSuppressed] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [retry, setRetry] = createSignal(0)
  type Request = { taskId: string; url: string; signal: AbortSignal }
  const [requested, setRequested] = createSignal<Request | null>(null)
  let attempted: Request | undefined
  // The page request. A newer one, or unmounting, aborts it.
  const ensuring = latestSignal()

  // Geometry changes cross the seam only when the visible rectangle changes.
  let placed = ''

  const syncRect = () => {
    if (!preview || !host) return
    const r = visibleElementRect(host)
    const next = elementRectKey(r)
    if (next === placed) return
    placed = next
    preview.setBounds(props.taskId, r)
  }

  onMount(() => {
    if (!preview) return
    const stopPage = observeNativePage(host, (rect, covered) => {
      setSuppressed(covered)
      const next = elementRectKey(rect)
      if (next !== placed) {
        placed = next
        preview.setBounds(props.taskId, rect)
      }
    })
    const offEvent = preview.onEvent((s) => {
      if (s.taskId !== props.taskId) return // only the active view drives the chrome
      setLoading(s.loading)
      setAddr(s.url)
      setPageUrl(s.url)
      setCanBack(s.canGoBack)
      setCanFwd(s.canGoForward)
    })
    onCleanup(() => {
      ensuring.abort() // invalidate any in-flight ensure before it can re-show this disposed pane
      stopPage()
      offEvent()
    })
  })

  // Capture the outgoing task before props change. Cleanup never hides another task's page.
  createEffect(() => {
    const taskId = props.taskId
    setAddr('')
    setPageUrl('')
    setCanBack(false)
    setCanFwd(false)
    onCleanup(() => preview?.hide(taskId))
  })

  // Visibility does not reconcile a target or retry a failed navigation.
  createEffect(() => {
    const taskId = props.taskId
    if (ready() && props.url && !props.remoteBlocked && !props.resolutionFailed && !suppressed()) {
      placed = ''
      syncRect()
      preview?.show(taskId)
    } else {
      preview?.hide(taskId)
    }
  })

  createEffect(() => {
    const taskId = props.taskId
    const url = props.url
    const blocked = props.remoteBlocked
    const resolving = props.resolving
    const resolutionFailed = props.resolutionFailed
    retry()
    const signal = ensuring.next()
    setRequested(null)
    setReady(false)
    setFailed(false)
    if (!preview || !host) return
    if (blocked) {
      preview.evict(taskId)
      return
    }
    // A configuration read is not an instruction to reset a retained page.
    if (!url || resolving || resolutionFailed) return
    setRequested({ taskId, url, signal })
  })

  createEffect(() => {
    const request = requested()
    if (!preview || !request || suppressed() || attempted === request) return
    attempted = request
    const { taskId, url, signal } = request
    void preview
      .ensure(taskId, url)
      .then((accepted) => {
        if (signal.aborted) return
        setFailed(!accepted)
        setReady(accepted)
      })
      .catch(() => {
        if (!signal.aborted) setFailed(true)
      })
  })

  const go = () => {
    const v = addr().trim()
    if (preview && v) preview.load(props.taskId, withScheme(v))
  }

  // Another plugin's Reload (docs/plugins/toolbar-actions.md). It asks for the page it drew beside, by
  // address, and Preview checks that page is still the one on screen, in the task and on the Node the
  // contributor was mounted for. Then it presses Preview's own reload, so a contributor can't navigate.
  const reloadFor =
    (taskId: string, nodeId: string | null) =>
    (payload: unknown, invocation: { byPerson: boolean }): PreviewToolbarResult => {
      if (!invocation.byPerson) return { ok: false, reason: 'needs_person' }
      if (!preview || props.remoteBlocked || !ready()) return { ok: false, reason: 'unsupported' }
      const expected = (payload as Partial<PreviewReloadPayload> | null)?.expectedUrl
      if (taskId !== props.taskId || nodeId !== activeNodeId() || !pageUrl() || expected !== pageUrl())
        return { ok: false, reason: 'changed' }
      preview.command(taskId, 'reload')
      return { ok: true }
    }

  const copy = (address: string) => {
    void navigator.clipboard.writeText(address)
    toast('Copied the page address')
  }

  return (
    <>
      {/* No "needs the desktop app" fallback: the pane's `requires: { seam: 'preview' }` means a host
          without the seam never offers it (./PreviewTaskPane.tsx). */}
      <Show when={props.remoteBlocked && props.blockedReason === 'not-loopback'}>
        <EmptyState title="This address isn't an app on the Node">
          acorn shows another computer's app only when its address is plain http on that computer's own localhost, such
          as http://localhost:5173. Change the address in the project's Preview settings.
        </EmptyState>
      </Show>
      <Show when={props.remoteBlocked && props.blockedReason !== 'not-loopback'}>
        <EmptyState title="Preview works on this computer only">
          A page from another computer could reach your local network, and acorn can keep it from doing that only on a
          Mac. Open acorn on that computer to preview it.
        </EmptyState>
      </Show>
      <Show when={!props.remoteBlocked && (failed() || props.resolutionFailed)}>
        <EmptyState title="Could not open the preview">
          Check the preview URL and available browser capacity, then retry.
          <Button onPress={() => (props.resolutionFailed ? props.retryResolution?.() : setRetry((value) => value + 1))}>
            Retry preview
          </Button>
        </EmptyState>
      </Show>
      <Show when={!props.remoteBlocked && props.resolving && !props.url}>
        <Spinner label="Resolving preview URL" />
      </Show>
      <Show
        when={!props.remoteBlocked && !failed() && !props.resolutionFailed && props.url}
        fallback={
          props.remoteBlocked || props.resolving || failed() || props.resolutionFailed ? null : (
            <EmptyState title="No preview address">
              Start the app from the pane switcher's run button, or set an address in the project's Preview settings.
            </EmptyState>
          )
        }
      >
        {/* The browser chrome, as the kit's toolbar rather than a flex row of this plugin's own:
            the address box is an `Input`, so it takes the reader's style pack like every other box
            in the app. */}
        <Toolbar ariaLabel="Preview">
          <IconButton
            icon="chevron-left"
            label="Back"
            disabled={!canBack()}
            onPress={() => preview?.command(props.taskId, 'back')}
          />
          <IconButton
            icon="chevron-right"
            label="Forward"
            disabled={!canFwd()}
            onPress={() => preview?.command(props.taskId, 'forward')}
          />
          <IconButton
            icon={loading() ? 'x' : 'rotate-cw'}
            label={loading() ? 'Stop loading the page' : 'Reload the page'}
            onPress={() => preview?.command(props.taskId, loading() ? 'stop' : 'reload')}
          />
          <IconButton
            icon="house"
            label="Go to the app's start page"
            onPress={() => props.url && preview?.load(props.taskId, props.url)}
          />
          <Input
            size="sm"
            label="Preview address"
            assist={false}
            value={addr()}
            onInput={(value) => setAddr(value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') go()
            }}
          />
          <IconButton icon="copy" label="Copy page address" disabled={!addr()} onPress={() => copy(addr())} />
          <IconButton
            icon="code-xml"
            label="Show developer tools"
            onPress={() => preview?.command(props.taskId, 'devtools')}
          />
          {/* Other plugins' controls, after Preview's own and before the spinner, so the spinner
              coming and going doesn't move them. Keyed on the task, so a task switch remounts them
              and a contributor's action can't land on the next task's page. */}
          <Show when={props.taskId} keyed>
            {(taskId) => {
              // Read once, at mount. Inside the JSX it would be read again at every call.
              const reload = reloadFor(taskId, activeNodeId())
              return (
                <Slot
                  point={PREVIEW_TOOLBAR_ACTIONS_POINT}
                  taskId={taskId}
                  projectId={props.projectId ?? null}
                  props={(): PreviewToolbarProps => ({
                    taskId,
                    ...(props.projectId ? { projectId: props.projectId } : {}),
                    ...(pageUrl() ? { url: pageUrl() } : {}),
                    loading: loading(),
                    canGoBack: canBack(),
                    canGoForward: canFwd(),
                  })}
                  actions={{ reload }}
                />
              )
            }}
          </Show>
          <Show when={loading()}>
            <Spinner label="Loading page" />
          </Show>
        </Toolbar>
      </Show>
      <Show when={!props.remoteBlocked && props.url && props.blockedNavigation}>
        {(address) => (
          <Alert
            tone="warn"
            variant="banner"
            actions={<IconButton icon="copy" label="Copy the blocked address" onPress={() => copy(address())} />}
          >
            The page tried to open {address()}, which isn't part of the app, so acorn didn't load it.
          </Alert>
        )}
      </Show>
      {/* A WebContentsView is somebody else's pixels, so it is a rectangle: the kit owns the box and
          the way in and out of it with the keyboard, and the shell positions the view over `mount`. */}
      <Rectangle
        kind="webview"
        label="Preview"
        hidden={props.remoteBlocked || !props.url || failed() || props.resolutionFailed}
        mount={(element) => {
          host = element
        }}
      />
    </>
  )
}
