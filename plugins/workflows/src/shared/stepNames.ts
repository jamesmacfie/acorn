// How to pick a step name nobody typed. The editor names a new step with it (../client/editor/draft.ts).
import type { WorkflowDef } from './workflowContracts'

/** A name nothing else has yet, from a base a person did not type, in words: "Run a command 2". */
export function uniqueStepName(def: WorkflowDef, base: string): string {
  const taken = new Set(def.steps.map((step) => step.name))
  const root = base.trim() || 'Step'
  const numbered = (n: number) => `${root} ${n}`
  if (!taken.has(root)) return root
  for (let n = 2; ; n += 1) if (!taken.has(numbered(n))) return numbered(n)
}
