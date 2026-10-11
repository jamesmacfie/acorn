// The read half of the workflow agent tools (docs/agent-tools/workflow-tools.md). Everything here is
// scoped by the authenticated task: its project, its workspace, and the files in its own checkout.
// Nothing here writes, starts a step, or calls a model.
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { ToolError, type PluginDatabase } from '@acorn/plugin-api/node'
import { z } from 'zod'
import type { WorkflowCatalog, WorkflowDef, WorkflowDefinitionRef } from '../../shared/workflowContracts'
import { scopedWorkflowCatalog, workflowCatalogTarget } from '../definitions/catalog'
import { loadWorkflowFiles } from '../definitions/files'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import type { WorkflowResolutionScope, WorkflowTaskResolutionScope } from '../definitions/resolution'
import { defsForProject, getDef, type StoredWorkflowDef } from '../definitions/store'
import { publishedWorkflow } from '../publication/store'
import { validateWorkflow, type WorkflowValidationCatalog } from '../validation/definition'
import { agentDefinitionView } from './projection'

export const MAX_TOOL_RESPONSE_BYTES = 64 * 1024
export const MAX_LIST_ENTRIES = 50
export const MAX_DEFINITION_BYTES = 256 * 1024

export type WorkflowToolDeps = {
  db: PluginDatabase
  catalog(): WorkflowCatalog
  validationCatalog(): WorkflowValidationCatalog
  taskScope(taskId: string): Promise<WorkflowTaskResolutionScope | null>
  /** Whether the owner lets agents start this definition, for workflows_list (./launches.ts). */
  invocation?(
    projectId: string,
    definitionKey: string,
    digest: string | undefined,
    sessionId: string | undefined,
  ): unknown
}

/** Where a definition opens: the editor's item key in the task's project, which a client turns into
 *  its own URL (client/surfacePath.ts). */
export type WorkflowDefinitionTarget = { kind: 'workflow-definition'; resourceId: string; projectId: string }

export const definitionKey = (ref: WorkflowDefinitionRef): string =>
  ref.source === 'database'
    ? `db:${ref.id}`
    : ref.source === 'user'
      ? `user:${ref.id}`
      : `repo:${fileId(ref.path) ?? ref.path}`

export const definitionTarget = (
  ref: WorkflowDefinitionRef,
  scope: { projectId: string },
): WorkflowDefinitionTarget => ({
  kind: 'workflow-definition',
  resourceId: definitionKey(ref),
  projectId: scope.projectId,
})

/** The reference a definition key names. The inverse of definitionKey. */
export const refForKey = (key: string): WorkflowDefinitionRef | null => {
  const match = /^(db|repo|user):(.+)$/.exec(key)
  if (!match) return null
  return match[1] === 'db'
    ? { source: 'database', id: match[2]! }
    : match[1] === 'repo'
      ? { source: 'repo', path: `.acorn/workflows/${match[2]}.toml` }
      : { source: 'user', id: match[2]! }
}

const fileId = (path: string): string | null =>
  /^\.acorn\/workflows\/([A-Za-z0-9][A-Za-z0-9_-]*)\.toml$/.exec(path)?.[1] ?? null

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '')

/** Items after `cursor` in key order, as many as fit both the count and the byte allowance. The first
 *  item always goes in, so a page can never stall on one large entry. */
export function boundedPage<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  cursor: string | undefined,
  limit: number,
  room = MAX_TOOL_RESPONSE_BYTES - 4096,
): { items: T[]; nextCursor: string | null } {
  const sorted = [...items].sort((left, right) => keyOf(left).localeCompare(keyOf(right)))
  const remaining = cursor ? sorted.filter((item) => keyOf(item).localeCompare(cursor) > 0) : sorted
  const page: T[] = []
  let used = 0
  for (const item of remaining) {
    const size = bytes(item)
    if (page.length && (page.length >= limit || used + size > room)) break
    page.push(item)
    used += size
  }
  return { items: page, nextCursor: page.length < remaining.length ? keyOf(page.at(-1)!) : null }
}

