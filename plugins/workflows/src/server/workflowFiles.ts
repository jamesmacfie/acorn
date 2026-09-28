import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
// Workflow files: declarative, committed `.acorn/workflows/*.toml`. Layering and sub-workflow
// expansion are covered in docs/workflows.md § Execution model.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'
import { dataBindingSchema } from '@acorn/protocol/dataBindings.ts'
import { agentProfileRegistry, resolveInRoot } from '@acorn/plugin-api/node'
import { BUILTIN_POLICIES, BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from './workflowBuiltins'
import type {
  ChildWorkflowConfig,
  ToolCeiling,
  ToolRisk,
  WorkflowBudget,
  WorkflowDef,
  WorkflowInput,
  WorkflowStepDef,
  WorkflowBoundTemplate,
  WorkflowGateForm,
  WorkflowMapSource,
  WorkflowValueBinding,
} from '../shared/workflowContracts'
import { validateWorkflow, type WorkflowValidationCatalog } from './workflowValidation'

export type WorkflowFileError = { source: string; message: string }
export type LoadedWorkflow = WorkflowDef & { id: string; source: 'repo' | 'user' }

const defaultCatalog = (): WorkflowValidationCatalog => ({
  stepKinds: new Set<string>(BUILTIN_STEP_KINDS),
  policies: new Set<string>(BUILTIN_POLICIES),
  profiles: new Set(agentProfileRegistry.list().map((profile) => profile.id)),
  structuredProfiles: new Set(agentProfileRegistry.list().filter((profile) => profile.aiArgv).map((profile) => profile.id)),
  validateStepKind: (kind, step, context) => BUILTIN_STEP_VALIDATORS[kind as (typeof BUILTIN_STEP_KINDS)[number]]?.(step, context) ?? [],
})

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

// A raw parsed step: WorkflowStepDef plus the unexpanded sub-workflow reference.
type RawStep = WorkflowStepDef & { workflowRef?: string }
type RawWorkflow = {
  baseline: typeof ACORN_BASELINE
  maxDescendants?: number
  maxConcurrency?: number
  formatVersion: 1
  outputs?: WorkflowDef['outputs']
  id: string
  name: string
  posture?: 'gated' | 'autonomous'
  trigger?: string
  tools?: ToolCeiling
  budget?: WorkflowBudget
  inputs?: WorkflowInput[]
  steps: RawStep[]
  source: 'repo' | 'user'
}

function parseTools(value: unknown): ToolCeiling | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const allow = Array.isArray(raw.allow) && raw.allow.every((id) => typeof id === 'string') ? raw.allow : undefined
  const maxRisk = typeof raw.max_risk === 'string' && ['read', 'write', 'execute'].includes(raw.max_risk) ? (raw.max_risk as ToolRisk) : undefined
  return allow || maxRisk ? { allow, maxRisk } : undefined
}

function parseBudget(value: unknown): WorkflowBudget | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const number = (key: string): number | undefined =>
    typeof raw[key] === 'number' ? raw[key] : undefined
  const budget = {
    maxWallTimeMs: number('max_wall_time_ms'),
    maxCostUsd: number('max_cost_usd'),
    maxInputTokens: number('max_input_tokens'),
    maxOutputTokens: number('max_output_tokens'),
    maxTurns: number('max_turns'),
  }
  return Object.values(budget).some((item) => item != null) ? budget : undefined
}

function parseAfter(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((name): name is string => typeof name === 'string' && !!name.trim()).map((name) => name.trim())
}

function parseStringTable(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => typeof item === 'string')
  return entries.length ? Object.fromEntries(entries as [string, string][]) : undefined
}

function parseInputs(value: unknown): WorkflowInput[] | undefined {
  if (!Array.isArray(value)) return undefined
  const inputs = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const name = str(raw.name)
    if (!name) return []
    return [{
      name,
      ...(typeof raw.connection_json === 'string' ? { connection: JSON.parse(raw.connection_json) } : {}),
      label: str(raw.label),
      ...(typeof raw.schema_json === 'string' ? { schema: JSON.parse(raw.schema_json), ...(typeof raw.default_json === 'string' ? { default: JSON.parse(raw.default_json) } : {}) } : { default: str(raw.default) }),
      description: str(raw.description),
      ...(raw.required === true ? { required: true } : {}),
    }]
  })
  return inputs.length ? inputs : undefined
}

