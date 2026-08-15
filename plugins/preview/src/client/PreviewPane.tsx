import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { clientEvents, previewViews } from '@acorn/plugin-api/client'
import { EmptyState, Spinner } from '@acorn/plugin-api/ui'

const withScheme = (v: string) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)

// Drop an archived task's preview view (called by every archive path via the runtime event below).
export function evictPreviewWebview(taskId: string): void {
  previewViews()?.evict(taskId)
}

export const activatePreviewEvents = (): (() => void) =>
  clientEvents.on('runtime:task-archived', ({ taskId }) => evictPreviewWebview(taskId))

export default function PreviewPane(props: { taskId: string; url: string | null }) {
  let host!: HTMLDivElement
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

  // Reconcile the task's main-owned view + home URL, position it over the host, and hide it when the
  // pane has no URL or an overlay covers it. Main owns home identity across renderer remounts, so a
  // changed run target updates the view while ordinary pane/task switches preserve browse state.
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
          <div class="preview-chrome">
            <button type="button" class="preview-nav-btn" title="Back" disabled={!canBack()} onClick={() => preview?.command(props.taskId, 'back')}>‹</button>
            <button type="button" class="preview-nav-btn" title="Forward" disabled={!canFwd()} onClick={() => preview?.command(props.taskId, 'forward')}>›</button>
            <button type="button" class="preview-nav-btn" title={loading() ? 'Stop' : 'Reload'} onClick={() => preview?.command(props.taskId, loading() ? 'stop' : 'reload')}>{loading() ? '✕' : '↻'}</button>
            <button type="button" class="preview-nav-btn" title="Home" onClick={() => props.url && preview?.load(props.taskId, props.url)}>⌂</button>
            <input
              class="preview-url"
              type="text"
              spellcheck={false}
              value={addr()}
              onInput={(e) => setAddr(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
            />
            <button type="button" class="preview-nav-btn" title="Toggle preview DevTools" aria-label="Toggle preview DevTools" onClick={() => preview?.command(props.taskId, 'devtools')}>{'</>'}</button>
            <Show when={loading()}><Spinner label="Loading page" /></Show>
          </div>
        </Show>
      </Show>
      <div class="workspace-preview-host" ref={host} />
    </section>
  )
}
