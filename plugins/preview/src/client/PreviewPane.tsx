import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { clientEvents, previewViews } from '@acorn/plugin-api/client'
import { Button, EmptyState, Input, Rectangle, Spinner, Toolbar } from '@acorn/plugin-api/ui'

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

  const syncRect = () => {
    if (!preview || !host) return
    const r = host.getBoundingClientRect()
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
    ro.observe(host)
    const onResize = () => {
      syncRect()
      checkOcclusion()
    }
    window.addEventListener('resize', onResize)
    const poll = setInterval(checkOcclusion, 200)
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
      window.removeEventListener('resize', onResize)
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
      syncRect()
      if (!suppressed()) preview.show(taskId)
    })
  })

  const go = () => {
    const v = addr().trim()
    if (preview && v) preview.load(props.taskId, withScheme(v))
  }

  return (
    <section class="pane workspace-preview" style={{ 'grid-column': '1 / 3' }}>
      <Show when={preview} fallback={
        <EmptyState title="The browser preview needs the desktop app">
          Server-backed panes (PR review, workspaces, tasks) work in browser mode, but the preview
          surface is a desktop-only capability.
        </EmptyState>
      }>
        <Show when={props.url} fallback={
          <EmptyState title="No preview URL yet">
            Declare a run target with a <code>url</code> (in <code>.acorn/config.toml</code> or the
            workspace's run targets) and start it from the pane switcher's ▶ button, or set a preview
            URL in Settings → workspace.
          </EmptyState>
        }>
          {/* The browser chrome, as the kit's toolbar rather than a flex row of this plugin's own:
              the address box is an `Input`, so it takes the reader's style pack like every other box
              in the app instead of the three rules this plugin used to ship for it. */}
          <Toolbar size="sm" ariaLabel="Preview">
            <Button variant="bare" title="Back" disabled={!canBack()} onPress={() => preview?.command(props.taskId, 'back')}>‹</Button>
            <Button variant="bare" title="Forward" disabled={!canFwd()} onPress={() => preview?.command(props.taskId, 'forward')}>›</Button>
            <Button variant="bare" title={loading() ? 'Stop' : 'Reload'} onPress={() => preview?.command(props.taskId, loading() ? 'stop' : 'reload')}>{loading() ? '✕' : '↻'}</Button>
            <Button variant="bare" title="Home" onPress={() => props.url && preview?.load(props.taskId, props.url)}>⌂</Button>
            <Input
              size="sm"
              label="Preview address"
              assist={false}
              value={addr()}
              onInput={(value) => setAddr(value)}
              onKeyDown={(event) => { if (event.key === 'Enter') go() }}
            />
            <Button variant="bare" title="Toggle preview DevTools" label="Toggle preview DevTools" onPress={() => preview?.command(props.taskId, 'devtools')}>{'</>'}</Button>
            <Show when={loading()}><Spinner label="Loading page" /></Show>
          </Toolbar>
        </Show>
      </Show>
      {/* A WebContentsView is somebody else's pixels, so it is a rectangle: the kit owns the box and
          the way in and out of it with the keyboard, and the shell positions the view over `mount`. */}
      <Rectangle kind="webview" label="Preview" mount={(element) => { host = element }} />
    </section>
  )
}
