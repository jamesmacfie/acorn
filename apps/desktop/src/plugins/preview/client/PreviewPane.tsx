import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { clientEvents } from '../../../core/client/registries/clientEvents'

// The browser-preview pane (docs/panes.md): browser chrome (back/forward/stop-reload/home
// + an editable URL bar + a loading spinner) over a per-task, MAIN-owned WebContentsView. `props.url`
// is the resolved "home" (run target / workspace preview — TaskView computes the priority chain).
// The native view lives in the main process (previewService.ts) and is positioned over this pane's
// host rect, so browse state (page, scroll, form input) survives pane/task switches for free — the
// old <webview> was reparented in the DOM and reloaded on every switch, which this replaces.
// Agent driving binds inside main when the view is created, so `browser_*` tools drive exactly the
// surface the user sees.

// A native view always paints above web content, so overlays (palette, modals) can't sit above it via
// z-index. We poll whether something covers the pane and hide the view when so (see checkOcclusion).

const withScheme = (v: string) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)

// Drop an archived task's preview view (called by every archive path via the runtime event below).
export function evictPreviewWebview(taskId: string): void {
  window.acorn?.preview?.evict(taskId)
}

export const activatePreviewEvents = (): (() => void) =>
  clientEvents.on('runtime:task-archived', ({ taskId }) => evictPreviewWebview(taskId))

export default function PreviewPane(props: { taskId: string; url: string | null }) {
  let host!: HTMLDivElement
  const preview = window.acorn?.preview
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

  // Is an overlay covering the pane? The host div is empty (the native view floats over it, not
  // inside the DOM), so elementFromPoint at its centre returns the host itself when nothing covers it.
  // ponytail: polled at ~200ms via a single centre-point probe — a modal/palette over the preview
  // hides it within a frame or two. A corner-only overlay (e.g. a toast) over an off-centre part isn't
  // detected; upgrade to multi-point sampling or a global overlay signal if that regresses.
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
        <div class="workspace-empty-inner">
          <p class="muted">The browser preview needs the desktop app.</p>
          <p class="muted">Server-backed panes (PR review, workspaces, tasks) work in browser mode, but the preview surface is a desktop-only capability.</p>
        </div>
      }>
        <Show when={props.url} fallback={
          <div class="workspace-empty-inner">
            <p class="muted">No preview URL yet.</p>
            <p class="muted">Declare a run target with a <code>url</code> (in <code>.acorn/config.toml</code> or the workspace's run targets) and start it from the pane switcher's ▶ button, or set a preview URL in Settings → workspace.</p>
          </div>
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
            <Show when={loading()}><span class="preview-spinner spin">◐</span></Show>
          </div>
        </Show>
      </Show>
      <div class="workspace-preview-host" ref={host} />
    </section>
  )
}
