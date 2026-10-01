import type { WorkflowDef } from '../../../shared/workflowContracts'
import { definitionForPrompt, type PromptWorkflowDef } from '../edit'
import { validateWorkflow, workflowEdges, type WorkflowValidationCatalog } from '../../validation/definition'
import { GENERATE_MAX_EXAMPLES, GENERATE_MAX_EXAMPLE_CHARS, GENERATE_MAX_EXAMPLE_SIZE } from './limits'

// --- 9. worked examples from this workspace ---

/** The ID lets selection exclude the definition being edited. */
export type WorkflowExample = { id: string; def: WorkflowDef }
type PromptWorkflowExample = { id: string; def: PromptWorkflowDef }

/** Rank fan-in first, then parallel roots, then details beyond a plain agent chain. */
function teachingScore(def: WorkflowDef): number {
  const after = [...workflowEdges(def.steps).values()]
  return (after.some((names) => names.length > 1) ? 4 : 0)
    + (after.filter((names) => !names.length).length > 1 ? 2 : 0)
    + (def.steps.some((step) => step.kind && step.kind !== 'agent') ? 1 : 0)
    + (def.inputs?.length ? 1 : 0)
}

/** Select complete, valid definitions in teaching order. Never truncate example JSON. Exclude
 *  parent workflows because their protected child targets would leave an incomplete dispatch
 *  example; section 6 gives complete catalog-backed examples instead. */
export function selectExamples(args: {
  examples: readonly WorkflowExample[]
  validation: WorkflowValidationCatalog
  excludeId?: string
  budget?: number
}): { include: PromptWorkflowExample[]; omit: WorkflowExample[] } {
  const budget = args.budget ?? GENERATE_MAX_EXAMPLE_CHARS
  const candidates = args.examples
    .filter((example) => example.id !== args.excludeId && (example.def.steps?.length ?? 0) >= 2)
    .filter((example) => !example.def.steps.some((step) => step.kind === 'workflow' || step.kind === 'workflow-map'))
    .filter((example) => !validateWorkflow(example.def, args.validation).length)
    .map((original) => {
      const example = { id: original.id, def: definitionForPrompt(original.def) }
      return { original, example, text: JSON.stringify(example.def, null, 2), score: teachingScore(original.def) }
    })
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length || a.example.id.localeCompare(b.example.id))

  const include: PromptWorkflowExample[] = []
  const omit: WorkflowExample[] = []
  let spent = 0
  for (const candidate of candidates) {
    const fits = candidate.text.length <= GENERATE_MAX_EXAMPLE_SIZE
      && spent + candidate.text.length <= budget
      && include.length < GENERATE_MAX_EXAMPLES
    if (fits) {
      include.push(candidate.example)
      spent += candidate.text.length
    } else omit.push(candidate.original)
  }
  return { include, omit }
}

/** The workspace's own definitions, or nothing at all. The only section that can disappear. */
export function renderWorkspaceExamples(selected: { include: readonly PromptWorkflowExample[]; omit: readonly WorkflowExample[] }): string {
  if (!selected.include.length) return ''
  const lines = [
    '## 9. Worked examples from this workspace',
    '',
    'Definitions somebody here wrote and this node runs. Follow how they name steps and how much they',
    'say in a prompt. They are house style, not templates: write what the description asks for.',
    '',
    ...selected.include.flatMap((example) => [JSON.stringify(example.def, null, 2), '']),
  ]
  if (selected.omit.length) {
    lines.push(`${selected.omit.length} more definition${selected.omit.length === 1 ? '' : 's'} here did not fit: ${selected.omit.map((example) => example.def.name).join(', ')}.`)
  }
  return lines.join('\n').trimEnd()
}
