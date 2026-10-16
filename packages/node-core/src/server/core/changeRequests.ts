// A task's change requests, its pull or merge requests (docs/plugins/code-hosts.md § Change requests).
// The reads core needs, the one write that moves a task's primary, and what the code host that claims
// a change request's host declared about it.
import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import type { TaskChangeRequest as WireChangeRequest } from '@acorn/protocol/api.ts'
import type { Env } from '../bindings'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import type { Principal } from '../middleware/auth'
import { changeRequestDeclaration, codeHostFor } from '../pluginHost/codeHosts'
import { dispatchPluginRoute, type PluginDispatchInit } from '../pluginHost/dispatch'
import { githubFacet, projectRepository, type ProjectRow } from '../projects/projects'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('change-requests')

export type ChangeRequestRow = typeof schema.taskChangeRequests.$inferSelect
type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

// Everything a link records apart from the task and its role.
export type ChangeRequestLink = Pick<ChangeRequestRow, 'provider' | 'repoHost' | 'repoPath' | 'number'> & {
  provenance: 'task' | 'adopted' | 'agent'
  sourceBranch?: string | null
  sourceRepository?: string | null
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

/** What core fetches to check `row` out: the code host's ref from origin, or else the source branch by
 *  name, from the fork when the link names one. A declared ref serves forks too, so it ignores the fork. */
export function changeRequestFetch(
  row: ChangeRequestRow,
  taskBranch: string,
): { ref: string; fork?: { base: string; path: string } } {
  const provider = changeRequestProvider(row)
  const pattern = provider && changeRequestDeclaration(provider)?.ref
  if (pattern) return { ref: pattern.replace('{number}', String(row.number)) }
  const branch = row.sourceBranch ?? taskBranch
  const fork = row.sourceRepoPath && row.sourceRepoPath !== row.repoPath ? row.sourceRepoPath : null
  return fork ? { ref: `refs/heads/${branch}`, fork: { base: row.repoPath, path: fork } } : { ref: branch }
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
      sourceRepoPath: link.sourceRepository ?? null,
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

// ─── Asking the code host ───────────────────────────────────────────────────────────────────────
//
// Core's `pr` context section and `pr_*` agent tools ask the plugin that owns a change request's host,
// through the routes under its declared `changeRequest.api` (docs/plugins/code-hosts.md § Agent context).

// The read routes answer from the plugin's local mirror, so a slow one is a stuck plugin, and the
// context assembly waiting on it matters more than its answer.
const READ_DEADLINE_MS = 5_000

export type ChangeRequestHost = { provider: string; api: string; number: number; label: string; prefix: string }

/** The task's primary change request and the route its code host answers on. Null when the task has no
 *  primary, or the running plugin that holds its host declared no `api`. */
export async function primaryChangeRequestHost(db: AppDatabase, taskId: string): Promise<ChangeRequestHost | null> {
  const row = await primaryChangeRequest(db, taskId)
  const provider = row ? changeRequestProvider(row) : null
  const declared = provider ? changeRequestDeclaration(provider) : undefined
  if (!row || !provider || !declared?.api) return null
  return {
    provider,
    api: declared.api,
    number: row.number,
    label: declared.label ?? 'change request',
    prefix: changeRequestPrefix(provider),
  }
}

/** Call one of `provider`'s change request routes. Null when it doesn't answer within `deadlineMs`. The
 *  race matters as well as the abort, because a compiled handler can ignore its signal. */
export async function askChangeRequestHost(
  env: Env,
  provider: string,
  path: string,
  init: PluginDispatchInit,
  principal: Principal,
  deadlineMs: number,
): Promise<Response | null> {
  const signal = AbortSignal.timeout(deadlineMs)
  const timedOut = new Promise<null>((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }))
  return Promise.race([dispatchPluginRoute(env, provider, path, init, signal, principal), timedOut])
}

/** Read `{api}/{number}{view}` as the task, and parse it with `shape`. Null for any answer an agent can't
 *  use: a non-2xx, a timeout, a missing route, or a body that doesn't match. */
export async function readChangeRequest<T>(
  env: Env,
  host: ChangeRequestHost,
  view: '' | '/checks' | '/feedback',
  shape: z.ZodType<T>,
  caller: { userId: string; taskId: string; query?: Record<string, string> },
): Promise<T | null> {
  const query = new URLSearchParams({ ...caller.query, taskId: caller.taskId })
  const path = `${host.api}/${host.number}${view}?${query}`
  const principal: Principal = { kind: 'internal', scope: 'task', userId: caller.userId, taskId: caller.taskId }
  try {
    const response = await askChangeRequestHost(
      env,
      host.provider,
      path,
      { method: 'GET' },
      principal,
      READ_DEADLINE_MS,
    )
    if (!response?.ok) {
      if (response) log.warn(`${host.provider} answered ${response.status} from ${host.api}`)
      else log.warn(`${host.provider} did not answer ${host.api} in ${READ_DEADLINE_MS}ms`)
      return null
    }
    const parsed = shape.safeParse(await response.json())
    if (!parsed.success) log.warn(`${host.provider} answered ${host.api}${view} with an unexpected shape`)
    return parsed.success ? parsed.data : null
  } catch (error) {
    log.warn(`${host.provider} failed ${host.api}${view}: ${describeError(error).message}`)
    return null
  }
}
