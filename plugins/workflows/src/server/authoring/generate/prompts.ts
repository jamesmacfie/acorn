import type { WorkflowGenerateNote } from '../../../shared/api'
import { GENERATE_MAX_DESCRIPTION_CHARS } from '../../../shared/api'
import type { WorkflowCatalog, WorkflowDef, WorkflowInput } from '../../../shared/workflowContracts'
import { definitionForPrompt, type PromptWorkflowDef } from '../edit'
import { renderWorkflowTargets } from '../targetPrompt'
import type { WorkflowValidationCatalog } from '../../validation/definition'
import { GENERATE_MAX_REPAIR_PROBLEMS, GENERATE_MAX_SYSTEM_CHARS } from './limits'
import { SECTION_ROLE, SECTION_CONCEPTS } from './teaching'
import { renderStepKinds } from './kinds'
import { SECTION_CONTRACTS, SECTION_RULES } from './rules'
import { renderVocabulary } from './vocabulary'
import { SECTION_EXAMPLES } from './builtinExamples'
import { renderWorkspaceExamples, selectExamples, type WorkflowExample } from './workspaceExamples'

/** Build a validator from serializable catalog facts. Contributed kind validators run on the
 *  node, so the request orchestrator passes the runner's full validation catalog instead. */
export function catalogValidation(catalog: WorkflowCatalog): WorkflowValidationCatalog {
  const described = new Map(catalog.kinds.map((kind) => [kind.id, kind.describe]))
  return {
    stepKinds: new Set(catalog.kinds.map((kind) => kind.id)),
    policies: new Set(catalog.policies.map((policy) => policy.id)),
    profiles: new Set(catalog.profiles.map((profile) => profile.id)),
    structuredProfiles: new Set(catalog.profiles.filter((profile) => profile.structured).map((profile) => profile.id)),
    agentStepKinds: new Set(catalog.kinds.filter((kind) => kind.describe?.runsAgent).map((kind) => kind.id)),
    describeStepKind: (kind) => described.get(kind) ?? undefined,
    workflowTargets: catalog.workflows,
  }
}

/** Assemble the cache-stable system prompt. Section budgets keep required teaching text ahead
 *  of the final length cap; workspace examples are the only optional section. */
export function buildGenerateSystemPrompt(args: {
  catalog: WorkflowCatalog
  examples?: readonly WorkflowExample[]
  excludeId?: string
  validation?: WorkflowValidationCatalog
  exampleBudget?: number
}): string {
  const selected = selectExamples({
    examples: args.examples ?? [],
    validation: args.validation ?? catalogValidation(args.catalog),
    excludeId: args.excludeId,
    budget: args.exampleBudget,
  })
  return [
    SECTION_ROLE,
    SECTION_CONCEPTS,
    renderStepKinds(args.catalog),
    SECTION_CONTRACTS,
    renderVocabulary(args.catalog),
    renderWorkflowTargets(args.catalog),
    SECTION_RULES,
    SECTION_EXAMPLES,
    renderWorkspaceExamples(selected),
  ].filter(Boolean).join('\n\n').slice(0, GENERATE_MAX_SYSTEM_CHARS)
}

const inputLine = (input: WorkflowInput): string =>
  `- \`${input.name}\`${input.required ? ', required' : ''}${input.description ? `. ${input.description}` : ''}`

/** Build a replacement brief or edit request. Edit mode shows only the model-visible definition;
 *  grounding restores protected values after the reply. */
export function buildGenerateUserPrompt(args:
  | { mode: 'overwrite'; description: string; name?: string; inputs?: readonly WorkflowInput[] }
  | { mode: 'edit'; description: string; currentDef: WorkflowDef },
): string {
  if (args.mode === 'edit') {
    return [
      'Edit the current workflow according to this request:',
      '',
      args.description.trim().slice(0, GENERATE_MAX_DESCRIPTION_CHARS),
      '',
      'Here is the current workflow:',
      '',
      JSON.stringify(definitionForPrompt(args.currentDef), null, 2),
      '',
      'Return the whole edited definition, not a patch. Keep every name, step, prompt, edge, input,',
      'policy, budget and setting that the request does not need to change. Some protected settings',
      'have been omitted; keep the stable step ids and kinds for unaffected steps so acorn can restore them.',
      '',
      'Answer with the JSON object and nothing else.',
    ].join('\n')
  }

  const lines = ['Write the workflow definition for this description.', '', args.description.trim().slice(0, GENERATE_MAX_DESCRIPTION_CHARS)]
  const name = args.name?.trim()
  const inputs = (args.inputs ?? []).filter((input) => input.name?.trim())
  if (name || inputs.length) {
    lines.push('', 'It replaces a draft that is already open.')
    if (name) lines.push(`Its name is "${name}". Keep it when it still describes what you wrote.`)
    if (inputs.length) {
      lines.push('It declares these inputs. Keep the ones your definition uses and drop the rest:')
      lines.push(...inputs.map(inputLine))
    }
  }
  lines.push('', 'Answer with the JSON object and nothing else.')
  return lines.join('\n')
}

/** Repair a grounded definition against the same system prompt. Repeat the original request
 *  because calls are stateless; include removal notes and exact validator messages so the model
 *  can correct the applied draft without restoring discarded settings. */
export function buildRepairUserPrompt(args: {
  userPrompt: string
  def: WorkflowDef | PromptWorkflowDef
  notes: readonly WorkflowGenerateNote[]
  problems: readonly string[]
}): string {
  const lines = [
    args.userPrompt,
    '',
    '---',
    '',
    'Your answer did not pass the checker. Here it is as it stands:',
    '',
    JSON.stringify(args.def, null, 2),
  ]
  if (args.notes.length) {
    lines.push('', 'These were removed because this node does not have them. Do not put them back:', '')
    lines.push(...args.notes.map((note) => `- ${note.message}`))
  }
  const problems = args.problems.slice(0, GENERATE_MAX_REPAIR_PROBLEMS)
  lines.push('', 'The checker reports these problems. Fix every one:', '')
  lines.push(...problems.map((problem) => `- ${problem}`))
  if (args.problems.length > problems.length) {
    lines.push(`- and ${args.problems.length - problems.length} more of the same kind.`)
  }
  lines.push('', 'Answer with the whole corrected definition as one JSON object and nothing else. Keep every step,')
  lines.push('prompt and edge that no problem above mentions.')
  return lines.join('\n')
}
