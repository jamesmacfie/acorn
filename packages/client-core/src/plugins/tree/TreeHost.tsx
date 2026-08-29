import { batch, createMemo, createSignal, ErrorBoundary, For, onCleanup, Show, type JSX } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { Dynamic } from 'solid-js/web'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { TREE_LIMITS } from '@acorn/protocol/tree/messages.ts'
import { TEXT_NODE, isKitNode, type KitEvent } from '@acorn/protocol/tree/nodes.ts'
import { isHandlerRef, sanitizeProps } from '@acorn/protocol/tree/props.ts'
import { KIT_COMPONENTS } from './components'
import { TreePlaceholder } from './placeholder'

// The host end of the remote tree (docs/future/layout/06-remote-tree.md).
//
// This component is the only thing standing between a stranger's code and the shell's DOM, so the
// order matters: a batch is checked whole, applied whole, and only then rendered. Nothing a message
// carries becomes a class, a style, a URL or a function — a handler crosses as an id and this file
// mints the closure.
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

type Stored = { type: string; props: Record<string, unknown>; children: string[] }

export function TreeHost(props: TreeHostProps) {
  const [nodes, setNodes] = createStore<Record<string, Stored>>({})
  const [roots, setRoots] = createSignal<string[]>([])
  const [failed, setFailed] = createSignal<string | null>(null)
  // The parent of every live node, kept outside the store so the pre-flight check below can read it
  // without subscribing to anything. It is also how depth is bounded without walking the store.
  const parents = new Map<string, string | null>()

  const refuse = (reason: string): void => {
    props.onRefused?.(reason)
    console.warn(`[plugins] ${props.pluginId}: ${reason}`)
  }

  /**
   * Would this batch leave the tree consistent? Run before a single write, because the host never
   * renders half a batch: an op addressing a node that does not exist means the sandbox and the host
   * disagree about the tree, and applying the prefix would bake the disagreement in.
   *
   * Simulated against a projected copy of the parent map rather than the live one, so an op is judged
   * against the tree the ops before it in the same batch would have left — the alternative reads a
   * stale depth for anything a batch moves, and misses the case a `move` is dangerous for at all.
   */
  const acceptable = (ops: readonly TreeMutation[]): string | null => {
    if (ops.length > TREE_LIMITS.batchOps) return `batch of ${ops.length} mutations is over the cap`
    const projected = new Map(parents)

    /** Depth of a node, and the cycle check in the same walk: a chain that does not reach the root in
     *  `depth` steps is either too deep or a loop, and both are refusals. */
    const depthIn = (id: string | null): number => {
      let depth = 0
      let at = id
      while (at !== null) {
        if (++depth > TREE_LIMITS.depth) return depth
        at = projected.get(at) ?? null
      }
      return depth
    }

    for (const op of ops) {
      switch (op.op) {
        case 'insert': {
          if (op.parent !== null && !projected.has(op.parent)) return `insert under an unknown node ${op.parent}`
          const base = depthIn(op.parent)
          const stack: { node: typeof op.node; parent: string | null; depth: number }[] = [{ node: op.node, parent: op.parent, depth: base + 1 }]
          while (stack.length) {
            const { node, parent, depth } = stack.pop()!
            if (depth > TREE_LIMITS.depth) return `tree deeper than ${TREE_LIMITS.depth}`
            if (projected.has(node.id)) return `duplicate node id ${node.id}`
            projected.set(node.id, parent)
            if (projected.size > TREE_LIMITS.treeNodes) return `more than ${TREE_LIMITS.treeNodes} nodes`
            for (const child of node.children) stack.push({ node: child, parent: node.id, depth: depth + 1 })
          }
          break
        }
        case 'move': {
          if (!projected.has(op.id)) return `move of an unknown node ${op.id}`
          if (op.parent !== null && !projected.has(op.parent)) return `move under an unknown node ${op.parent}`
          // Into itself, or into one of its own descendants. Either makes a cycle, and a cycle is an
          // infinite render rather than a wrong one.
          let ancestor = op.parent
          while (ancestor !== null) {
            if (ancestor === op.id) return `move of ${op.id} inside itself`
            ancestor = projected.get(ancestor) ?? null
          }
          projected.set(op.id, op.parent)
          if (depthIn(op.id) > TREE_LIMITS.depth) return `tree deeper than ${TREE_LIMITS.depth}`
          break
        }
        case 'remove': {
          if (!projected.has(op.id)) return `remove of an unknown node ${op.id}`
          // With its subtree: a later op addressing a removed descendant is the sandbox and the host
          // disagreeing, which is what this whole pass exists to catch.
          for (const [id, parent] of [...projected]) {
            let at: string | null = parent
            while (at !== null) {
              if (at === op.id) {
                projected.delete(id)
                break
              }
              at = projected.get(at) ?? null
            }
          }
          projected.delete(op.id)
          break
        }
        case 'patch':
        case 'text':
          if (!projected.has(op.id)) return `${op.op} of an unknown node ${op.id}`
          break
      }
    }
    return null
  }

  const childrenOf = (id: string | null): string[] =>
    id === null ? roots() : nodes[id]?.children ?? []

  const setChildren = (id: string | null, next: string[]): void => {
    if (id === null) setRoots(next)
    else setNodes(id, 'children', next)
  }

  const detach = (id: string): void => {
    const parent = parents.get(id) ?? null
    setChildren(parent, childrenOf(parent).filter((child) => child !== id))
  }

  const forget = (id: string): void => {
    for (const child of nodes[id]?.children ?? []) forget(child)
    parents.delete(id)
    setNodes(produce((table) => { delete table[id] }))
  }

  const apply = (ops: readonly TreeMutation[]): void => {
    const problem = acceptable(ops)
    if (problem) return refuse(`dropped a whole batch: ${problem}`)
    batch(() => {
      for (const op of ops) {
        switch (op.op) {
          case 'insert': {
            const add = (node: typeof op.node, parent: string | null, index: number): void => {
              const { props: safe, dropped } = sanitizeProps(node.type, node.props)
              if (dropped.length) refuse(`${node.type} dropped props: ${dropped.join(', ')}`)
              setNodes(node.id, { type: node.type, props: safe, children: [] })
              parents.set(node.id, parent)
              const siblings = [...childrenOf(parent)]
              siblings.splice(Math.min(index, siblings.length), 0, node.id)
              setChildren(parent, siblings)
              node.children.forEach((child, at) => add(child, node.id, at))
            }
            add(op.node, op.parent, op.index)
            break
          }
          case 'remove':
            detach(op.id)
            forget(op.id)
            break
          case 'patch': {
            const { props: safe, dropped } = sanitizeProps(nodes[op.id]!.type, op.props)
            if (dropped.length) refuse(`${nodes[op.id]!.type} dropped props: ${dropped.join(', ')}`)
            // A null means "the sandbox unset this", which is `undefined` to a Solid component.
            for (const [name, value] of Object.entries(safe)) setNodes(op.id, 'props', name, value === null ? undefined : value)
            break
          }
          case 'move': {
            detach(op.id)
            parents.set(op.id, op.parent)
            const siblings = [...childrenOf(op.parent)]
            siblings.splice(Math.min(op.index, siblings.length), 0, op.id)
            setChildren(op.parent, siblings)
            break
          }
          case 'text':
            setNodes(op.id, 'props', 'value', op.value)
            break
        }
      }
    })
  }

  // Coalesced per frame. The sandbox already batches its own render pass, so this only matters for a
  // bundle sending faster than the screen redraws, which is the case the throttle exists for.
  let queued: TreeMutation[] = []
  let frame = 0
  const flush = (): void => {
    frame = 0
    const ops = queued
    queued = []
    if (ops.length) apply(ops)
  }
  const detachBatch = props.transport.onBatch((ops) => {
    queued.push(...ops)
    if (frame) return
    frame = requestAnimationFrame(flush)
  })
  const detachFailed = props.transport.onFailed((message) => setFailed(message))
  onCleanup(() => {
    detachBatch()
    detachFailed()
    if (frame) cancelAnimationFrame(frame)
  })

  const NodeView = (own: { id: string }): JSX.Element => {
    const stored = () => nodes[own.id]
    const type = () => stored()?.type ?? ''
    const resolved = createMemo(() => {
      const out: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(stored()?.props ?? {})) {
        // The only place a handler becomes a function. The id is the sandbox's; this closure is the
        // host's, and it carries the kit's payload rather than anything the DOM knows.
        if (isHandlerRef(value)) out[name] = (payload: unknown) => props.transport.send(value.$handler, name as KitEvent, payload)
        else out[name] = value
      }
      return out
    })
    return (
      <Show when={stored()} keyed={false}>
        <Show when={type() !== TEXT_NODE} fallback={<>{String(stored()!.props.value ?? '')}</>}>
          <Show when={isKitNode(type())} fallback={<TreePlaceholder pluginId={props.pluginId} detail={type()} />}>
            <Dynamic component={KIT_COMPONENTS[type() as keyof typeof KIT_COMPONENTS]} {...resolved()}>
              <For each={stored()!.children}>{(child) => <NodeView id={child} />}</For>
            </Dynamic>
          </Show>
        </Show>
      </Show>
    )
  }

  return (
    <Show when={!failed()} fallback={<TreePlaceholder pluginId={props.pluginId} detail={failed() ?? undefined} />}>
      {/* One boundary per tree, not per node: a kit component that throws on a stranger's props takes
          its own tree down and nothing else. The owner's surface around it is untouched, which is the
          containment promise the design makes. */}
      <ErrorBoundary fallback={(error: unknown) => <TreePlaceholder pluginId={props.pluginId} detail={error instanceof Error ? error.message : String(error)} />}>
        <For each={roots()}>{(id) => <NodeView id={id} />}</For>
      </ErrorBoundary>
    </Show>
  )
}