function parseBranches(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.length || entries.some(([, target]) => typeof target !== 'string' || !target.trim())) return undefined
  return Object.fromEntries(entries.map(([verdict, target]) => [verdict, (target as string).trim()]))
}

function parseBinding(value: unknown): WorkflowValueBinding {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  if (typeof raw.binding_json !== 'string') throw new Error('Workflow bindings require binding_json with a typed address')
  return dataBindingSchema.parse(JSON.parse(raw.binding_json))
}

function parseBindings(value: unknown): Record<string, WorkflowValueBinding> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>).map(([name, binding]) => [name, parseBinding(binding)])
  return entries.length ? Object.fromEntries(entries) : undefined
}

function parseChildWorkflow(value: unknown): ChildWorkflowConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const ref = raw.ref && typeof raw.ref === 'object' && !Array.isArray(raw.ref)
    ? raw.ref as Record<string, unknown>
    : {}
  return { ...raw, ref, inputs: parseBindings(raw.inputs) } as ChildWorkflowConfig
}

function parseMapSource(value: unknown): WorkflowMapSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  return raw as WorkflowMapSource
}

function parseTitle(value: unknown): WorkflowBoundTemplate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  return { ...raw, bindings: parseBindings(raw.bindings) } as WorkflowBoundTemplate
}

function parseForm(value: unknown): WorkflowGateForm | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  // Everything else on the table rides along, so validation can name the key it does not know.
  return { ...raw, fields: parseInputs(raw.fields) ?? [], values: parseBindings(raw.values) } as WorkflowGateForm
}

function parseStep(v: unknown, id: string, i: number, errors: WorkflowFileError[], source: string): RawStep | null {
  if (!v || typeof v !== 'object') {
    errors.push({ source, message: `${id}: step ${i + 1} must be a table` })
    return null
  }
  const o = v as Record<string, unknown>
  const workflowRef = str(o.workflow)
  const kind = str(o.kind) ?? 'agent'
  const name = str(o.name) ?? (workflowRef ? `→ ${workflowRef}` : `step-${i + 1}`)
  const stepId = str(o.id)
  if (!stepId) {
    errors.push({ source, message: `${id}: step '${name}' needs an id. Add format_version = 1 and a stable id to every [[steps]] table.` })
    return null
  }
  let schema: object | undefined
  const schemaJson = str(o.schema_json)
  if (schemaJson) {
    try {
      const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(schemaJson))
      if (!parsed.success) throw new Error('schema_json must be a JSON object')
      schema = parsed.data
    } catch {
      errors.push({ source, message: `${id}: step '${name}' has invalid schema_json` })
      return null
    }
  }
  const isolation = str(o.isolation)
  const inputsMode = str(o.inputs)
  const dataFields: Partial<WorkflowStepDef> = {}
  if (Array.isArray(o.projection) && o.projection.every(value => typeof value === 'string')) dataFields.projection = o.projection
  if (o.repeat && typeof o.repeat === 'object') dataFields.repeat = o.repeat as WorkflowStepDef['repeat']
  if (typeof o.incremental === 'boolean') dataFields.incremental = o.incremental
  try {
    for (const key of ['query', 'record', 'condition'] as const) {
      if (typeof o[`${key}_json`] === 'string') Object.assign(dataFields, { [key]: JSON.parse(o[`${key}_json`] as string) })
    }
  } catch {
    errors.push({ source, message: `${id}: step '${name}' has invalid data configuration JSON` })
    return null
  }
  return {
    ...dataFields,
    id: stepId,
    name,
    kind,
    after: parseAfter(o.after),
    isolation: isolation === 'worktree' ? 'worktree' : isolation === 'shared' ? 'shared' : undefined,
    inputs: inputsMode === 'append' || inputsMode === 'template' || inputsMode === 'none' ? inputsMode : undefined,
    configOptions: parseStringTable(o.config_options),
    profileId: str(o.profile),
    model: str(o.model),
    prompt: str(o.prompt),
    schema,
    policy: str(o.policy),
    maxIterations: typeof o.max_iterations === 'number' ? o.max_iterations : undefined,
    requiresRun: str(o.requires_run),
    childWorkflow: parseChildWorkflow(o.child_workflow),
    items: parseMapSource(o.items),
    itemKey: typeof o.item_key === 'string' ? o.item_key : undefined,
    title: parseTitle(o.title),
    form: parseForm(o.form),
    branches: parseBranches(o.branches),
    // Passed through unread: `[steps.with]` belongs to whichever plugin contributed the kind.
    with: o.with && typeof o.with === 'object' && !Array.isArray(o.with) ? (o.with as Record<string, unknown>) : undefined,
    tools: parseTools(o.tools),
    budget: parseBudget(o.budget),
    workflowRef,
  }
}

