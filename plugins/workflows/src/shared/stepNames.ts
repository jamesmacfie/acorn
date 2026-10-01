// How to pick a step name nobody typed. The editor names a new step with it (../client/editor/draft.ts).
import type { WorkflowDef } from './workflowContracts'

/** A name nothing else has yet, from a base a person did not type. A definition whose steps carry
 *  ids names them in words, "Run a command 2"; an older one keys edges on the name, so it stays
 *  slug-shaped, "run-a-command-2". */
export function uniqueStepName(def: WorkflowDef, base: string): string {
  const taken = new Set(def.steps.map((step) => step.name))
  const words = def.formatVersion === 1
  const root = words
    ? base.trim() || 'Step'
    : base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'step'
  const numbered = (n: number) => (words ? `${root} ${n}` : `${root}-${n}`)
  if (!taken.has(root)) return root
  for (let n = 2; ; n += 1) if (!taken.has(numbered(n))) return numbered(n)
}
