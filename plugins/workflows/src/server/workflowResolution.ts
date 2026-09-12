import { createHash } from 'node:crypto'
import { isDir, type CoreServices, type PluginDatabase, type ProjectRef, type TaskRef } from '@acorn/plugin-api/node'
import type {
  WorkflowDef,
  WorkflowDefinitionRef,
  WorkflowDefinitionProvenance,
  ResolvedWorkflowGraph,
  ResolvedWorkflowNode,
  WorkflowStepDef,
  WorkflowValueBinding,
} from '../shared/workflowContracts'
import { getDef } from './workflowDefs'
import { loadWorkflowFiles } from './workflowFiles'
import {
  resolveWorkflowInputs,
  validateWorkflow,
  WorkflowValidationError,
  type WorkflowValidationCatalog,
} from './workflowValidation'

export const MAX_CHILD_WORKFLOW_DEPTH = 1

export type WorkflowResolutionScope = {
  workspaceId: string
  projectId: string
  repoDir: string | null
  userDir: string | null
}

export type WorkflowTaskResolutionScope = WorkflowResolutionScope & {
  task: TaskRef
  project: ProjectRef
}

/** Loads the core-owned task and project once, then derives the only filesystem roots a child
 *  workflow may use. Keeping this in the resolver prevents route handlers from rebuilding scope. */
export async function workflowTaskResolutionScope(
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  taskId: string,
  userDir: string | null,
): Promise<WorkflowTaskResolutionScope | null> {
  const task = await core.tasks.load(taskId)
  if (!task) return null
  const project = await core.projects.byId(task.projectId)
  if (!project) return null
  const repoDir = task.worktreePath && isDir(task.worktreePath)
    ? task.worktreePath
    : project.path && isDir(project.path) ? project.path : null
  return { task, project, workspaceId: project.workspaceId, projectId: project.id, repoDir, userDir }
}

export type { ResolvedWorkflowGraph, ResolvedWorkflowNode, WorkflowDefinitionProvenance } from '../shared/workflowContracts'

type ResolvedDefinition = {
  definition: WorkflowDef
  provenance: WorkflowDefinitionProvenance
}

const runtimeKind = (step: WorkflowStepDef): boolean => step.kind === 'workflow' || step.kind === 'workflow-map'

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function workflowContentFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

const provenanceKey = (provenance: WorkflowDefinitionProvenance): string => {
  if (provenance.source === 'inline') return 'inline'
  if (provenance.source === 'repo') return `repo:${provenance.path}`
  return `${provenance.source}:${provenance.id}`
}

function fileId(path: string): string | null {
  const match = /^\.acorn\/workflows\/([A-Za-z0-9][A-Za-z0-9_-]*)\.toml$/.exec(path)
  return match?.[1] ?? null
}

function fileResolutionError(ref: WorkflowDefinitionRef, messages: readonly string[]): WorkflowValidationError {
  const target = ref.source === 'repo' ? ref.path : ref.source === 'user' ? ref.id : ref.id
  const detail = messages.length ? ` ${messages.join('; ')}` : ''
  return new WorkflowValidationError([`child workflow '${ref.source}:${target}' could not be resolved.${detail}`])
}

/** Resolves one reference inside the parent's workspace and project. No caller-provided path reaches
 *  the filesystem directly. Repository paths must name one file in `.acorn/workflows`. */
export async function resolveScopedWorkflowDefinition(
  db: PluginDatabase,
  ref: WorkflowDefinitionRef,
  scope: WorkflowResolutionScope,
  catalog: WorkflowValidationCatalog,
): Promise<ResolvedDefinition> {
  if (ref.source === 'database') {
    const row = await getDef(db, ref.id)
    if (!row || row.workspaceId !== scope.workspaceId || (row.projectId && row.projectId !== scope.projectId)) {
      throw fileResolutionError(ref, [])
    }
    const problems = validateWorkflow(row.def, catalog)
    if (problems.length) throw new WorkflowValidationError(problems.map((problem) => `child workflow '${row.name}': ${problem}`))
    return { definition: structuredClone(row.def), provenance: { source: 'database', id: row.id, revision: row.revision } }
  }

  const id = ref.source === 'repo' ? fileId(ref.path) : /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(ref.id) ? ref.id : null
  if (!id) throw fileResolutionError(ref, [])
  const loaded = ref.source === 'repo'
    ? loadWorkflowFiles(scope.repoDir, scope.userDir, catalog)
    : loadWorkflowFiles(null, scope.userDir, catalog)
  const definition = loaded.workflows.find((workflow) => workflow.id === id && workflow.source === ref.source)
  if (!definition) {
    const source = `${ref.source}:${id}`
    throw fileResolutionError(ref, loaded.errors.filter((error) => error.source === source).map((error) => error.message))
  }
  const { id: _id, source: _source, ...def } = definition
  return {
    definition: structuredClone(def),
    provenance: ref.source === 'repo'
      ? { source: 'repo', path: ref.path }
      : { source: 'user', id: ref.id },
  }
}

