import { BridgeError, ToolError, type CoreServices, isDir, type PluginDatabase } from '@acorn/plugin-api/node'
import { homedir } from 'node:os'
import type { KnowledgeBridge } from '../server/routes/knowledge'
import { listMemories, memorySources, MEMORY_TYPES, privateMemoryRoot, reconcileMemories, searchMemories, normalizeMemoryType, type MemoryType } from './memory'
import { formatLaunchContext } from '@acorn/plugin-context/contract/contextBlock.ts'
import type { MemoryRow } from './memory'
import type { MemoryStoreAccess } from './memoryStore'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

export type KnowledgeDeps = {
  /** This plugin's own channel for memory edits. */
  emit?(frame: { channel: string } & Record<string, unknown>): void
}

export type KnowledgeCoreServices = Pick<CoreServices, 'tasks' | 'projects' | 'context' | 'identity' | 'prefs'>

// Reads over the derived index, bound to this plugin's own database (docs/data-layer.md § Plugin
// databases). Findings and the legacy page read through this during phase 1 measurement.
// Direct agent tools and standing context read the files (docs/notes-and-memory.md § Memory).
export type MemoryIndex = {
  // Exposed as well as used internally: a caller that then reads through a different path (core's
  // context assembler) still needs the index fresh.
  reconciled(): Promise<void>
  list(opts: { projectId?: string | null; type?: MemoryType }): Promise<MemoryRow[]>
}

export type MemoryKnowledge = MemoryIndex & {
  // Builds the bounded task and memory block. Terminal owns delivery to its new session.
  launchContext(taskId: string): Promise<string | null>
  standingContext(taskId: string): Promise<string | null>
  store: MemoryStoreAccess
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

  // Writes and session prompts are first-use work, outside the Node's cold-boot graph.
  let storePromise: Promise<MemoryStoreAccess> | undefined
  const loadStore = () => storePromise ??= import('./memoryStore').then(({ MemoryStore }) => new MemoryStore(privateMemoryRoot(homedir()), announceMemories))
  const store: MemoryStoreAccess = {
    list: async (...args) => (await loadStore()).list(...args),
    get: async (...args) => (await loadStore()).get(...args),
    search: async (...args) => (await loadStore()).search(...args),
    write: async (...args) => (await loadStore()).write(...args),
    delete: async (...args) => (await loadStore()).delete(...args),
    undo: async (...args) => (await loadStore()).undo(...args),
  }
  const standingContext = async (taskId: string) => {
    const { standingContextBuilder } = await import('./standingContext')
    return standingContextBuilder(store, core)(taskId)
  }

  const launchContext = async (taskId: string): Promise<string | null> => {
    // Launch injection (docs/notes-and-memory.md § Context integration): task context is gated by
    // the startup_context_injection pref. Memory is always the contract and capped indexes.
    // Terminal reads this before spawn where the profile supports it. Best-effort on failure.
    try {
      const t = await core.tasks.load(taskId)
      if (!t) return null

      const blocks: string[] = []

      const userId = core.identity.active()
      if (userId && (await core.context.injectionEnabled(userId))) {
        const ctx = await core.context.assemble(userId, taskId, new Set(['pr', 'issues', 'notes']))
        const contextBlock = ctx ? formatLaunchContext(ctx) : ''
        if (contextBlock) blocks.push(contextBlock)
      }

      const memoryBlock = await standingContext(taskId)
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
        const t = await core.tasks.load(taskId)
        if (p.scope === 'project' && !t?.projectId) throw new Error('Project memory needs a task that names a project.')
        const res = await store.write({ scope: p.scope, projectId: p.scope === 'project' ? t!.projectId! : null, name: p.name.trim() }, {
          name: p.name.trim(),
          description: p.description.trim(),
          type: normalizeMemoryType(p.type),
          body: p.body,
        }, { by: 'owner', taskId })
        await reconciled()
        return res
      }),
    memoryProjectAdd: (projectId, input) => guard(async () => {
      if (!await core.projects.byId(projectId)) throw new Error('No such project.')
      return store.write({ scope: input.scope, projectId: input.scope === 'project' ? projectId : null, name: input.name },
        { ...input, type: normalizeMemoryType(input.type) }, { by: 'owner' })
    }),
    memoryUndo: async (changeId) => {
      try { return await store.undo(changeId) }
      catch (error) {
        if (error instanceof ToolError) throw new BridgeError(error.kind === 'conflict' ? 409 : error.kind === 'not_found' ? 404 : 400, error.kind, error.message)
        throw error
      }
    },
    memoryApproveFinding: async () => ({ ok: false, reason: 'Findings review is unavailable.' }),
  }

  // The index reads bind to this plugin's own database; Terminal consumes launchContext as a
  // contribution and the other reads stay inside Memory.
  return {
    route,
    store,
    standingContext,
    reconciled,
    launchContext,
    list: (opts) => listMemories(db, opts),
  }
}
