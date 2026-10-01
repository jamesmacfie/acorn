import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { elementRectKey, previewViews, toast, visibleElementRect } from '@acorn/plugin-api/client'
import { Button, EmptyState, IconButton, Input, Rectangle, Spinner, Text, Toolbar } from '@acorn/plugin-api/ui'

const withScheme = (v: string) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)

export default function PreviewPane(props: {
  taskId: string
  url: string | null
  remoteBlocked: boolean
  resolving?: boolean
  resolutionFailed?: boolean
  retryResolution?: () => void
}) {
  let host!: HTMLElement
  const preview = previewViews()
  const [loading, setLoading] = createSignal(false)
  const [addr, setAddr] = createSignal('')
  const [canBack, setCanBack] = createSignal(false)
  const [canFwd, setCanFwd] = createSignal(false)
  const [suppressed, setSuppressed] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [retry, setRetry] = createSignal(0)
  type Request = { taskId: string; url: string; version: number }
  const [requested, setRequested] = createSignal<Request | null>(null)
  let attempted: Request | undefined
  let ensureVersion = 0

  // Where the view was last told to sit. The poll below asks the same question five times a second
  // and the answer is usually the same one, which is not worth a message across the seam.
  let placed = ''

  const syncRect = () => {
    if (!preview || !host) return
    const r = visibleElementRect(host)
    const next = elementRectKey(r)
    if (next === placed) return
    placed = next
    preview.setBounds(props.taskId, r)
  }

  const checkOcclusion = () => {
    if (!host) return
    const r = visibleElementRect(host)
    if (r.width === 0 || r.height === 0) return setSuppressed(true)
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    setSuppressed(!(top === host || host.contains(top)))
  }

  onMount(() => {
    if (!preview) return
    const ro = new ResizeObserver(() => {
      syncRect()
      checkOcclusion()
    })
    // The box and the page. A window resize moves the box in viewport coordinates even when the box
    // itself does not change size, and the shell positions the view in those coordinates — so the
    // page is observed too, in place of the `window` resize listener this used to carry.
    ro.observe(host)
    ro.observe(document.documentElement)
    // Size is observed above; nothing reports that the box has *moved*. An ancestor scrolling, a
    // fixed rail arriving beside the panes, a stylesheet landing a frame late in dev — each leaves
    // the view sitting where the box used to be, and somebody else's pixels over the tab rails is
    // what that looks like. So the question is asked again on the tick the occlusion check already
    // runs on. The ceiling is a fifth of a second of lag behind a fast drag, and the observer above
    // still covers everything that does change size.
    const poll = setInterval(() => {
      syncRect()
      checkOcclusion()
    }, 200)
    checkOcclusion()
    const offEvent = preview.onEvent((s) => {
      if (s.taskId !== props.taskId) return // only the active view drives the chrome
      setLoading(s.loading)
      setAddr(s.url)
      setCanBack(s.canGoBack)
      setCanFwd(s.canGoForward)
    })
    onCleanup(() => {
      ensureVersion += 1 // invalidate any in-flight ensure before it can re-show this disposed pane
      ro.disconnect()
      clearInterval(poll)
      offEvent()
    })
  })

  // Capture the outgoing task before props change. Cleanup never hides another task's page.
  createEffect(() => {
    const taskId = props.taskId
    setAddr('')
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
    const version = ++ensureVersion
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
    setRequested({ taskId, url, version })
  })

  createEffect(() => {
    const request = requested()
    if (!preview || !request || suppressed() || attempted === request) return
    attempted = request
    const { taskId, url, version } = request
    void preview.ensure(taskId, url).then((accepted) => {
      if (version !== ensureVersion) return
      setFailed(!accepted)
      setReady(accepted)
    }).catch(() => {
      if (version === ensureVersion) setFailed(true)
    })
  })

  const go = () => {
    const v = addr().trim()
    if (preview && v) preview.load(props.taskId, withScheme(v))
  }

  const copyAddr = () => {
    void navigator.clipboard.writeText(addr())
    toast('Copied the page address')
  }

  return (
    <>
      {/* No "needs the desktop app" fallback: the pane's `requires: { seam: 'preview' }` means a host
          without the seam never offers it (./PreviewTaskPane.tsx). */}
      <Show when={props.remoteBlocked}>
        <EmptyState title="Preview unavailable on remote Nodes">
          A page loaded here could reach services on this computer's network. Run Acorn on the Node
          machine to inspect its preview.
        </EmptyState>
      </Show>
      <Show when={!props.remoteBlocked && (failed() || props.resolutionFailed)}>
        <EmptyState title="Could not open the preview">
          Check the preview URL and available browser capacity, then retry.
          <Button onPress={() => props.resolutionFailed ? props.retryResolution?.() : setRetry((value) => value + 1)}>Retry preview</Button>
        </EmptyState>
      </Show>
      <Show when={!props.remoteBlocked && props.resolving && !props.url}><Spinner label="Resolving preview URL" /></Show>
      <Show when={!props.remoteBlocked && !failed() && !props.resolutionFailed && props.url} fallback={props.remoteBlocked || props.resolving || failed() || props.resolutionFailed ? null :
        <EmptyState title="No preview URL yet">
          Start the run target from the pane switcher's ▶ button. If it is already running, check its{' '}
          <Text emphasis="mono">url</Text> in <Text emphasis="mono">.acorn/config.toml</Text> or the
          preview URL in Settings → workspace.
        </EmptyState>
      }>
        {/* The browser chrome, as the kit's toolbar rather than a flex row of this plugin's own:
            the address box is an `Input`, so it takes the reader's style pack like every other box
            in the app instead of the three rules this plugin used to ship for it. */}
        <Toolbar ariaLabel="Preview">
          <IconButton icon="chevron-left" label="Back" disabled={!canBack()} onPress={() => preview?.command(props.taskId, 'back')} />
          <IconButton icon="chevron-right" label="Forward" disabled={!canFwd()} onPress={() => preview?.command(props.taskId, 'forward')} />
          <IconButton
            icon={loading() ? 'x' : 'rotate-cw'}
            label={loading() ? 'Stop loading the page' : 'Reload the page'}
            onPress={() => preview?.command(props.taskId, loading() ? 'stop' : 'reload')}
          />
          <IconButton icon="house" label="Back to the run target's URL" onPress={() => props.url && preview?.load(props.taskId, props.url)} />
          <Input
            size="sm"
            label="Preview address"
            assist={false}
            value={addr()}
            onInput={(value) => setAddr(value)}
            onKeyDown={(event) => { if (event.key === 'Enter') go() }}
          />
          <IconButton icon="copy" label="Copy the page address" disabled={!addr()} onPress={copyAddr} />
          <IconButton icon="code-xml" label="Toggle preview DevTools" onPress={() => preview?.command(props.taskId, 'devtools')} />
          <Show when={loading()}><Spinner label="Loading page" /></Show>
        </Toolbar>
      </Show>
      {/* A WebContentsView is somebody else's pixels, so it is a rectangle: the kit owns the box and
          the way in and out of it with the keyboard, and the shell positions the view over `mount`. */}
      <Rectangle kind="webview" label="Preview" hidden={props.remoteBlocked || !props.url || failed() || props.resolutionFailed} mount={(element) => { host = element }} />
    </>
  )
}
