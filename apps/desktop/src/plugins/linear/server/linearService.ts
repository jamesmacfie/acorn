import { z } from 'zod'
import type { AppDatabase } from '../../../core/server/db'
import { connectionHasCapability, forEachConnection, getConnection } from '../../../core/server/integrations/connections'
import { decryptSecret } from '../../../core/server/session'
import { providerRequestScheduler } from '../../../core/server/integrations/budgetRuntime'
import { runProviderResource } from '../../../core/server/integrations/resourceRuntime'
import { ProviderOperationError } from '../../../core/server/integrations/types'
import { PublicApiError, type ErrorCode } from '../../../core/shared/publicApi/errors'
import type { LinearIssueDetailSchema, LinearIssueSummarySchema, LinearProjectSchema } from '../../../core/shared/publicApi/linear'
import type { StoredConnection } from '../../../core/server/integrations/connections'
import {
  ISSUES_QUERY,
  ISSUE_ID_QUERY,
  PROJECTS_QUERY,
  PROJECT_ISSUES_QUERY,
  type LinearNode,
  type LinearProjectNode,
  issuesFilter,
  linearData,
  linearError,
  linearFetch,
  projectIssuesFilter,
} from '.'
import { linearNodeToDetail, linearProvider, linearSummaryOf } from './provider'
import type { LinearIssueDetail } from '../../../core/shared/api'

// LinearService (docs/public-api.md). Reuses the internal route's GraphQL helpers +
// provider runtime so the public and internal surfaces share one implementation. A bare identifier
// is resolved across all connected Linear workspaces (first hit wins).

const PROVIDER = 'linear'
type Project = z.infer<typeof LinearProjectSchema>
type Summary = z.infer<typeof LinearIssueSummarySchema>
type Detail = z.infer<typeof LinearIssueDetailSchema>

function mapProviderError(e: unknown): PublicApiError {
  if (e instanceof ProviderOperationError) {
    const byStatus: Record<number, ErrorCode> = { 401: 'upstream_reauthentication_required', 403: 'operation_forbidden', 404: 'not_found', 429: 'upstream_rate_limited' }
    return new PublicApiError(byStatus[e.status] ?? 'provider_unavailable', e.code)
  }
  return new PublicApiError('provider_unavailable', 'Linear request failed')
}

export class LinearService {
  constructor(
    private readonly db: AppDatabase,
    private readonly encKey: string,
  ) {}

  // Every connected Linear connection with its decrypted API key.
  private async connections(userId: string): Promise<{ row: StoredConnection; key: string }[]> {
    return forEachConnection(this.db, userId, PROVIDER, this.encKey, async (row, key) => ({ row, key }))
  }

  private fetch(row: StoredConnection, key: string, query: string, variables: Record<string, unknown>) {
    return providerRequestScheduler.run(PROVIDER, row.id, linearProvider.budgets, () => linearFetch(key, query, variables))
  }

  private async connectionOrThrow(userId: string, connectionId: string): Promise<{ row: StoredConnection; key: string }> {
    const row = await getConnection(this.db, userId, connectionId)
    if (!row) throw new PublicApiError('provider_validation_failed', 'Linear connection not found')
    const key = await decryptSecret(row.authRef, this.encKey)
    if (!key) throw new PublicApiError('upstream_reauthentication_required', 'Linear credential must be renewed')
    return { row, key }
  }

  async projects(userId: string, connectionId?: string): Promise<Project[]> {
    const conns = connectionId ? [await this.connectionOrThrow(userId, connectionId)] : await this.connections(userId)
    if (!conns.length) throw new PublicApiError('provider_unavailable', 'No Linear connection')
    const out: Project[] = []
    for (const { row, key } of conns) {
      const res = await this.fetch(row, key, PROJECTS_QUERY, {})
      if (linearError(res)) continue
      try {
        const { projects } = await linearData<{ projects: { nodes: LinearProjectNode[] } }>(res)
        out.push(...projects.nodes.map((p) => ({ integrationId: row.id, id: p.id, name: p.name })))
      } catch {
        // skip this connection
      }
    }
    return out
  }

