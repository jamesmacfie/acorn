// Workflow files (docs/workflows.md / 13): declarative, committed `.acorn/workflows/*.toml`,
// layered repo → user like config.toml (repo wins by id). A step may reference another workflow
// (`workflow = "<id>"`) — expanded inline, ONE level of nesting to start, cycles rejected with a
// surfaced error (never a hang). Malformed files become error rows (the 13 §B DX rule), never
// silent skips.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { agentProfileRegistry } from '../../../core/main/agentProfiles'
import { BUILTIN_POLICIES, BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from './workflowBuiltins'
import type { ToolCeiling, ToolRisk, WorkflowDef, WorkflowStepDef } from './workflowContracts'
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
type RawWorkflow = { id: string; name: string; posture?: 'gated' | 'autonomous'; trigger?: string; tools?: ToolCeiling; steps: RawStep[]; source: 'repo' | 'user' }

function parseTools(value: unknown): ToolCeiling | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const allow = Array.isArray(raw.allow) && raw.allow.every((id) => typeof id === 'string') ? raw.allow : undefined
  const maxRisk = typeof raw.max_risk === 'string' && ['read', 'write', 'execute'].includes(raw.max_risk) ? (raw.max_risk as ToolRisk) : undefined
  return allow || maxRisk ? { allow, maxRisk } : undefined
}

function parseBranches(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.length || entries.some(([, target]) => typeof target !== 'string' || !target.trim())) return undefined
  return Object.fromEntries(entries.map(([verdict, target]) => [verdict, (target as string).trim()]))
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
  let schema: object | undefined
  const schemaJson = str(o.schema_json)
  if (schemaJson) {
    try {
      schema = JSON.parse(schemaJson) as object
    } catch {
      errors.push({ source, message: `${id}: step '${name}' has invalid schema_json` })
      return null
    }
  }
  const childRaw = o.child_step
  const child =
    childRaw && typeof childRaw === 'object'
      ? {
          name: str((childRaw as Record<string, unknown>).name),
          profileId: str((childRaw as Record<string, unknown>).profile),
          model: str((childRaw as Record<string, unknown>).model),
          prompt: str((childRaw as Record<string, unknown>).prompt),
          tools: parseTools((childRaw as Record<string, unknown>).tools),
        }
      : undefined
  return {
    name,
    kind,
    profileId: str(o.profile),
    model: str(o.model),
    prompt: str(o.prompt),
    schema,
    policy: str(o.policy),
    maxIterations: typeof o.max_iterations === 'number' ? o.max_iterations : undefined,
    requiresRun: str(o.requires_run),
    childStep: child,
    joins: str(o.joins),
    branches: parseBranches(o.branches),
    tools: parseTools(o.tools),
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
  const rawSteps = Array.isArray(doc.steps) ? doc.steps : []
  if (!rawSteps.length) {
    errors.push({ source: `${source}:${id}`, message: `${id}: no [[steps]] declared` })
    return null
  }
  const steps = rawSteps.map((s, i) => parseStep(s, id, i, errors, `${source}:${id}`)).filter((s): s is RawStep => s != null)
  if (steps.length !== rawSteps.length) return null
  const posture = str(doc.posture)
  return {
    id,
    name: str(doc.name) ?? id,
    posture: posture === 'autonomous' ? 'autonomous' : posture === 'gated' || posture === undefined ? 'gated' : undefined,
    trigger: str(doc.trigger),
    tools: parseTools(doc.tools),
    steps,
    source,
  }
}

// Inline sub-workflow expansion with cycle rejection (a self/loop reference is an error row, not a
// hang). Nested references expand recursively but a chain revisiting an id is refused.
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
      steps.push(
        ...inner.map((s) => ({
          ...s,
          name: `${prefix}${s.name}`,
          joins: s.joins ? `${prefix}${s.joins}` : undefined,
          branches: s.branches ? Object.fromEntries(Object.entries(s.branches).map(([verdict, targetName]) => [verdict, `${prefix}${targetName}`])) : undefined,
          prompt: s.prompt?.replace(/\$\{steps\.([^}]+)\.output\}/g, `\${steps.${prefix}$1.output}`),
          childStep: s.childStep
            ? { ...s.childStep, prompt: s.childStep.prompt?.replace(/\$\{steps\.([^}]+)\.output\}/g, `\${steps.${prefix}$1.output}`) }
            : undefined,
        })),
      )
    }
    return steps
  }

  for (const w of raw) {
    const steps = expand(w, [w.id])
    if (steps) {
      const workflow = { id: w.id, name: w.name, posture: w.posture, trigger: w.trigger, tools: w.tools, steps, source: w.source }
      const problems = validateWorkflow(workflow, catalog)
      if (problems.length) errors.push(...problems.map((message) => ({ source: `${w.source}:${w.id}`, message: `${w.id}: ${message}` })))
      else out.push(workflow)
    }
  }
  return out
}

// Scan `.acorn/workflows/*.toml` in the repo checkout/worktree + `~/.acorn/workflows` (repo wins).
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
        const parsed = parseWorkflowToml(readFileSync(join(dir, entry), 'utf8'), id, source, errors)
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
