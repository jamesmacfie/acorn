import { createEffect, createMemo, onCleanup } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'
import { createFrameBridge, type FrameBinding } from '../frames/broker'
import { createFrameServices } from '../frames/frameServices'
import { eligiblePlugins, isTaskPane } from '../contributions'
import { recordSurfaceFailure } from '../surfaceFailures'
import { activeNodeId } from '../../node/activeNode'
import { TreeHost } from './TreeHost'
import type { RemoteContribution } from './registry'
import { acquireTreeWorker } from './workerHost'

// One tree from one plugin, drawn where the owner asked for it.
//
// The counterpart to PluginFrame.tsx, and the same division of labour: this component is lifecycle and
// wiring, the broker decides every bridge call, and TreeHost.tsx decides every mutation. What is
// different is what crosses. A frame gets a rectangle and draws it; a tree gets nothing but a port,
// and the pixels are the host's own components all the way down.

export type RemoteTreeProps = {
  contribution: RemoteContribution
  /** What this tree is for. Reactive: a second mount for the same slot is a props update, which is how
   *  a tool card redraws on every transcript snapshot without its worker restarting. */
  props: () => unknown
}

let slotSeq = 0

export function RemoteTree(componentProps: RemoteTreeProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const slot = `s${++slotSeq}`
  // The one place a remote tree's DOM is addressable, for the broker's `openUrl` gate: a click inside
  // the tree lands on one of the host's own components, which is a descendant of this element.
  let container: HTMLDivElement | undefined

  const contribution = componentProps.contribution
  const refuse = (reason: string): void => {
    recordSurfaceFailure(contribution.pluginId, contribution.id, new Error(reason))
  }

  const binding = (): FrameBinding => {
    // The roster row this device resolved, which is where the manifest's scopes and event channels
    // live. Read here rather than passed in, so the owner's surface cannot widen what a contributor
    // may reach by getting a prop wrong.
    const owner = eligiblePlugins().find((entry) => entry.pluginId === contribution.pluginId)
    return {
      pluginId: contribution.pluginId,
      surface: contribution.id,
      target: 'remote',
      nodeId: activeNodeId() ?? '',
      api: owner?.installed.permissions.api ?? [],
      events: owner?.installed.permissions.events ?? [],
      // A tree is not a pane and cannot open one it did not declare, so this is the plugin's own
      // task-scoped panes and nothing else, exactly as it is for a frame.
      panes: (owner?.installed.contributions.frames ?? []).filter(isTaskPane).map((frame) => frame.id),
      claimsKeys: [],
      // No task and no project, deliberately. One worker serves every tree its bundle draws, so one
      // bridge does too, and a bridge bound to whichever tree happened to start the worker would let a
      // card in one task push a pane into another. The subject reaches a tree through its mount props
      // instead, which are per slot and always current. What that costs is `bridge.ui.openPane` from a
      // tree, which is inert: opening into somebody else's task layout is not obviously a contributor's
      // to do, and phase 4 is where a slot's scope gets designed rather than inherited.
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
        theme: document.documentElement.dataset.theme ?? 'light',
        style: document.documentElement.dataset.style ?? 'terminal',
        claimsKeys: [],
      }
      return createFrameBridge({
        port,
        binding: bound,
        // The same fourteen effects a frame's bridge gets. A tree has no iframe to check focus
        // against, so the gate is whether the shell's focus is inside the element this tree drew into,
        // which is the same question one rung down.
        services: createFrameServices(
          { binding: bound, hash: contribution.hash },
          {
            qc,
            frameHasFocus: () => container !== undefined && container.contains(document.activeElement),
            navigate,
          },
        ),
        context,
        onMisbehaving: (reason) => refuse(`misbehaved on the bridge: ${reason}`),
      })
    },
  })

  const transport = worker.transport(slot)
  // Mount is also update: the first call starts the tree, every later one carries new props. Solid's
  // effect gives the "later one" for free, because `props()` is the caller's accessor.
  createEffect(() => worker.mount(slot, contribution.entry, componentProps.props()))
  onCleanup(() => {
    worker.unmount(slot)
    worker.release()
  })

  const pluginId = createMemo(() => contribution.pluginId)
  return (
    <div class="remote-tree" ref={container}>
      <TreeHost pluginId={pluginId()} transport={transport} onRefused={refuse} />
    </div>
  )
}
