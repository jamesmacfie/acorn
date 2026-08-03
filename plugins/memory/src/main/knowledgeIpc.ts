// The notes + memory surfaces (the renderer's KnowledgeBridge over HTTP + the context-assembler
// seams), the launch-time memory injector and the memory auto-generation trigger — split out of
// terminal.ts (docs/notes-and-memory.md). HTTP routing moved the `memory:*` / `notes:*` IPC channels
// to the KnowledgeBridge (server/routes/knowledge.ts).
//
// Called from the plugin's init (node/index.ts), not from the app: what it returns is published as the
// `memory.knowledge` capability (contract/knowledge.ts) for the consumers that used to be handed it by
// the composition root. Its two database arguments say the whole story of the split — the DERIVED index
// is this plugin's own SQLite file, and everything it needs from core's tables (the task set, the
// checkout list, the injection pref, the context assembler) arrives as CoreServices.
import { gitOrThrow } from '@acorn/node-core/main/core/git.ts'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import { setKnowledgeBridge } from '../server/routes/knowledge'
import { buildHeadlessArgv, runHeadless } from '@acorn/node-core/main/headless.ts'
import { formatMemoryInjection, getMemory, listMemories, memoryIndexSlice, memorySources, MEMORY_TYPES, reconcileMemories, searchMemories, writeMemoryFile, type MemoryType } from './memory'
import { acceptProposal, generateMemoryProposals, rejectProposal } from './memoryGen'
import { MemoryProposalStore } from './memoryProposals'
import { NotesStore, type NoteKind } from '@acorn/plugin-notes/main/notes.ts'
import { broadcastWorkflowNotice } from '@acorn/node-core/main/notify.ts'
import { listProfileDefs, profileAvailable, resolveCommand, type ProfileDef } from '@acorn/node-core/main/profiles.ts'
import { isDir } from '@acorn/node-core/main/taskWorktree.ts'
import { buildSessionEnv } from '@acorn/node-core/main/taskEnv.ts'
import { formatLaunchContext } from '@acorn/protocol/contextBlock.ts'
import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { MemoryHit, MemoryRow } from './memory'

export type KnowledgeDeps = {
  // Queue a text block into an agent session on its idle edge (agentSender in terminal.ts).
  sendToAgent(sessionId: string, text: string, submit: 'after-ready'): void
  currentUserId(): string | null
}

// Four core reads, each replacing a `db.select()` this file used to make against a core table:
// `tasks` (one id + the active set), `repo_paths` (every primary checkout), the
// `startup_context_injection` pref and core's section assembler.
export type KnowledgeCoreServices = Pick<CoreServices, 'tasks' | 'repos' | 'context'>

// Reads over the derived index, BOUND to this plugin's own database. This is what lets the app-layer
// agent-tool and context-section wiring keep working: it can no longer hold a handle to the file these
// rows live in (docs/vNext/data.md § Plugin DBs). Every read reconciles from the markdown files first —
// they are the truth.
export type MemoryIndex = {
  // Exposed as well as used internally, because a caller that then reads through some OTHER path (core's
  // context assembler) still needs the index fresh.
  reconciled(): Promise<void>
  list(opts: { repo?: string | null; type?: MemoryType }): Promise<MemoryRow[]>
  get(opts: { repo?: string | null; name: string }): Promise<MemoryRow | null>
  search(query: string, opts: { repo?: string | null; type?: MemoryType }): Promise<MemoryHit[]>
  // The always-safe injection slice: index lines only (name + description), capped.
  indexSlice(repo: string, cap?: number): Promise<{ name: string; description: string }[]>
}

export type MemoryKnowledge = MemoryIndex & {
  // Workspace/task notes. Owned by plugins/notes and constructed here because the human-facing pane, the
  // agent tools and the context assembler must all read ONE store (docs/notes-and-memory.md).
  notesStore: NotesStore
  // The human gate's pending proposals, on disk under the data root.
  proposals: MemoryProposalStore
  // Push the combined launch block (task context + repo memory) into a fresh agent session
  // (docs/notes-and-memory.md). Best-effort — a session must never fail to launch over it.
  launchInjector(taskId: string, sessionId: string): Promise<void>
  // Memory auto-generation trigger: fired when an agent session for a task exits, with that session's
  // ring tail as the transcript input.
  memoryReviewTrigger(taskId: string, transcriptTail: string): Promise<void>
}

// Published by the plugin's init (node/index.ts) and resolved by the composition root.
//
// Deliberately NOT in a `contract/` entrypoint, unlike agents.sessionExecute. A contract carries types
// and ids only and may not name the plugin's internals (tools/arch/boundaries.test.ts), and this
// capability's value legitimately INCLUDES two internal stores. It is also not a cross-plugin surface:
// the only consumer is apps/node's composition root, which may import a plugin's internals by design.
// When W6 moves the memory tool definitions into this plugin, the MemoryIndex slice becomes the
// cross-plugin part and can move to a contract/ then.
export const MEMORY_KNOWLEDGE = capabilityId<MemoryKnowledge>('memory.knowledge')

