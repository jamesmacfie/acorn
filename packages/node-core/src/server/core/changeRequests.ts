// A task's change requests, its pull or merge requests (docs/plugins/code-hosts.md § Change requests).
// The reads core needs, the one write that moves a task's primary, and what the code host that claims
// a change request's host declared about it.
import { and, eq, inArray } from 'drizzle-orm'
import type { TaskChangeRequest as WireChangeRequest } from '@acorn/protocol/api.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { changeRequestDeclaration, codeHostFor } from '../pluginHost/codeHosts'
import { githubFacet, projectRepository, type ProjectRow } from '../projects/projects'

export type ChangeRequestRow = typeof schema.taskChangeRequests.$inferSelect
type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

// Everything a link records apart from the task and its role.
export type ChangeRequestLink = Pick<ChangeRequestRow, 'provider' | 'repoHost' | 'repoPath' | 'number'> & {
  provenance: 'task' | 'adopted' | 'agent'
  sourceBranch?: string | null
  sessionId?: string | null
  requestId?: string | null
}

/** Where a new link on `project` points: its repository, with '' standing in for a project with none. */
export function projectChangeRequestRepository(
  project: ProjectRow | null,
): Pick<ChangeRequestRow, 'provider' | 'repoHost' | 'repoPath'> {
  const repository = project && projectRepository(project)
  return { provider: repository?.provider ?? '', repoHost: repository?.host ?? '', repoPath: repository?.path ?? '' }
}

// The live claim first, the same rule as a project's repository: the stored provider stands in only
// while no running plugin claims the host.
export const changeRequestProvider = (row: Pick<ChangeRequestRow, 'provider' | 'repoHost'>): string | null =>
  (row.repoHost && codeHostFor(row.repoHost)) || row.provider || null

/** The mark before a change request's number in a task title. `#` when its code host declares none. */
export const changeRequestPrefix = (provider: string | null): string =>
  (provider && changeRequestDeclaration(provider)?.prefix) || '#'

/** What core fetches from origin to check `row` out: the code host's ref, or the source branch by name. */
export function changeRequestRef(row: ChangeRequestRow, taskBranch: string): string {
  const provider = changeRequestProvider(row)
  const pattern = provider && changeRequestDeclaration(provider)?.ref
  return pattern ? pattern.replace('{number}', String(row.number)) : (row.sourceBranch ?? taskBranch)
}

/** How a person names `row`, such as `merge request !12`. */
export function changeRequestName(row: ChangeRequestRow): string {
  const provider = changeRequestProvider(row)
  const label = (provider && changeRequestDeclaration(provider)?.label) || 'change request'
  return `${label} ${changeRequestPrefix(provider)}${row.number}`
}

export function toWireChangeRequest(row: ChangeRequestRow): WireChangeRequest {
  const provider = changeRequestProvider(row)
  const pane = provider ? changeRequestDeclaration(provider)?.pane : undefined
  return { provider, number: row.number, ...(pane ? { pane } : {}) }
}

/** Each task's primary change request, keyed by task id. */
export async function primaryChangeRequests(
  db: AppDatabase,
  taskIds: readonly string[],
): Promise<Map<string, ChangeRequestRow>> {
  if (!taskIds.length) return new Map()
  const rows = await db
    .select()
    .from(schema.taskChangeRequests)
    .where(and(inArray(schema.taskChangeRequests.taskId, [...taskIds]), eq(schema.taskChangeRequests.role, 'primary')))
  return new Map(rows.map((row) => [row.taskId, row]))
}

export const primaryChangeRequest = async (db: AppDatabase, taskId: string): Promise<ChangeRequestRow | undefined> =>
  (await primaryChangeRequests(db, [taskId])).get(taskId)

/** Make `link` the task's primary change request, or clear the primary with null. The old primary stays
 *  as a related row. Every primary change goes through here, because `tasks.pull_number` copies the
 *  primary for the GitHub-named readers and the two must not drift. */
export function setPrimaryChangeRequest(tx: Transaction, taskId: string, link: ChangeRequestLink | null): void {
  const table = schema.taskChangeRequests
  tx.update(table)
    .set({ role: 'related' })
    .where(and(eq(table.taskId, taskId), eq(table.role, 'primary')))
    .run()
  if (link) {
    const row = {
      taskId,
      provider: link.provider,
      repoHost: link.repoHost,
      repoPath: link.repoPath,
      number: link.number,
      role: 'primary',
      provenance: link.provenance,
      sourceBranch: link.sourceBranch ?? null,
      sessionId: link.sessionId ?? null,
      requestId: link.requestId ?? null,
      createdAt: Date.now(),
    }
    tx.insert(table)
      .values(row)
      .onConflictDoUpdate({
        target: [table.taskId, table.repoHost, table.repoPath, table.number],
        set: { role: 'primary' },
      })
      .run()
  }
  const github = link && githubFacet({ host: link.repoHost, path: link.repoPath })
  tx.update(schema.tasks)
    .set({ pullNumber: github ? link.number : null, updatedAt: Date.now() })
    .where(eq(schema.tasks.id, taskId))
    .run()
}
