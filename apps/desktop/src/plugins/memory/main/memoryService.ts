import { homedir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { type AppDatabase, schema } from '../../../core/server/db'
import { taskRoot } from '../../../core/main/taskWorktree'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import type { MemoryEntrySchema, MemoryInputSchema, MemoryProposalSchema, ResolveProposalSchema } from '../../../core/shared/publicApi/memory'
import { getMemory, listMemories, searchMemories, writeMemoryFile, type MemoryType } from './memory'
import { acceptProposal, rejectProposal } from './memoryGen'
import type { MemoryProposalStore } from './memoryProposals'

// MemoryService (docs/public-api.md). Read side is the derived SQLite index; the write
// side reuses the existing memory-file writer + proposal gate machinery so the public surface can't
// bypass reconciliation. Injected with the knowledge store's proposal store + reconcile closure.

type MemoryRow = typeof schema.memories.$inferSelect
type MemoryEntry = z.infer<typeof MemoryEntrySchema>
type MemoryProposal = z.infer<typeof MemoryProposalSchema>

export type MemoryServiceDeps = {
  db: AppDatabase
  proposals: MemoryProposalStore
  // Re-index all memory sources after a write; the knowledge store owns the source list.
  reconcile: () => Promise<void>
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    scope: row.scope as 'repo' | 'private',
    repo: row.repo,
    name: row.name,
    type: row.type,
    description: row.description,
    body: row.body,
    updatedAt: row.updatedAt,
  }
}

export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  async listEntries(opts: { repo?: string; type?: string }): Promise<MemoryEntry[]> {
    const rows = await listMemories(this.deps.db, { repo: opts.repo ?? null, type: opts.type as MemoryType | undefined })
    return rows.map(rowToEntry)
  }

  async search(input: { query: string; repo?: string; type?: string; limit: number }): Promise<MemoryEntry[]> {
    const hits = await searchMemories(this.deps.db, input.query, {
      repo: input.repo ?? null,
      type: input.type as MemoryType | undefined,
      limit: input.limit,
    })
    return hits.map(rowToEntry)
  }

  // Direct create: write the memory file, reconcile the index, return the landed entry. Repo scope
  // lands in the task worktree's .acorn/memory; private scope in the home private dir.
  async createEntry(taskId: string, input: z.infer<typeof MemoryInputSchema>): Promise<MemoryEntry> {
    let dir: string
    let repo: string | null = null
    if (input.scope === 'repo') {
      const root = await taskRoot(this.deps.db, taskId)
      if (!root) throw new PublicApiError('conflict', 'Task has no worktree; repo-scoped memory has nowhere to land')
      dir = join(root, '.acorn', 'memory')
      repo = await this.repoForTask(taskId)
    } else {
      dir = join(homedir(), '.acorn', 'memory')
    }
    try {
      await writeMemoryFile(dir, {
        name: input.name,
        description: input.description,
        // The public schema keeps `type` open; the file writer stores it verbatim.
        type: input.type as MemoryType,
        originSessionId: null,
        commitSha: null,
        supersededBy: null,
        createdAt: Date.now(),
        body: input.body,
      })
    } catch (e) {
      throw new PublicApiError('validation_failed', e instanceof Error ? e.message : 'Invalid memory')
    }
    await this.deps.reconcile()
    const landed = await getMemory(this.deps.db, { repo, name: input.name })
    if (!landed) throw new PublicApiError('internal_error', 'Memory did not reconcile')
    return rowToEntry(landed)
  }

  async listProposals(opts: { taskId?: string }): Promise<MemoryProposal[]> {
    const all = await this.deps.proposals.list()
    const filtered = opts.taskId ? all.filter((p) => p.taskId === opts.taskId) : all
    return filtered.map((p) => ({
      id: p.id,
      taskId: p.taskId,
      repo: p.repo,
      name: p.name,
      type: p.type,
      description: p.description,
      body: p.body,
      flags: p.flags,
      status: p.status,
      createdAt: p.createdAt,
    }))
  }

  async resolveProposal(id: string, input: z.infer<typeof ResolveProposalSchema>): Promise<{ resolved: boolean; status: 'accepted' | 'rejected' }> {
    const proposal = await this.deps.proposals.get(id)
    if (!proposal) throw new PublicApiError('not_found', 'Proposal not found')
    if (!input.approved) {
      const res = await rejectProposal(this.deps.proposals, id)
      if (!res.ok) throw new PublicApiError('conflict', 'Proposal could not be rejected')
      return { resolved: true, status: 'rejected' }
    }
    const worktreePath = proposal.taskId ? await taskRoot(this.deps.db, proposal.taskId) : null
    const edited = input.edited ? { name: input.edited.name, type: input.edited.type as MemoryType, description: input.edited.description, body: input.edited.body } : undefined
    const res = await acceptProposal(this.deps.proposals, id, worktreePath, this.deps.reconcile, edited)
    if (!res.ok) throw new PublicApiError('conflict', res.reason ?? 'Proposal could not be accepted')
    return { resolved: true, status: 'accepted' }
  }

  private async repoForTask(taskId: string): Promise<string | null> {
    const [t] = await this.deps.db
      .select({ owner: schema.tasks.repoOwner, name: schema.tasks.repoName })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .limit(1)
    return t ? `${t.owner}/${t.name}` : null
  }
}