// The headless profile the memory-review pass runs on: the FIRST installed agent profile with a
// headless mode (claude-code, then codex) — hardcoding claude-code silently disabled
// auto-generation for Codex-only users (docs/notes-and-memory.md).
export function memoryReviewProfile(): ProfileDef | null {
  return (
    listProfileDefs().find((p) => p.kind === 'agent' && profileAvailable(p) && buildHeadlessArgv(p.id, resolveCommand(p), { prompt: '' }) !== null) ?? null
  )
}

export function registerKnowledgeIpc(db: PluginDatabase, dataRoot: string, core: KnowledgeCoreServices, deps: KnowledgeDeps): MemoryKnowledge {
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

  // Memory (docs/notes-and-memory.md): files are truth; the SQLite index reconciles from every active
  // worktree + primary checkout + the private home dir before each read (cheap at this scale).
  const buildMemorySources = async () => {
    const active = (await core.tasks.active())
      .filter((t) => t.worktreePath && isDir(t.worktreePath))
      .map((t) => ({ dir: t.worktreePath!, repo: `${t.repoOwner}/${t.repoName}` }))
    const checkouts = (await core.repos.checkouts()).filter((p) => isDir(p.path)).map((p) => ({ dir: p.path, repo: `${p.owner}/${p.repo}` }))
    return memorySources(active, checkouts, homedir())
  }
  const reconciled = async () => reconcileMemories(db, await buildMemorySources())

  const launchInjector = async (taskId: string, sessionId: string) => {
    // Launch injection (docs/notes-and-memory.md): one first-prompt block combining task context
    // (PR + linked issues + notes, gated by the startup_context_injection pref) and the repo-memory
    // block (MEMORY.md index slice + feedback/convention bodies). Queued 'after-ready' so it lands
    // as the agent's first prompt once the CLI settles. Best-effort — never blocks a launch.
    try {
      const t = await core.tasks.load(taskId)
      if (!t) return
      const repo = `${t.repoOwner}/${t.repoName}`
      const blocks: string[] = []

      const userId = deps.currentUserId()
      if (userId && (await core.context.injectionEnabled(userId))) {
        const ctx = await core.context.assemble(userId, taskId, new Set(['pr', 'issues', 'notes']))
        const contextBlock = ctx ? formatLaunchContext(ctx) : ''
        if (contextBlock) blocks.push(contextBlock)
      }

      await reconciled()
      const slice = await memoryIndexSlice(db, repo)
      const key = (await listMemories(db, { repo })).filter((m) => m.type === 'feedback' || m.type === 'convention')
      const memoryBlock = formatMemoryInjection(slice, key)
      if (memoryBlock) blocks.push(memoryBlock)

      if (blocks.length) deps.sendToAgent(sessionId, blocks.join('\n\n'), 'after-ready')
    } catch {
      // launch injection is best-effort — never blocks a session launch
    }
  }

  // Memory auto-generation (docs/notes-and-memory.md): the task-completion trigger. Fired on agent session
  // end (and best-effort at archive) while the worktree is still alive; proposals flow through the
  // human gate — nothing lands without an accept. Verification flags ride the proposal's `flags`
  // field (structural), never folded into the description.
  const memoryReviewTrigger = async (taskId: string, transcriptTail: string) => {
    try {
      const t = await core.tasks.load(taskId)
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
            const { stdout } = await gitOrThrow(['diff', 'HEAD'], { cwd: worktree, timeoutMs: 15_000 })
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
        const t = await core.tasks.load(taskId)
        let dir: string
        if (p.scope === 'private') dir = join(homedir(), '.acorn', 'memory')
        else {
          if (!t?.worktreePath || !isDir(t.worktreePath)) throw new Error('Repo-scoped memory needs the task worktree (open a terminal first).')
          dir = join(t.worktreePath, '.acorn', 'memory')
        }
        let commitSha: string | null = null
        if (t?.worktreePath && isDir(t.worktreePath)) {
          try {
            const { stdout } = await gitOrThrow(['rev-parse', 'HEAD'], { cwd: t.worktreePath, timeoutMs: 5_000 })
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
    notesSetTitle: (location, slug, title) =>
      guard(async () => {
        await notesStore.setTitle(location, slug, title)
        return { ok: true }
      }),
    notesRemove: (location, slug) =>
      guard(async () => {
        await notesStore.remove(location, slug)
        return { ok: true }
      }),
  })

  // Published as `memory.knowledge`. The four index reads are bound to THIS plugin's database, which
  // is what lets the agent-tool and context-section wiring keep working without a handle to it.
  return {
    notesStore,
    proposals,
    reconciled,
    launchInjector,
    memoryReviewTrigger,
    list: (opts) => listMemories(db, opts),
    get: (opts) => getMemory(db, opts),
    search: (query, opts) => searchMemories(db, query, opts),
    indexSlice: (repo, cap) => memoryIndexSlice(db, repo, cap),
  }
}
