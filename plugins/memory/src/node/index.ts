import type { NodePlugin } from '@acorn/plugin-api/node'
import { memorySection } from '../server/contextSection'
import { TERMINAL_LAUNCH_CONTEXT } from '@acorn/plugin-terminal/contract/launchContext.ts'
import { memoryAgentTools } from '../server/agentTools'
import { registerKnowledgeChannel } from '../server/knowledgeChannel'
import { MEMORY_LIBRARY, type MemoryLibraryEntry, type MemoryType } from '../contract/library'
import { knowledge, KNOWLEDGE } from '../server/routes/knowledge'
import { FINDINGS_REVIEW_TARGET } from '@acorn/plugin-findings/contract/extensions.ts'
import { createMemoryFindingsTarget } from '../server/findingsReview'
import { homedir } from 'node:os'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

// No deps: Terminal owns launch delivery.
//
// `dataDir` stays a parameter, unlike changes' and github's, because the knowledge index reads source
// files under the data root.
export const memoryPlugin = (): NodePlugin => {
  let routeCapability: { dispose(): void } | null = null
  return {
    name: 'memory',
    label: 'Memory',
    required: true,
    emits: [
      { verb: 'memories-changed', description: 'The project or private memory library changed' },
    ],
    // This module's own URL: the chain sits at plugins/memory/migrations beside it, and the host owns
    // open, migrate and close from there.
    migrationsModule: import.meta.url,
    init: async (ctx) => {
      // Opened and migrated by the host before init returns. registerKnowledgeChannel closes over the handle
      // and fills the route's bridge, so no request can reach an unmigrated database.
      const db = ctx.storage.open()
      const runtime = registerKnowledgeChannel(db, ctx.core, { emit: ctx.events.send })
      ctx.extensionPoints.handle(TERMINAL_LAUNCH_CONTEXT, { id: 'memory', value: { read: runtime.launchContext } })
      const findingsTarget = createMemoryFindingsTarget({
        db, memory: runtime, capabilities: ctx.capabilities, homeDir: homedir(),
        announce: (projectId) => ctx.events.send({ channel: pluginChannel('memory', 'memories-changed'), ...(projectId ? { scope: 'project', projectId } : { scope: 'private', projectId: null }) }),
      })
      // The host qualifies contribution IDs with this plugin owner, producing `memory:change`.
      ctx.extensionPoints.handle(FINDINGS_REVIEW_TARGET, { id: 'change', value: findingsTarget.contribution })
      runtime.route.memoryApproveFinding = (id, input) => findingsTarget.approve({ candidateId: id, ...input })
      // The SQLite table is a derived index. Rebuild it once after migration so a fresh node has a warm
      // index and the project checkout and task-worktree source set is exercised at startup.
      await runtime.reconciled()
      ctx.capabilities.provide(MEMORY_LIBRARY, {
        list: async (scope) => {
          await runtime.reconciled()
          const rows = await runtime.list(scope.scope === 'project' ? { projectId: scope.projectId } : { projectId: null })
          return rows
            .filter((row) => scope.scope === 'project'
              ? row.scope === 'project' && row.projectId === scope.projectId
              : row.scope === 'private')
            .map(({ id, scope, projectId, name, type, description, body, createdAt, updatedAt }): MemoryLibraryEntry => ({
              id,
              scope: scope as MemoryLibraryEntry['scope'],
              projectId,
              name,
              type: type as MemoryType,
              description,
              body,
              createdAt,
              updatedAt,
            }))
        },
      })
      routeCapability = ctx.capabilities.provide(KNOWLEDGE, runtime.route)
      ctx.routes.register(knowledge, { prefix: '', note: 'memory pane' })
      for (const tool of memoryAgentTools(runtime, ctx.capabilities, ctx.core)) ctx.tools.register(tool)
      ctx.contextSections.register(
        memorySection(async (_taskId, projectId) => {
          await runtime.reconciled()
          return runtime.indexSlice(projectId)
        }),
      )
    },
    // The route bridge only. The SQLite handle is the host's to drain, right after this returns.
    dispose: () => {
      routeCapability?.dispose()
    },
  }
}
