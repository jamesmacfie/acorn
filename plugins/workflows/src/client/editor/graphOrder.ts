// How a definition reads as a graph: which steps each one waits on, and the order the list draws them
// in. Both the editor (./draft.ts) and the run pane (../runs/runPaneModel.ts) read it.
//
// Its own module because the run pane's model is registered before the first draw, and importing it
// from ./draft.ts put the whole editor on the renderer's startup graph (docs/frontend.md § Startup
// budget).
import type { WorkflowDef } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'

/** The steps one waits on, with the "absent means the step declared before it" rule applied. The
 *  runner reads `after` the same way (../../server/workflowValidation.ts), so the picture the editor
 *  draws is the graph that runs. */
export function effectiveAfter(def: WorkflowDef, index: number): readonly string[] {
  const step = def.steps[index]
  if (!step) return []
  if (step.after) return step.after
  const previous = def.steps[index - 1]
  return previous ? [stepIdentity(previous)] : []
}

/** Every step's incoming edges, by name. */
export function edges(def: WorkflowDef): Map<string, readonly string[]> {
  return new Map(def.steps.map((step, index) => [stepIdentity(step), effectiveAfter(def, index)]))
}

/** One row of the list column: the graph in reading order, indented by rank.
 *
 *  Roots come first in declaration order and every other node lands after the last of its
 *  predecessors, which is what puts a chain under the step that starts it rather than at the bottom.
 *  A node waiting on more than one step carries `parents` so the row can say so. */
export type GraphRow = { name: string; depth: number; parents: readonly string[] }

const MAX_DEPTH = 4

export function graphOrder(def: WorkflowDef): GraphRow[] {
  const graph = edges(def)
  const declared = new Map(def.steps.map((step, index) => [stepIdentity(step), index]))
  const waiting = new Set(def.steps.map((step) => stepIdentity(step)))
  const placedAt = new Map<string, number>()
  const rank = new Map<string, number>()
  const rows: GraphRow[] = []

  const row = (name: string): GraphRow => {
    const parents = (graph.get(name) ?? []).filter((parent) => declared.has(parent))
    const depth = parents.length ? Math.min(MAX_DEPTH, 1 + Math.max(...parents.map((parent) => rank.get(parent) ?? 0))) : 0
    rank.set(name, depth)
    placedAt.set(name, rows.length)
    waiting.delete(name)
    return { name, depth, parents }
  }

  while (waiting.size) {
    const ready = [...waiting].filter((name) => (graph.get(name) ?? []).every((parent) => !waiting.has(parent)))
    // Nothing ready means a cycle. The footer names it; the list still has to draw every node, so the
    // rest go out in declaration order rather than vanishing.
    if (!ready.length) {
      for (const name of [...waiting].sort((a, b) => (declared.get(a) ?? 0) - (declared.get(b) ?? 0))) rows.push(row(name))
      break
    }
    const key = (name: string): [number, number] => {
      const parents = (graph.get(name) ?? []).filter((parent) => placedAt.has(parent))
      return [parents.length ? Math.max(...parents.map((parent) => placedAt.get(parent) ?? -1)) : -1, declared.get(name) ?? 0]
    }
    const next = ready.sort((a, b) => {
      const [aLast, aDecl] = key(a)
      const [bLast, bDecl] = key(b)
      return bLast - aLast || aDecl - bDecl
    })[0]
    rows.push(row(next))
  }
  return rows
}
