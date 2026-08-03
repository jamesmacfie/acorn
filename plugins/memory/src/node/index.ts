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
import { MEMORY_KNOWLEDGE, registerKnowledgeIpc, type KnowledgeDeps } from '../main/knowledgeIpc'
import { knowledge, setKnowledgeBridge } from '../server/routes/knowledge'
import { migrationsDir } from './migrations'

// Two things this plugin cannot resolve for itself. `sendToAgent` is plugins/terminal's PTY sender —
// importing it would add a memory→terminal edge, and terminal is not a NodePlugin yet, so it cannot
// publish a capability to resolve instead. `currentUserId` is the node's active GitHub identity, which
// lives in the runtime bindings. Both are supplied by the composition root until those two seams exist.
export type MemoryPluginDeps = KnowledgeDeps

export const memoryPlugin = (dataDir: string, deps: MemoryPluginDeps): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'memory',
    required: true,
    init: (ctx) => {
      // Opened and migrated before the listener binds: registerKnowledgeIpc closes over the handle and
      // fills the route's bridge, so no request can reach an unmigrated database.
      db = openPluginDb(dataDir, 'memory', { migrationsFolder: migrationsDir() })
      const runtime = registerKnowledgeIpc(db, dataDir, ctx.core, deps)
      ctx.capabilities.provide(MEMORY_KNOWLEDGE, runtime)
      ctx.routes.register(knowledge, { prefix: '', note: 'notes/memory pane' })
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
