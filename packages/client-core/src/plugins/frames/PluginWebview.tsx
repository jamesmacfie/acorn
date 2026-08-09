import { createEffect, createResource, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { PluginFrameSurface } from '@acorn/protocol/api.ts'
import { acornGlobal } from '../../capabilities'
import PluginFrame from './PluginFrame'
import type { FrameBinding } from './broker'
import { displayHost, pluginWebviewKey, resolvePluginWebviewUrl } from './webviewModel'

export type PluginWebviewProps = {
  pluginId: string
  surface: PluginFrameSurface
  binding: FrameBinding
  hash: string
}

export default function PluginWebview(props: PluginWebviewProps) {
  let host!: HTMLDivElement
  const native = acornGlobal()?.webview
  const key = () => pluginWebviewKey(props.binding)
  const [home] = createResource(
    () => [props.pluginId, props.surface, props.binding] as const,
    ([pluginId, surface, binding]) => resolvePluginWebviewUrl(pluginId, surface, binding),
  )
  const [loading, setLoading] = createSignal(false)
  const [url, setUrl] = createSignal('')
  const [canBack, setCanBack] = createSignal(false)
  const [canForward, setCanForward] = createSignal(false)
  const [blocked, setBlocked] = createSignal('')
  const [suppressed, setSuppressed] = createSignal(false)
  let ensureVersion = 0

  const syncRect = () => {
    if (!native || !host) return
    const rect = host.getBoundingClientRect()
    native.setBounds(key(), { x: rect.left, y: rect.top, width: rect.width, height: rect.height })
  }
  const checkOcclusion = () => {
    if (!host) return
    const rect = host.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    setSuppressed(!(top === host || host.contains(top)))
  }
  const acceptState = (state: { key: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => {
    if (state.key !== key()) return
    const previousUrl = url()
    setUrl(state.url)
    setLoading(state.loading)
    setCanBack(state.canGoBack)
    setCanForward(state.canGoForward)
    if (previousUrl && state.url !== previousUrl) setBlocked('')
  }

  onMount(() => {
    if (!native) return
    const resize = new ResizeObserver(() => {
      syncRect()
      checkOcclusion()
    })
    resize.observe(host)
    const onResize = () => {
      syncRect()
      checkOcclusion()
    }
    window.addEventListener('resize', onResize)
    const poll = setInterval(checkOcclusion, 200)
    const offEvent = native.onEvent(acceptState)
    const offBlocked = native.onBlocked((state) => {
      if (state.key === key()) setBlocked(state.host || state.url)
    })
    onCleanup(() => {
      ensureVersion += 1
      resize.disconnect()
      window.removeEventListener('resize', onResize)
      clearInterval(poll)
      offEvent()
      offBlocked()
      native.hide(key())
      native.evict(key())
    })
  })

  createEffect(() => {
    const homeUrl = home()
    const covered = suppressed()
    const version = ++ensureVersion
    if (!native || !host || !homeUrl) {
      if (native) native.hide(key())
      return
    }
    if (covered) native.hide(key())
    else syncRect()
    void native.ensure(key(), homeUrl, props.surface.hosts ?? []).then((ready) => {
      if (!ready || version !== ensureVersion) return
      syncRect()
      if (!suppressed()) native.show(key())
    })
  })

  const controller = {
    navigate: (nextUrl: string) => native?.load(key(), nextUrl) ?? Promise.resolve(false),
    command: (action: 'back' | 'forward' | 'reload') => native?.command(key(), action) ?? Promise.resolve(false),
    subscribe(listener: (channel: 'webview:navigated' | 'webview:blocked', payload: unknown) => void): () => void {
      if (!native) return () => undefined
      const offEvent = native.onEvent((state) => {
        if (state.key === key()) listener('webview:navigated', {
          url: state.url,
          loading: state.loading,
          canGoBack: state.canGoBack,
          canGoForward: state.canGoForward,
        })
      })
      const offBlocked = native.onBlocked((state) => {
        if (state.key === key()) listener('webview:blocked', { url: state.url, host: state.host })
      })
      return () => {
        offEvent()
        offBlocked()
      }
    },
  }

  return (
    <section class="pane workspace-preview plugin-webview" style={{ 'grid-column': '1 / 3' }}>
      <div class="preview-chrome plugin-webview-chrome">
        <button type="button" class="preview-nav-btn" title="Back" disabled={!canBack()} onClick={() => void native?.command(key(), 'back')}>‹</button>
        <button type="button" class="preview-nav-btn" title="Forward" disabled={!canForward()} onClick={() => void native?.command(key(), 'forward')}>›</button>
        <button type="button" class="preview-nav-btn" title="Reload" onClick={() => void native?.command(key(), 'reload')}>↻</button>
        <span class="plugin-webview-hostname" title={url() || home() || ''}>{displayHost(url() || home() || '') || 'No page loaded'}</span>
        <Show when={blocked()}><span class="plugin-webview-blocked" role="status">Blocked navigation to {blocked()}</span></Show>
        <Show when={loading()}><span class="preview-spinner spin">◐</span></Show>
      </div>
      <Show when={native} fallback={
        <div class="workspace-empty-inner"><p class="muted">Plugin web pages need the desktop app.</p></div>
      }>
        <Show when={!home.loading && home()} fallback={
          <div class="workspace-empty-inner">
            <p class="muted">{home.error ? 'The plugin could not resolve its page URL.' : 'No web page is available yet.'}</p>
          </div>
        }><></></Show>
      </Show>
      <div class="workspace-preview-host" ref={host} />
      <PluginFrame binding={props.binding} hash={props.hash} controllerOnly webview={controller} />
    </section>
  )
}
