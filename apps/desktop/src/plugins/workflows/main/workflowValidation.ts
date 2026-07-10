import { DEFAULT_PROFILE_ID } from '../../../core/main/agentProfiles'
import type { StepValidationContext, WorkflowDef, WorkflowStepDef } from './workflowContracts'
import { intersectToolCeilings, narrowsToolCeiling } from './workflowTools'

const TEMPLATE_RE = /\$\{steps\.([^}]+)\.output\}/g
const STEP_TEMPLATE_TOKEN_RE = /\$\{steps\.[^}]*\}/g

export type WorkflowValidationCatalog = {
  stepKinds: ReadonlySet<string>
  policies: ReadonlySet<string>
  profiles: ReadonlySet<string>
  // Profiles with a one-shot structured (aiArgv) mode — the only ones `decide` can run on.
  structuredProfiles: ReadonlySet<string>
  validateStepKind?: (kind: string, step: WorkflowStepDef, context: StepValidationContext) => string[]
}

export class WorkflowValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('\n'))
    this.name = 'WorkflowValidationError'
  }
}

export function templateReferences(prompt: string | undefined): string[] {
  if (!prompt) return []
  return [...prompt.matchAll(TEMPLATE_RE)].map((match) => match[1])
}

function invalidTemplateExpressions(prompt: string | undefined): string[] {
  if (!prompt) return []
  return (prompt.match(STEP_TEMPLATE_TOKEN_RE) ?? []).filter((token) => !/^\$\{steps\.[^}]+\.output\}$/.test(token))
}

export function validateWorkflow(def: WorkflowDef, catalog: WorkflowValidationCatalog): string[] {
  const errors: string[] = []
  if (!def.name?.trim()) errors.push('workflow has no name')
  if (!Array.isArray(def.steps) || !def.steps.length) return [...errors, 'workflow has no steps']
  if (def.posture === 'autonomous' && !def.tools?.allow && !def.tools?.maxRisk) {
    errors.push(`workflow '${def.name}' is autonomous but has no tool allowlist or risk ceiling`)
  }

  const indexes = new Map<string, number>()
  for (const [index, step] of def.steps.entries()) {
    if (!step.name?.trim()) errors.push(`step ${index + 1} has no name`)
    else if (indexes.has(step.name)) errors.push(`step '${step.name}' is declared more than once`)
    else indexes.set(step.name, index)
  }

  const stepAt = (name: string): WorkflowStepDef | undefined => {
    const index = indexes.get(name)
    return index == null ? undefined : def.steps[index]
  }

  for (const [index, step] of def.steps.entries()) {
    const kind = step.kind ?? 'agent'
    const label = `step '${step.name || index + 1}'`
    if (!catalog.stepKinds.has(kind)) errors.push(`${label} has unknown kind '${kind}'`)
    if (!narrowsToolCeiling(def.tools, step.tools)) errors.push(`${label} tool ceiling widens the workflow ceiling`)
    if (!narrowsToolCeiling(intersectToolCeilings(def.tools, step.tools), step.childStep?.tools)) {
      errors.push(`${label} child tool ceiling widens its parent ceiling`)
    }

    if (['agent', 'ci-loop', 'fan-out', 'decide'].includes(kind)) {
      const profileId = step.profileId ?? DEFAULT_PROFILE_ID
      if (!catalog.profiles.has(profileId)) errors.push(`${label} names unknown profile '${profileId}'`)
      else if (kind === 'decide' && !catalog.structuredProfiles.has(profileId)) {
        errors.push(`${label} profile '${profileId}' has no one-shot structured mode (decide requires one)`)
      }
    }
    if (step.childStep?.profileId && !catalog.profiles.has(step.childStep.profileId)) {
      errors.push(`${label} child names unknown profile '${step.childStep.profileId}'`)
    }
    errors.push(...(catalog.validateStepKind?.(kind, step, { label, index, indexes, stepAt, policies: catalog.policies }) ?? []))
    for (const expression of [...invalidTemplateExpressions(step.prompt), ...invalidTemplateExpressions(step.childStep?.prompt)]) {
      errors.push(`${label} has invalid template expression '${expression}'`)
    }
    for (const reference of [...templateReferences(step.prompt), ...templateReferences(step.childStep?.prompt)]) {
      const targetIndex = indexes.get(reference)
      if (targetIndex == null) errors.push(`${label} has invalid template reference '${reference}'`)
      else if (targetIndex >= index) errors.push(`${label} has forward template reference '${reference}'`)
    }
  }
  return errors
}

export function assertValidWorkflow(def: WorkflowDef, catalog: WorkflowValidationCatalog): void {
  const problems = validateWorkflow(def, catalog)
  if (problems.length) throw new WorkflowValidationError(problems)
}

// Frozen pre-Phase-8 runs may contain a join without `joins`. Preserve their checkpoint semantics
// at read time; newly loaded/started definitions still fail validation until they migrate.
export function normalizePersistedWorkflow(def: WorkflowDef): WorkflowDef {
  const steps = def.steps.map((step, index, all) => {
    if (step.kind !== 'join' || step.joins) return step
    const fanOut = [...all.slice(0, index)].reverse().find((candidate) => candidate.kind === 'fan-out')
    return fanOut ? { ...step, joins: fanOut.name } : step
  })
  return { ...def, steps }
}

export function renderWorkflowPrompt(prompt: string | undefined, rows: { name: string; status: string; structuredJson: string | null; resultJson: string | null }[]): string {
  return (prompt ?? '').replace(TEMPLATE_RE, (_match, name: string) => {
    const row = rows.find((candidate) => candidate.name === name)
    if (!row) throw new WorkflowValidationError([`invalid template reference '${name}'`])
    if (row.status !== 'done') throw new WorkflowValidationError([`template reference '${name}' points to a ${row.status} step`])
    if (row.structuredJson) return row.structuredJson
    if (row.resultJson) {
      try {
        const result = JSON.parse(row.resultJson) as { result?: unknown }
        return typeof result.result === 'string' ? result.result : JSON.stringify(result.result ?? result)
      } catch {
        return row.resultJson
      }
    }
    return ''
  })
}
