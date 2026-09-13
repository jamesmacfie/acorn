import type { PluginDatabase } from '@acorn/plugin-api/node'
import type {
  WorkflowCatalog,
  WorkflowCatalogTarget,
  WorkflowDef,
  WorkflowDefinitionRef,
} from '../shared/workflowContracts'
import { validateWorkflow, workflowEdges, type WorkflowValidationCatalog } from './workflowValidation'
import { defsForProject } from './workflowDefs'
import { loadWorkflowFiles } from './workflowFiles'

export const GENERATE_MAX_WORKFLOW_TARGETS = 40
export const GENERATE_MAX_WORKFLOW_CATALOG_JSON_CHARS = 12_000

const PRIVATE_SCHEMA_KEYS = new Set(['default', 'example', 'examples', '$comment'])

/** Keeps the output contract while dropping value-bearing annotations that can hold fixture data or
 *  credentials. The catalog needs types and properties, not sample output. */
const schemaMetadata = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(schemaMetadata)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PRIVATE_SCHEMA_KEYS.has(key))
      .map(([key, item]) => [key, schemaMetadata(item)]),
  )
}

const outputSchemas = (
  def: WorkflowDef,
  catalog: WorkflowCatalog,
): WorkflowCatalogTarget['outputs'] => {
  const edges = workflowEdges(def.steps)
  const parents = new Set([...edges.values()].flat())
  const described = new Map(catalog.kinds.map((kind) => [kind.id, kind.describe]))
  const outputs = def.steps.flatMap((step) => {
    if (parents.has(step.name)) return []
    const schema = step.schema ?? described.get(step.kind ?? 'agent')?.output?.schema
    return schema && typeof schema === 'object' && !Array.isArray(schema)
      ? [{ step: step.name, schema: schemaMetadata(schema) as object }]
      : []
  })
  return outputs.length ? outputs : undefined
}

const target = (
  ref: WorkflowDefinitionRef,
  def: WorkflowDef,
  catalog: WorkflowCatalog,
): WorkflowCatalogTarget => ({
  ref,
  name: def.name,
  inputs: (def.inputs ?? []).map(({ default: inputDefault, ...input }) => ({
    ...input,
    ...(inputDefault != null ? { hasDefault: true } : {}),
  })),
  outputs: outputSchemas(def, catalog),
})

/** A child is a valid leaf. A definition with runtime children would exceed the one-level tree limit
 *  when selected here, so it is not an available target even though it can run as a root. */
const canBeChild = (def: WorkflowDef, validation: WorkflowValidationCatalog): boolean =>
  !validateWorkflow(def, validation).length
  && !def.steps.some((step) => step.kind === 'workflow' || step.kind === 'workflow-map')

/** Adds only definitions that the selected project can resolve. File bodies and input defaults stay
 *  on the node; the client and model receive reference metadata only. */
export async function scopedWorkflowCatalog(args: {
  db: PluginDatabase
  base: WorkflowCatalog
  workspaceId: string
  projectId: string
  repoDir: string | null
  userDir: string | null
  validation: WorkflowValidationCatalog
}): Promise<WorkflowCatalog> {
  const rows = (await defsForProject(args.db, args.workspaceId, args.projectId))
    .filter((row) => canBeChild(row.def, args.validation))
  const repo = loadWorkflowFiles(args.repoDir, null, args.validation).workflows
    .filter((def) => canBeChild(def, args.validation))
  const user = loadWorkflowFiles(null, args.userDir, args.validation).workflows
    .filter((def) => canBeChild(def, args.validation))
  const workflows = [
    ...rows.map((row) => target({ source: 'database', id: row.id }, row.def, args.base)),
    ...repo.map((def) => target({ source: 'repo', path: `.acorn/workflows/${def.id}.toml` }, def, args.base)),
    ...user.map((def) => target({ source: 'user', id: def.id }, def, args.base)),
  ].sort((left, right) => left.name.localeCompare(right.name))
  return { ...args.base, workflows }
}

/** The model sees a bounded reference set, and grounding checks against the same set. */
export function generationWorkflowCatalog(catalog: WorkflowCatalog, excludeDatabaseId?: string): WorkflowCatalog {
  const candidates = (catalog.workflows ?? [])
    .filter((entry) => !(entry.ref.source === 'database' && entry.ref.id === excludeDatabaseId))
    .map((entry) => ({
      ...entry,
      name: entry.name.slice(0, 200),
      inputs: entry.inputs.map((input) => ({
        ...input,
        description: input.description?.slice(0, 500),
      })),
      outputs: entry.outputs?.filter((output) => JSON.stringify(output.schema).length <= 2_000),
    }))
  const workflows: typeof candidates = []
  for (const entry of candidates) {
    const nextSize = JSON.stringify([...workflows, entry]).length
    if (workflows.length >= GENERATE_MAX_WORKFLOW_TARGETS || nextSize > GENERATE_MAX_WORKFLOW_CATALOG_JSON_CHARS) continue
    workflows.push(entry)
  }
  return { ...catalog, workflows }
}
