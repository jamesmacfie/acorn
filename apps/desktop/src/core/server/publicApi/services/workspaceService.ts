import { randomUUID } from 'node:crypto'
import { and, eq, inArray, max } from 'drizzle-orm'
import type { AppDatabase } from '../../db'
import { schema } from '../../db'
import { getConnection } from '../../integrations/connections'
import { isValidWorkspaceColor, parseWorkspaceIcon, serializeWorkspaceIcon } from '../../../shared/workspaceIdentity'
import { PublicApiError } from '../../../shared/publicApi/errors'
import type { Workspace } from '../../../shared/publicApi/resources'
import type { z } from 'zod'
import type {
  CreateWorkspaceSchema,
  PatchWorkspaceSchema,
  PatchRepositoryAssignmentSchema,
  PutRepositoryAssignmentSchema,
  RepositoryAssignmentSchema,
  WorkspaceIconSchema,
} from '../../../shared/publicApi/resources'

// WorkspaceService (docs/next/api/implementation-plan.md Phase 4). The DB-level workspace domain
// shared by the public API. Returns the public Workspace shape (with timestamps). Behavior mirrors
// core/server/routes/workspaces.ts so the two surfaces cannot drift.

type Icon = z.infer<typeof WorkspaceIconSchema>
type RepositoryAssignment = z.infer<typeof RepositoryAssignmentSchema>

async function ignoredRepoSet(db: AppDatabase): Promise<Set<string>> {
  return new Set((await db.select().from(schema.ignoredRepos)).map((i) => `${i.owner}/${i.repo}`))
}

