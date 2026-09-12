import { DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import { BUILTIN_AGENT_STEP_KINDS, readStepField } from '../shared/stepFields'
import type {
  StepField,
  StepKindDescription,
  StepValidationContext,
  WorkflowBudget,
  WorkflowDef,
  WorkflowStepDef,
} from '../shared/workflowContracts'
import { intersectToolCeilings, narrowsToolCeiling } from './workflowTools'

const TEMPLATE_RE = /\$\{steps\.([^}]+)\.output\}/g
const STEP_TEMPLATE_TOKEN_RE = /\$\{steps\.[^}]*\}/g
const INPUT_RE = /\$\{inputs\.([^}]+)\}/g
const INPUT_TOKEN_RE = /\$\{inputs\.[^}]*\}/g
const INPUT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/

/**
 * The edges, derived and never stored. A step with an `after` list waits on exactly those steps; a
 * step without one waits on the step declared before it, which is what a plain list always meant.
 * `after = []` is an explicit root.
 */
export function workflowEdges(steps: readonly WorkflowStepDef[]): Map<string, string[]> {
  const edges = new Map<string, string[]>()
  steps.forEach((step, index) => {
    const previous = index > 0 ? steps[index - 1]?.name : undefined
    edges.set(step.name, step.after ?? (previous ? [previous] : []))
  })
  return edges
}

/** Every transitive predecessor of `name`, or `null` when the walk meets a cycle. */
function ancestors(edges: ReadonlyMap<string, string[]>, name: string): Set<string> | null {
  const seen = new Set<string>()
  const stack = [...(edges.get(name) ?? [])]
  while (stack.length) {
    const current = stack.pop()!
    if (current === name) return null
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(edges.get(current) ?? []))
  }
  return seen
}

/** The first cycle the graph holds, named the way the error reads: `a → b → a`. */
function findCycle(edges: ReadonlyMap<string, string[]>): string[] | null {
  const state = new Map<string, 'open' | 'closed'>()
  const path: string[] = []
  const walk = (name: string): string[] | null => {
    const seen = state.get(name)
    if (seen === 'closed') return null
    if (seen === 'open') return [...path.slice(path.indexOf(name)), name]
    state.set(name, 'open')
    path.push(name)
    for (const next of edges.get(name) ?? []) {
      const cycle = walk(next)
      if (cycle) return cycle
    }
    path.pop()
    state.set(name, 'closed')
    return null
  }
  for (const name of edges.keys()) {
    const cycle = walk(name)
    if (cycle) return cycle
  }
  return null
}

export type WorkflowValidationCatalog = {
  stepKinds: ReadonlySet<string>
  policies: ReadonlySet<string>
  profiles: ReadonlySet<string>
  // Profiles with a one-shot structured (aiArgv) mode: the only ones `decide` can run on.
  structuredProfiles: ReadonlySet<string>
  // Every kind whose description says it runs an agent, built-in or contributed. Absent means the
  // built-ins alone, which is what a catalog assembled without descriptions knows.
  agentStepKinds?: ReadonlySet<string>
  // A kind's description, for the host-applied field checks below. Absent for a kind that has none.
  describeStepKind?: (kind: string) => StepKindDescription | undefined
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

export function inputReferences(prompt: string | undefined): string[] {
  if (!prompt) return []
  return [...prompt.matchAll(INPUT_RE)].map((match) => match[1])
}

function invalidTemplateExpressions(prompt: string | undefined): string[] {
  if (!prompt) return []
  return [
    ...(prompt.match(STEP_TEMPLATE_TOKEN_RE) ?? []).filter((token) => !/^\$\{steps\.[^}]+\.output\}$/.test(token)),
    ...(prompt.match(INPUT_TOKEN_RE) ?? []).filter((token) => !/^\$\{inputs\.[^}]+\}$/.test(token)),
  ]
}

/** Every string a definition may hold a reference in: the prompt, the child prompt, and one level of
 *  `with`. Anywhere else, a `${...}` is just text. */
