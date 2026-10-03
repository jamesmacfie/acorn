import { queryOwner } from '../../infra/node/queryOwnership'
import { createEffect, createMemo, on, onCleanup } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import type { PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import { TREE_LIMITS, batchBytes } from '@acorn/protocol/tree/messages.ts'
import { answerOwnerInvoke, unknownHostOp, unsupportedOverlay, type OwnerActions } from './hostRequests'
import type { FrameBinding } from '../frames/broker'
import { closePluginOverlayFrom, openPluginOverlayInvocation } from '../frames/overlays'
import { createTreeBridgeFactory } from './bridgeFactory'
import { eligiblePlugins, isTaskPane } from '../plugins/contributions'
import { qualifiedContributionId } from '../plugins/contributionIds'
import { activeNodeId } from '../../infra/node/activeNode'
import { createLogger } from '../../infra/telemetry/logger'
import { watchAppearance } from '../../kit/tokens/appearance'
import { clientEvents, consumePaneIntent } from '../registries/commands/clientEvents'
import { TreeHost } from './TreeHost'
import type { RemoteContribution } from './treeRegistry'
import { acquireTreeWorker, treeAuthorityKey, treeModelAuthorityKey, treeDocumentGrant, type TreeHostResult } from './workerHost'

// One tree from one plugin, drawn where the owner asked for it.
//
// The counterpart to PluginFrame.tsx, and the same division of labour: this component is lifecycle and
// wiring, the broker decides every bridge call, and TreeHost.tsx decides every mutation. What is
// different is what crosses. A frame gets a rectangle and draws it; a tree gets nothing but a port,
// and the pixels are the host's own components all the way down.

/** Where this tree is being drawn, when that is somewhere with a subject. Read at call time. */
export type TreeScope = {
  taskId?: string
  projectId?: string
  /** The routed or rail-selected item, for a tree standing in for a project pane or a reference panel. */
  item?: string
}

export type RemoteTreeProps = {
  contribution: RemoteContribution
  /** What this tree is for. Reactive: a second mount for the same slot is a props update, which is how
   *  a tool card redraws on every transcript snapshot without its worker restarting. */
  props: () => unknown
  /**
   * What the owner of this slot will do if the tree asks (docs/plugins/remote-points.md § Asking the owner).
   *
   * Host-only. These never reach the worker in any form: a function cannot cross the boundary, and the
   * name is not sent either, so a tree learns which actions exist only from the point's own published
   * declaration. The tree names one and the host looks it up here.
   */
  actions?: () => OwnerActions
  /** The action names the owning extension point declared, as the host read them off the owner's
   *  manifest. Both lists have to contain a name before the host will forward it: the point says what
   *  may ever be asked, and `actions` says what this particular `Slot` is prepared to answer. */
  declaredActions?: () => readonly string[]
  /**
   * The task or project this tree is inside, for a tree that is a pane rather than a slot.
   *
   * Task and project authority is captured with this mount's QueryClient origin. Item props remain
   * reactive; a props update cannot lend the worker another mount's API or document grant.
   */
  scope?: () => TreeScope
  /** The shared composed owner's immutable opening selection, for legacy context affinity. */
  openingItem?: string
  /**
   * The sibling host editor's document, for a tree that is one region of a composed pane.
   *
   * An accessor rather than a value, because the two regions mount independently and either may be
   * first. Its absence is the whole permission check for the `document` verb: a tree either stands
   * beside a host editor or it does not, and there is no scope to declare either way
   * (../frames/broker.ts). The `frame` region of the same pane is handed the identical accessor.
   */
  document?: () => { read(): string; write(text: string): void; flush(): Promise<void> } | null
}

/** How long after a press a tree may still open its overlay. Long enough to cover the worker round
 *  trip the request makes, short enough that it cannot outlive the gesture a person made. */
const GESTURE_WINDOW_MS = 1_000

const treeRefusal = (contribution: RemoteContribution) => {
  const log = createLogger('plugins', contribution.pluginId)
  return (reason: string): void => log.warn(`${contribution.id}: ${reason}`, undefined, {
    'plugin.id': contribution.pluginId, 'plugin.surface': contribution.id,
  })
}

let slotSeq = 0

export function RemoteTree(componentProps: RemoteTreeProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const slot = `s${++slotSeq}`
  // The one place a remote tree's DOM is addressable, for the broker's `openUrl` gate: a click inside
  // the tree lands on one of the host's own components, which is a descendant of this element.
  let container: HTMLDivElement | undefined
  // When a person last acted inside this tree, as the proof that `openOverlay` is answering a gesture.
  //
  // `document.activeElement` was the original proof and is not enough on its own. WebKit does not move
  // focus to a button when it is clicked — that is the platform behaviour behind macOS's "Keyboard
  // navigation" setting, and the shell runs in a WKWebView — so a click on a kit `Button` leaves focus
  // on `<body>` and a tree could never open its companion overlay from a click at all. Capturing,
  // because the target is inside the host's own components and may stop the bubble.
  let lastGestureAt = 0
  const markGesture = (event: Event): void => { if (event.isTrusted) lastGestureAt = Date.now() }

  const contribution = componentProps.contribution
  const scope = (): TreeScope => componentProps.scope?.() ?? {}
  const refuse = treeRefusal(contribution)

  const registeredNode = queryOwner(qc)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const boundScope = scope()
  const binding = (): FrameBinding => {
    // The roster row this device resolved, which is where the manifest's scopes and event channels
    // live. Read here rather than passed in, so the owner's surface cannot widen what a contributor
    // may reach by getting a prop wrong.
    const owner = eligiblePlugins().find((entry) => entry.pluginId === contribution.pluginId)
    return {
      pluginId: contribution.pluginId,
      surface: contribution.id,
      target: 'remote',
      nodeId: nodeId ?? '',
      api: [...(owner?.installed.permissions.api ?? [])],
      events: [...(owner?.installed.permissions.events ?? [])],
      // A tree is not a pane and cannot open one it did not declare, so this is the plugin's own
      // task-scoped panes and nothing else, exactly as it is for a frame.
      panes: (owner?.installed.contributions.frames ?? []).filter(isTaskPane).map((frame) => frame.id),
      claimsKeys: [],
      // Getters, for the reason `scope` above states at length: the binding outlives any one tree.
      taskId: boundScope.taskId,
      projectId: boundScope.projectId,
    }
  }

  const bound = binding()
  // The row that opened this pane, when a row did. Retained by `openPane` until the pane consumes
  // it, so a tree mounting for the first time gets its selection in `context` rather than racing
  // its own mount against an event that has already fired — the same split a frame region makes
  // (../frames/PluginFrame.tsx). A routed item wins, because for a project-scoped surface it IS the
  // current selection rather than a one-shot.
  const opened = scope().item
    ?? (bound.taskId ? consumePaneIntent(bound.taskId, contribution.id, 'plugin:select') : undefined)
  const item = typeof opened === 'string' ? opened : opened?.kind === 'plugin:select' ? opened.item : undefined
  const context: PluginFrameContext = {
    surface: bound.surface,
    target: 'remote',
    nodeId: bound.nodeId,
    ...(bound.taskId ? { taskId: bound.taskId } : {}),
    ...(bound.projectId ? { projectId: bound.projectId } : {}),
    ...(item ? { item } : {}),
    theme: document.documentElement.dataset.theme ?? 'light',
    style: document.documentElement.dataset.style ?? 'terminal',
    claimsKeys: [],
  }
  const documentGrant = treeDocumentGrant(componentProps.document)
  context.authority = treeModelAuthorityKey(contribution.hash, qc, bound, context, componentProps.document)
  const legacyContext = componentProps.openingItem === undefined ? context : { ...context, item: componentProps.openingItem }
  const worker = acquireTreeWorker({
    pluginId: contribution.pluginId,
    hash: contribution.hash,
    authority: treeAuthorityKey(contribution.hash, qc, bound, legacyContext, componentProps.document),
    context: legacyContext,
    hasFocus: () => (container !== undefined && container.contains(document.activeElement)) || (lastGestureAt > 0 && Date.now() - lastGestureAt <= GESTURE_WINDOW_MS),
    onRefused: refuse,
    connect: createTreeBridgeFactory(
      { binding: bound, hash: contribution.hash, ...(documentGrant ? { document: documentGrant } : {}) },
      { qc, navigate }, context, refuse,
    ),
  })

  // ── What this tree may ask the host for (../frames/sdk/treeChannel.ts § TreeMount.host) ───────────────
  //
  // Two operations, each with its own grant, and both answered here rather than on the bridge. The
  // bridge belongs to the bundle; this belongs to one mounted contribution, which is the only scope in
  // which "which attachment was pressed" has an answer at all.
  const fail = (code: string, message: string): TreeHostResult => ({ ok: false, error: { code, message } })

  let lastOverlayAt = 0
  let openOverlayId = ''

  const openOverlay = async (name: string, input: unknown): Promise<TreeHostResult> => {
    // The one overlay this contribution's own manifest descriptor associated, and no other. A list would
    // make this a dispatcher; one name makes it a grant that is readable at trust time.
    //
    // Qualified first, because the two sides are not spelled the same. A frame id outside the plugin's
    // namespace is rewritten to `<pluginId>.<id>` when the device reads the roster row, and the
    // manifest's reference to it is rewritten with it (../plugins/contributionIds.ts) — but the string
    // a running tree passes is the one its author wrote in the manifest, and nothing rewrites that. So a
    // plugin declaring `editor` and asking for `editor` was refused for naming its own overlay.
    const wanted = qualifiedContributionId(contribution.pluginId, name)
    if (!contribution.overlay || wanted !== contribution.overlay) {
      return fail('unknown_overlay', `'${name}' is not the overlay this contribution declares`)
    }
    // A host with no overlay frames answers so rather than hanging. The terminal is the case: it mounts
    // remote trees and has no iframe to put one in, so a plugin catches this and leaves its static
    // preview up (apps/tui/src/plugins/RemoteTree.tsx).
    const owner = eligiblePlugins().find((entry) => entry.pluginId === contribution.pluginId)
    const declared = (owner?.installed.contributions.frames ?? []).some((frame) => frame.id === wanted && frame.target === 'overlay')
    if (!declared) return unsupportedOverlay()
    // A modal is a person's act, and this is where that is checked: either the shell's focus is inside
    // this tree, or somebody pressed something in it a moment ago. Both are things only a person
    // produces, which is what keeps a background timer from putting an editor in front of the reader,
    // and the throttle below backs them up the way it does for `openUrl` one rung down
    // (../frames/broker.ts).
    const now = Date.now()
    const focused = container !== undefined && container.contains(document.activeElement)
    if (!focused && now - lastGestureAt > GESTURE_WINDOW_MS) {
      return fail('needs_focus', 'openOverlay works from a click or key handler: the tree must be focused')
    }
    if (now - lastOverlayAt < 1_000) return fail('throttled', 'openOverlay is limited to one overlay per second')
    lastOverlayAt = now
    if (batchBytes(input ?? null) > TREE_LIMITS.hostRequestBytes) return fail('too_large', `an overlay input is capped at ${TREE_LIMITS.hostRequestBytes} bytes`)
    const opened = openPluginOverlayInvocation({
      pluginId: contribution.pluginId,
      surface: wanted,
      ...(input === undefined ? {} : { input }),
    })
    openOverlayId = opened.id
    const result = await opened.result
    if (openOverlayId === opened.id) openOverlayId = ''
    return { ok: true, body: result ?? null }
  }

  const attachGestures = (element: HTMLDivElement): void => {
    element.addEventListener('pointerdown', markGesture, { capture: true })
    element.addEventListener('keydown', markGesture, { capture: true })
  }
  const detachGestures = (): void => {
    container?.removeEventListener('pointerdown', markGesture, { capture: true })
    container?.removeEventListener('keydown', markGesture, { capture: true })
  }

  const detachHostRequests = worker.onHostRequest(slot, async (request) => {
    if (request.op === 'owner.invoke') {
      return answerOwnerInvoke({
        declared: componentProps.declaredActions?.() ?? [],
        actions: componentProps.actions?.() ?? {},
        name: request.name,
        payload: request.payload,
      })
    }
    if (request.op === 'overlay.open') return openOverlay(request.name, request.payload)
    return unknownHostOp(String(request.op))
  })

  const transport = worker.transport(slot)
  const pushAppearance = (): void => worker.appearance(slot, {
    theme: document.documentElement.dataset.theme ?? 'light',
    style: document.documentElement.dataset.style ?? 'terminal',
    tokens: {},
  })
  pushAppearance()
  const unwatchAppearance = watchAppearance(pushAppearance)
  // Mount is also update: the first call starts the tree, every later one carries new props. Solid's
  // effect gives the "later one" for free, because `props()` is the caller's accessor.
  createEffect(() => worker.mount(slot, contribution.entry, componentProps.props()))

  // These pushes go to this slot's bridge, never the bundle's bootstrap bridge.
  //
  // A rail row picked while the pane is already open. `defer`, because the selection that opened the
  // pane crossed in the mount props and posting it again would restart a load already in flight.
  createEffect(on(() => scope().item, (next, previous) => {
    if (!next || next === previous) return
    worker.select(slot, next)
  }, { defer: true }))
  const unselect = clientEvents.on('presentation:pane-intent', (event) => {
    if (event.taskId !== scope().taskId || event.paneId !== contribution.id) return
    if (event.intent.kind !== 'plugin:select') return
    // Consumed here so the retained copy does not reach a later remount as a stale selection.
    consumePaneIntent(event.taskId, event.paneId)
    worker.select(slot, event.intent.item)
  })
  // A surface-scoped command the host resolved on this tree's behalf: the chord landed in the sibling
  // editor of a composed pane, or the row was picked in the palette.
  const unaction = clientEvents.on('plugin:surface-action', (event) => {
    if (event.pluginId !== contribution.pluginId || event.surface !== contribution.id) return
    worker.surfaceAction(slot, event.command)
  })

  onCleanup(() => {
    unwatchAppearance()
    detachGestures()
    unaction()
    unselect()
    detachHostRequests()
    // An overlay outliving the tree that asked for it is a modal nobody can answer: the reader would be
    // drawing on an attachment whose composer has gone. The invocation settles with `null` on the way
    // out, and the sandbox's own copy of the promise rejects when the host unmounts the slot.
    if (openOverlayId) closePluginOverlayFrom(openOverlayId)
    worker.unmount(slot)
    worker.release()
  })

  const pluginId = createMemo(() => contribution.pluginId)
  return (
    <div class="remote-tree" ref={(element) => { container = element; attachGestures(element) }}>
      <TreeHost pluginId={pluginId()} transport={transport} onRefused={refuse} />
    </div>
  )
}