export class WorkspaceService {
  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async ensureDefault(): Promise<string> {
    const existing = await this.db.select().from(schema.workspaces).where(eq(schema.workspaces.isDefault, true)).limit(1)
    if (existing[0]) return existing[0].id
    const now = this.now()
    const id = randomUUID()
    await this.db.insert(schema.workspaces).values({ id, name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    return id
  }

  private rowToWorkspace(row: typeof schema.workspaces.$inferSelect, repos: Workspace['repos']): Workspace {
    return {
      id: row.id,
      name: row.name,
      isDefault: row.isDefault,
      sort: row.sort,
      setupScript: row.setupScript,
      setupScriptTrigger: row.setupScriptTrigger as Workspace['setupScriptTrigger'],
      devScript: row.devScript,
      devRestartScript: row.devRestartScript,
      teardownScript: row.teardownScript,
      dbUrlScript: row.dbUrlScript,
      previewMode: row.previewMode as Workspace['previewMode'],
      previewValue: row.previewValue,
      icon: parseWorkspaceIcon(row.icon) as Icon | null,
      color: row.color,
      repos: [...repos].sort((a, b) => a.sort - b.sort),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  async list(): Promise<Workspace[]> {
    const rows = await this.db.select().from(schema.workspaces).orderBy(schema.workspaces.sort)
    if (!rows.length) return []
    const repoRows = await this.db
      .select()
      .from(schema.workspaceRepos)
      .where(inArray(schema.workspaceRepos.workspaceId, rows.map((r) => r.id)))
    const ignored = await ignoredRepoSet(this.db)
    const byWs = new Map<string, Workspace['repos']>()
    for (const r of repoRows) {
      if (ignored.has(`${r.repoOwner}/${r.repoName}`)) continue
      const list = byWs.get(r.workspaceId) ?? []
      list.push({ owner: r.repoOwner, name: r.repoName, sort: r.sort })
      byWs.set(r.workspaceId, list)
    }
    return rows.map((r) => this.rowToWorkspace(r, byWs.get(r.id) ?? []))
  }

  async get(id: string): Promise<Workspace | null> {
    const [row] = await this.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1)
    if (!row) return null
    const repoRows = await this.db.select().from(schema.workspaceRepos).where(eq(schema.workspaceRepos.workspaceId, id))
    const ignored = await ignoredRepoSet(this.db)
    const repos = repoRows
      .filter((r) => !ignored.has(`${r.repoOwner}/${r.repoName}`))
      .map((r) => ({ owner: r.repoOwner, name: r.repoName, sort: r.sort }))
    return this.rowToWorkspace(row, repos)
  }

  async getOrThrow(id: string): Promise<Workspace> {
    const ws = await this.get(id)
    if (!ws) throw new PublicApiError('not_found', 'Workspace not found')
    return ws
  }

  async create(input: z.infer<typeof CreateWorkspaceSchema>): Promise<Workspace> {
    if (input.color != null && input.color !== '' && !isValidWorkspaceColor(input.color)) {
      throw new PublicApiError('validation_failed', 'Invalid workspace color')
    }
    const [{ value }] = await this.db.select({ value: max(schema.workspaces.sort) }).from(schema.workspaces)
    const now = this.now()
    const id = randomUUID()
    await this.db.insert(schema.workspaces).values({
      id,
      name: input.name,
      isDefault: false,
      sort: (value ?? -1) + 1,
      icon: input.icon != null ? serializeWorkspaceIcon(input.icon) : null,
      color: input.color || null,
      createdAt: now,
      updatedAt: now,
    })
    return this.getOrThrow(id)
  }

  async update(id: string, patch: z.infer<typeof PatchWorkspaceSchema>): Promise<Workspace> {
    const [existing] = await this.db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, id))
    if (!existing) throw new PublicApiError('not_found', 'Workspace not found')

    const set: Partial<typeof schema.workspaces.$inferInsert> = { updatedAt: this.now() }
    if (patch.name !== undefined) set.name = patch.name
    if (patch.sort !== undefined) set.sort = patch.sort
    if (patch.setupScript !== undefined) set.setupScript = patch.setupScript?.trim() || null
    if (patch.devScript !== undefined) set.devScript = patch.devScript?.trim() || null
    if (patch.devRestartScript !== undefined) set.devRestartScript = patch.devRestartScript?.trim() || null
    if (patch.teardownScript !== undefined) set.teardownScript = patch.teardownScript?.trim() || null
    if (patch.dbUrlScript !== undefined) set.dbUrlScript = patch.dbUrlScript?.trim() || null
    if (patch.setupScriptTrigger !== undefined) set.setupScriptTrigger = patch.setupScriptTrigger
    if (patch.previewMode !== undefined) set.previewMode = patch.previewMode
    if (patch.previewValue !== undefined) set.previewValue = patch.previewValue?.trim() || null
    // 'port' preview mode is interpolated into http://localhost:<value>; require a bare port so a
    // crafted value can't redirect the preview to another host (matches the internal route).
    const effectiveMode = patch.previewMode !== undefined ? patch.previewMode : undefined
    if (effectiveMode === 'port' && set.previewValue != null) {
      const p = Number(set.previewValue)
      if (!/^\d{1,5}$/.test(set.previewValue) || p < 1 || p > 65535) {
        throw new PublicApiError('validation_failed', 'previewValue must be a bare port 1-65535')
      }
    }
    if (patch.icon !== undefined) set.icon = patch.icon === null ? null : serializeWorkspaceIcon(patch.icon)
    if (patch.color !== undefined) {
      if (patch.color === null || patch.color === '') set.color = null
      else if (isValidWorkspaceColor(patch.color)) set.color = patch.color
      else throw new PublicApiError('validation_failed', 'Invalid workspace color')
    }
    await this.db.update(schema.workspaces).set(set).where(eq(schema.workspaces.id, id))
    return this.getOrThrow(id)
  }

  async delete(id: string): Promise<void> {
    const [row] = await this.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1)
    if (!row) throw new PublicApiError('not_found', 'Workspace not found')
    if (row.isDefault) throw new PublicApiError('cannot_delete_default', 'The Default workspace cannot be deleted')
    const defaultId = await this.ensureDefault()
    await this.db.update(schema.workspaceRepos).set({ workspaceId: defaultId }).where(eq(schema.workspaceRepos.workspaceId, id))
    await this.db.delete(schema.workspaceProjects).where(eq(schema.workspaceProjects.workspaceId, id))
    await this.db.delete(schema.workspaces).where(eq(schema.workspaces.id, id))
  }

  async bootstrap(userLogin: string): Promise<Workspace[]> {
    const defaultId = await this.ensureDefault()
    const repos = await this.db.select().from(schema.repos).where(eq(schema.repos.userId, userLogin))
    const mapped = await this.db.select().from(schema.workspaceRepos)
    const ignored = await ignoredRepoSet(this.db)
    const skip = new Set([...mapped.map((m) => `${m.repoOwner}/${m.repoName}`), ...ignored])
    const now = this.now()
    const toAdd = repos
      .filter((r) => !skip.has(`${r.owner}/${r.name}`))
      .map((r, i) => ({ workspaceId: defaultId, repoOwner: r.owner, repoName: r.name, sort: i, createdAt: now }))
    if (toAdd.length) await this.db.insert(schema.workspaceRepos).values(toAdd).onConflictDoNothing()
    return this.list()
  }

