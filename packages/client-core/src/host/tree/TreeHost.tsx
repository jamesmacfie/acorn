import { createEffect, createMemo, ErrorBoundary, For, onCleanup, Show, Suspense, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { CHROME_SLOT_NODE, TEXT_NODE, isKitNode, type KitEvent } from '@acorn/protocol/tree/nodes.ts'
import { KIT_COMPONENTS } from './components'
import { kitComponent } from './kitEntry'
import { createTreeState } from './treeState'
import { NestedChromeSlot } from '../plugins/NestedChromeSlot'
import type { SlotRef } from '@acorn/protocol/chrome.ts'
import { useExclusiveSlotFailure } from '../plugins/ExclusiveSlotFailure'
import { markdownFences } from '../markdownFences/MarkdownFences'
import type { FenceScope } from '../markdownFences/fenceViewers'

// The DOM host's end of the remote tree (docs/plugins/tree-contract.md § The tree contract).
//
// This component is the only thing standing between a stranger's code and the shell's DOM. What it is
// not is the rules: the store, the pre-flight check and the mutation apply are ./treeState.ts, which
// the terminal host draws from too (docs/tui.md). One set of rules, two shells.
//
// Focus, selection, scroll memory and ARIA are not implemented here and never will be. The nodes this
// mounts are the kit's own components, so they arrive with all of that already.

/** What a mounted tree talks to its sandbox through. One per slot; the worker host supplies it. */
export type TreeTransport = {
  /** A validated batch for this slot. Return the detach. */
  onBatch(listener: (ops: readonly TreeMutation[]) => void): () => void
  /** The sandbox gave up on this slot, or the worker died. */
  onFailed(listener: (message: string) => void): () => void
  /** Post an event back. */
  send(handler: number, event: KitEvent, payload: unknown): void
}

export type TreeHostProps = {
  pluginId: string
  /** The Node this tree's plugin answers on. An `Artwork` node's picture is read from it and nowhere
   *  else; without it, the node draws its fallback. */
  nodeId?: string
  transport: TreeTransport
  /** Called with a one-line reason whenever something was refused, for the roster row. */
  onRefused?: (reason: string) => void
  /** Called with the reason when the whole tree fails and draws nothing. */
  onFailed?: (reason: string) => void
  /**
   * The scope this tree's `Markdown` nodes view their fences in (`core:markdown-fence`), for a tree that
   * is a top-level owner surface such as a plugin's pane. Absent for a contributor drawn in another
   * owner's slot, whose `Markdown` keeps plain fences: cooperative points stay one level deep.
   */
  markdownFences?: FenceScope
}

export function TreeHost(props: TreeHostProps) {
  const reportExclusiveFailure = useExclusiveSlotFailure()
  const reportFailure = (reason: string): void => {
    reportExclusiveFailure?.(reason)
    props.onFailed?.(reason)
  }
  const state = createTreeState({
    pluginId: props.pluginId,
    transport: props.transport,
    ...(props.onRefused ? { onRefused: props.onRefused } : {}),
  })
  onCleanup(() => state.dispose())
  createEffect(() => {
    const failed = state.failed()
    if (failed) reportFailure(failed)
  })

  const NodeView = (own: { id: string }): JSX.Element => {
    const stored = () => state.nodes[own.id]
    const type = () => stored()?.type ?? ''
    // A node keeps its type for life, so one fence adapter, and one viewer cap, per `Markdown` node.
    const fences = type() === 'Markdown' && props.markdownFences ? markdownFences(props.markdownFences) : undefined
    // Set on the object rather than spread after it: the host's answer replaces anything a worker sent
    // under the same name, and a spread would let a worker's value through wherever the host's is
    // `undefined`.
    const resolved = createMemo(() => {
      const own = state.resolveProps(stored())
      if (type() === 'Markdown') return { ...own, fences }
      // The picture's owner is this mount's, so a tree can only show artwork from its own routes.
      if (type() === 'Artwork')
        return { ...own, owner: props.nodeId ? { nodeId: props.nodeId, pluginId: props.pluginId } : undefined }
      return own
    })
    return (
      <Show when={stored()} keyed={false}>
        <Show when={type() !== TEXT_NODE} fallback={<>{String(stored()!.props.value ?? '')}</>}>
          <Show
            when={type() === CHROME_SLOT_NODE}
            fallback={
              <Show when={isKitNode(type())}>
                <Dynamic
                  component={kitComponent(KIT_COMPONENTS[type() as keyof typeof KIT_COMPONENTS])}
                  {...resolved()}
                >
                  <For each={stored()!.children}>{(child) => <NodeView id={child} />}</For>
                </Dynamic>
              </Show>
            }
          >
            <NestedChromeSlot slotRef={resolved().slotRef as SlotRef} />
          </Show>
        </Show>
      </Show>
    )
  }

  return (
    <Show when={!state.failed()}>
      {/* One boundary per tree, not per node: a kit component that throws on a stranger's props takes
          its own tree down and nothing else. A failed optional contribution stays out of the owner's
          UI rather than replacing it with an error. */}
      <ErrorBoundary
        fallback={(error) => {
          reportFailure(String(error))
          return null
        }}
      >
        {/* One boundary per root, not per node and not one for the whole slot. A heavy node is a
            loader (./kitEntry.ts), and a pending `lazy()` renders as an empty string — invisible on
            the DOM, refused by a cell host, so `fallback={null}` is the shape the pane registry
            already settled on (../registries/panes/panes.ts). Per root rather than per tree so a
            root waiting on a diff viewer does not blank the roots beside it. */}
        <For each={state.roots()}>
          {(id) => (
            <Suspense fallback={null}>
              <NodeView id={id} />
            </Suspense>
          )}
        </For>
      </ErrorBoundary>
    </Show>
  )
}
