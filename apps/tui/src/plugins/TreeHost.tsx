/** @jsxImportSource @opentui/solid */
import { createMemo, ErrorBoundary, For, onCleanup, Show, Suspense, type JSX } from 'solid-js'
import { Dynamic } from '../tree/renderer'
import { TEXT_NODE, isKitNode } from '@acorn/protocol/tree/nodes.ts'
import { kitComponent } from '@acorn/client-core/host/tree/kitEntry.ts'
import { createTreeState } from '@acorn/client-core/host/tree/treeState.ts'
import type { TreeHostProps } from '@acorn/client-core/host/tree/TreeHost.tsx'
import { KIT_COMPONENTS } from '../kit/components'
import { Alert } from '../kit/showing'
import { nextTick } from '../kit/tick'

// The terminal's end of the remote tree: the same mutations, applied to cells.
//
// Everything that decides anything is `client-core/host/tree/treeState.ts` — the store, the whole-batch
// pre-flight check, the prop sanitiser, and the one place a handler id becomes a closure. This file is
// the shell around it, and it is the shell that differs: a different table of components behind each
// name, a placeholder drawn as an `Alert` rather than a `<div>`, and the renderer's tick in place of a
// frame (docs/tui.md § Unknown nodes and failed trees).
//
// So a loaded plugin and a compiled one are indistinguishable here, which is what the tree protocol
// exists to make true. `plugins.test.ts` is the twin of client-core's `twoPaths.test.tsx`.

/** What the reader sees where a tree could not be drawn: a node this build has never heard of, a batch
 *  over the caps, a worker that threw or stopped answering. Named, never blank. */
function TreePlaceholder(props: { pluginId: string; detail?: string }) {
  return (
    <Alert tone="warn">
      {`Part of ${props.pluginId} this version of acorn cannot draw${props.detail ? ` — ${props.detail}` : ''}`}
    </Alert>
  )
}

export function TreeHost(props: TreeHostProps) {
  const state = createTreeState({
    pluginId: props.pluginId,
    transport: props.transport,
    scheduler: nextTick,
    ...(props.onRefused ? { onRefused: props.onRefused } : {}),
  })
  onCleanup(() => state.dispose())

  const NodeView = (own: { id: string }): JSX.Element => {
    const stored = () => state.nodes[own.id]
    const type = () => stored()?.type ?? ''
    const resolved = createMemo(() => state.resolveProps(stored()))
    return (
      <Show when={stored()} keyed={false}>
        {/* A bare string, as on the DOM, so the kit node above it flattens it into its own run of
            text (../kit/cells.tsx § flatten). Loose text under a node that draws a box is the one
            shape a cell host refuses and the DOM absorbs; the boundary below names it. */}
        <Show when={type() !== TEXT_NODE} fallback={String(stored()!.props.value ?? '')}>
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
          its own tree down and nothing else. */}
      <ErrorBoundary fallback={(error: unknown) => <TreePlaceholder pluginId={props.pluginId} detail={error instanceof Error ? error.message : String(error)} />}>
        {/* One boundary per root, the same shape client-core's TreeHost takes. Every entry in this
            host's table is a component today, so nothing suspends; the boundary is here because the
            table's type allows a loader and because the kit is drawn from one set of names on both
            hosts. Safe under OpenTUI only because ../kit/reconciler.ts ties a node's destruction to
            its creating owner rather than to being detached — without that, a boundary that suspends
            after showing content comes back permanently blank. */}
        <For each={state.roots()}>{(id) => <Suspense fallback={null}><NodeView id={id} /></Suspense>}</For>
      </ErrorBoundary>
    </Show>
  )
}