  async getProjects(id: string): Promise<{ integrationId: string; externalId: string }[]> {
    const rows = await this.db.select().from(schema.workspaceProjects).where(eq(schema.workspaceProjects.workspaceId, id))
    return rows.map((r) => ({ integrationId: r.integrationId, externalId: r.externalId }))
  }

  async replaceProjects(id: string, userLogin: string, projects: { integrationId: string; externalId: string }[]): Promise<{ integrationId: string; externalId: string }[]> {
    for (const project of projects) {
      if (!(await getConnection(this.db, userLogin, project.integrationId))) {
        throw new PublicApiError('provider_validation_failed', `Integration ${project.integrationId} is not connected`)
      }
    }
    const now = this.now()
    await this.db.delete(schema.workspaceProjects).where(eq(schema.workspaceProjects.workspaceId, id))
    if (projects.length) {
      await this.db
        .insert(schema.workspaceProjects)
        .values(projects.map((p) => ({ workspaceId: id, integrationId: p.integrationId, externalId: p.externalId, createdAt: now })))
        .onConflictDoNothing()
    }
    return this.getProjects(id)
  }

  // --- Repository assignments ---

  async listAssignments(filter: { workspaceId?: string; ignored?: boolean }): Promise<RepositoryAssignment[]> {
    const rows = await this.db.select().from(schema.workspaceRepos)
    const ignored = await ignoredRepoSet(this.db)
    let items = rows.map((r) => ({
      owner: r.repoOwner,
      name: r.repoName,
      workspaceId: r.workspaceId,
      ignored: ignored.has(`${r.repoOwner}/${r.repoName}`),
      sort: r.sort,
    }))
    if (filter.workspaceId) items = items.filter((a) => a.workspaceId === filter.workspaceId)
    if (filter.ignored !== undefined) items = items.filter((a) => a.ignored === filter.ignored)
    return items
  }

  async putAssignment(owner: string, name: string, input: z.infer<typeof PutRepositoryAssignmentSchema>): Promise<RepositoryAssignment> {
    const [ws] = await this.db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, input.workspaceId))
    if (!ws) throw new PublicApiError('not_found', 'Workspace not found')
    const now = this.now()
    await this.db
      .insert(schema.workspaceRepos)
      .values({ workspaceId: input.workspaceId, repoOwner: owner, repoName: name, sort: input.sort, createdAt: now })
      .onConflictDoUpdate({ target: [schema.workspaceRepos.repoOwner, schema.workspaceRepos.repoName], set: { workspaceId: input.workspaceId, sort: input.sort } })
    await this.setIgnored(owner, name, input.ignored)
    return { owner, name, workspaceId: input.workspaceId, ignored: input.ignored, sort: input.sort }
  }

  async patchAssignment(owner: string, name: string, patch: z.infer<typeof PatchRepositoryAssignmentSchema>): Promise<RepositoryAssignment> {
    const [row] = await this.db
      .select()
      .from(schema.workspaceRepos)
      .where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, name)))
      .limit(1)
    if (!row) throw new PublicApiError('not_found', 'Repository assignment not found')
    const set: Partial<typeof schema.workspaceRepos.$inferInsert> = {}
    if (patch.workspaceId !== undefined) {
      const [ws] = await this.db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, patch.workspaceId))
      if (!ws) throw new PublicApiError('not_found', 'Workspace not found')
      set.workspaceId = patch.workspaceId
    }
    if (patch.sort !== undefined) set.sort = patch.sort
    if (Object.keys(set).length) {
      await this.db.update(schema.workspaceRepos).set(set).where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, name)))
    }
    if (patch.ignored !== undefined) await this.setIgnored(owner, name, patch.ignored)
    const ignored = await ignoredRepoSet(this.db)
    const [updated] = await this.db
      .select()
      .from(schema.workspaceRepos)
      .where(and(eq(schema.workspaceRepos.repoOwner, owner), eq(schema.workspaceRepos.repoName, name)))
    return { owner, name, workspaceId: updated.workspaceId, ignored: ignored.has(`${owner}/${name}`), sort: updated.sort }
  }

  private async setIgnored(owner: string, repo: string, ignored: boolean): Promise<void> {
    if (ignored) {
      await this.db.insert(schema.ignoredRepos).values({ owner, repo, createdAt: this.now() }).onConflictDoNothing()
    } else {
      await this.db.delete(schema.ignoredRepos).where(and(eq(schema.ignoredRepos.owner, owner), eq(schema.ignoredRepos.repo, repo)))
    }
  }
}
