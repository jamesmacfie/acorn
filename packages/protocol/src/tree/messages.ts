// The wire between a plugin's sandbox and the host renderer: nodes, a mutation batch, an event, and
// the mount lifecycle. See docs/plugins.md § The tree contract.
//
// Nothing here names the DOM. A terminal host applies the same mutations to a cell buffer, and the
// events are the kit's eleven semantic names rather than keys or pointers, so a terminal host maps
// its own keys onto them.
import { z } from 'zod'
import { KIT_EVENTS } from './nodes.ts'

export { TREE_PROTOCOL_VERSION } from './nodes.ts'
import { propValue } from './props.ts'

/**
 * The caps. A batch past any of them is dropped whole and recorded, because half a batch is a tree
 * the sandbox did not describe.
 *
 * Sized like the state channel's 1 MiB per value: generous for anything honest, and small enough that
 * a bundle cannot use the renderer as a memory bomb.
 */
export const TREE_LIMITS = {
  /** Serialized bytes of one batch. */
  batchBytes: 1_048_576,
  /** Mutations in one batch. */
  batchOps: 4_000,
  /** Live nodes in one mounted tree. */
  treeNodes: 5_000,
  /** How deep a tree may nest. */
  depth: 64,
  /** Characters in one text node. */
  textLength: 65_536,
  /** Trees one worker may serve at once. */
  slotsPerWorker: 512,
} as const

const nodeId = z.string().min(1).max(64)
const slotId = z.string().min(1).max(128)
const props = z.record(z.string().min(1).max(64), propValue)

// A node's type is checked as a string here and resolved against the kit by the host, so a tree
// naming a node this build has never heard of renders the labelled placeholder rather than failing
// the whole batch. That is docs/plugins.md's forward-compatibility rule applied to nodes.
export type TreeNode = { id: string; type: string; props: Record<string, unknown>; children: TreeNode[] }

export const treeNode: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    id: nodeId,
    type: z.string().min(1).max(64),
    props: props.default({}),
    children: z.array(treeNode).max(TREE_LIMITS.treeNodes).default([]),
  }),
)

/** `parent: null` addresses the slot's root. */
export const mutation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert'), parent: nodeId.nullable(), index: z.number().int().min(0).max(TREE_LIMITS.treeNodes), node: treeNode }),
  z.object({ op: z.literal('remove'), id: nodeId }),
  z.object({ op: z.literal('patch'), id: nodeId, props }),
  z.object({ op: z.literal('move'), id: nodeId, parent: nodeId.nullable(), index: z.number().int().min(0).max(TREE_LIMITS.treeNodes) }),
  z.object({ op: z.literal('text'), id: nodeId, value: z.string().max(TREE_LIMITS.textLength) }),
])
// Declared rather than inferred, so a mutation's `props` is the same `Record<string, unknown>` a
// `TreeNode`'s is. The schema's inferred value type is the union of a handler ref and JSON, which is
// what the parse guarantees; spelling that in the type only makes every caller cast.
export type TreeMutation =
  | { op: 'insert'; parent: string | null; index: number; node: TreeNode }
  | { op: 'remove'; id: string }
  | { op: 'patch'; id: string; props: Record<string, unknown> }
  | { op: 'move'; id: string; parent: string | null; index: number }
  | { op: 'text'; id: string; value: string }

/** Sandbox to host. */
export const sandboxMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tree:ready'), version: z.number().int(), entries: z.array(z.string().min(1).max(64)).max(64) }),
  // `bytes` is the sandbox's own measurement of this batch, taken before it posted (frames/sdk.ts).
  // The host reads it instead of stringifying the batch a second time on the main thread: the message
  // has already been cloned into the renderer's heap by the time the host sees it, so re-serialising it
  // there costs another copy of the same bytes and prevents nothing. What actually bounds a hostile
  // bundle is `batchOps` here, `treeNodes`, `depth` and `textLength` in `mutation`, and the whole-batch
  // pre-flight in client-core/host/tree/treeState.ts, none of which the sandbox can talk its way past.
  // Absent from an older bundle, and then the host measures for itself.
  z.object({ kind: z.literal('tree:batch'), slot: slotId, ops: z.array(mutation).max(TREE_LIMITS.batchOps), bytes: z.number().int().min(0).optional() }),
  z.object({ kind: z.literal('tree:failed'), slot: slotId, message: z.string().max(1_000) }),
  z.object({ kind: z.literal('tree:pong') }),
])
export type TreeSandboxMessage = z.infer<typeof sandboxMessage>

/** Host to sandbox. A second `tree:mount` for a slot already mounted is a props update, which is what
 *  keeps a tool card's redraw one message rather than a teardown. */
export const hostMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tree:mount'), slot: slotId, entry: z.string().min(1).max(64), props: z.unknown() }),
  z.object({ kind: z.literal('tree:unmount'), slot: slotId }),
  z.object({ kind: z.literal('tree:event'), slot: slotId, handler: z.number().int().positive(), event: z.enum(KIT_EVENTS), payload: z.unknown() }),
  z.object({ kind: z.literal('tree:ping') }),
])
export type TreeHostMessage = z.infer<typeof hostMessage>

/** Cheap byte count for the cap. `JSON.stringify` is what crossed the port anyway.
 *
 *  Called on the sandbox's side of the port now, before it posts, and on the host's side only for a
 *  batch that arrived without a `bytes` field. */
export const batchBytes = (message: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(message)).byteLength
  } catch {
    // A cycle or a BigInt: not something structuredClone would have carried either.
    return Number.POSITIVE_INFINITY
  }
}
