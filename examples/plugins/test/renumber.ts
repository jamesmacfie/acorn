import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'

/** Node ids come from a counter that depends on what drew first, so a committed picture numbers them
 *  again in the order they appear. The site's specimen generator and the example pictures share it. */
export function renumber(batches: TreeMutation[][]): TreeMutation[][] {
  const ids = new Map<string, string>()
  const id = (old: string) => ids.get(old) ?? (ids.set(old, `n${ids.size + 1}`), ids.get(old)!)
  const node = (tree: TreeNode): TreeNode => ({ ...tree, id: id(tree.id), children: tree.children.map(node) })
  return batches.map((ops) =>
    ops.map((op) => {
      if (op.op === 'insert') return { ...op, parent: op.parent && id(op.parent), node: node(op.node) }
      if (op.op === 'move') return { ...op, id: id(op.id), parent: op.parent && id(op.parent) }
      return { ...op, id: id(op.id) }
    }),
  )
}