  async projectIssues(userId: string, connectionId: string, projectIds: string[]): Promise<Summary[]> {
    const { row, key } = await this.connectionOrThrow(userId, connectionId)
    if (!projectIds.length) return []
    const res = await this.fetch(row, key, PROJECT_ISSUES_QUERY, { filter: projectIssuesFilter(projectIds) })
    const err = linearError(res)
    if (err) throw new PublicApiError(err.status === 401 ? 'upstream_reauthentication_required' : 'provider_unavailable', 'Linear request failed')
    const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
    return issues.nodes.map((node) => linearSummaryOf(linearNodeToDetail(node)))
  }

  async resolve(userId: string, identifiers: string[], connectionId?: string): Promise<Summary[]> {
    const conns = connectionId ? [await this.connectionOrThrow(userId, connectionId)] : await this.connections(userId)
    if (!conns.length) throw new PublicApiError('provider_unavailable', 'No Linear connection')
    const byId = new Map<string, Summary>()
    let stale = [...new Set(identifiers)]
    for (const { row, key } of conns) {
      if (!stale.length) break
      const filter = issuesFilter(stale)
      if (!filter) break
      try {
        const res = await this.fetch(row, key, ISSUES_QUERY, { filter })
        if (linearError(res)) continue
        const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
        for (const node of issues.nodes) byId.set(node.identifier, linearSummaryOf(linearNodeToDetail(node)))
        stale = stale.filter((id) => !byId.has(id))
      } catch {
        // try the next connection
      }
    }
    return identifiers.map((id) => byId.get(id)).filter((s): s is Summary => !!s)
  }

  async detail(userId: string, identifier: string, connectionId: string, refresh: boolean): Promise<Detail> {
    const result = await runProviderResource<{ kind: 'detail'; identifier: string }, LinearIssueDetail>({
      db: this.db,
      userId,
      encryptionKey: this.encKey,
      providerId: PROVIDER,
      connectionId,
      resourceId: 'linear.issues',
      input: { kind: 'detail', identifier },
      force: refresh,
    })
    if (!result.ok) throw new PublicApiError(result.failure.status === 401 ? 'upstream_reauthentication_required' : 'provider_unavailable', result.failure.error)
    const d = result.value
    return {
      identifier: d.identifier,
      title: d.title,
      url: d.url,
      state: d.state,
      assignee: d.assignee,
      id: d.id,
      description: d.description,
      comments: d.comments.map((cm) => ({ id: cm.id, author: cm.author, body: cm.body, createdAt: cm.createdAt, parentId: cm.parentId })),
      activity: d.activity,
    }
  }

  async comment(userId: string, identifier: string, body: string, connectionId?: string, parentId?: string): Promise<{ created: true }> {
    const conns = connectionId ? [await this.connectionOrThrow(userId, connectionId)] : await this.connections(userId)
    if (!conns.length) throw new PublicApiError('provider_unavailable', 'No Linear connection')
    const filter = issuesFilter([identifier])
    if (!filter) throw new PublicApiError('not_found', 'Invalid identifier')
    // Resolve the internal issue UUID + owning connection.
    let owner: { row: StoredConnection; key: string; issueId: string } | null = null
    for (const { row, key } of conns) {
      const res = await this.fetch(row, key, ISSUE_ID_QUERY, { filter })
      if (linearError(res)) continue
      try {
        const { issues } = await linearData<{ issues: { nodes: LinearNode[] } }>(res)
        const id = issues.nodes[0]?.id
        if (id) {
          owner = { row, key, issueId: id }
          break
        }
      } catch {
        // next connection
      }
    }
    if (!owner) throw new PublicApiError('not_found', 'Linear issue not found')
    if (!connectionHasCapability(owner.row, 'comments')) throw new PublicApiError('operation_forbidden', 'Connection lacks comment scope')
    const input: Record<string, unknown> = { issueId: owner.issueId, body: body.trim() }
    if (parentId) input.parentId = parentId
    try {
      const mutation = linearProvider.mutations!.find((m) => m.id === 'linear.comment')!
      await providerRequestScheduler.run(PROVIDER, owner.row.id, linearProvider.budgets, () => mutation.run!({ secret: owner.key, input }))
    } catch (e) {
      throw mapProviderError(e)
    }
    return { created: true }
  }
}
