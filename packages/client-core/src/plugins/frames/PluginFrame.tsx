import { createSignal, onCleanup, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { prefsKey } from '@acorn/protocol/api.ts'
import type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/pluginBridge.ts'
import { sendRaw } from '../../apiClient'
import { pushNotice } from '../../notifications/notifications'
import { clientEvents, consumePaneIntent, openPane } from '../../registries/clientEvents'
import { saveJsonPref } from '../../settings/savePref'
import { watchAppearance } from '../../ui/appearance'
import { BRIDGE_TOKENS } from '../../ui/tokenAxes'
import { createFrameBridge, postAppearance, postSelect, type FrameBinding, type FrameServices } from './broker'
import { isSubscribable } from './channels'

export { SUBSCRIBABLE_CHANNELS } from './channels'

const PLUGIN_FRAME_SCHEME = 'app-plugin'
const pluginFrameOrigin = (hash: string): string => `${PLUGIN_FRAME_SCHEME}://${hash}`

// The host component for one sandboxed plugin surface (docs/plugins.md).
//
// Everything security-relevant is either in the frame's origin (main/pluginScheme.ts serves the CSP) or
// in the broker (scopes.ts decides every call). What is left here is wiring, and one rule: the frame is
// created from values the HOST holds, and the only thing that crosses into it is a MessagePort.
//
// On the `sandbox` attribute, which is defence in depth on top of the separate origin and not the
// mechanism. It carries `allow-same-origin` alongside `allow-scripts`, which reads alarming and is not:
// the pair is only dangerous when the framed document shares the EMBEDDER's origin, because then it can
// reach `parent.document` and rewrite the iframe that sandboxes it. Here the embedder is app://acorn and
// the frame is app-plugin://<hash>, so `allow-same-origin` means "keep your own hash origin" and nothing
// more. Dropping it makes the origin opaque, which costs three things and buys none: `'self'` in the
// served CSP stops matching, the frame's own module script becomes a cross-origin fetch on a scheme with
// no CORS (so the document renders blank), and frame-local storage disappears. What the attribute still
// buys with both tokens is real: no popups, no top-level navigation, no form submission, no downloads.

export type PluginFrameProps = {
  // What the host resolved: which plugin, which surface, which bundle, and what it is looking at.
  binding: FrameBinding
  hash: string
  // Reference-panel surfaces only: which external item the panel was opened for.
  refId?: string
  // Importer surfaces only. The host owns the modal chrome and the post-import refresh; the frame only
  // says when it is done.
  onImported?: () => void
  onClose?: () => void
}

const currentAxes = (): { theme: string; style: string } => ({
  // Both axes default to an ATTRIBUTE-LESS state: `light` and `terminal` have no [data-theme]/[data-style]
  // block at all (settings/uiStyles.ts), so reading the dataset legitimately gives undefined.
  theme: document.documentElement.dataset.theme ?? 'light',
  style: document.documentElement.dataset.style ?? 'terminal',
})

// The token values a frame gets. BRIDGE_TOKENS is the existing list of tokens read by string from
// JavaScript, which is exactly the right set: those are the ones already contracted to survive a rename
// review (ui/tokenAxes.ts), and a frame is one more JS consumer of them.
const currentTokens = (): Record<string, string> => {
  const computed = getComputedStyle(document.documentElement)
  const tokens: Record<string, string> = {}
  for (const name of BRIDGE_TOKENS) tokens[name] = computed.getPropertyValue(name).trim()
  return tokens
}

export default function PluginFrame(props: PluginFrameProps) {
  const qc = useQueryClient()
  const [misbehaving, setMisbehaving] = createSignal<string | null>(null)

  // Rebuilt per frame rather than shared: every effect below closes over THIS frame's binding, which is
  // what pins its node and forbids the importer verbs on a pane.
  const services = (): FrameServices => ({
    fetch: async (method, path, body, signal) => {
      const result = await sendRaw(path, {
        method,
        // Pinned. The frame named a path and nothing else; which node it reaches is the host's to decide,
        // so there is no argument a plugin could pass to address a different one.
        nodeId: props.binding.nodeId,
        signal,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      return result
    },
    subscribe: (channel, listener) => {
      // Second half of the check the broker starts: it verifies the manifest declared the channel, this
      // verifies the shell has one. Subscribing never creates a channel.
      if (!isSubscribable(channel)) throw new Error(`${channel} is not a channel a plugin frame can subscribe to`)
      return clientEvents.on(channel, (payload) => listener(payload))
    },
    // Prefs are a flat string map on the wire, and `saveJsonPref` is what wrote this one — so reading it
    // back means parsing. A value that is not JSON is a value some other writer put there under this key,
    // which is not this plugin's state and is reported as absent rather than handed over as a string.
    stateGet: (key) => {
      const raw = qc.getQueryData<Record<string, string>>(prefsKey)?.[key]
      if (raw === undefined) return undefined
      try {
        return JSON.parse(raw) as unknown
      } catch {
        return undefined
      }
    },
    stateSet: async (key, value) => void (await saveJsonPref(qc, key, value)),
    toast: (title, detail) =>
      void pushNotice({
        taskId: props.binding.taskId ?? '',
        kind: 'plugin',
        title,
        at: Date.now(),
        ...(detail === undefined ? {} : { detail }),
      }),
    copy: (text) => void navigator.clipboard.writeText(text),
    openPane: (paneId) => {
      // A pane is opened in a task's layout, so a frame with no task has nothing to open into.
      const taskId = props.binding.taskId
      if (taskId) openPane(taskId, paneId)
    },
    importerDone: () => props.onImported?.(),
    importerClose: () => props.onClose?.(),
  })

  // A rail-source row that opened this pane. Retained by openPane until the pane consumes it, so a
  // frame mounting for the first time gets its selection in `context` rather than racing its own load
  // (docs/plugins.md).
  const selected = (): string | undefined => {
    const taskId = props.binding.taskId
    if (!taskId) return undefined
    const intent = consumePaneIntent(taskId, props.binding.surface)
    return intent?.kind === 'plugin:select' ? intent.item : undefined
  }

  const context = (): PluginFrameContext => {
    // Once: consuming an intent removes it, so a second read would report no selection.
    const item = selected()
    return {
      surface: props.binding.surface,
      target: props.binding.target,
      nodeId: props.binding.nodeId,
      ...(props.binding.taskId ? { taskId: props.binding.taskId } : {}),
      ...(props.binding.projectId ? { projectId: props.binding.projectId } : {}),
      ...(props.refId ? { refId: props.refId } : {}),
      ...(item ? { item } : {}),
      ...currentAxes(),
    }
  }

  // The handshake. One channel per frame load: the host keeps port1 and transfers port2 in, so nothing
  // after this rides window.postMessage and there is no origin check to get wrong.
  const onLoad = (frame: HTMLIFrameElement) => {
    const target = frame.contentWindow
    if (!target) return
    const channel = new MessageChannel()
    const bridge = createFrameBridge({
      port: channel.port1,
      binding: props.binding,
      services: services(),
      context: context(),
      onMisbehaving: (reason) => {
        console.warn(`[plugins] ${props.binding.pluginId} misbehaved on the bridge: ${reason}`)
        setMisbehaving(reason)
      },
    })
    // Targeted, not '*': the sandbox keeps the frame's own origin through allow-same-origin (see the
    // block at the top of this file for why that is safe here), so naming it ensures the port can only
    // land in the hash-addressed document we built this frame for.
    target.postMessage({ acornBridge: PLUGIN_BRIDGE_VERSION }, pluginFrameOrigin(props.hash), [channel.port2])

    const push = () => postAppearance(channel.port1, { ...currentAxes(), tokens: currentTokens() })
    push()
    const unwatch = watchAppearance(push)
    // Every selection after the one that opened the pane. The intent is emitted as well as retained, so
    // an already-mounted frame is reached without being remounted and losing what it had drawn.
    const unselect = clientEvents.on('presentation:pane-intent', (event) => {
      if (event.taskId !== props.binding.taskId || event.paneId !== props.binding.surface) return
      if (event.intent.kind !== 'plugin:select') return
      // Consumed here so the retained copy does not reach a later remount as a stale selection.
      consumePaneIntent(event.taskId, event.paneId)
      postSelect(channel.port1, event.intent.item)
    })
    onCleanup(() => {
      unselect()
      unwatch()
      bridge.dispose()
    })
  }

  return (
    <Show
      when={!misbehaving()}
      fallback={
        <section class="pane contribution-failed" role="status">
          <strong>Plugin misbehaving</strong>
          <span class="muted">{props.binding.pluginId}</span>
          <span class="sr-only">{misbehaving()}</span>
        </section>
      }
    >
      <iframe
        // The bundle hash is the origin, so a plugin update is a new origin and a new frame — there is
        // nothing cached under the old one to reason about.
        src={`${pluginFrameOrigin(props.hash)}/index.html`}
        title={props.binding.surface}
        sandbox="allow-scripts allow-same-origin"
        style={{ border: '0', width: '100%', height: '100%', display: 'block' }}
        ref={(frame) => frame.addEventListener('load', () => onLoad(frame), { once: true })}
      />
    </Show>
  )
}
