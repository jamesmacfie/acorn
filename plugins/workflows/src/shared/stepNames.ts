// What a step may be called, and how to pick a name nobody typed.
//
// Shared rather than sitting beside the editor's other draft operations because two sides need it:
// the editor renames a node with it (../client/editor/draft.ts), and grounding a generated
// definition renames a step the model called "Reproduce the bug" (../server/groundWorkflow.ts). The
// server validator checks that a name is non-empty and unique and nothing more, so this file is the
// only place the shape is written down.
import type { WorkflowDef } from './workflowContracts'

/** A step name is slug-shaped and unique. The `:` a sub-workflow expansion carries is not typed
 *  here, so the rule is the narrower one. */
export const STEP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** A name nothing else has yet, from a base a person did not type. */
export function uniqueStepName(def: WorkflowDef, base: string): string {
  const taken = new Set(def.steps.map((step) => step.name))
  const root = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'step'
  if (!taken.has(root)) return root
  for (let n = 2; ; n += 1) if (!taken.has(`${root}-${n}`)) return `${root}-${n}`
}
