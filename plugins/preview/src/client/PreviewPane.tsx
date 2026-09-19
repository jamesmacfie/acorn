import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { clientEvents, previewViews } from '@acorn/plugin-api/client'
import { EmptyState, IconButton, Input, Rectangle, Spinner, Text, Toolbar } from '@acorn/plugin-api/ui'

const withScheme = (v: string) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)

// Drop an archived task's preview view (called by every archive path via the runtime event below).
export function evictPreviewWebview(taskId: string): void {
  previewViews()?.evict(taskId)
}

export const activatePreviewEvents = (): (() => void) =>
  clientEvents.on('runtime:task-archived', ({ taskId }) => evictPreviewWebview(taskId))

export default function PreviewPane(props: { taskId: string; url: string | null }) {
  let host!: HTMLElement
  const preview = previewViews()
  const [loading, setLoading] = createSignal(false)
  const [addr, setAddr] = createSignal('')
  const [canBack, setCanBack] = createSignal(false)
  const [canFwd, setCanFwd] = createSignal(false)
  const [suppressed, setSuppressed] = createSignal(false)
  let ensureVersion = 0

  // Where the view was last told to sit. The poll below asks the same question five times a second
  // and the answer is usually the same one, which is not worth a message across the seam.
  let placed = ''

  const syncRect = () => {
    if (!preview || !host) return
    const r = host.getBoundingClientRect()
    const next = `${r.left},${r.top},${r.width},${r.height}`
    if (next === placed) return
    placed = next
    preview.setBounds(props.taskId, { x: r.left, y: r.top, width: r.width, height: r.height })
  }

  const checkOcclusion = () => {
    if (!host) return
    const r = host.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
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
    const offEvent = preview.onEvent((s) => {
      if (s.taskId !== props.taskId) return // only the active view drives the chrome
      setLoading(s.loading)
      setAddr(s.url || props.url || '')
      setCanBack(s.canGoBack)
      setCanFwd(s.canGoForward)
    })
    onCleanup(() => {
      ensureVersion += 1 // invalidate any in-flight ensure before it can re-show this disposed pane
      ro.disconnect()
      clearInterval(poll)
      offEvent()
      preview.hide() // leaving the preview pane hides the native view; main keeps it alive
    })
  })

  // Reconciles the task's shell-owned view against the host element (docs/shell.md § Host-owned
  // webviews covers positioning and hide-on-cover). The shell owns home identity across client
  // remounts, so a changed run target updates the view while an ordinary pane or task switch
  // preserves whatever the user was browsing.
  createEffect(() => {
    const taskId = props.taskId
    const url = props.url
    const covered = suppressed()
    const version = ++ensureVersion
    if (!preview || !host) return
    if (!url) {
      preview.hide()
      return
    }
    if (covered) {
      preview.hide()
    } else {
      syncRect()
    }
    void preview.ensure(taskId, url).then((ready) => {
      if (!ready || version !== ensureVersion) return
      // A view the shell has just created is a 1x1 square in the corner, and the bounds call that
      // ran before `ensure` found no view to move, so this one placement cannot be the one the
      // memo above skips.
      placed = ''
      syncRect()
      if (!suppressed()) preview.show(taskId)
    })
  })

  const go = () => {
    const v = addr().trim()
    if (preview && v) preview.load(props.taskId, withScheme(v))
  }

  return (
    <>
      {/* No "needs the desktop app" fallback: the pane's `requires: { seam: 'preview' }` means a host
          without the seam never offers it (./PreviewTaskPane.tsx). */}
      <Show when={props.url} fallback={
        <EmptyState title="No preview URL yet">
          Declare a run target with a <Text emphasis="mono">url</Text> — in{' '}
          <Text emphasis="mono">.acorn/config.toml</Text> or the workspace's run targets — and start it
          from the pane switcher's ▶ button, or set a preview URL in Settings → workspace.
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
          <IconButton icon="code-xml" label="Toggle preview DevTools" onPress={() => preview?.command(props.taskId, 'devtools')} />
          <Show when={loading()}><Spinner label="Loading page" /></Show>
        </Toolbar>
      </Show>
      {/* A WebContentsView is somebody else's pixels, so it is a rectangle: the kit owns the box and
          the way in and out of it with the keyboard, and the shell positions the view over `mount`. */}
      <Rectangle kind="webview" label="Preview" mount={(element) => { host = element }} />
    </>
  )
}
