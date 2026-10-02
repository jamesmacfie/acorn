import type { NodePlugin } from '@acorn/plugin-api/node'
import { AGENT_STANDING_CONTEXT } from '@acorn/plugin-agents/contract/standingContext.ts'
import { TERMINAL_LAUNCH_CONTEXT } from '@acorn/plugin-terminal/contract/launchContext.ts'
import { memoryAgentTools } from '../server/agentTools'
import { registerKnowledgeChannel } from '../server/knowledgeChannel'
import { MEMORY_LIBRARY, type MemoryLibraryEntry, type MemoryType } from '../contract/library'
import { knowledge, KNOWLEDGE } from '../server/routes/knowledge'
import { FINDINGS_REVIEW_TARGET } from '@acorn/plugin-findings/contract/extensions.ts'
import type { MemoryFindingsTarget } from '../server/findingsReview'
import type { FindingTargetController } from '@acorn/plugin-findings/contract/review.ts'
import { homedir } from 'node:os'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

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
    // This module's own URL: the chain sits at plugins/memory/migrations beside it, and the host owns
    // open, migrate and close from there.
    migrationsModule: import.meta.url,
    init: async (ctx) => {
      // Opened and migrated by the host before init returns. registerKnowledgeChannel closes over the handle
      // and fills the route's bridge, so no request can reach an unmigrated database.
      const db = ctx.storage.open()
      const runtime = registerKnowledgeChannel(db, ctx.core, { emit: ctx.events.send })
      ctx.extensionPoints.handle(TERMINAL_LAUNCH_CONTEXT, { id: 'memory', value: { read: runtime.launchContext } })
      // Boot needs the review descriptor; validation and approval load on the first review.
      let findingsTarget: MemoryFindingsTarget | undefined
      let targetPromise: Promise<MemoryFindingsTarget> | undefined
      let controller: FindingTargetController | undefined
      let disconnect: (() => void) | undefined
      const loadTarget = () => targetPromise ??= import('../server/findingsReview').then(({ createMemoryFindingsTarget }) => {
        findingsTarget = createMemoryFindingsTarget({
          db, memory: runtime, capabilities: ctx.capabilities, homeDir: homedir(),
          announce: (projectId) => ctx.events.send({ channel: pluginChannel('memory', 'memories-changed'), ...(projectId ? { scope: 'project', projectId } : { scope: 'private', projectId: null }) }),
        })
        if (controller) disconnect = findingsTarget.contribution.connect(controller) || undefined
        return findingsTarget
      })
      // The host qualifies contribution IDs with this plugin owner, producing `memory:change`.
      ctx.extensionPoints.handle(FINDINGS_REVIEW_TARGET, { id: 'change', value: {
        version: 1, label: 'Memory changes',
        validate: async (input) => (await loadTarget()).contribution.validate(input),
        acceptedFingerprints: async (scope) => (await loadTarget()).contribution.acceptedFingerprints(scope),
        synthesisContext: async (scope) => (await loadTarget()).contribution.synthesisContext!(scope),
        connect: (next) => {
          disconnect?.()
          controller = next
          disconnect = findingsTarget?.contribution.connect(next) || undefined
          return () => { if (controller === next) { disconnect?.(); disconnect = undefined; controller = undefined } }
        },
      } })
      runtime.route.memoryApproveFinding = async (id, input) => (await loadTarget()).approve({ candidateId: id, ...input })
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
      ctx.capabilities.provide(AGENT_STANDING_CONTEXT, { build: runtime.standingContext })
      routeCapability = ctx.capabilities.provide(KNOWLEDGE, runtime.route)
      ctx.routes.register(knowledge, { prefix: '', note: 'memory pane' })
      for (const tool of memoryAgentTools(runtime.store, ctx.core)) ctx.tools.register(tool)

    },
    // The route bridge only. The SQLite handle is the host's to drain, right after this returns.
    dispose: () => {
      routeCapability?.dispose()
    },
  }
}
