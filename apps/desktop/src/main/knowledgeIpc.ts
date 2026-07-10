// The notes + memory surfaces (the renderer's KnowledgeBridge over HTTP + the context-assembler
// seams), the launch-time memory injector and the memory auto-generation trigger — split out of
// terminal.ts (docs/notes-and-memory.md). registerKnowledgeIpc still constructs and returns the shared
// stores/closures the harness bridges and workflow wiring reuse; Phase 3 moved the `memory:*` /
// `notes:*` IPC channels to the KnowledgeBridge (server/routes/knowledge.ts).
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import { setKnowledgeBridge } from '../server/routes/knowledge'
import { buildHeadlessArgv, runHeadless } from './headless'
import { formatMemoryInjection, listMemories, memoryIndexSlice, memorySources, MEMORY_TYPES, reconcileMemories, searchMemories, writeMemoryFile, type MemoryType } from './memory'
import { acceptProposal, generateMemoryProposals, rejectProposal } from './memoryGen'
import { MemoryProposalStore } from './memoryProposals'
import { NotesStore, type NoteKind } from './notes'
import { broadcastWorkflowNotice } from './notify'
import { BUILTIN_PROFILES, profileAvailable, resolveCommand, type ProfileDef } from './profiles'
import { isDir, loadTask, workspaceConfigRow } from './taskWorktree'
import { buildSessionEnv } from './terminalUtils'

export type KnowledgeDeps = {
  // Queue a text block into an agent session on its idle edge (agentSender in terminal.ts).
  sendToAgent(sessionId: string, text: string, submit: 'after-ready'): void
}

export type Knowledge = {
  notesStore: NotesStore
  proposals: MemoryProposalStore
  // Reconcile the derived SQLite memory index from every live source dir (cheap at this scale) —
  // call before any read.
  reconciled(): Promise<void>
  // Push the memory block into a fresh agent session (docs/next 12 P2). Best-effort — a session
  // must never fail to launch over memory.
  memoryInjector(taskId: string, sessionId: string): Promise<void>
  // Memory auto-generation trigger (docs/next 12 P3): fired when an agent session for a task
  // exits, with that session's ring tail as the transcript input.
  memoryReviewTrigger(taskId: string, transcriptTail: string): Promise<void>
}

// The headless profile the memory-review pass runs on: the FIRST installed agent profile with a
// headless mode (claude-code, then codex) — hardcoding claude-code silently disabled
// auto-generation for Codex-only users (docs/notes-and-memory.md).
export function memoryReviewProfile(): ProfileDef | null {
  return (
    BUILTIN_PROFILES.find((p) => p.kind === 'agent' && profileAvailable(p) && buildHeadlessArgv(p.id, resolveCommand(p), { prompt: '' }) !== null) ?? null
  )
}

