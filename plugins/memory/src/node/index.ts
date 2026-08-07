import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_SEND_TO_AGENT } from '@acorn/plugin-terminal/contract/sendToAgent.ts'
import { memoryAgentTools } from '../main/agentTools'
import { memorySection } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { MEMORY_KNOWLEDGE, registerKnowledgeIpc, type KnowledgeDeps } from '../main/knowledgeIpc'
import { knowledge, setKnowledgeBridge } from '../server/routes/knowledge'
import { migrationsDir } from './migrations'

// No deps: both of this plugin's former app-supplied thunks now resolve through the plugin context —
// sendToAgent and notes through capabilities, the owner identity through ctx.core.identity.
export const memoryPlugin = (dataDir: string): NodePlugin => {
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
      const runtime = registerKnowledgeIpc(db, dataDir, ctx.core, { sendToAgent, notes })
      ctx.capabilities.provide(MEMORY_KNOWLEDGE, runtime)
      ctx.routes.register(knowledge, { prefix: '', note: 'notes/memory pane' })
      for (const tool of memoryAgentTools(runtime, runtime.proposals, ctx.core)) ctx.tools.register(tool)
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
