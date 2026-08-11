import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { prefsKey } from '@acorn/protocol/api.ts'
import type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/pluginBridge.ts'
import { sendRaw } from '../../apiClient'
import { pushNotice } from '../../notifications/notifications'
import { clientEvents, consumePaneIntent, openPane } from '../../registries/clientEvents'
import { executeCommand } from '../../registries/commands'
import { openContentTarget, parseInAppTarget } from '../../registries/contentLinks'
import { keybindingRegistry, resolveFrameKeybinding, resolveKeybindings } from '../../registries/keybindings'
import { saveJsonPref } from '../../settings/savePref'
import { activeTaskId } from '../../tasks/tasks'
import { watchAppearance } from '../../ui/appearance'
import { FRAME_TOKENS } from '../../ui/tokenAxes'
import { createFrameBridge, postAppearance, postBridgeEvent, postSelect, postSurfaceAction, type FrameBinding, type FrameServices } from './broker'
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
  // Project-scoped pane surfaces only: which item the URL addresses. A task-scoped pane gets the same
  // thing as a retained pane intent, because its selection lives in the task's layout state; a
  // project-scoped one has no such store, so the URL is the selection and it arrives as a prop the host
  // updates. Both feed the same two channels — whatever is set when the frame connects rides in
  // `context`, and every change after that is a `select` message rather than a remount.
  item?: string
  // Importer surfaces only. The host owns the modal chrome and the post-import refresh; the frame only
  // says when it is done.
  onImported?: () => void
  onClose?: () => void
  // A webview's visible pixels are host-owned. Its sandboxed client bundle remains mounted offscreen
  // solely as the typed controller that can issue the four allowed verbs.
  controllerOnly?: boolean
  // Composed panes only (`document-over-frame`): the sibling host editor's document, as an accessor
  // because the editor may not exist yet when this frame mounts. Read per bridge call rather than
  // captured, so a frame that connected first still reaches the document once it appears.
  document?: () => { read(): string; write(text: string): void; flush(): Promise<void> } | null
  webview?: {
    navigate(url: string): Promise<boolean>
    command(action: 'back' | 'forward' | 'reload'): Promise<boolean>
    subscribe(listener: (channel: 'webview:navigated' | 'webview:blocked', payload: unknown) => void): () => void
  }
}

const currentAxes = (): { theme: string; style: string } => ({
  // Both axes default to an ATTRIBUTE-LESS state: `light` and `terminal` have no [data-theme]/[data-style]
  // block at all (settings/uiStyles.ts), so reading the dataset legitimately gives undefined.
  theme: document.documentElement.dataset.theme ?? 'light',
  style: document.documentElement.dataset.style ?? 'terminal',
})

// The token values a frame gets. A frame can render the shared primitive stylesheet, so it needs the
// complete theme + style + invariant projection rather than BRIDGE_TOKENS' deliberately small canvas
// contract. The stylesheet itself is served by Electron main at the frame's hash origin.
const currentTokens = (): Record<string, string> => {
  const computed = getComputedStyle(document.documentElement)
  const tokens: Record<string, string> = {}
  for (const name of FRAME_TOKENS) tokens[name] = computed.getPropertyValue(name).trim()
  return tokens
}

