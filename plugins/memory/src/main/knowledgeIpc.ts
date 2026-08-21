import { buildHeadlessArgv, buildSessionEnv, type CoreServices, gitOrThrow, isDir, listProfileDefs, type PluginDatabase, profileAvailable, type ProfileDef, resolveCommand, runHeadless } from '@acorn/plugin-api/node'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { KnowledgeBridge } from '../server/routes/knowledge'
import { formatMemoryInjection, getMemory, listMemories, memoryIndexSlice, memorySources, MEMORY_TYPES, reconcileMemories, searchMemories, writeMemoryFile, type MemoryType } from './memory'
import { acceptProposal, generateMemoryProposals, rejectProposal } from './memoryGen'
import { MemoryProposalStore } from './memoryProposals'
import type { NotesStoreCapability } from '@acorn/plugin-notes/contract/store.ts'
import type { NoteKind } from '@acorn/protocol/notes.ts'
import { formatLaunchContext } from '@acorn/plugin-context/contract/contextBlock.ts'
import type { MemoryHit, MemoryRow } from './memory'

export type KnowledgeDeps = {
  // Queue a text block into an agent session on its idle edge (agentSender in terminal.ts).
  sendToAgent(sessionId: string, text: string, submit: 'after-ready'): void
  notes(): NotesStoreCapability
  notice(taskId: string, kind: 'gate' | 'run-done', title: string): void
}

export type KnowledgeCoreServices = Pick<CoreServices, 'tasks' | 'projects' | 'context' | 'identity'>

// Reads over the derived index, bound to this plugin's own database (docs/data-layer.md §
// Plugin databases). Keeps the app-layer agent-tool and context-section wiring working without a
// handle to the underlying files (docs/notes-and-memory.md § Memory).
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
  proposals: MemoryProposalStore
  // Pushes the combined launch block (task context + project memory) into a fresh agent session
  // (docs/notes-and-memory.md § Context integration). Best-effort: never fails a launch.
  launchInjector(taskId: string, sessionId: string): Promise<void>
  // Memory auto-generation trigger: fired when an agent session for a task exits, with that session's
  // ring tail as the transcript input.
  memoryReviewTrigger(taskId: string, transcriptTail: string): Promise<void>
}

// The capability id moved to ../contract/knowledge.ts, narrowed to the two methods that are
// actually driven from outside this plugin. This type stays here because it is the full runtime,
// including the proposal-store handle, which a contract file may not name.

// The headless profile the memory-review pass runs on (docs/notes-and-memory.md § Lifecycle
// hooks).
export function memoryReviewProfile(): ProfileDef | null {
  return (
    listProfileDefs().find((p) => p.kind === 'agent' && profileAvailable(p) && buildHeadlessArgv(p.id, resolveCommand(p), { prompt: '' }) !== null) ?? null
  )
}

