import { createEffect, createResource, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { PluginFrameSurface } from '@acorn/protocol/api.ts'
import { pluginWebviews } from '../../infra/platform'
import PluginFrame from './PluginFrame'
import type { FrameBinding } from './broker'
import { displayHost, pluginWebviewKey, resolvePluginWebviewUrl } from './webviewModel'
import { Alert, Button, EmptyState, Spinner } from '../../kit/components/primitives'
import { elementRectKey, visibleElementRect } from '../../infra/platform/webviewGeometry'

export type PluginWebviewProps = {
  pluginId: string
  surface: PluginFrameSurface
  binding: FrameBinding
  hash: string
}

export default function PluginWebview(props: PluginWebviewProps) {
  let host!: HTMLDivElement
  const native = pluginWebviews()
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
  const [failed, setFailed] = createSignal(false)
  const [suppressed, setSuppressed] = createSignal(false)
  let ensureVersion = 0
  let placed = ''
  let ensuredKey = ''

  const syncRect = () => {
    if (!native || !host) return
    const rect = visibleElementRect(host)
    const next = elementRectKey(rect)
    if (next === placed) return
    placed = next
    native.setBounds(key(), rect)
  }
  const checkOcclusion = () => {
    if (!host) return
    const rect = visibleElementRect(host)
    if (rect.width === 0 || rect.height === 0) return setSuppressed(true)
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
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
    resize.observe(document.documentElement)
    const poll = setInterval(() => {
      syncRect()
      checkOcclusion()
    }, 200)
    const offEvent = native.onEvent(acceptState)
    const offBlocked = native.onBlocked((state) => {
      if (state.key === key()) setBlocked(state.host || state.url)
    })
    onCleanup(() => {
      ensureVersion += 1
      resize.disconnect()
      clearInterval(poll)
      offEvent()
      offBlocked()
      if (ensuredKey) {
        native.hide(ensuredKey)
        native.evict(ensuredKey)
      }
    })
  })

  createEffect(() => {
    const homeUrl = home()
    const covered = suppressed()
    const version = ++ensureVersion
    const nextKey = key()
    if (native && ensuredKey && ensuredKey !== nextKey) {
      native.hide(ensuredKey)
      native.evict(ensuredKey)
      ensuredKey = ''
    }
    if (!native || !host || !homeUrl) {
      if (native && ensuredKey) {
        native.hide(ensuredKey)
        native.evict(ensuredKey)
        ensuredKey = ''
      }
      return
    }
    ensuredKey = nextKey
    setFailed(false)
    if (covered) native.hide(nextKey)
    else syncRect()
    void native.ensure(nextKey, homeUrl, props.surface.hosts ?? []).then((ready) => {
      if (version !== ensureVersion) return
      if (!ready) {
        setFailed(true)
        return
      }
      placed = ''
      syncRect()
      if (!suppressed()) native.show(nextKey)
    }).catch(() => {
      if (version === ensureVersion) setFailed(true)
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
        <Button variant="bare" title="Back" disabled={!canBack()} onPress={() => void native?.command(key(), 'back')}>‹</Button>
        <Button variant="bare" title="Forward" disabled={!canForward()} onPress={() => void native?.command(key(), 'forward')}>›</Button>
        <Button variant="bare" title="Reload" onPress={() => void native?.command(key(), 'reload')}>↻</Button>
        <span class="plugin-webview-hostname" title={url() || home() || ''}>{displayHost(url() || home() || '') || 'No page loaded'}</span>
        <Show when={blocked()}><Alert tone="warn">Blocked navigation to {blocked()}</Alert></Show>
        <Show when={failed()}><Alert tone="warn">Could not open the plugin page.</Alert></Show>
        {/* Was a literal ◐ glyph with no accessible name. */}
        <Show when={loading()}><Spinner label="Loading page" /></Show>
      </div>
      <Show when={native} fallback={
        <EmptyState>Plugin web pages need the desktop app.</EmptyState>
      }>
        <Show when={!home.loading && home()} fallback={
          <EmptyState>
            {home.error ? 'The plugin could not resolve its page URL.' : 'No web page is available yet.'}
          </EmptyState>
        }><></></Show>
      </Show>
      <div class="workspace-preview-host" ref={host} />
      <PluginFrame binding={props.binding} hash={props.hash} controllerOnly webview={controller} />
    </section>
  )
}
