/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, on, onCleanup } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import type { BoxRenderable, Renderable } from '@opentui/core'
import type { PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import { createFrameBridge, postSelect, postSurfaceAction, type FrameBinding } from '@acorn/client-core/host/frames/broker.ts'
import { createFrameServices } from '@acorn/client-core/host/frames/frameServices.ts'
import { eligiblePlugins, isTaskPane } from '@acorn/client-core/host/plugins/contributions.ts'
import { recordSurfaceFailure } from '@acorn/client-core/host/plugins/surfaceFailures.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { clientEvents, consumePaneIntent } from '@acorn/client-core/host/registries/commands/clientEvents.ts'
import { acquireTreeWorker } from '@acorn/client-core/host/tree/workerHost.ts'
import type { RemoteContribution } from '@acorn/client-core/host/tree/treeRegistry.ts'
import { toast } from '@acorn/client-core/features/notifications/toast.ts'
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
  /** The task or project this tree is inside. An accessor, read on every bridge call, because one
   *  worker serves every tree its bundle draws and therefore holds one bridge. */
  scope?: () => { taskId?: string; projectId?: string; item?: string }
}

let slotSeq = 0

export function RemoteTree(componentProps: RemoteTreeProps) {
  const qc = useQueryClient()
  const slot = `s${++slotSeq}`
  // Where this tree drew, for the bridge's focus gate. The DOM asks whether `document.activeElement`
  // is inside the tree's element; here focus is the renderer's, so the same question is whether the
  // focused renderable has this box among its parents.
  let container: BoxRenderable | undefined

  const contribution = componentProps.contribution
  const scope = () => componentProps.scope?.() ?? {}
  const refuse = (reason: string): void => {
    recordSurfaceFailure(contribution.pluginId, contribution.id, new Error(reason))
  }

  const holdsFocus = (): boolean => {
    let at: Renderable | null | undefined = focusedRenderable()
    while (at) {
      if (at === container) return true
      at = at.parent as Renderable | null | undefined
    }
    return false
  }

  const binding = (): FrameBinding => {
    const owner = eligiblePlugins().find((entry) => entry.pluginId === contribution.pluginId)
    return {
      pluginId: contribution.pluginId,
      surface: contribution.id,
      target: 'remote',
      nodeId: activeNodeId() ?? '',
      api: owner?.installed.permissions.api ?? [],
      events: owner?.installed.permissions.events ?? [],
      panes: (owner?.installed.contributions.frames ?? []).filter(isTaskPane).map((frame) => frame.id),
      claimsKeys: [],
      get taskId() {
        return scope().taskId
      },
      get projectId() {
        return scope().projectId
      },
    }
  }

  const worker = acquireTreeWorker({
    pluginId: contribution.pluginId,
    hash: contribution.hash,
    onRefused: refuse,
    connect: (port) => {
      const bound = binding()
      const context: PluginFrameContext = {
        surface: bound.surface,
        target: 'remote',
        nodeId: bound.nodeId,
        ...(bound.taskId ? { taskId: bound.taskId } : {}),
        ...(bound.projectId ? { projectId: bound.projectId } : {}),
        // This host has one appearance and it is the reader's own terminal: no stylesheet, no tokens,
        // and no theme id to resolve until the appearance layer publishes its colours as data
        // (../appearance.ts, docs/future/terminal/findings.md).
        theme: 'terminal',
        style: 'terminal',
        claimsKeys: [],
      }
      return createFrameBridge({
        port,
        binding: bound,
        services: createFrameServices(
          { binding: bound, hash: contribution.hash },
          {
            qc,
            frameHasFocus: holdsFocus,
            // No router here, so the route rung of a content link has nothing to navigate. The pane and
            // panel rungs above it still resolve, and what neither claims falls to `openExternal`.
            navigate: () => {},
            // OSC 52 where the terminal takes it, and the value on screen where it does not
            // (../kit/copy.ts). `navigator.clipboard` is the DOM's answer and there is none here.
            copy: (text) => { if (!copyToTerminal(text)) toast(`Copy by hand: ${text}`) },
            // There is no window to open one in, and shelling out to a browser from a terminal a person
            // may be reaching over ssh would open it on the wrong machine.
            openExternal: (url) => toast(`Open in a browser: ${url}`),
          },
        ),
        context,
        onMisbehaving: (reason) => refuse(`misbehaved on the bridge: ${reason}`),
      })
    },
  })

  const transport = worker.transport(slot)
  // Mount is also update: the first call starts the tree, every later one carries new props.
  createEffect(() => worker.mount(slot, contribution.entry, componentProps.props()))

  // The three pushes that are not tree mutations, exactly as the DOM host sends them: they ride the
  // bridge rather than the tree channel, because they are the same messages a frame gets.
  createEffect(on(() => scope().item, (next, previous) => {
    const port = worker.bridgePort()
    if (!port || !next || next === previous) return
    postSelect(port, next)
  }, { defer: true }))
  const unselect = clientEvents.on('presentation:pane-intent', (event) => {
    const port = worker.bridgePort()
    if (!port || event.taskId !== scope().taskId || event.paneId !== contribution.id) return
    if (event.intent.kind !== 'plugin:select') return
    consumePaneIntent(event.taskId, event.paneId)
    postSelect(port, event.intent.item)
  })
  const unaction = clientEvents.on('plugin:surface-action', (event) => {
    const port = worker.bridgePort()
    if (!port || event.pluginId !== contribution.pluginId || event.surface !== contribution.id) return
    postSurfaceAction(port, event.command)
  })

  onCleanup(() => {
    unaction()
    unselect()
    worker.unmount(slot)
    worker.release()
  })

  const pluginId = createMemo(() => contribution.pluginId)
  return (
    <box flexDirection="column" flexGrow={1} ref={(element: BoxRenderable) => { container = element }}>
      <TreeHost pluginId={pluginId()} transport={transport} onRefused={refuse} />
    </box>
  )
}
