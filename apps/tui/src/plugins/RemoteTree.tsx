/** @jsxImportSource @acorn/tui/jsx */
import { queryOwner } from '@acorn/client-core/infra/node'
import { createEffect, createMemo, on, onCleanup } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import type { Renderable } from '../tree/compat'
import type { PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import type { FrameBinding } from '@acorn/client-core/host/frames/broker.ts'
import { eligiblePlugins, isTaskPane } from '@acorn/client-core/host/plugins'
import { recordSurfaceFailure } from '@acorn/client-core/host/plugins'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { clientEvents, consumePaneIntent } from '@acorn/client-core/host/registries/commands'
import { acquireTreeWorker, treeAuthorityKey, treeModelAuthorityKey, treeDocumentGrant } from '@acorn/client-core/host/tree/workerHost.ts'
import {
  createTreeBridgeFactory, answerOwnerInvoke, unknownHostOp, unsupportedOverlay, type OwnerActions,
} from '@acorn/client-core/host/tree'
import type { RemoteContribution } from '@acorn/client-core/host/tree'
import { toast } from '@acorn/client-core/features/notifications'
import { copyToTerminal } from '../kit/copy'
import { focusedRenderable } from '../keys/regions'
import { TreeHost } from './TreeHost'

// One tree from one plugin, drawn where the owner asked for it, in cells.
//
// The terminal's sibling of `client-core/host/tree/RemoteTree.tsx`, and the same division of labour:
// this is lifecycle and wiring, the broker decides every bridge call, and ./TreeHost.tsx applies every
// mutation. Everything below the bridge is shared with the desktop — the same fourteen effects, the
// same three pushes, the same worker host — and what differs is the four answers a terminal has to
// give differently, each marked where it is given.

export type RemoteTreeProps = {
  contribution: RemoteContribution
  /** What this tree is for. Reactive: a second mount for the same slot is a props update. */
  props: () => unknown
  /** The task or project this tree is inside. Task and project authority is captured at construction; item props remain reactive. */
  scope?: () => { taskId?: string; projectId?: string; item?: string }
  /** Immutable opening selection shared by this composed owner's regions. */
  openingItem?: string
  /** The sibling host editor's document, for a tree that is one region of a composed pane. An accessor
   *  because the two regions mount independently; its absence is the whole permission check for the
   *  `document` verb, exactly as it is on the desktop. */
  document?: () => { read(): string; write(text: string): void; flush(): Promise<void> } | null
  /** What the owner of this slot will do if the tree asks, and what the owning point declared it may
   *  ask for. The same pair the desktop takes, answered by the same shared check, because what a
   *  contributor may ask its owner to do is not a question about which host is drawing. */
  actions?: () => OwnerActions
  declaredActions?: () => readonly string[]
}

const treeRefusal = (contribution: RemoteContribution) => (reason: string): void => {
  recordSurfaceFailure(contribution.pluginId, contribution.id, new Error(reason))
}
const copy = (text: string): void => { if (!copyToTerminal(text)) toast(`Copy by hand: ${text}`) }
const openExternal = (url: string): void => toast(`Open in a browser: ${url}`)
const navigate = (): void => {}

let slotSeq = 0

export function RemoteTree(componentProps: RemoteTreeProps) {
  const qc = useQueryClient()
  const slot = `s${++slotSeq}`
  // Where this tree drew, for the bridge's focus gate. The DOM asks whether `document.activeElement`
  // is inside the tree's element; here focus is the renderer's, so the same question is whether the
  // focused renderable has this box among its parents.
  let container: Renderable | undefined

  const contribution = componentProps.contribution
  const scope = () => componentProps.scope?.() ?? {}
  const refuse = treeRefusal(contribution)

  const holdsFocus = (): boolean => {
    let at: Renderable | null | undefined = focusedRenderable()
    while (at) {
      if (at === container) return true
      at = at.parent as Renderable | null | undefined
    }
    return false
  }

  const registeredNode = queryOwner(qc)
  const nodeId = registeredNode === undefined ? activeNodeId() : registeredNode
  const boundScope = scope()
  const binding = (): FrameBinding => {
    const owner = eligiblePlugins().find((entry) => entry.pluginId === contribution.pluginId)
    return {
      pluginId: contribution.pluginId,
      surface: contribution.id,
      target: 'remote',
      nodeId: nodeId ?? '',
      api: [...(owner?.installed.permissions.api ?? [])],
      events: [...(owner?.installed.permissions.events ?? [])],
      panes: (owner?.installed.contributions.frames ?? []).filter(isTaskPane).map((frame) => frame.id),
      claimsKeys: [],
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
    // This host has one appearance and it is the reader's own terminal: no stylesheet, no tokens,
    // and no theme id to resolve until the appearance layer publishes its colours as data
    // (../appearance.ts, docs/tui.md).
    theme: 'terminal',
    style: 'terminal',
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
    hasFocus: holdsFocus,
    onRefused: refuse,
    connect: createTreeBridgeFactory(
      { binding: bound, hash: contribution.hash, ...(documentGrant ? { document: documentGrant } : {}) },
      { qc, navigate, copy, openExternal }, context, refuse,
    ),
  })

  // The fifth answer a terminal gives differently. An owner action is host-agnostic and goes through
  // the shared check; a companion overlay is a rectangle over the window, and this host has none, so it
  // says so rather than pretending. A plugin catches `unsupported_host` and leaves its static preview
  // up, which is why the owner's chip is what a reader sees here (docs/tui.md § Plugin surfaces).
  const detachHostRequests = worker.onHostRequest(slot, async (request) => {
    if (request.op === 'owner.invoke') {
      return answerOwnerInvoke({
        declared: componentProps.declaredActions?.() ?? [],
        actions: componentProps.actions?.() ?? {},
        name: request.name,
        payload: request.payload,
      })
    }
    if (request.op === 'overlay.open') return unsupportedOverlay()
    return unknownHostOp(String(request.op))
  })

  const transport = worker.transport(slot)
  worker.appearance(slot, { theme: 'terminal', style: 'terminal', tokens: {} })
  // Mount is also update: the first call starts the tree, every later one carries new props.
  createEffect(() => worker.mount(slot, contribution.entry, componentProps.props()))

  // Selection and actions go to this slot's bridge, as they do in the DOM host.
  createEffect(on(() => scope().item, (next, previous) => {
    if (!next || next === previous) return
    worker.select(slot, next)
  }, { defer: true }))
  const unselect = clientEvents.on('presentation:pane-intent', (event) => {
    if (event.taskId !== scope().taskId || event.paneId !== contribution.id) return
    if (event.intent.kind !== 'plugin:select') return
    consumePaneIntent(event.taskId, event.paneId)
    worker.select(slot, event.intent.item)
  })
  const unaction = clientEvents.on('plugin:surface-action', (event) => {
    if (event.pluginId !== contribution.pluginId || event.surface !== contribution.id) return
    worker.surfaceAction(slot, event.command)
  })

  onCleanup(() => {
    unaction()
    unselect()
    detachHostRequests()
    worker.unmount(slot)
    worker.release()
  })

  const pluginId = createMemo(() => contribution.pluginId)
  return (
    <box flexDirection="column" flexGrow={1} ref={(element: Renderable) => { container = element }}>
      <TreeHost pluginId={pluginId()} transport={transport} onRefused={refuse} />
    </box>
  )
}