function childInputProblems(step: WorkflowStepDef, child: WorkflowDef): string[] {
  const label = `step '${step.name}'`
  const bindings = step.childWorkflow?.inputs ?? {}
  const declared = new Map((child.inputs ?? []).map((input) => [input.name, input]))
  const problems: string[] = []
  for (const name of Object.keys(bindings)) {
    if (!declared.has(name)) problems.push(`${label} binds undeclared child input '${name}'`)
  }
  for (const input of declared.values()) {
    if (input.required && !bindings[input.name] && (input.default == null || !input.default.trim())) {
      problems.push(`${label} needs a binding for child input '${input.name}'`)
    }
  }
  return problems
}

const resolvedDefaults = (def: WorkflowDef, bindings: Readonly<Record<string, WorkflowValueBinding>>): Record<string, string> =>
  Object.fromEntries((def.inputs ?? []).flatMap((input) =>
    bindings[input.name] || input.default == null ? [] : [[input.name, input.default]]))

/** Resolves every runtime child before a run starts. The returned graph is immutable snapshot data
 *  that the durable dispatch layer can persist without consulting live definitions again. */
export async function resolveWorkflowGraph(
  db: PluginDatabase,
  root: WorkflowDef,
  options: {
    scope: WorkflowResolutionScope
    catalog: WorkflowValidationCatalog
    inputs?: Record<string, string>
    provenance?: WorkflowDefinitionProvenance
    allowDatabaseDefinitions?: boolean
  },
): Promise<ResolvedWorkflowGraph> {
  const rootProblems = validateWorkflow(root, options.catalog)
  if (rootProblems.length) throw new WorkflowValidationError(rootProblems)
  const rootInputs = resolveWorkflowInputs(root, options.inputs)
  const frozenRoot = root.inputs?.length
    ? { ...structuredClone(root), inputs: root.inputs.map((input) => ({ ...input, default: rootInputs[input.name] ?? '' })) }
    : structuredClone(root)
  const nodes: ResolvedWorkflowNode[] = []

  const walk = async (
    definition: WorkflowDef,
    provenance: WorkflowDefinitionProvenance,
    path: string[],
    depth: number,
    chain: string[],
    defaults: Record<string, string>,
  ): Promise<void> => {
    const key = provenanceKey(provenance)
    if (chain.includes(key)) throw new WorkflowValidationError([`child workflow cycle: ${[...chain, key].join(' → ')}`])
    if (depth > MAX_CHILD_WORKFLOW_DEPTH) {
      throw new WorkflowValidationError([`child workflow depth exceeds the ${MAX_CHILD_WORKFLOW_DEPTH}-level limit at ${path.join('.')}`])
    }
    const frozen = structuredClone(definition)
    nodes.push({
      path,
      depth,
      definition: frozen,
      provenance,
      defaultInputs: { ...defaults },
      fingerprint: workflowContentFingerprint({ definition: frozen, provenance, defaultInputs: defaults }),
    })
    for (const step of frozen.steps.filter(runtimeKind)) {
      if (step.childWorkflow!.ref.source === 'database' && options.allowDatabaseDefinitions === false) {
        throw new WorkflowValidationError([`step '${step.name}' cannot resolve an owner-authored database workflow from a task-confined caller`])
      }
      const child = await resolveScopedWorkflowDefinition(db, step.childWorkflow!.ref, options.scope, options.catalog)
      const problems = childInputProblems(step, child.definition)
      if (problems.length) throw new WorkflowValidationError(problems)
      await walk(
        child.definition,
        child.provenance,
        [...path, step.name],
        depth + 1,
        [...chain, key],
        resolvedDefaults(child.definition, step.childWorkflow?.inputs ?? {}),
      )
    }
  }

  await walk(frozenRoot, options.provenance ?? { source: 'inline' }, ['$'], 0, [], rootInputs)
  return {
    root: frozenRoot,
    nodes,
    fingerprint: workflowContentFingerprint(nodes.map(({ path, definition, provenance, defaultInputs }) => ({ path, definition, provenance, defaultInputs }))),
    requiresRepoTrust: nodes.some((node) => node.provenance.source === 'repo'),
  }
}

export function assertRuntimeWorkflowDispatchUnavailable(def: WorkflowDef): void {
  const step = def.steps.find(runtimeKind)
  if (step) throw new WorkflowValidationError([`step '${step.name}' uses runtime workflow dispatch, which is not available in this build`])
}