function templatedStrings(step: WorkflowStepDef): (string | undefined)[] {
  return [step.prompt, step.childStep?.prompt, ...Object.values(step.with ?? {}).filter((value): value is string => typeof value === 'string')]
}

const BUDGET_FIELDS: Array<keyof WorkflowBudget> = [
  'maxWallTimeMs',
  'maxCostUsd',
  'maxInputTokens',
  'maxOutputTokens',
  'maxTurns',
]

function validateBudget(label: string, budget: WorkflowBudget | undefined): string[] {
  if (!budget) return []
  return BUDGET_FIELDS.flatMap((field) => {
    const value = budget[field]
    if (value == null) return []
    if (!Number.isFinite(value) || value <= 0) return [`${label} ${field} must be positive`]
    if (field !== 'maxCostUsd' && !Number.isInteger(value)) return [`${label} ${field} must be an integer`]
    return []
  })
}

/**
 * The checks a description states, applied by the host before the kind's own validator runs
 * (docs/workflows.md § Contributed step kinds). A validator can then assume the shape and check the
 * meaning. A select with an `optionsRoute` is skipped: the node reading the file may not be able to
 * reach the project whose route lists the choices.
 */
function fieldProblems(label: string, step: WorkflowStepDef, kind: string, fields: readonly StepField[]): string[] {
  const errors: string[] = []
  for (const field of fields) {
    const value = readStepField(step as Parameters<typeof readStepField>[0], kind, field.id)
    const missing = value == null || (typeof value === 'string' && !value.trim())
    if (missing) {
      if (field.required) errors.push(`${label} needs ${field.label.toLowerCase()}`)
      continue
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${label} ${field.label.toLowerCase()} must be a number`)
      else if ((field.min != null && value < field.min) || (field.max != null && value > field.max)) {
        errors.push(`${label} ${field.label.toLowerCase()} must be between ${field.min ?? '-'} and ${field.max ?? '-'}`)
      }
    } else if (field.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${label} ${field.label.toLowerCase()} must be true or false`)
    } else if (field.type === 'select' && field.options && !field.options.some((option) => option.value === value)) {
      errors.push(`${label} ${field.label.toLowerCase()} must be one of ${field.options.map((option) => option.value).join(', ')}`)
    }
  }
  return errors
}

function budgetNarrows(parent: WorkflowBudget | undefined, child: WorkflowBudget | undefined): boolean {
  if (!child) return true
  return BUDGET_FIELDS.every((field) =>
    child[field] == null || parent?.[field] == null || child[field]! <= parent[field]!)
}

