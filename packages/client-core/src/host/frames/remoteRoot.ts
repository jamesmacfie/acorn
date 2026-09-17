// The remote root: what a sandboxed plugin's UI code builds instead of DOM.
//
// It runs inside the sandbox, so the rules at the top of ./sdk.ts apply here too — types only from
// anything that reaches the shell, nothing that touches `window`. A foreign plugin's own bundler
// bundles this file.
//
// The shape is deliberately the one `solid-js/universal`'s `createRenderer` asks for: create a node,
// set a property, insert before an anchor, walk to a parent or a sibling. Which is also why the
// mutators below are free functions rather than methods on the root — that babel preset emits
// module-level calls, so a per-root closure could not be reached from the generated code. A node
// carries the root it is attached to instead, and detached nodes emit nothing at all.
import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { TEXT_NODE, isKitEvent } from '@acorn/protocol/tree/nodes.ts'

/** What the root does when one of its nodes changes. Held on the node so a mutator can find it. */
type Attached = {
  push(op: TreeMutation): void
  handlerFor(fn: (payload: unknown) => void): number
  /** The slot's own root node. Identity, not a type name: a plugin can create a node called `#root`
   *  and it must not become one. */
  isRoot(node: RemoteNode): boolean
}

export type RemoteNode = {
  readonly id: string
  readonly type: string
  props: Record<string, unknown>
  parent: RemoteNode | null
  children: RemoteNode[]
}

// Which root a node hangs from, or nothing while it is detached. A side table rather than a field, so
// the node an adapter walks carries only what the tree is made of: a plugin cannot reach the emitter
// by poking at its own nodes, and the published type has nothing opaque in it.
//
// A subtree built detached crosses once, as the `insert` that attaches it, rather than as a mutation
// per node — that is what "no entry in this map" means.
const rootOf = new WeakMap<RemoteNode, Attached>()

export type RemoteRoot = {
  /** The node a framework renders into. Its children are the tree the host draws. */
  readonly node: RemoteNode
  /** Call the closure a handler id stands for. The host never sees the function. */
  dispatch(handler: number, payload: unknown): void
  /** Drop everything. Called when the host unmounts this slot. */
  dispose(): void
}

// Ids are minted here rather than per root because `createNode` has no root to ask: a node is created
// detached and only learns where it belongs when something inserts it. Global uniqueness costs one
// counter and removes the question entirely.
let seq = 0

export const createNode = (type: string): RemoteNode => ({
  id: `n${++seq}`,
  type,
  props: {},
  parent: null,
  children: [],
})

export const createText = (value: string): RemoteNode => {
  const node = createNode(TEXT_NODE)
  node.props.value = value
  return node
}

export const isTextNode = (node: RemoteNode): boolean => node.type === TEXT_NODE
export const parentOf = (node: RemoteNode): RemoteNode | null => node.parent
export const firstChild = (node: RemoteNode): RemoteNode | null => node.children[0] ?? null
export const nextSibling = (node: RemoteNode): RemoteNode | null => {
  const siblings = node.parent?.children
  if (!siblings) return null
  return siblings[siblings.indexOf(node) + 1] ?? null
}

type WireJson = string | number | boolean | null | WireJson[] | { [key: string]: WireJson }

const notWireable = Symbol('not-wireable')

/**
 * Copy a prop into the data-only shape the tree protocol accepts.
 *
 * This is a copy, not just a check. Solid stores expose otherwise ordinary arrays and records through
 * proxies, and a MessagePort refuses a proxy even though JSON.stringify can read it. Copying here
 * keeps the worker boundary honest and also means a nested function or class instance is rejected
 * before one bad prop can stop every mounted tree from the same plugin.
 */
const wireJson = (value: unknown, ancestors: Set<object>): WireJson | typeof notWireable => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : notWireable
  if (typeof value !== 'object') return notWireable

  try {
    if (ancestors.has(value)) return notWireable
    ancestors.add(value)
    if (Array.isArray(value)) {
      const out: WireJson[] = []
      for (const item of value) {
        const next = wireJson(item, ancestors)
        if (next === notWireable) return notWireable
        out.push(next)
      }
      return out
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return notWireable
    const out: Record<string, WireJson> = {}
    for (const [key, item] of Object.entries(value)) {
      // A key whose value is `undefined` is left out, which is what `JSON.stringify` does with one.
      // An optional field written as `count: rows.length || undefined` is ordinary, and dropping the
      // whole prop over it would hand the host a `Tabs` with no `tabs`.
      if (item === undefined) continue
      const next = wireJson(item, ancestors)
      if (next === notWireable) return notWireable
      out[key] = next
    }
    return out
  } catch {
    return notWireable
  } finally {
    ancestors.delete(value)
  }
}

