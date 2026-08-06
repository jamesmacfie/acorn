// The memory plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// What the composition root used to do by hand: apps/node/src/server/routes.ts registered the knowledge
// router, apps/node/src/service/runtime.ts called registerKnowledgeIpc() with core's database handle and
// threaded its result into six other wiring calls, and core owned the `memories` table plus the
// hand-written `memories_fts` virtual table. All of that is here now, and the plugin owns its own
// SQLite file.
//
// `required: true` for the same reason github/terminal/agents are: core's agent tools, core's context
// assembler and terminal's launch injection all resolve `memory.knowledge` and assume it answers.
// Disabling this plugin would produce a node that boots and then fails at the first agent session,
// which is not a configuration worth supporting.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_SEND_TO_AGENT } from '@acorn/plugin-terminal/contract/sendToAgent.ts'
import { memoryAgentTools } from '../main/agentTools'
import { memorySection } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { MEMORY_KNOWLEDGE, registerKnowledgeIpc, type KnowledgeDeps } from '../main/knowledgeIpc'
import { knowledge, setKnowledgeBridge } from '../server/routes/knowledge'
import { migrationsDir } from './migrations'

// The one thing this plugin still cannot resolve for itself. `currentUserId` is the node's active GitHub
// identity, which lives in the runtime bindings — not on CoreServices, and not something a plugin should
// be able to set. It is supplied by the composition root until that seam exists.
//
// `sendToAgent` used to be here too, with a comment saying it could not become a capability because
// terminal was not a NodePlugin. It is one now, so this resolves through the capability registry below —
// and so does `notes`, which used to be worse than a dep: this plugin CONSTRUCTED the notes store.
export type MemoryPluginDeps = Omit<KnowledgeDeps, 'sendToAgent' | 'notes'>

export const memoryPlugin = (dataDir: string, deps: MemoryPluginDeps): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'memory',
    required: true,
    init: (ctx) => {
      // Opened and migrated before the listener binds: registerKnowledgeIpc closes over the handle and
      // fills the route's bridge, so no request can reach an unmigrated database.
      db = openPluginDb(dataDir, 'memory', { migrationsFolder: migrationsDir() })
      // terminal.sendToAgent, resolved at CALL time rather than here. Plugin init order is not defined
      // (server/plugin/capabilities.ts), so resolving at init could capture `undefined` purely because
      // terminal is declared after memory in the plugin list.
      //
      // Degrades to a warn-and-drop. The only caller is best-effort launch injection: without a PTY
      // engine there is no agent session to inject into in the first place, so a fresh session simply
      // starts without its context block — never a failed launch.
      let warned = false
      const sendToAgent: KnowledgeDeps['sendToAgent'] = (sessionId, text, submit) => {
        const send = ctx.capabilities.get(TERMINAL_SEND_TO_AGENT)
        if (!send) {
          if (!warned) {
            warned = true
            ctx.log.warn('terminal.sendToAgent is unavailable; skipping agent-session injection')
          }
          return
        }
        send(sessionId, text, submit)
      }
      // notes.store, also resolved at CALL time and for the same reason. Unlike sendToAgent this one
      // does NOT degrade: notes is a `required` plugin, and a notes pane that silently answered "no
      // notes" because a capability was missing would look exactly like data loss.
      const notes = () => ctx.capabilities.require(NOTES_STORE)
      const runtime = registerKnowledgeIpc(db, dataDir, ctx.core, { ...deps, sendToAgent, notes })
      ctx.capabilities.provide(MEMORY_KNOWLEDGE, runtime)
      ctx.routes.register(knowledge, { prefix: '', note: 'notes/memory pane' })
      // memory_search / memory_list / memory_get / memory_write, over the SAME index and proposal queue
      // the routes above serve. The app used to hold both in a dep bag to declare these; it no longer
      // needs to see either.
      for (const tool of memoryAgentTools(runtime, runtime.proposals, ctx.core)) ctx.tools.register(tool)
      // The `memory` context section — this plugin's index, over this plugin's SQLite file. Two lines that
      // used to live in apps/node/src/wiring/contextSectionsWiring.ts, where core had to be handed a
      // `MemoryIndex` because it has no handle to memory.sqlite. It never needed the index; it needed the
      // slice, and now it does not need either.
      //
      // `reconciled()` first, exactly as before: the index is rebuilt from files on boot, and a slice read
      // before that finishes reports a repo as having no memories at all.
      ctx.contextSections.register(
        memorySection(async (_taskId, repo) => {
          await runtime.reconciled()
          return runtime.indexSlice(repo)
        }),
      )
    },
    // The plugin's SQLite file is in WAL mode, so it has to be closed before the data root's lock is
    // dropped — the composition root's own teardown invariant.
    dispose: () => {
      db?.close()
      db = null
      setKnowledgeBridge(null)
    },
  }
}
