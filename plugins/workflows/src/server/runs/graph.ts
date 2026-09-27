import type { WorkflowDef, WorkflowStepRow } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'
import { workflowEdges } from '../validation/definition'

/** Returns steps whose every path from a root crosses a blocked step. A live branch can keep a
 * shared successor reachable even when another predecessor is blocked. */
export function unreachableSteps(
  def: WorkflowDef,
  blocked: ReadonlySet<string>,
  roots: ReadonlySet<string> = new Set(),
): Set<string> {
  const edges = workflowEdges(def.steps)
  const alive = new Set<string>()
  for (let changed = true; changed;) {
    changed = false
    for (const step of def.steps) {
      const id = stepIdentity(step)
      if (alive.has(id) || blocked.has(id)) continue
      const after = edges.get(id) ?? []
      // A chosen branch target acts as a root even if its declared predecessor was skipped.
      if (roots.has(id) || !after.length || after.some((name) => alive.has(name))) {
        alive.add(id)
        changed = true
      }
    }
  }
  return new Set(def.steps.map(stepIdentity).filter((name) => !alive.has(name) && !blocked.has(name)))
}

/** Keeps retry metadata when execution rewrites the step's input record. */
export function retryRecord(step: WorkflowStepRow): Record<string, unknown> {
  if (!step.inputsJson) return {}
  try {
    const { originalPrompt, retryPrompt, mapRoster } = JSON.parse(step.inputsJson) as {
      originalPrompt?: string
      retryPrompt?: string
      mapRoster?: unknown
    }
    return {
      ...(typeof originalPrompt === 'string' ? { originalPrompt } : {}),
      ...(typeof retryPrompt === 'string' ? { retryPrompt } : {}),
      ...(mapRoster && typeof mapRoster === 'object' ? { mapRoster } : {}),
    }
  } catch {
    return {}
  }
}