export function registerKnowledgeIpc(db: PluginDatabase, dataRoot: string, core: KnowledgeCoreServices, deps: KnowledgeDeps): MemoryKnowledge & { route: KnowledgeBridge } {
  const proposals = new MemoryProposalStore(join(dataRoot, 'memory-proposals'))

  const guard = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn()
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'notes failed' }
    }
  }

  // Memory (docs/notes-and-memory.md § Memory): files are truth, and the SQLite index reconciles
  // from every active worktree, primary checkout, and the private home dir before each read
  // (cheap at this scale).
  const buildMemorySources = async () => {
    const active = (await core.tasks.active())
      .filter((t) => t.worktreePath && isDir(t.worktreePath))
      .filter((t) => t.projectId)
      .map((t) => ({ dir: t.worktreePath!, projectId: t.projectId! }))
    const checkouts = (await core.projects.checkouts()).filter((p) => isDir(p.path))
    return memorySources(active, checkouts, homedir())
  }
  const reconciled = async () => reconcileMemories(db, await buildMemorySources())

  const launchInjector = async (taskId: string, sessionId: string) => {
    // Launch injection (docs/notes-and-memory.md § Context integration): task context is gated by
    // the startup_context_injection pref; the memory block is the MEMORY.md index slice plus
    // feedback/convention bodies. Queued 'after-ready'. Best-effort: never blocks a launch.
    try {
      const t = await core.tasks.load(taskId)
      if (!t) return
      const projectId = t.projectId
      if (!projectId) return
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

      if (blocks.length) deps.sendToAgent(sessionId, blocks.join('\n\n'), 'after-ready')
    } catch {
      // launch injection is best-effort: it never blocks a session launch
    }
  }

  // Memory auto-generation (docs/notes-and-memory.md § Lifecycle hooks): the task-completion
  // trigger, fired on agent session end (and best-effort at archive) while the worktree is still
  // alive. Verification flags ride the proposal's `flags` field, never folded into the
  // description.
  const memoryReviewTrigger = async (taskId: string, transcriptTail: string) => {
    try {
      const t = await core.tasks.load(taskId)
      if (!t?.worktreePath || !isDir(t.worktreePath)) return
      const profile = memoryReviewProfile()
      if (!profile) return // no headless-capable agent CLI installed → no auto-generation
      const worktree = t.worktreePath
      const project = t.projectId ? await core.projects.byId(t.projectId) : null
      if (!project) return
      const out = await generateMemoryProposals({
        runReview: (prompt, schema0) => {
          const argv = buildHeadlessArgv(profile.id, resolveCommand(profile), { prompt, schema: schema0 })!
          return runHeadless(argv, { cwd: worktree, env: buildSessionEnv({ taskId, cwd: worktree, task: { projectId: project.id, projectName: project.name, github: project.github, branch: t.branch, title: t.title } }) })
        },
        taskDiff: async () => {
          if (!existsSync(join(worktree, '.git'))) return ''
          try {
            const { stdout } = await gitOrThrow(['diff', 'HEAD'], { cwd: worktree, timeoutMs: 15_000 })
            return stdout
          } catch {
            return ''
          }
        },
        transcriptTail: async () => transcriptTail,
        existingIndex: async () => {
          await reconciled()
          return (await listMemories(db, { projectId: project.id })).map((m) => ({ id: m.id, name: m.name, description: m.description, body: m.body }))
        },
        fileExists: (p) => existsSync(join(worktree, p)),
        propose: async (c, flags) =>
          void (await proposals.propose({
            taskId,
            projectId: project.id,
            name: c.name,
            type: c.type,
            description: c.description,
            body: c.body,
            flags,
            originSessionId: null,
          })),
      })
      if (out.proposed > 0) deps.notice(taskId, 'gate', `${out.proposed} memory proposal${out.proposed === 1 ? '' : 's'} await review`)
    } catch {
      // auto-generation is best-effort: it never disturbs the task lifecycle
    }
  }

  // The renderer's notes + memory surface, exposed as the KnowledgeBridge behind the HTTP routes
  // (server/routes/knowledge.ts). Distinct from the harness memory/notes bridges (the MCP agent
  // surface); this is the human-facing pane. guard() keeps the `| { error }` contract the clients
  // union on. Backed by the same stores, so it 503s under dev:node.
  const route: KnowledgeBridge = {
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
    // Manual add: project scope writes into the task's worktree, reviewed through its PR and never
    // the user's primary checkout. Private scope writes into ~/.acorn/memory.
    memoryAdd: (taskId, p) =>
      guard(async () => {
        const type: MemoryType = MEMORY_TYPES.includes(p.type as MemoryType) ? (p.type as MemoryType) : 'reference'
        const t = await core.tasks.load(taskId)
        let dir: string
        if (p.scope === 'private') dir = join(homedir(), '.acorn', 'memory')
        else {
          const project = t?.projectId ? await core.projects.byId(t.projectId) : null
          const root = t?.worktreePath && isDir(t.worktreePath) ? t.worktreePath : project?.path
          if (!root || !isDir(root)) throw new Error('Project memory needs a mapped project folder (or task worktree).')
          dir = join(root, '.acorn', 'memory')
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
        return res
      }),
    // The human gate over auto-generated proposals (docs/notes-and-memory.md).
    memoryProposals: async (taskId) => {
      const pending = await proposals.list('pending')
      return taskId ? pending.filter((p) => p.taskId === taskId) : pending
    },
    memoryResolveProposal: async (id, approved, edited) => {
      if (!approved) return rejectProposal(proposals, id)
      const proposal = await proposals.get(id)
      if (!proposal) return { ok: false, reason: 'Proposal not found.' }
      const t = await core.tasks.load(proposal.taskId)
      const project = t?.projectId ? await core.projects.byId(t.projectId) : null
      return acceptProposal(proposals, proposal.id, t?.worktreePath ?? project?.path ?? null, reconciled, edited as { name: string; type: MemoryType; description: string; body: string } | undefined)
    },
    // --- notes ---
    //
    // Delegated to plugins/notes' `notes.store` capability, resolved per call (docs/notes-and-memory.md
    // § Notes: this is the one-release compatibility alias for older clients). Moving the mount to
    // /v2/p/notes/* remains outstanding: it needs route builder, client, and mount-table changes
    // this batch didn't make.
    notesList: (location) => guard(() => deps.notes().list(location)),
    notesRead: (location, slug) => guard(() => deps.notes().read(location, slug)),
    notesCreate: (location, title, kind) => guard(() => deps.notes().create(location, title, { kind: kind as NoteKind | undefined })),
    notesWrite: (location, slug, body) =>
      guard(async () => {
        await deps.notes().write(location, slug, body)
        return { ok: true }
      }),
    notesSetIncluded: (location, slug, included) =>
      guard(async () => {
        await deps.notes().setIncluded(location, slug, included)
        return { ok: true }
      }),
    notesSetTitle: (location, slug, title) =>
      guard(async () => {
        await deps.notes().setTitle(location, slug, title)
        return { ok: true }
      }),
    notesRemove: (location, slug) =>
      guard(async () => {
        await deps.notes().remove(location, slug)
        return { ok: true }
      }),
  }

  // Published as `memory.knowledge`. See the MemoryIndex comment above for why these reads bind
  // to this plugin's own database.
  return {
    route,
    proposals,
    reconciled,
    launchInjector,
    memoryReviewTrigger,
    list: (opts) => listMemories(db, opts),
    get: (opts) => getMemory(db, opts),
    search: (query, opts) => searchMemories(db, query, opts),
    indexSlice: (projectId, cap) => memoryIndexSlice(db, projectId, cap),
  }
}