export function registerKnowledgeIpc(db: AppDatabase, dataRoot: string, deps: KnowledgeDeps): Knowledge {
  // Workspace notes (docs/notes-and-memory.md): files under <dataDir>/notes/<workspaceId>/, beside the
  // worktrees dir. ONE store — the UI reads it here; the MCP notes_* tools reuse it (harness).
  const notesStore = new NotesStore(join(dataRoot, 'notes'))
  const proposals = new MemoryProposalStore(join(dataRoot, 'memory-proposals'))

  const guard = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn()
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'notes failed' }
    }
  }

  // Memory (docs/next 12 P1): files are truth; the SQLite index reconciles from every active
  // worktree + primary checkout + the private home dir before each read (cheap at this scale).
  const buildMemorySources = async () => {
    const active = (await db.select().from(schema.tasks).where(eq(schema.tasks.status, 'active')))
      .filter((t) => t.worktreePath && isDir(t.worktreePath))
      .map((t) => ({ dir: t.worktreePath!, repo: `${t.repoOwner}/${t.repoName}` }))
    const checkouts = (await db.select().from(schema.repoPaths)).filter((p) => isDir(p.path)).map((p) => ({ dir: p.path, repo: `${p.owner}/${p.repo}` }))
    return memorySources(active, checkouts, homedir())
  }
  const reconciled = async () => reconcileMemories(db, await buildMemorySources())

  const memoryInjector = async (taskId: string, sessionId: string) => {
    // Launch injection (docs/next 12 P2): MEMORY.md index slice + repo feedback/convention bodies,
    // queued 'after-ready' so it lands as the agent's first prompt once it settles.
    try {
      const t = await loadTask(db, taskId)
      if (!t) return
      const repo = `${t.repoOwner}/${t.repoName}`
      await reconciled()
      const slice = await memoryIndexSlice(db, repo)
      const key = (await listMemories(db, { repo })).filter((m) => m.type === 'feedback' || m.type === 'convention')
      const block = formatMemoryInjection(slice, key)
      if (block) deps.sendToAgent(sessionId, block, 'after-ready')
    } catch {
      // memory injection is best-effort — never blocks a session launch
    }
  }

  // Memory auto-generation (docs/next 12 P3): the task-completion trigger. Fired on agent session
  // end (and best-effort at archive) while the worktree is still alive; proposals flow through the
  // human gate — nothing lands without an accept. Verification flags ride the proposal's `flags`
  // field (structural), never folded into the description.
  const memoryReviewTrigger = async (taskId: string, transcriptTail: string) => {
    try {
      const t = await loadTask(db, taskId)
      if (!t?.worktreePath || !isDir(t.worktreePath)) return
      const profile = memoryReviewProfile()
      if (!profile) return // no headless-capable agent CLI installed → no auto-generation
      const worktree = t.worktreePath
      const repo = `${t.repoOwner}/${t.repoName}`
      const out = await generateMemoryProposals({
        runReview: (prompt, schema0) => {
          const argv = buildHeadlessArgv(profile.id, resolveCommand(profile), { prompt, schema: schema0 })!
          return runHeadless(argv, { cwd: worktree, env: buildSessionEnv({ taskId, cwd: worktree, task: t }) })
        },
        taskDiff: async () => {
          try {
            const { stdout } = await promisify(execFile)('git', ['-C', worktree, 'diff', 'HEAD'], { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 })
            return stdout
          } catch {
            return ''
          }
        },
        transcriptTail: async () => transcriptTail,
        existingIndex: async () => {
          await reconciled()
          return (await listMemories(db, { repo })).map((m) => ({ id: m.id, name: m.name, description: m.description, body: m.body }))
        },
        fileExists: (p) => existsSync(join(worktree, p)),
        propose: async (c, flags) =>
          void (await proposals.propose({
            taskId,
            repo,
            name: c.name,
            type: c.type,
            description: c.description,
            body: c.body,
            flags,
            originSessionId: null,
          })),
      })
      if (out.proposed > 0) broadcastWorkflowNotice(taskId, 'gate', `${out.proposed} memory proposal${out.proposed === 1 ? '' : 's'} await review`)
    } catch {
      // auto-generation is best-effort — never disturbs the task lifecycle
    }
  }

  // The renderer's notes + memory surface, exposed as the KnowledgeBridge behind the HTTP routes
  // (server/routes/knowledge.ts). Distinct from the harness memory/notes bridges (the MCP agent
  // surface); this is the human-facing pane. guard() keeps the `| { error }` contract the clients
  // union on. Backed by the same stores, so it 503s under dev:node.
  setKnowledgeBridge({
    memoryList: (repo) =>
      guard(async () => {
        await reconciled()
        return listMemories(db, { repo: repo ?? null })
      }),
    memorySearch: (query, repo, type) =>
      guard(async () => {
        await reconciled()
        return searchMemories(db, query, { repo: repo ?? null, type: MEMORY_TYPES.includes(type as MemoryType) ? (type as MemoryType) : undefined })
      }),
    // Manual add (12 P1): repo scope writes into the TASK'S WORKTREE (reviewed via its PR — never
    // the user's primary checkout); private scope into ~/.acorn/memory.
    memoryAdd: (taskId, p) =>
      guard(async () => {
        const type: MemoryType = MEMORY_TYPES.includes(p.type as MemoryType) ? (p.type as MemoryType) : 'reference'
        const t = await loadTask(db, taskId)
        let dir: string
        if (p.scope === 'private') dir = join(homedir(), '.acorn', 'memory')
        else {
          if (!t?.worktreePath || !isDir(t.worktreePath)) throw new Error('Repo-scoped memory needs the task worktree (open a terminal first).')
          dir = join(t.worktreePath, '.acorn', 'memory')
        }
        let commitSha: string | null = null
        if (t?.worktreePath && isDir(t.worktreePath)) {
          try {
            const { stdout } = await promisify(execFile)('git', ['-C', t.worktreePath, 'rev-parse', 'HEAD'], { timeout: 5000 })
            commitSha = stdout.trim()
          } catch {
            // no commit yet — fine
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
    // The human gate over auto-generated proposals (docs/next 12 P3).
    memoryProposals: async (taskId) => {
      const pending = await proposals.list('pending')
      return taskId ? pending.filter((p) => p.taskId === taskId) : pending
    },
    memoryResolveProposal: async (id, approved, edited) => {
      if (!approved) return rejectProposal(proposals, id)
      const proposal = await proposals.get(id)
      if (!proposal) return { ok: false, reason: 'Proposal not found.' }
      const t = await loadTask(db, proposal.taskId)
      return acceptProposal(proposals, proposal.id, t?.worktreePath ?? null, reconciled, edited as { name: string; type: MemoryType; description: string; body: string } | undefined)
    },
    // --- notes ---
    notesList: (location) => guard(() => notesStore.list(location)),
    notesRead: (location, slug) => guard(() => notesStore.read(location, slug)),
    notesCreate: (location, title, kind) => guard(() => notesStore.create(location, title, { kind: kind as NoteKind | undefined })),
    notesWrite: (location, slug, body) =>
      guard(async () => {
        await notesStore.write(location, slug, body)
        return { ok: true }
      }),
    notesSetIncluded: (location, slug, included) =>
      guard(async () => {
        await notesStore.setIncluded(location, slug, included)
        return { ok: true }
      }),
    notesRemove: (location, slug) =>
      guard(async () => {
        await notesStore.remove(location, slug)
        return { ok: true }
      }),
  })

  return { notesStore, proposals, reconciled, memoryInjector, memoryReviewTrigger }
}
