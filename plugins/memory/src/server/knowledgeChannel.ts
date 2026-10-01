import { type CoreServices, gitOrThrow, isDir, type PluginDatabase } from '@acorn/plugin-api/node'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { KnowledgeBridge } from '../server/routes/knowledge'
import { formatMemoryInjection, getMemory, listMemories, memoryIndexSlice, memorySources, MEMORY_TYPES, privateMemoryRoot, projectMemoryDir, reconcileMemories, searchMemories, writeMemoryFile, type MemoryType } from './memory'
import { formatLaunchContext } from '@acorn/plugin-context/contract/contextBlock.ts'
import type { MemoryHit, MemoryRow } from './memory'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

export type KnowledgeDeps = {
  /** This plugin's own channel for memory edits. */
  emit?(frame: { channel: string } & Record<string, unknown>): void
}

export type KnowledgeCoreServices = Pick<CoreServices, 'tasks' | 'projects' | 'context' | 'identity'>

// Reads over the derived index, bound to this plugin's own database (docs/data-layer.md § Plugin
// databases). Agent tools and context sections read memory through this rather than the files
// (docs/notes-and-memory.md § Memory).
export type MemoryIndex = {
  // Exposed as well as used internally: a caller that then reads through a different path (core's
  // context assembler) still needs the index fresh.
  reconciled(): Promise<void>
  list(opts: { projectId?: string | null; type?: MemoryType }): Promise<MemoryRow[]>
  get(opts: { projectId?: string | null; name: string }): Promise<MemoryRow | null>
  search(query: string, opts: { projectId?: string | null; type?: MemoryType }): Promise<MemoryHit[]>
  // The always-safe injection slice: index lines only (name + description), capped.
  indexSlice(projectId: string, cap?: number): Promise<{ name: string; description: string }[]>
}

export type MemoryKnowledge = MemoryIndex & {
  // Builds the bounded task and memory block. Terminal owns delivery to its new session.
  launchContext(taskId: string): Promise<string | null>
}

export function registerKnowledgeChannel(db: PluginDatabase, core: KnowledgeCoreServices, deps: KnowledgeDeps): MemoryKnowledge & { route: KnowledgeBridge } {
  const guard = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn()
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'memory failed' }
    }
  }

  // Memory (docs/notes-and-memory.md § Memory): files are truth, and the SQLite index reconciles from
  // the private store plus every active worktree and primary checkout before each read. The worktree
  // and checkout halves are read-only: acorn writes memory under the private root alone.
  const buildMemorySources = async () => {
    const active = (await core.tasks.active())
      .filter((t) => t.worktreePath && isDir(t.worktreePath))
      .filter((t) => t.projectId)
      .map((t) => ({ dir: t.worktreePath!, projectId: t.projectId! }))
    const checkouts = (await core.projects.checkouts()).filter((p) => isDir(p.path))
    return await memorySources(active, checkouts, homedir())
  }
  const reconciled = async () => reconcileMemories(db, await buildMemorySources())
  const announceMemories = (projectId: string | null) => deps.emit?.({
    channel: pluginChannel('memory', 'memories-changed'),
    ...(projectId ? { scope: 'project' as const, projectId } : { scope: 'private' as const, projectId: null }),
  })

  const launchContext = async (taskId: string): Promise<string | null> => {
    // Launch injection (docs/notes-and-memory.md § Context integration): task context is gated by
    // the startup_context_injection pref; the memory block is the MEMORY.md index slice plus
    // feedback/convention bodies. Queued 'after-ready'. Best-effort: never blocks a launch.
    try {
      const t = await core.tasks.load(taskId)
      if (!t) return null
      const projectId = t.projectId
      if (!projectId) return null
      const blocks: string[] = []

      const userId = core.identity.active()
      if (userId && (await core.context.injectionEnabled(userId))) {
        const ctx = await core.context.assemble(userId, taskId, new Set(['pr', 'issues', 'notes']))
        const contextBlock = ctx ? formatLaunchContext(ctx) : ''
        if (contextBlock) blocks.push(contextBlock)
      }

      await reconciled()
      const slice = await memoryIndexSlice(db, projectId)
      const key = (await listMemories(db, { projectId })).filter((m) => m.type === 'feedback' || m.type === 'convention')
      const memoryBlock = formatMemoryInjection(slice, key)
      if (memoryBlock) blocks.push(memoryBlock)

      return blocks.join('\n\n') || null
    } catch {
      return null
    }
  }

  // The client's memory surface, exposed as the KnowledgeBridge behind the HTTP routes.
  // guard() keeps the `| { error }` contract the client unions on.
  const route: KnowledgeBridge = {
    taskMemoryScope: async (taskId) => {
      const task = await core.tasks.load(taskId)
      if (!task) return null
      if (!task.projectId) return { projectId: null }
      const project = await core.projects.byId(task.projectId)
      return project ? { projectId: project.id } : null
    },
    memoryList: (projectId) =>
      guard(async () => {
        await reconciled()
        return listMemories(db, { projectId: projectId ?? null })
      }),
    memorySearch: (query, projectId, type) =>
      guard(async () => {
        await reconciled()
        return searchMemories(db, query, { projectId: projectId ?? null, type: MEMORY_TYPES.includes(type as MemoryType) ? (type as MemoryType) : undefined })
      }),
    // Manual add: both scopes write under the owner's private root, so a memory never turns up in the
    // repo's diff. Project scope is keyed by the task's project id; private scope applies everywhere.
    memoryAdd: (taskId, p) =>
      guard(async () => {
        const type: MemoryType = MEMORY_TYPES.includes(p.type as MemoryType) ? (p.type as MemoryType) : 'reference'
        const t = await core.tasks.load(taskId)
        let dir: string
        if (p.scope === 'private') dir = privateMemoryRoot(homedir())
        else {
          if (!t?.projectId) throw new Error('Project memory needs a task that names a project.')
          dir = projectMemoryDir(homedir(), t.projectId)
        }
        let commitSha: string | null = null
        if (t?.worktreePath && isDir(t.worktreePath) && existsSync(join(t.worktreePath, '.git'))) {
          try {
            const { stdout } = await gitOrThrow(['rev-parse', 'HEAD'], { cwd: t.worktreePath, timeoutMs: 5_000 })
            commitSha = stdout.trim()
          } catch {
            // no commit yet; continue without one
          }
        }
        const res = await writeMemoryFile(dir, {
          name: p.name.trim(),
          description: p.description.trim(),
          type,
          originSessionId: null,
          commitSha,
          supersededBy: null,
          createdAt: Date.now(),
          body: p.body,
        })
        await reconciled()
        announceMemories(p.scope === 'private' ? null : t!.projectId!)
        return res
      }),
    memoryApproveFinding: async () => ({ ok: false, reason: 'Findings review is unavailable.' }),
  }

  // The index reads bind to this plugin's own database; Terminal consumes launchContext as a
  // contribution and the other reads stay inside Memory.
  return {
    route,
    reconciled,
    launchContext,
    list: (opts) => listMemories(db, opts),
    get: (opts) => getMemory(db, opts),
    search: (query, opts) => searchMemories(db, query, opts),
    indexSlice: (projectId, cap) => memoryIndexSlice(db, projectId, cap),
  }
}