export async function requireTaskScope(deps: WorkflowToolDeps, taskId: string): Promise<WorkflowTaskResolutionScope> {
  const scope = await deps.taskScope(taskId)
  if (!scope) throw new ToolError('not_found', 'This task has no project on this Node.')
  return scope
}

export const sameScope = (row: StoredWorkflowDef, scope: WorkflowResolutionScope): boolean =>
  row.workspaceId === scope.workspaceId && (!row.projectId || row.projectId === scope.projectId)

/** The validation catalog with the child workflow targets this task's checkout can resolve. */
export async function scopedValidation(
  deps: WorkflowToolDeps,
  scope: WorkflowTaskResolutionScope,
): Promise<WorkflowValidationCatalog> {
  const scoped = await scopedWorkflowCatalog({
    db: deps.db,
    base: deps.catalog(),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    repoDir: scope.repoDir,
    userDir: scope.userDir,
    validation: deps.validationCatalog(),
  })
  return { ...deps.validationCatalog(), workflowTargets: scoped.workflows }
}

// One definition this task can see. A row carries its draft, plus its published revision when it has
// one. A file the loader rejected has no definition, only the reasons.
export type Applicable = {
  ref: WorkflowDefinitionRef
  row?: StoredWorkflowDef
  published?: { revision: number; digest: string; def: WorkflowDef } | null
  file?: WorkflowDef
  loadErrors?: string[]
}

function fileLayer(
  scope: WorkflowResolutionScope,
  source: 'repo' | 'user',
  validation: WorkflowValidationCatalog,
): Applicable[] {
  // The user layer is read on its own, as resolution does, so a repo file of the same name does not
  // hide it from a reference that names the user layer.
  const loaded =
    source === 'repo'
      ? loadWorkflowFiles(scope.repoDir, scope.userDir, validation)
      : loadWorkflowFiles(null, scope.userDir, validation)
  const refOf = (id: string): WorkflowDefinitionRef =>
    source === 'repo' ? { source, path: `.acorn/workflows/${id}.toml` } : { source, id }
  const found = new Map<string, Applicable>()
  for (const workflow of loaded.workflows) {
    if (workflow.source === source) found.set(workflow.id, { ref: refOf(workflow.id), file: workflow })
  }
  for (const error of loaded.errors) {
    const id = error.source.startsWith(`${source}:`) ? error.source.slice(source.length + 1) : null
    if (!id || found.get(id)?.file) continue
    const entry = found.get(id) ?? { ref: refOf(id), loadErrors: [] }
    entry.loadErrors!.push(error.message)
    found.set(id, entry)
  }
  return [...found.values()]
}

async function withPublished(db: PluginDatabase, row: StoredWorkflowDef): Promise<Applicable> {
  const published = row.publishedRevision ? await publishedWorkflow(db, row.id).catch(() => null) : null
  return {
    ref: { source: 'database', id: row.id },
    row,
    published: published ? { revision: published.revision, digest: published.digest, def: published.def } : null,
  }
}

async function applicable(deps: WorkflowToolDeps, scope: WorkflowTaskResolutionScope): Promise<Applicable[]> {
  const validation = deps.validationCatalog()
  const rows = await defsForProject(deps.db, scope.workspaceId, scope.projectId)
  return [
    ...(await Promise.all(rows.map((row) => withPublished(deps.db, row)))),
    ...fileLayer(scope, 'repo', validation),
    ...fileLayer(scope, 'user', validation),
  ]
}

export async function resolveRef(
  deps: WorkflowToolDeps,
  scope: WorkflowResolutionScope,
  ref: WorkflowDefinitionRef,
): Promise<Applicable> {
  if (ref.source === 'database') {
    const row = await getDef(deps.db, ref.id)
    // Another project's or workspace's row answers exactly as a missing one does.
    if (!row || !sameScope(row, scope))
      throw new ToolError('not_found', 'No workflow with that reference is available to this task.')
    return withPublished(deps.db, row)
  }
  const key = definitionKey(ref)
  const found = fileLayer(scope, ref.source, deps.validationCatalog()).find((entry) => definitionKey(entry.ref) === key)
  if (!found) throw new ToolError('not_found', 'No workflow with that reference is available to this task.')
  return found
}

