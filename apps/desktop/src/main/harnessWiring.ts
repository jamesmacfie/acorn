// Wires the per-domain harness sub-bridges (docs/mcp.md): the loopback surface the acorn MCP
// server's feature tools call (server/routes/harness.ts). The backings live here in the main
// process — NotesStore, the memory index + proposal gate, the runtime service and the CDP browser
// driver — and each domain is wired independently so tests can fake one without the others.
// Agent writes stamp author: agent + the session id (provenance).
import type { AppDatabase } from '../server/db'
import { setBrowserBridge, setMemoryBridge, setNotesBridge, setRunBridge } from '../server/routes/harness'
import { driverFor } from './browserService'
import { getMemory, listMemories, MEMORY_TYPES, searchMemories, type MemoryType } from './memory'
import type { MemoryProposalStore } from './memoryProposals'
import type { NotesStore } from './notes'
import type { RuntimeService } from './runtime'
import { repoFor, workspaceIdFor } from './taskWorktree'

export type HarnessWiringDeps = {
  db: AppDatabase
  notesStore: NotesStore
  proposals: MemoryProposalStore
  runtime: RuntimeService
  reconciled(): Promise<void>
}

export function wireHarnessBridges({ db, notesStore, proposals, runtime, reconciled }: HarnessWiringDeps): void {
  setNotesBridge({
    list: async (taskId) => notesStore.list(await workspaceIdFor(db, taskId)),
    read: async (taskId, slug) => notesStore.read(await workspaceIdFor(db, taskId), slug),
    write: async (taskId, slug, body, sessionId) => {
      const ws = await workspaceIdFor(db, taskId)
      const exists = await notesStore.read(ws, slug).catch(() => null)
      if (exists) await notesStore.write(ws, slug, body)
      else await notesStore.append(ws, slug, body, { author: 'agent', originSessionId: sessionId })
    },
    append: async (taskId, slug, text, sessionId) => notesStore.append(await workspaceIdFor(db, taskId), slug, text, { author: 'agent', originSessionId: sessionId }),
  })

  const asType = (type: string | undefined): MemoryType | undefined => (MEMORY_TYPES.includes(type as MemoryType) ? (type as MemoryType) : undefined)
  setMemoryBridge({
    search: async (taskId, query, type) => {
      await reconciled()
      return searchMemories(db, query, { repo: await repoFor(db, taskId), type: asType(type) })
    },
    list: async (taskId, type) => {
      await reconciled()
      return listMemories(db, { repo: await repoFor(db, taskId), type: asType(type) })
    },
    get: async (taskId, name) => {
      await reconciled()
      return getMemory(db, { repo: await repoFor(db, taskId), name })
    },
    // memory_write → a PROPOSAL through the human gate (docs/next 12); agent proposals carry no
    // verification flags (those come from the auto-generation verify pass).
    propose: async (taskId, p) =>
      proposals.propose({
        taskId,
        repo: await repoFor(db, taskId).catch(() => null),
        name: p.name,
        type: p.type as MemoryType,
        description: p.description,
        body: p.body,
        originSessionId: p.originSessionId ?? null,
      }),
  })

  setRunBridge({
    targets: (taskId) => runtime.targets(taskId),
    start: (taskId, targetId) => runtime.start(taskId, targetId),
    stop: (taskId, targetId) => runtime.stop(taskId, targetId),
    restart: (taskId, targetId) => runtime.restart(taskId, targetId),
    status: (taskId, targetId) => runtime.status(taskId, targetId),
    defaultUrl: (taskId) => runtime.defaultUrl(taskId),
  })

  // Drivable browser (docs/panes.md): CDP over the bound preview webview; a missing binding is a
  // clean structured result (the agent is told to open the preview), never a throw.
  setBrowserBridge({
    navigate: async (taskId, url) => driverFor(taskId)?.navigate(url) ?? { ok: false, reason: 'No preview webview for this task — open the browser pane first.' },
    snapshot: async (taskId) => {
      const d = driverFor(taskId)
      return d ? d.takeSnapshot() : { error: 'No preview webview for this task — open the browser pane first.' }
    },
    click: async (taskId, ref) => driverFor(taskId)?.click(ref) ?? { ok: false, reason: 'No preview webview for this task.' },
    fill: async (taskId, ref, text) => driverFor(taskId)?.fill(ref, text) ?? { ok: false, reason: 'No preview webview for this task.' },
    screenshot: async (taskId) => {
      const d = driverFor(taskId)
      return d ? d.screenshot() : { error: 'No preview webview for this task.' }
    },
    console: async (taskId) => driverFor(taskId)?.console() ?? { lines: [] },
  })
}
