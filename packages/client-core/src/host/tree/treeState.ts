import { batch, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { TREE_LIMITS } from '@acorn/protocol/tree/messages.ts'
import type { KitEvent } from '@acorn/protocol/tree/nodes.ts'
import { isHandlerRef, sanitizeProps } from '@acorn/protocol/tree/props.ts'
import type { TreeTransport } from './TreeHost'

// The half of the remote tree host that is arithmetic rather than drawing: the store, the pre-flight
// check, the mutation apply, and the coalescer that feeds them (docs/plugins.md § The tree contract).
//
// Split out of TreeHost.tsx when the terminal grew a tree host of its own
// (docs/tui.md). There are two hosts and one set of rules: a batch
// is checked whole, applied whole, and only then rendered, and nothing a message carries becomes a
// class, a style, a URL or a function. Two copies of that would be two copies of a security decision.
//
// No JSX, so this is also the half a bare-Node suite can reach.

export type StoredNode = { type: string; props: Record<string, unknown>; children: string[] }

/** When to flush a queued batch. The DOM has a frame; a cell renderer has its own tick, and a bare
 *  Node process has neither, so the default is the next timer turn. */
export type TreeScheduler = { schedule(run: () => void): number; cancel(handle: number): void }

const defaultScheduler: TreeScheduler =
  typeof requestAnimationFrame === 'function'
    ? { schedule: (run) => requestAnimationFrame(run), cancel: (handle) => cancelAnimationFrame(handle) }
    : { schedule: (run) => setTimeout(run, 0) as unknown as number, cancel: (handle) => clearTimeout(handle) }

export type TreeStateInput = {
  pluginId: string
  transport: TreeTransport
  /** A one-line reason something was refused, for the roster row. */
  onRefused?: (reason: string) => void
  scheduler?: TreeScheduler
}

export function createTreeState(input: TreeStateInput) {
  const scheduler = input.scheduler ?? defaultScheduler
  const [nodes, setNodes] = createStore<Record<string, StoredNode>>({})
  const [roots, setRoots] = createSignal<string[]>([])
  const [failed, setFailed] = createSignal<string | null>(null)
  // The parent of every live node, kept outside the store so the pre-flight check below can read it
  // without subscribing to anything. It is also how depth is bounded without walking the store.
  const parents = new Map<string, string | null>()

  const refuse = (reason: string): void => {
    input.onRefused?.(reason)
    console.warn(`[plugins] ${input.pluginId}: ${reason}`)
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

  // Coalesced per tick. The sandbox already batches its own render pass, so this only matters for a
  // bundle sending faster than the screen redraws, which is the case the throttle exists for.
  let queued: TreeMutation[] = []
  let handle = 0
  const flush = (): void => {
    handle = 0
    const ops = queued
    queued = []
    if (ops.length) apply(ops)
  }
  const detachBatch = input.transport.onBatch((ops) => {
    queued.push(...ops)
    if (handle) return
    handle = scheduler.schedule(flush)
  })
  const detachFailed = input.transport.onFailed((message) => setFailed(message))

  return {
    nodes,
    roots,
    failed,
    /**
     * One node's props, ready to spread. The only place a handler becomes a function: the id is the
     * sandbox's, this closure is the host's, and it carries the kit's payload rather than anything the
     * DOM knows.
     */
    resolveProps(stored: StoredNode | undefined): Record<string, unknown> {
      const out: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(stored?.props ?? {})) {
        if (isHandlerRef(value)) out[name] = (payload: unknown) => input.transport.send(value.$handler, name as KitEvent, payload)
        else out[name] = value
      }
      return out
    },
    dispose(): void {
      detachBatch()
      detachFailed()
      if (handle) scheduler.cancel(handle)
    },
    /** Test seam: apply a batch without waiting for a tick. */
    _apply: apply,
  }
}