export function parseWorkflowToml(text: string, id: string, source: 'repo' | 'user', errors: WorkflowFileError[]): RawWorkflow | null {
  let doc: Record<string, unknown>
  try {
    doc = parseToml(text) as Record<string, unknown>
  } catch (e) {
    errors.push({ source: `${source}:${id}`, message: e instanceof Error ? e.message : 'invalid TOML' })
    return null
  }
  try {
  const rawSteps = Array.isArray(doc.steps) ? doc.steps : []
  if (doc.format_version !== 1 || doc.baseline !== ACORN_BASELINE) {
    errors.push({ source: `${source}:${id}`, message: `Incompatible workflow. Set format_version = 1 and baseline = "${ACORN_BASELINE}" before loading it.` })
    return null
  }
  if (!rawSteps.length) {
    errors.push({ source: `${source}:${id}`, message: `${id}: no [[steps]] declared` })
    return null
  }
  const steps = rawSteps.map((s, i) => parseStep(s, id, i, errors, `${source}:${id}`)).filter((s): s is RawStep => s != null)
  if (steps.length !== rawSteps.length) return null
  const posture = str(doc.posture)
  return {
    baseline: ACORN_BASELINE,
    formatVersion: 1,
    maxDescendants: doc.max_descendants as number | undefined,
    maxConcurrency: doc.max_concurrency as number | undefined,
    outputs: typeof doc.outputs_json === 'string' ? JSON.parse(doc.outputs_json) : undefined,
    id,
    name: str(doc.name) ?? id,
    posture: posture === 'autonomous' ? 'autonomous' : posture === 'gated' || posture === undefined ? 'gated' : undefined,
    trigger: str(doc.trigger),
    tools: parseTools(doc.tools),
    budget: parseBudget(doc.budget),
    inputs: parseInputs(doc.inputs),
    steps,
    source,
  }
  } catch (error) {
    errors.push({ source: `${source}:${id}`, message: `Invalid typed workflow value: ${error instanceof Error ? error.message : String(error)}` })
    return null
  }
}