/** The digest of what would run, as workflows_list reports it and workflow_run checks it: a row's
 *  published revision, or a file's content. A draft that was never published has none. */
export const executableDigest = (entry: Applicable): string | undefined =>
  entry.published?.digest ?? (entry.file ? workflowContentFingerprint(entry.file) : undefined)

// What would run: the published revision of a row, or the file. A draft that was never published has
// nothing executable, so its signature is the draft's.
const executable = (entry: Applicable): WorkflowDef | undefined => entry.published?.def ?? entry.file
const signatureOf = (entry: Applicable): WorkflowDef | undefined => executable(entry) ?? entry.row?.def
const nameOf = (entry: Applicable): string => signatureOf(entry)?.name ?? definitionKey(entry.ref)

// ─── workflow_catalog ───────────────────────────────────────────────────────────────────────────

export function catalogPage(deps: WorkflowToolDeps, cursor: string | undefined) {
  const catalog = deps.catalog()
  const page = boundedPage(catalog.kinds, (kind) => kind.id, cursor, 100, MAX_TOOL_RESPONSE_BYTES - 8192)
  return {
    format: { formatVersion: 1, baseline: ACORN_BASELINE },
    kinds: page.items,
    policies: catalog.policies,
    profiles: catalog.profiles,
    nextCursor: page.nextCursor,
  }
}

// ─── workflows_list ─────────────────────────────────────────────────────────────────────────────

export async function listDefinitions(
  deps: WorkflowToolDeps,
  context: { taskId: string; sessionId?: string },
  input: { search?: string; cursor?: string },
) {
  const scope = await requireTaskScope(deps, context.taskId)
  const validation = await scopedValidation(deps, scope)
  const needle = input.search?.trim().toLowerCase()
  const entries = (await applicable(deps, scope))
    .filter(
      (entry) =>
        !needle ||
        nameOf(entry).toLowerCase().includes(needle) ||
        definitionKey(entry.ref).toLowerCase().includes(needle),
    )
    .map((entry) => {
      const signature = signatureOf(entry)
      const runnable = executable(entry)
      const problems =
        entry.loadErrors ??
        (runnable
          ? validateWorkflow(runnable, validation)
          : ['Not published. The owner publishes a draft from the workflow editor.'])
      return {
        ref: entry.ref,
        name: nameOf(entry),
        source: entry.ref.source,
        published: !!runnable,
        ...(entry.row ? { revision: entry.row.revision, publishedRevision: entry.row.publishedRevision ?? null } : {}),
        ...(executableDigest(entry) ? { digest: executableDigest(entry) } : {}),
        ...(signature
          ? (({ inputs, outputs }) => ({ inputs, outputs }))(workflowCatalogTarget(entry.ref, signature))
          : {}),
        ...(entry.row?.agentOrigin
          ? { agentDraft: { yours: entry.row.agentOrigin.sessionId === context.sessionId } }
          : {}),
        ...(deps.invocation
          ? {
              invocation: deps.invocation(
                scope.projectId,
                definitionKey(entry.ref),
                executableDigest(entry),
                context.sessionId,
              ),
            }
          : {}),
        ...(problems.length ? { problems: problems.slice(0, 10) } : {}),
        target: definitionTarget(entry.ref, scope),
      }
    })
  const page = boundedPage(
    entries,
    (entry) => `${entry.name.toLowerCase()}\u0000${definitionKey(entry.ref)}`,
    input.cursor,
    MAX_LIST_ENTRIES,
  )
  return { workflows: page.items, nextCursor: page.nextCursor }
}

// ─── workflow_get ───────────────────────────────────────────────────────────────────────────────

