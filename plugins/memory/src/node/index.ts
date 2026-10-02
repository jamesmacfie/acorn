import type { NodePlugin } from '@acorn/plugin-api/node'
import { AGENT_STANDING_CONTEXT } from '@acorn/plugin-agents/contract/standingContext.ts'
import { TERMINAL_LAUNCH_CONTEXT } from '@acorn/plugin-terminal/contract/launchContext.ts'
import { memoryAgentTools } from '../server/agentTools'
import { registerKnowledgeChannel } from '../server/knowledgeChannel'
import { MEMORY_LIBRARY, type MemoryLibraryEntry } from '../contract/library'
import { knowledge, KNOWLEDGE } from '../server/routes/knowledge'

// Terminal owns launch delivery; Agents owns the optional standing-context contract.
export const memoryPlugin = (): NodePlugin => {
  let routeCapability: { dispose(): void } | null = null
  return {
    name: 'memory',
    label: 'Memory',
    required: true,
    emits: [
      { verb: 'memories-changed', description: 'The project or private memory library changed' },
    ],
    init: (ctx) => {
      const runtime = registerKnowledgeChannel(ctx.core, { emit: ctx.events.send })
      ctx.extensionPoints.handle(TERMINAL_LAUNCH_CONTEXT, { id: 'memory', value: { read: runtime.launchContext } })
      ctx.capabilities.provide(MEMORY_LIBRARY, {
        list: async (scope) => {
          const rows = await runtime.list(scope.scope === 'project' ? scope.projectId : null)
          return rows
            .filter((row) => scope.scope === 'project'
              ? row.scope === 'project' && row.projectId === scope.projectId
              : row.scope === 'private')
            .map(({ id, scope, projectId, name, type, description, body, createdAt, updatedAt }): MemoryLibraryEntry => ({
              id,
              scope,
              projectId,
              name,
              type,
              description,
              body,
              createdAt,
              updatedAt,
            }))
        },
      })
      ctx.capabilities.provide(AGENT_STANDING_CONTEXT, { build: runtime.standingContext })
      routeCapability = ctx.capabilities.provide(KNOWLEDGE, runtime.route)
      ctx.routes.register(knowledge, { prefix: '', note: 'memory pane' })
      for (const tool of memoryAgentTools(runtime.store, ctx.core)) ctx.tools.register(tool)
    },
    // Release the route bridge on shutdown.
    dispose: () => {
      routeCapability?.dispose()
    },
  }
}
