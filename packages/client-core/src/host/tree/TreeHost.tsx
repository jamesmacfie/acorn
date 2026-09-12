import { createMemo, ErrorBoundary, For, onCleanup, Show, Suspense, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { TEXT_NODE, isKitNode, type KitEvent } from '@acorn/protocol/tree/nodes.ts'
import { KIT_COMPONENTS } from './components'
import { kitComponent } from './kitEntry'
import { TreePlaceholder } from './placeholder'
import { createTreeState } from './treeState'

// The DOM host's end of the remote tree (docs/plugins.md § The tree contract).
//
// This component is the only thing standing between a stranger's code and the shell's DOM. What it is
// not is the rules: the store, the pre-flight check and the mutation apply are ./treeState.ts, which
// the terminal host draws from too (docs/tui.md). One set of rules,
// two shells.
//
// Focus, selection, scroll memory and ARIA are not implemented here and never will be. The nodes this
// mounts are the kit's own components, so they arrive with everything phase 2 gave them. That is the
// whole reason the remote root came after focus rather than before it.

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
  transport: TreeTransport
  /** Called with a one-line reason whenever something was refused, for the roster row. */
  onRefused?: (reason: string) => void
}

export function TreeHost(props: TreeHostProps) {
  const state = createTreeState({
    pluginId: props.pluginId,
    transport: props.transport,
    ...(props.onRefused ? { onRefused: props.onRefused } : {}),
  })
  onCleanup(() => state.dispose())

  const NodeView = (own: { id: string }): JSX.Element => {
    const stored = () => state.nodes[own.id]
    const type = () => stored()?.type ?? ''
    const resolved = createMemo(() => state.resolveProps(stored()))
    return (
      <Show when={stored()} keyed={false}>
        <Show when={type() !== TEXT_NODE} fallback={<>{String(stored()!.props.value ?? '')}</>}>
          <Show when={isKitNode(type())} fallback={<TreePlaceholder pluginId={props.pluginId} detail={type()} />}>
            <Dynamic component={kitComponent(KIT_COMPONENTS[type() as keyof typeof KIT_COMPONENTS])} {...resolved()}>
              <For each={stored()!.children}>{(child) => <NodeView id={child} />}</For>
            </Dynamic>
          </Show>
        </Show>
      </Show>
    )
  }

  return (
    <Show when={!state.failed()} fallback={<TreePlaceholder pluginId={props.pluginId} detail={state.failed() ?? undefined} />}>
      {/* One boundary per tree, not per node: a kit component that throws on a stranger's props takes
          its own tree down and nothing else. The owner's surface around it is untouched, which is the
          containment promise the design makes. */}
      <ErrorBoundary fallback={(error: unknown) => <TreePlaceholder pluginId={props.pluginId} detail={error instanceof Error ? error.message : String(error)} />}>
        {/* One boundary per root, not per node and not one for the whole slot. A heavy node is a
            loader (./kitEntry.ts), and a pending `lazy()` renders as an empty string — invisible on
            the DOM, refused by a cell host, so `fallback={null}` is the shape the pane registry
            already settled on (../registries/panes/panes.ts). Per root rather than per tree so a
            root waiting on a diff viewer does not blank the roots beside it. */}
        <For each={state.roots()}>{(id) => <Suspense fallback={null}><NodeView id={id} /></Suspense>}</For>
      </ErrorBoundary>
    </Show>
  )
}
