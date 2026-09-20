// Definitions stored as rows (docs/workflows.md § Database definitions).
//
// Two stores, one read. A `.acorn/workflows/*.toml` file is executable configuration somebody
// committed, so the trust snapshot hashes it and a run from one asks for an acknowledgement. A row
// here was typed by the node's owner in this app, behind the device gate, so it has no bytes to hash
// and needs none. `mergedList` reads both and a repo id wins, because a definition a reviewer can see
// in a pull request beats a local draft with the same name.
//
// Cross-database ids are plain ids, as the runs table already does with `task_id`.
import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { WorkflowDefRow, WorkflowDefSummary } from '@acorn/protocol/workflow.ts'
import { workflowDefs, workflowDependencies } from '../node/schema'
import { publicationStore } from './workflowPublicationStore'
import type { WorkflowDef } from '../shared/workflowContracts'
import { loadWorkflowFiles, type LoadedWorkflow } from './workflowFiles'
import type { WorkflowValidationCatalog } from './workflowValidation'

type Row = typeof workflowDefs.$inferSelect

/** The wire row with its definition narrowed. `WorkflowDefRow.def` is `unknown` because protocol may
 *  not name a plugin's type; on this side of the wire we know what it is. */
export type StoredWorkflowDef = Omit<WorkflowDefRow, 'def'> & { def: WorkflowDef }

const now = () => Date.now()

// A definition copied out of a file arrives carrying the loader's own `id` and `source`. Neither
// belongs in a row: the row's id is the row's, and a row has no layer. Leaving `source: 'repo'` in
// would also make a start from the row ask for a trust snapshot it has no file behind.
const cleanDef = (def: WorkflowDef): WorkflowDef => {
  const { id: _id, source: _source, ...rest } = def as WorkflowDef & { id?: unknown; source?: unknown }
  return rest
}

const toRow = (row: Row): StoredWorkflowDef => ({
  id: row.id,
  workspaceId: row.workspaceId,
  projectId: row.projectId,
  name: row.name,
  revision: row.revision,
  publishedRevision: row.publishedRevision ?? null,
  basePublishedRevision: row.basePublishedRevision ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  def: JSON.parse(row.defJson) as WorkflowDef,
})

const summariseDef = (id: string, source: WorkflowDefSummary['source'], def: WorkflowDef, extra: Partial<WorkflowDefSummary> = {}): WorkflowDefSummary => ({
  formatVersion: def.formatVersion,
  id,
  name: def.name,
  source,
  posture: def.posture,
  inputs: def.inputs,
  steps: def.steps.map((step) => ({ id: step.id, name: step.name, kind: step.kind, after: step.after, isolation: step.isolation, inputs: step.inputs })),
  ...extra,
})

/** Every row of a workspace, newest edit first. */
export async function listDefs(db: PluginDatabase, workspaceId: string): Promise<StoredWorkflowDef[]> {
  const rows = await db.select().from(workflowDefs).where(eq(workflowDefs.workspaceId, workspaceId)).orderBy(desc(workflowDefs.updatedAt))
  return rows.map(toRow)
}

/** The rows a task may start: its workspace's, bound either to its project or to none. */
export async function defsForProject(db: PluginDatabase, workspaceId: string, projectId: string): Promise<StoredWorkflowDef[]> {
  const rows = await db
    .select()
    .from(workflowDefs)
    .where(and(eq(workflowDefs.workspaceId, workspaceId), or(isNull(workflowDefs.projectId), eq(workflowDefs.projectId, projectId))))
    .orderBy(desc(workflowDefs.updatedAt))
  return rows.map(toRow)
}

export async function getDef(db: PluginDatabase, id: string): Promise<StoredWorkflowDef | null> {
  const [row] = await db.select().from(workflowDefs).where(eq(workflowDefs.id, id)).limit(1)
  return row ? toRow(row) : null
}

export async function createDef(
  db: PluginDatabase,
  input: { id?: string; workspaceId: string; projectId?: string | null; def: WorkflowDef },
): Promise<StoredWorkflowDef> {
  const at = now()
  const row: typeof workflowDefs.$inferInsert = {
    id: input.id ?? randomUUID(),
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    name: input.def.name,
    defJson: JSON.stringify(cleanDef(input.def)),
    revision: 1,
    createdAt: at,
    updatedAt: at,
  }
  await db.insert(workflowDefs).values(row)
  return toRow(row as Row)
}