// Inline sub-workflow expansion with cycle rejection: see docs/workflows.md § Execution model.
export function expandWorkflows(raw: RawWorkflow[], errors: WorkflowFileError[], catalog: WorkflowValidationCatalog = defaultCatalog()): LoadedWorkflow[] {
  const byId = new Map(raw.map((w) => [w.id, w]))
  const out: LoadedWorkflow[] = []

  const expand = (w: RawWorkflow, chain: string[]): WorkflowStepDef[] | null => {
    const steps: WorkflowStepDef[] = []
    for (const step of w.steps) {
      if (!step.workflowRef) {
        const { workflowRef: _drop, ...def } = step
        steps.push(def)
        continue
      }
      const target = byId.get(step.workflowRef)
      if (!target) {
        errors.push({ source: `${w.source}:${w.id}`, message: `${w.id}: unknown sub-workflow '${step.workflowRef}'` })
        return null
      }
      if (chain.includes(step.workflowRef) || step.workflowRef === w.id) {
        errors.push({ source: `${w.source}:${w.id}`, message: `${w.id}: cyclic sub-workflow reference '${chain.concat(step.workflowRef).join(' → ')}'` })
        return null
      }
      const inner = expand(target, [...chain, step.workflowRef])
      if (!inner) return null
      const prefix = `${step.workflowRef}:`
      const prefixBinding = (binding: WorkflowValueBinding): WorkflowValueBinding => {
        const typed = dataBindingSchema.parse(binding)
        return {
          ...typed,
          address: typed.address.from === 'step'
            ? { ...typed.address, stepId: `${prefix}${typed.address.stepId}` }
            : typed.address,
        }
      }
      const prefixBindings = (bindings: Record<string, WorkflowValueBinding> | undefined) =>
        bindings ? Object.fromEntries(Object.entries(bindings).map(([name, binding]) => [name, prefixBinding(binding)])) : undefined
      steps.push(
        ...inner.map((s) => ({
          ...s,
          id: `${prefix}${s.id}`,
          name: `${prefix}${s.name}`,
          // An absent `after` still means "the step declared before me", which after a linear
          // expansion is the previous inner step, or the step before the reference for the first one.
          after: s.after?.map((name) => `${prefix}${name}`),
          branches: s.branches ? Object.fromEntries(Object.entries(s.branches).map(([verdict, targetName]) => [verdict, `${prefix}${targetName}`])) : undefined,
          prompt: s.prompt?.replace(/\$\{steps\.([^}]+)\.output\}/g, `\${steps.${prefix}$1.output}`),
          childWorkflow: s.childWorkflow
            ? { ...s.childWorkflow, inputs: prefixBindings(s.childWorkflow.inputs) }
            : undefined,
          items: s.items ? { ...s.items, step: `${prefix}${s.items.step}` } : undefined,
          title: s.title
            ? { ...s.title, bindings: prefixBindings(s.title.bindings) }
            : undefined,
        })),
      )
    }
    return steps
  }

  for (const w of raw) {
    const steps = expand(w, [w.id])
    if (steps) {
      const workflow = {
        baseline: w.baseline,
        formatVersion: w.formatVersion,
        maxDescendants: w.maxDescendants,
        maxConcurrency: w.maxConcurrency,
        outputs: w.outputs,
        id: w.id,
        name: w.name,
        posture: w.posture,
        trigger: w.trigger,
        tools: w.tools,
        budget: w.budget,
        inputs: w.inputs,
        steps,
        source: w.source,
      }
      const problems = validateWorkflow(workflow, catalog)
      if (problems.length) errors.push(...problems.map((message) => ({ source: `${w.source}:${w.id}`, message: `${w.id}: ${message}` })))
      else out.push(workflow)
    }
  }
  return out
}

// Scans `.acorn/workflows/*.toml` in the repo checkout/worktree plus `~/.acorn/workflows`; see
// docs/workflows.md § Execution model for the layering rule.
export function loadWorkflowFiles(
  repoDir: string | null,
  userDir: string | null,
  catalog: WorkflowValidationCatalog = defaultCatalog(),
): { workflows: LoadedWorkflow[]; errors: WorkflowFileError[] } {
  const errors: WorkflowFileError[] = []
  const raw = new Map<string, RawWorkflow>()
  const scan = (base: string | null, source: 'repo' | 'user') => {
    if (!base) return
    const dir = join(base, '.acorn', 'workflows')
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.toml')) continue
      const id = entry.slice(0, -5)
      try {
        const path = resolveInRoot(base, `.acorn/workflows/${entry}`)
        if (!path) throw new Error('Workflow file is outside the allowed root')
        const parsed = parseWorkflowToml(readFileSync(path, 'utf8'), id, source, errors)
        // repo layer scans first and wins; the user layer only fills gaps.
        if (parsed && !raw.has(id)) raw.set(id, parsed)
      } catch (e) {
        errors.push({ source: `${source}:${id}`, message: e instanceof Error ? e.message : 'unreadable workflow file' })
      }
    }
  }
  scan(repoDir, 'repo')
  scan(userDir, 'user')
  return { workflows: expandWorkflows([...raw.values()], errors, catalog), errors }
}