export async function getDefinition(
  deps: WorkflowToolDeps,
  taskId: string,
  input: { ref: WorkflowDefinitionRef; revision?: number; step?: string },
) {
  const scope = await requireTaskScope(deps, taskId)
  const entry = await resolveRef(deps, scope, input.ref)
  let shown: { showing: 'draft' | 'published' | 'file'; revision: number | null; def: WorkflowDef }
  // Draft revisions and published revisions are separate counters, so `revision` names only the
  // second. The draft is what an agent reads to save against.
  if (entry.row && input.revision !== undefined) {
    const published = await publishedWorkflow(deps.db, entry.row.id, input.revision).catch(() => null)
    if (!published) throw new ToolError('not_found', `This workflow has no published revision ${input.revision}.`)
    shown = { showing: 'published', revision: input.revision, def: published.def }
  } else if (entry.row) {
    shown = { showing: 'draft', revision: entry.row.revision, def: entry.row.def }
  } else if (entry.file) {
    if (input.revision !== undefined)
      throw new ToolError('bad_request', 'A workflow file has no revisions. Omit revision.')
    shown = { showing: 'file', revision: null, def: entry.file }
  } else {
    return {
      ref: entry.ref,
      source: entry.ref.source,
      problems: entry.loadErrors ?? [],
      target: definitionTarget(entry.ref, scope),
    }
  }

  const view = agentDefinitionView(shown.def)
  const problems = validateWorkflow(shown.def, await scopedValidation(deps, scope))
  const header = {
    ref: entry.ref,
    source: entry.ref.source,
    name: shown.def.name,
    showing: shown.showing,
    revision: shown.revision,
    // Always what would run, whichever version is shown: the value workflow_run checks.
    ...(executableDigest(entry) ? { digest: executableDigest(entry) } : {}),
    editable: !!entry.row,
    ...(entry.row
      ? {
          draftRevision: entry.row.revision,
          published: entry.published ? { revision: entry.published.revision, digest: entry.published.digest } : null,
        }
      : {}),
    problems,
    withheld: view.withheld,
    target: definitionTarget(entry.ref, scope),
  }
  if (input.step) {
    const step = view.definition.steps.find((candidate) => (candidate.id ?? candidate.name) === input.step)
    if (!step) throw new ToolError('not_found', `No step '${input.step}' in this definition.`)
    return { ...header, step }
  }
  if (bytes(view.definition) <= MAX_TOOL_RESPONSE_BYTES - bytes(header) - 1024)
    return { ...header, definition: view.definition }
  // Too large for one answer. The outline still names every step, and `step` reads one in full.
  return {
    ...header,
    definition: {
      ...view.definition,
      steps: view.definition.steps.map(({ id, name, kind, after }) => ({ id, name, kind, after })),
    },
    truncated: 'Step bodies were left out to fit the response. Pass step with a step ID to read one in full.',
  }
}

// ─── workflow_validate ──────────────────────────────────────────────────────────────────────────

// Structural only, like the device route's body: a name, the format markers, and a list of steps.
// The validator says everything else, field by field.
export const candidateDefinitionSchema = z
  .object({
    baseline: z.literal(ACORN_BASELINE),
    formatVersion: z.literal(1),
    name: z.string().min(1).max(200),
    steps: z.array(z.object({ name: z.string().min(1) }).passthrough()).max(200),
  })
  .passthrough()

/** The structural problems of an untrusted candidate, each prefixed with the field it is about. */
export function structuralProblems(candidate: unknown): string[] {
  if (bytes(candidate) > MAX_DEFINITION_BYTES)
    return [`The definition is larger than ${MAX_DEFINITION_BYTES / 1024} KiB.`]
  const parsed = candidateDefinitionSchema.safeParse(candidate)
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'definition'}: ${issue.message}`)
}

export async function validateCandidate(deps: WorkflowToolDeps, taskId: string, candidate: unknown) {
  const scope = await requireTaskScope(deps, taskId)
  const structural = structuralProblems(candidate)
  if (structural.length) return { valid: false, problems: structural }
  const problems = validateWorkflow(candidate as WorkflowDef, await scopedValidation(deps, scope))
  return { valid: !problems.length, problems }
}
