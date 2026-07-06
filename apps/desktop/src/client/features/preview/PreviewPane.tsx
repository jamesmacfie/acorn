import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'

// The browser-preview pane (docs/panes.md): browser chrome (back/forward/stop-reload/home + an
// editable URL bar + a loading spinner) over a per-task Electron <webview>. `props.url` is the
// resolved "home" (run target / workspace preview — TaskView computes the priority chain); the
// main process's will-attach-webview guard keeps it to http(s). Agent-driving is a capability of
// this same webview, not a separate pane: on dom-ready its webContents id is bound to main
// (window.acorn.browser.bind) so agents can drive it over CDP via the MCP browser_* tools.

// Electron's <webview> isn't a typed JSX element; this is the slice of its API the chrome drives.
type WebviewEl = HTMLElement & {
  src: string
  loadURL(url: string): void
  reload(): void
  stop(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  getWebContentsId(): number
}
const withScheme = (v: string) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)

// One live <webview> per task, kept across pane and task switches so browse state (page, scroll,
// form input) survives — only a page reload (app restart) starts fresh. Entries are evicted when
// their task is archived (evictPreviewWebview below), so dead webviews don't accumulate.
const previewWebviews = new Map<string, WebviewEl>()

// All webviews live in one persistent layer parented to <body>, outside SolidJS's render tree, so
// pane/task/workspace navigation never detaches them — Electron reloads a <webview>'s guest whenever
// it's removed from and re-added to the DOM, which was wiping browse state on every remount. Instead
// of parenting into PreviewPane's (churned) host div, we position this layer over the current host's
// rect. z-index sits above pane content but below app modals/palette (z-index 40+).
let previewLayer: HTMLDivElement | null = null
function getPreviewLayer(): HTMLDivElement {
  if (previewLayer) return previewLayer
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.style.display = 'none'
  el.style.zIndex = '10'
  previewLayer = el
  document.body.appendChild(el)
  return el
}

// Drop an archived task's webview (called by every archive path: TaskView's close flow, the rail
// menu, the palette action). Detaches it from the DOM so the guest process is torn down.
export function evictPreviewWebview(taskId: string): void {
  const el = previewWebviews.get(taskId)
  if (!el) return
  el.remove()
  previewWebviews.delete(taskId)
}

export default function PreviewPane(props: { taskId: string; url: string | null }) {
  let host!: HTMLDivElement
  const [loading, setLoading] = createSignal(false)
  const [addr, setAddr] = createSignal('')
  const [canBack, setCanBack] = createSignal(false)
  const [canFwd, setCanFwd] = createSignal(false)
  const active = () => previewWebviews.get(props.taskId) ?? null
  const isActive = (el: WebviewEl) => previewWebviews.get(props.taskId) === el
  const syncFrom = (el: WebviewEl) => {
    try {
      setAddr(el.getURL() || props.url || '')
      setCanBack(el.canGoBack())
      setCanFwd(el.canGoForward())
    } catch {
      setAddr(props.url ?? '')
      setCanBack(false)
      setCanFwd(false)
    }
  }

  // Keep the persistent layer positioned over this pane's host slot. Fires on host resize (pane
  // layout changes) and window resize; the pane area itself doesn't scroll.
  // ponytail: rect follows host via ResizeObserver + resize; add scroll handling if the pane ever
  // lives in a scroll container.
  const syncRect = () => {
    const r = host.getBoundingClientRect()
    const layer = getPreviewLayer()
    layer.style.top = `${r.top}px`
    layer.style.left = `${r.left}px`
    layer.style.width = `${r.width}px`
    layer.style.height = `${r.height}px`
  }
  onMount(() => {
    const layer = getPreviewLayer()
    const ro = new ResizeObserver(syncRect)
    ro.observe(host)
    window.addEventListener('resize', syncRect)
    onCleanup(() => {
      ro.disconnect()
      window.removeEventListener('resize', syncRect)
      layer.style.display = 'none' // hide the floating webviews when the preview pane isn't shown
    })
  })

  // Show the current task's webview (creating it on first open) in the persistent layer, hide the
  // others. The webview is never detached from the layer, so browse state survives navigation.
  createEffect(() => {
    const taskId = props.taskId
    const url = props.url
    const layer = getPreviewLayer()
    if (!host) return
    if (!url) {
      layer.style.display = 'none'
      return
    }
    let el = previewWebviews.get(taskId)
    if (!el) {
      el = document.createElement('webview') as WebviewEl
      el.setAttribute('src', url)
      el.setAttribute('data-acorn-home', url)
      el.style.width = '100%'
      el.style.height = '100%'
      const captured = el
      el.addEventListener('did-start-loading', () => isActive(captured) && setLoading(true))
      el.addEventListener('did-stop-loading', () => isActive(captured) && (setLoading(false), syncFrom(captured)))
      const onNav = (e: Event) => isActive(captured) && (setAddr((e as Event & { url?: string }).url ?? captured.getURL()), syncFrom(captured))
      el.addEventListener('did-navigate', onNav)
      el.addEventListener('did-navigate-in-page', onNav)
      // Bind for agent driving (docs/panes.md): main resolves the webContents id → CDP driver.
      el.addEventListener('dom-ready', () => {
        try {
          void window.acorn?.browser?.bind(taskId, captured.getWebContentsId())
        } catch {
          /* driving is optional; the preview still works */
        }
      }, { once: true })
      previewWebviews.set(taskId, el)
    }
    if (el.parentElement !== layer) layer.appendChild(el) // parented once; never re-detached
    // A changed home URL (a layout recipe resolved a run target, docs/next 13 §C) navigates there.
    if (el.getAttribute('data-acorn-home') !== url) {
      el.setAttribute('data-acorn-home', url)
      try {
        el.loadURL(url)
      } catch {
        /* webview not ready yet — the src attribute already points home */
      }
    }
    for (const [id, w] of previewWebviews) w.style.display = id === taskId ? 'flex' : 'none'
    layer.style.display = 'block'
    syncRect()
    setLoading(false)
    syncFrom(el)
  })

  const go = () => {
    const el = active()
    const v = addr().trim()
    if (el && v) el.loadURL(withScheme(v))
  }

  return (
    <section class="pane workspace-preview" style={{ 'grid-column': '1 / 3' }}>
      <Show when={props.url} fallback={
        <div class="workspace-empty-inner">
          <p class="muted">No preview URL yet.</p>
          <p class="muted">Declare a run target with a <code>url</code> (in <code>.acorn/config.toml</code> or the workspace's run targets) and start it from the pane switcher's ▶ button, or set a preview URL in Settings → workspace.</p>
        </div>
      }>
        <div class="preview-chrome">
          <button type="button" class="preview-nav-btn" title="Back" disabled={!canBack()} onClick={() => active()?.goBack()}>‹</button>
          <button type="button" class="preview-nav-btn" title="Forward" disabled={!canFwd()} onClick={() => active()?.goForward()}>›</button>
          <button type="button" class="preview-nav-btn" title={loading() ? 'Stop' : 'Reload'} onClick={() => (loading() ? active()?.stop() : active()?.reload())}>{loading() ? '✕' : '↻'}</button>
          <button type="button" class="preview-nav-btn" title="Home" onClick={() => props.url && active()?.loadURL(props.url)}>⌂</button>
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
      <div class="workspace-preview-host" ref={host} />
    </section>
  )
}