/** A save. `revision` is the one the editor read; a stale one is a conflict carrying the row that
 *  won, so the caller can show what changed underneath it rather than overwriting it. */
export async function updateDef(
  db: PluginDatabase,
  id: string,
  def: WorkflowDef,
  revision: number,
): Promise<{ row: StoredWorkflowDef } | { conflict: StoredWorkflowDef } | null> {
  const current = await getDef(db, id)
  if (!current) return null
  if (current.revision !== revision) return { conflict: current }
  const at = now()
  const changed = await db
    .update(workflowDefs)
    .set({ name: def.name, defJson: JSON.stringify(cleanDef(def)), revision: revision + 1, updatedAt: at })
    .where(and(eq(workflowDefs.id, id), eq(workflowDefs.revision, revision)))
    .returning({ id: workflowDefs.id })
  if (changed.length !== 1) {
    const winner = await getDef(db, id)
    return winner ? { conflict: winner } : null
  }
  return { row: { ...current, name: def.name, def: cleanDef(def), revision: revision + 1, updatedAt: at } }
}

export async function removeDef(db: PluginDatabase, id: string): Promise<void> {
  publicationStore(db).assertAvailable('workflow', id)
  if (db.select().from(workflowDependencies).where(and(eq(workflowDependencies.targetId, id), eq(workflowDependencies.kind, 'workflow'))).get()) throw new Error('This workflow is referenced by another published workflow')
  for (const row of db.select().from(workflowDefs).all()) {
    if (row.id !== id && (JSON.parse(row.defJson) as WorkflowDef).steps.some(step => step.childWorkflow?.ref.source === 'database' && step.childWorkflow.ref.id === id)) throw new Error('This workflow is referenced by a draft')
  }
  await db.delete(workflowDefs).where(eq(workflowDefs.id, id))
}

/** The rail's list: this workspace's rows, every project's committed files, and the user layer, with
 *  the repo layer winning an id collision. */
export async function mergedList(
  db: PluginDatabase,
  workspaceId: string,
  projects: readonly { id: string; path: string | null }[],
  options: { userDir: string | null; catalog: WorkflowValidationCatalog },
): Promise<{ workflows: WorkflowDefSummary[]; errors: { source: string; message: string }[] }> {
  const errors: { source: string; message: string }[] = []
  const byId = new Map<string, WorkflowDefSummary>()
  const known = new Set(projects.map((project) => project.id))

  // Rows first, then the user layer, then each project's repo files, each one writing over what came
  // before. That is the precedence rule: repo beats user beats database.
  for (const row of await listDefs(db, workspaceId)) {
    const dangling = row.projectId && !known.has(row.projectId)
    byId.set(row.id, summariseDef(row.id, 'database', row.def, {
      projectId: row.projectId,
      publishedRevision: row.publishedRevision,
      ...(dangling ? { problems: ['The project this workflow was bound to has been removed.'] } : {}),
    }))
  }

  // Each project is read with the user layer beside it, because a committed definition may expand a
  // sub-workflow that lives in `~/.acorn/workflows`. Only the named layer's own results are kept from
  // each read, so scanning three projects does not report the user layer three times.
  const fold = (
    loaded: { workflows: LoadedWorkflow[]; errors: { source: string; message: string }[] },
    layer: 'repo' | 'user',
    projectId: string | null,
  ) => {
    for (const workflow of loaded.workflows) {
      if (workflow.source !== layer) continue
      // Across projects the first repo to declare an id keeps it, the same way the file loader picks
      // the first of two layers.
      if (byId.get(workflow.id)?.source === 'repo') continue
      byId.set(workflow.id, summariseDef(workflow.id, workflow.source, workflow, { projectId }))
    }
    for (const error of loaded.errors) if (error.source.startsWith(`${layer}:`)) errors.push(error)
  }

  fold(loadWorkflowFiles(null, options.userDir, options.catalog), 'user', null)
  for (const project of projects) {
    if (project.path) fold(loadWorkflowFiles(project.path, options.userDir, options.catalog), 'repo', project.id)
  }

  return { workflows: [...byId.values()], errors }
}

/** Compatibility for callers that have not adopted reviewed published-graph export. */
export async function saveDefToRepo(
  db: PluginDatabase,
  id: string,
  _options: { checkoutDir: string; keepRow: boolean; resolveInRoot: (root: string, relPath: string) => string | null },
): Promise<{ path: string } | { error: string }> {
  const row = await getDef(db, id)
  if (!row) return { error: 'not_found' }
  return { error: 'review_published_export_required' }
}
