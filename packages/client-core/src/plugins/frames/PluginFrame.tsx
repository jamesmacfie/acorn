import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/pluginBridge.ts'
import { clientEvents, consumePaneIntent } from '../../registries/clientEvents'
import { watchAppearance } from '../../ui/appearance'
import { FRAME_TOKENS } from '../../ui/tokenAxes'
import { createFrameBridge, postAppearance, postBridgeEvent, postSelect, postSurfaceAction } from './broker'
import { createFrameServices, type PluginFrameProps } from './frameServices'

export { SUBSCRIBABLE_CHANNELS } from './channels'
export type { PluginFrameProps } from './frameServices'

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

// How long a frame gets to say anything at all after the host transfers its port. The bundle is local
// bytes out of a content-addressed cache and the ack is the first line the SDK runs, so this is generous
// by an order of magnitude — it is a deadline for "did this code evaluate", not a performance budget.
//
// Any message counts as the ack, so a bundle built before the SDK started sending one still
// clears this as soon as it calls the bridge. A bundle that was built before the ack existed AND never
// calls the bridge (a purely static frame) will show the placeholder wrongly until it is rebuilt. Every
// package in this repo is rebuilt by scripts/build-plugin.mjs; an installed third-party copy is not.
const HANDSHAKE_DEADLINE_MS = 10_000

export default function PluginFrame(props: PluginFrameProps) {
  const qc = useQueryClient()
  const [misbehaving, setMisbehaving] = createSignal<string | null>(null)
  // The frame took the port and never said a word — a bundle that threw at module scope, or one that was
  // never a frame bundle. Until this existed the surface was a blank rectangle and the only evidence was
  // a console error inside an iframe nobody opens devtools on.
  const [silent, setSilent] = createSignal(false)

  // The iframe element, for the broker's `frameHasFocus` gate on `openUrl`: a click or keypress
  // inside the frame's document makes this element the shell document's activeElement.
  let frameEl: HTMLIFrameElement | undefined

  // For the route rung of a link a frame hands over. Taken here because `useNavigate` is only callable
  // while a component is being set up, and the services are a plain function on purpose.
  const navigate = useNavigate()

  // The bridge's fourteen effects, built from this frame's props (./frameServices.ts). Kept out of
  // this file so they can be unit-tested: the repo's client suites run in bare Node with no Solid
  // transform, so nothing in a `.tsx` file can be reached by one.
  const services = () => createFrameServices(props, {
    qc,
    // Only this component holds the element to compare against, which is why the check is passed in
    // rather than implemented over there: a click or keypress inside the frame's document makes this
    // element the shell document's activeElement.
    frameHasFocus: () => frameEl !== undefined && document.activeElement === frameEl,
    navigate,
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
    // Armed before the port is transferred and cleared by the frame's first message. A controller-only
    // frame is exempt: it has no rectangle for a placeholder to occupy, and replacing its iframe would
    // remove the very thing the host is driving.
    const deadline = props.controllerOnly
      ? null
      : setTimeout(() => {
        console.warn(`[plugins] ${props.binding.pluginId} surface '${props.binding.surface}' never connected its frame`)
        setSilent(true)
      }, HANDSHAKE_DEADLINE_MS)
    const bridge = createFrameBridge({
      port: channel.port1,
      binding: props.binding,
      services: services(),
      context: context(),
      onMisbehaving: (reason) => {
        console.warn(`[plugins] ${props.binding.pluginId} misbehaved on the bridge: ${reason}`)
        setMisbehaving(reason)
      },
      onConnected: () => {
        if (deadline !== null) clearTimeout(deadline)
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
      if (deadline !== null) clearTimeout(deadline)
      unwebview?.()
      unaction()
      unselect()
      unwatch()
      bridge.dispose()
    })
  }

  return (
    <Show
      when={!misbehaving() && !silent()}
      fallback={
        <section class="pane contribution-failed" role="status">
          {/* Two failures, one placeholder, because the reader's situation is the same either way: this
              rectangle is not going to render. The wording separates them because the remedies differ —
              misbehaving is the host cutting a running plugin off, silent is a plugin's UI that never
              started at all. */}
          <strong>{misbehaving() ? 'Plugin misbehaving' : 'This plugin’s UI failed to start'}</strong>
          <span class="muted">{props.binding.pluginId}</span>
          <span class="sr-only">{misbehaving() ?? `${props.binding.surface} never connected to the host`}</span>
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