export default function PluginFrame(props: PluginFrameProps) {
  const qc = useQueryClient()
  const [misbehaving, setMisbehaving] = createSignal<string | null>(null)

  // The iframe element, for the broker's `frameHasFocus` gate on `openUrl`: a click or keypress
  // inside the frame's document makes this element the shell document's activeElement.
  let frameEl: HTMLIFrameElement | undefined

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
    // A link inside a frame's own rendered content. The frame handed over a URL and nothing else; where
    // it goes is decided here, on the host's side of the port, with the same two-rung ladder every shell
    // surface uses (registries/contentLinks.ts) and the same external fall-through the descriptor
    // `openUrl` verb takes (chrome/actions.ts). There is no third path: a frame cannot navigate the shell
    // to an address of its choosing, only offer a URL and let the host recognise it or not.
    //
    // Which rung is PREFERRED comes from the surface, which is why this lives here and not in the broker:
    // this side knows what the frame is. A link clicked inside a reference panel wants to swap that
    // panel's subject — the reader is looking sideways and asked to look sideways again, and pushing a
    // pane behind an overlay they would then have to dismiss is not what they meant. Every other surface
    // is a pane or a modal sitting in a task, where the pane is the richer destination and the one those
    // surfaces have always used. Identical reasoning to registries/refPanelHost.tsx and github's PR
    // conversation, and the frame is not consulted in either case.
    openUrl: (url) => {
      const target = parseInAppTarget(url)
      // The BOUND task, never `activeTaskId()`, even though the shell's own content handlers use the
      // ambient one. A frame the host did not give a task is not looking at one: a project-scoped surface
      // and a ref panel both sit beside or over something that is not a task layout, while a task may well
      // still be selected in the rail behind them. Reading it here would let a link clicked on a project
      // page push a pane into a background task's PERSISTED layout, where the reader is not and will not
      // see it. With no bound task the pane rung is simply unavailable, and the URL falls to the browser.
      const presentation = {
        taskId: props.binding.taskId,
        ...(props.binding.target === 'refPanel' ? { prefer: 'refPanel' as const } : {}),
      }
      if (target && openContentTarget(target, presentation) !== 'external') return
      // Nothing in-app claimed it. `window.open` is denied by main's setWindowOpenHandler, which hands
      // the URL to `shell.openExternal` behind the scheme allowlist — so this opens in the owner's
      // browser and never in-app, and there is no second policy to keep in step
      // (apps/desktop/src/app/main/electron.ts, docs/electron.md § navigation policy).
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    frameHasFocus: () => frameEl !== undefined && document.activeElement === frameEl,
    importerDone: () => props.onImported?.(),
    importerClose: () => props.onClose?.(),
    // Present only for a composed pane, and its absence IS the permission check the broker applies —
    // there is no scope to declare, because the grant is structural. The indirection through the
    // accessor is what makes the two regions' mount order a non-issue: the frame can connect before the
    // editor has loaded its document, and its first `document.read()` still lands on the real thing.
    ...(props.document
      ? {
        document: {
          read: () => props.document?.()?.read() ?? '',
          write: (text: string) => props.document?.()?.write(text),
          flush: async () => void (await props.document?.()?.flush()),
        },
      }
      : {}),
    webviewNavigate: (url) => props.webview?.navigate(url) ?? Promise.resolve(false),
    webviewCommand: (action) => props.webview?.command(action) ?? Promise.resolve(false),
    keydown: (chord) => {
      const frameBinding = resolveFrameKeybinding(
        chord,
        resolveKeybindings(keybindingRegistry.entries(), qc.getQueryData<Record<string, string>>(prefsKey) ?? {}),
        {
          pluginId: props.binding.pluginId,
          surface: props.binding.surface,
          taskActive: !!props.binding.taskId && activeTaskId() === props.binding.taskId,
        },
      )
      if (!frameBinding) return
      void executeCommand(frameBinding.command).catch((error) => {
        console.error(`[command:${frameBinding.command}]`, error)
      })
    },
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
    // Once: consuming an intent removes it, so a second read would report no selection. A routed item
    // wins, because for a project-scoped surface it IS the current selection rather than a one-shot.
    const item = props.item ?? selected()
    return {
      surface: props.binding.surface,
      target: props.binding.target,
      nodeId: props.binding.nodeId,
      ...(props.binding.taskId ? { taskId: props.binding.taskId } : {}),
      ...(props.binding.projectId ? { projectId: props.binding.projectId } : {}),
      ...(props.refId ? { refId: props.refId } : {}),
      ...(item ? { item } : {}),
      ...currentAxes(),
      claimsKeys: [...props.binding.claimsKeys],
    }
  }

  // The port this frame is connected on, or null before it loads and after it is torn down. Held out here
  // rather than inside `onLoad` so the effect below can have a normal reactive lifetime: `onLoad` runs from
  // an iframe load event, which is outside the component's reactive owner.
  let port: MessagePort | null = null

  // Every routed selection after the one the frame connected with. `defer` skips the initial value
  // deliberately — that one already crossed in `context`, and posting it again would tell the frame to
  // reload the ticket it is in the middle of loading. A change that lands BEFORE the frame connects needs
  // nothing either, because `context()` is built at load time and reads whatever is current then.
  createEffect(on(() => props.item, (next, previous) => {
    if (!port || !next || next === previous) return
    postSelect(port, next)
  }, { defer: true }))

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

    port = channel.port1
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
    // Surface-scoped commands the host resolved for this frame — the chord was pressed in the sibling
    // editor, or the row was picked in the palette. Addressed by plugin AND surface, because a task can
    // have two composed panes open and each one's chord belongs to its own frame.
    const unaction = clientEvents.on('plugin:surface-action', (event) => {
      if (event.pluginId !== props.binding.pluginId || event.surface !== props.binding.surface) return
      postSurfaceAction(channel.port1, event.command)
    })
    const unwebview = props.webview?.subscribe((eventChannel, payload) => {
      postBridgeEvent(channel.port1, eventChannel, payload)
    })
    onCleanup(() => {
      port = null
      unwebview?.()
      unaction()
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
        aria-hidden={props.controllerOnly ? 'true' : undefined}
        style={props.controllerOnly
          ? { border: '0', width: '1px', height: '1px', position: 'absolute', opacity: '0', 'pointer-events': 'none' }
          : { border: '0', width: '100%', height: '100%', display: 'block' }}
        ref={(frame) => {
          frameEl = frame
          frame.addEventListener('load', () => onLoad(frame), { once: true })
        }}
      />
    </Show>
  )
}