export function validateWorkflow(def: WorkflowDef, catalog: WorkflowValidationCatalog): string[] {
  const errors: string[] = []
  if (!def.name?.trim()) errors.push('workflow has no name')
  if (!Array.isArray(def.steps) || !def.steps.length) return [...errors, 'workflow has no steps']
  if (def.posture === 'autonomous' && !def.tools?.allow && !def.tools?.maxRisk) {
    errors.push(`workflow '${def.name}' is autonomous but has no tool allowlist or risk ceiling`)
  }
  errors.push(...validateBudget(`workflow '${def.name}' budget`, def.budget))

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

  const declaredInputs = new Set<string>()
  for (const [index, input] of (def.inputs ?? []).entries()) {
    const name = input?.name ?? ''
    if (!INPUT_NAME_RE.test(name)) errors.push(`input ${index + 1} has an invalid name '${name}'`)
    else if (declaredInputs.has(name)) errors.push(`input '${name}' is declared more than once`)
    else declaredInputs.add(name)
  }

  // The graph. `after` is checked before the cycle walk, because a dangling name would send the walk
  // looking for a step that is not there.
  for (const step of def.steps) {
    for (const name of step.after ?? []) {
      if (name === step.name) errors.push(`step '${step.name}' waits on itself`)
      else if (!indexes.has(name)) errors.push(`step '${step.name}' waits on unknown step '${name}'`)
    }
  }
  const edges = workflowEdges(def.steps)
  const cycle = errors.length ? null : findCycle(edges)
  if (cycle) errors.push(`workflow '${def.name}' has a cycle: ${cycle.join(' → ')}`)
  const predecessors = new Map<string, Set<string>>(
    def.steps.map((step) => [step.name, (cycle ? null : ancestors(edges, step.name)) ?? new Set<string>()]),
  )
  const after = (name: string): readonly string[] => edges.get(name) ?? []
  const precedes = (candidate: string, step: string): boolean => predecessors.get(step)?.has(candidate) ?? false

  for (const [index, step] of def.steps.entries()) {
    const kind = step.kind ?? 'agent'
    const label = `step '${step.name || index + 1}'`
    if (!catalog.stepKinds.has(kind)) errors.push(`${label} has unknown kind '${kind}'`)
    if (!narrowsToolCeiling(def.tools, step.tools)) errors.push(`${label} tool ceiling widens the workflow ceiling`)
    if (!narrowsToolCeiling(intersectToolCeilings(def.tools, step.tools), step.childStep?.tools)) {
      errors.push(`${label} child tool ceiling widens its parent ceiling`)
    }
    errors.push(...validateBudget(`${label} budget`, step.budget))
    errors.push(...validateBudget(`${label} child budget`, step.childStep?.budget))
    if (!budgetNarrows(def.budget, step.budget)) errors.push(`${label} budget widens the workflow budget`)
    const effectiveBudget = {
      ...def.budget,
      ...Object.fromEntries(BUDGET_FIELDS.flatMap((field) => {
        const value = [def.budget?.[field], step.budget?.[field]]
          .filter((candidate): candidate is number => candidate != null)
        return value.length ? [[field, Math.min(...value)]] : []
      })),
    }
    if (!budgetNarrows(effectiveBudget, step.childStep?.budget)) {
      errors.push(`${label} child budget widens its parent budget`)
    }

    if ((catalog.agentStepKinds ?? BUILTIN_AGENT_STEP_KINDS).has(kind)) {
      const profileId = step.profileId ?? DEFAULT_PROFILE_ID
      if (!catalog.profiles.has(profileId)) errors.push(`${label} names unknown profile '${profileId}'`)
      else if (kind === 'decide' && !catalog.structuredProfiles.has(profileId)) {
        errors.push(`${label} profile '${profileId}' has no one-shot structured mode (decide requires one)`)
      }
    }
    if (step.childStep?.profileId && !catalog.profiles.has(step.childStep.profileId)) {
      errors.push(`${label} child names unknown profile '${step.childStep.profileId}'`)
    }
    // The description's own checks first, and the kind's validator only when they pass: the
    // contract a validator relies on is "the shape is already right".
    const described = catalog.describeStepKind?.(kind)
    const fieldErrors = described ? fieldProblems(label, step, kind, described.fields) : []
    errors.push(...fieldErrors)
    if (!fieldErrors.length) {
      errors.push(...(catalog.validateStepKind?.(kind, step, { label, index, indexes, stepAt, policies: catalog.policies, after, precedes }) ?? []))
    }
    if (!(catalog.agentStepKinds ?? BUILTIN_AGENT_STEP_KINDS).has(kind)) {
      for (const field of ['isolation', 'inputs', 'configOptions'] as const) {
        if (step[field] != null) errors.push(`${label} is a '${kind}' step, which cannot take ${field}`)
      }
    } else if (step.model && step.configOptions?.model) {
      errors.push(`${label} sets both model and config_options.model; config_options wins, so drop one`)
    }
    const strings = templatedStrings(step)
    for (const expression of strings.flatMap(invalidTemplateExpressions)) {
      errors.push(`${label} has invalid template expression '${expression}'`)
    }
    for (const reference of strings.flatMap(templateReferences)) {
      // A transitive predecessor, not "declared earlier": two roots are not ordered, so a step
      // beside this one may well have run first and still be the wrong thing to read.
      if (!indexes.has(reference)) errors.push(`${label} has invalid template reference '${reference}'`)
      else if (!precedes(reference, step.name)) errors.push(`${label} references '${reference}', which is not one of its predecessors`)
    }
    for (const reference of strings.flatMap(inputReferences)) {
      if (!declaredInputs.has(reference)) errors.push(`${label} references undeclared input '${reference}'`)
    }
  }
  return errors
}