// A function is only ever sendable as one of the kit's semantic events. Anything else, including a
// nested function, is dropped here rather than being allowed to kill the plugin's shared worker.
const wireValue = (root: Attached, name: string, value: unknown): unknown => {
  if (typeof value === 'function') {
    if (!isKitEvent(name)) return undefined
    return { $handler: root.handlerFor(value as (payload: unknown) => void) }
  }
  const json = wireJson(value, new Set())
  return json === notWireable ? undefined : json
}

const serialize = (root: Attached, node: RemoteNode): TreeNode => {
  const props: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(node.props)) {
    const wire = wireValue(root, name, value)
    if (wire !== undefined) props[name] = wire
  }
  return { id: node.id, type: node.type, props, children: node.children.map((child) => serialize(root, child)) }
}

const attach = (node: RemoteNode, root: Attached | null): void => {
  if (root) rootOf.set(node, root)
  else rootOf.delete(node)
  for (const child of node.children) attach(child, root)
}

export function setProperty(node: RemoteNode, name: string, value: unknown): void {
  node.props[name] = value
  const root = rootOf.get(node)
  if (!root) return
  const wire = wireValue(root, name, value)
  // `undefined` is a prop the sandbox unset. It crosses as null, because JSON drops the other one.
  root.push({ op: 'patch', id: node.id, props: { [name]: wire === undefined ? null : wire } })
}

export function setText(node: RemoteNode, value: string): void {
  node.props.value = value
  rootOf.get(node)?.push({ op: 'text', id: node.id, value })
}

export function insertNode(parent: RemoteNode, node: RemoteNode, anchor?: RemoteNode | null): void {
  const index = anchor ? Math.max(0, parent.children.indexOf(anchor)) : parent.children.length
  const from = node.parent
  if (from) from.children.splice(from.children.indexOf(node), 1)
  parent.children.splice(index, 0, node)
  const wasAttached = rootOf.has(node)
  node.parent = parent
  const root = rootOf.get(parent)
  if (wasAttached) {
    // Already on screen: the host moves the node it has rather than being sent a second copy of it.
    root?.push({ op: 'move', id: node.id, parent: wireParent(root, parent), index })
    return
  }
  if (!root) return
  const payload = serialize(root, node)
  attach(node, root)
  root.push({ op: 'insert', parent: wireParent(root, parent), index, node: payload })
}

export function removeNode(parent: RemoteNode, node: RemoteNode): void {
  const at = parent.children.indexOf(node)
  if (at >= 0) parent.children.splice(at, 1)
  const root = rootOf.get(node)
  node.parent = null
  attach(node, null)
  root?.push({ op: 'remove', id: node.id })
}

/** `null` addresses the slot's own root, which the host owns and the sandbox never names. */
const wireParent = (root: Attached, node: RemoteNode): string | null => (root.isRoot(node) ? null : node.id)

/**
 * Build a root that streams its mutations to `emit`.
 *
 * `emit` is called with a batch, already coalesced: every synchronous run of changes, which is what
 * one render pass is, crosses as one message. The host applies a batch atomically or not at all, so a
 * partial one would be a tree the sandbox never described.
 */
export function createRemoteRoot(emit: (ops: TreeMutation[]) => void): RemoteRoot {
  let handlerSeq = 0
  const handlers = new Map<number, (payload: unknown) => void>()
  const handlerIds = new WeakMap<object, number>()
  let pending: TreeMutation[] = []
  let scheduled = false
  let disposed = false

  const flush = (): void => {
    scheduled = false
    if (disposed || !pending.length) return
    const ops = pending
    pending = []
    emit(ops)
  }

  const node = createNode('#root')

  const state: Attached = {
    isRoot: (candidate) => candidate === node,
    push: (op) => {
      if (disposed) return
      pending.push(op)
      if (scheduled) return
      scheduled = true
      // A microtask, not a timer: one render pass is synchronous, so this is the first moment the
      // tree is consistent again. The host coalesces per frame on its own side.
      queueMicrotask(flush)
    },
    // Stable per function, so a re-render passing the same closure does not churn the host's table.
    handlerFor: (fn) => {
      const existing = handlerIds.get(fn)
      if (existing !== undefined) {
        handlers.set(existing, fn)
        return existing
      }
      const id = ++handlerSeq
      handlerIds.set(fn, id)
      handlers.set(id, fn)
      return id
    },
  }

  rootOf.set(node, state)

  return {
    node,
    dispatch: (handler, payload) => { handlers.get(handler)?.(payload) },
    dispose: () => {
      disposed = true
      pending = []
      handlers.clear()
      attach(node, null)
    },
  }
}