export function assertValidWorkflow(def: WorkflowDef, catalog: WorkflowValidationCatalog): void {
  const problems = validateWorkflow(def, catalog)
  if (problems.length) throw new WorkflowValidationError(problems)
}

// Persisted runs can contain a join without `joins`. Infer it from the preceding fan-out at read time.
// A newly created definition still needs an explicit join target to pass validation.
export function normalizePersistedWorkflow(def: WorkflowDef): WorkflowDef {
  const steps = def.steps.map((step, index, all) => {
    if (step.kind !== 'join' || step.joins) return step
    const fanOut = all.slice(0, index).reverse().find((candidate) => candidate.kind === 'fan-out')
    return fanOut ? { ...step, joins: fanOut.name } : step
  })
  return { ...def, steps }
}

export type WorkflowStepOutputRow = { name: string; status: string; structuredJson: string | null; resultJson: string | null }

/** What `${steps.<name>.output}` stands for: the structured JSON if the step produced one, its final
 *  text otherwise. */
export function stepOutput(row: WorkflowStepOutputRow): string {
  if (row.structuredJson) return row.structuredJson
  if (!row.resultJson) return ''
  try {
    const result = JSON.parse(row.resultJson) as { result?: unknown }
    return typeof result.result === 'string' ? result.result : JSON.stringify(result.result ?? result)
  } catch {
    return row.resultJson
  }
}

export function renderWorkflowPrompt(
  prompt: string | undefined,
  rows: WorkflowStepOutputRow[],
  inputs: Record<string, string> = {},
): string {
  return (prompt ?? '')
    .replace(TEMPLATE_RE, (_match, name: string) => {
      const row = rows.find((candidate) => candidate.name === name)
      if (!row) throw new WorkflowValidationError([`invalid template reference '${name}'`])
      if (row.status !== 'done') throw new WorkflowValidationError([`template reference '${name}' points to a ${row.status} step`])
      return stepOutput(row)
    })
    .replace(INPUT_RE, (_match, name: string) => {
      if (!(name in inputs)) throw new WorkflowValidationError([`invalid input reference '${name}'`])
      return inputs[name] ?? ''
    })
}

/** One level of a contributed kind's `[steps.with]` table, rendered. A handler never sees a template:
 *  `terminal:command` gets the substituted command, not `${inputs.issue}`. */
export function renderWith(
  table: Record<string, unknown> | undefined,
  rows: WorkflowStepOutputRow[],
  inputs: Record<string, string> = {},
): Record<string, unknown> | undefined {
  if (!table) return undefined
  return Object.fromEntries(
    Object.entries(table).map(([key, value]) => [key, typeof value === 'string' ? renderWorkflowPrompt(value, rows, inputs) : value]),
  )
}

/** The values a run starts with: the declared default unless the caller supplied one. Refuses a
 *  missing required input and a name the definition does not declare, so a bad start is a refusal
 *  rather than a prompt with a hole in it. */
export function resolveWorkflowInputs(def: WorkflowDef, supplied: Record<string, string> | undefined): Record<string, string> {
  const declared = def.inputs ?? []
  const problems: string[] = []
  for (const name of Object.keys(supplied ?? {})) {
    if (!declared.some((input) => input.name === name)) problems.push(`workflow '${def.name}' has no input '${name}'`)
  }
  const resolved: Record<string, string> = {}
  for (const input of declared) {
    const value = supplied?.[input.name] ?? input.default
    if (value == null || (input.required && !value.trim())) {
      if (input.required) problems.push(`workflow '${def.name}' needs a value for input '${input.name}'`)
      resolved[input.name] = value ?? ''
    } else resolved[input.name] = value
  }
  if (problems.length) throw new WorkflowValidationError(problems)
  return resolved
}

/** The values a started run froze into its own copy of the definition. */
export function frozenWorkflowInputs(def: WorkflowDef): Record<string, string> {
  return Object.fromEntries((def.inputs ?? []).map((input) => [input.name, input.default ?? '']))
}
