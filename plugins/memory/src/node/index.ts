import type { NodePlugin } from '@acorn/plugin-api/node'
import { memorySection } from '../server/contextSection'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { TERMINAL_SEND_TO_AGENT } from '@acorn/plugin-terminal/contract/sendToAgent.ts'
import { memoryAgentTools } from '../server/agentTools'
import { registerKnowledgeChannel, type KnowledgeDeps } from '../server/knowledgeChannel'
import { MEMORY_KNOWLEDGE } from '../contract/knowledge'
import { MEMORY_LIBRARY, type MemoryLibraryEntry, type MemoryType } from '../contract/library'
import { MEMORY_SOURCE_ID } from '../shared/api'
import { knowledge, KNOWLEDGE } from '../server/routes/knowledge'
import { FINDINGS_LEGACY_SOURCE, FINDINGS_REVIEW_TARGET } from '@acorn/plugin-findings/contract/extensions.ts'
import { FINDINGS_LIFECYCLE } from '@acorn/plugin-findings/contract/lifecycle.ts'
import { FINDINGS_REVIEW } from '@acorn/plugin-findings/contract/review.ts'
import { createMemoryFindingsTarget } from '../server/findingsReview'
import { homedir } from 'node:os'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { resolveMappedLegacyProposal } from '../server/legacyFindingsCompatibility'

// No deps: both of this plugin's former app-supplied thunks resolve through the plugin context now,
// sendToAgent and notes through capabilities and the owner identity through ctx.core.identity.
//
// `dataDir` stays a parameter, unlike changes' and github's, because the knowledge index reads source
// files under the data root.
export const memoryPlugin = (dataDir: string): NodePlugin => {
  let routeCapability: { dispose(): void } | null = null
  return {
    name: 'memory',
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
      // terminal.sendToAgent, resolved at call time rather than here. Plugin init order isn't defined, so
      // resolving at init could capture `undefined` purely because terminal is declared after memory.
      //
      // Degrades to a warn and drop. The only caller is best-effort launch injection: without a PTY
      // engine there's no agent session to inject into, so a fresh session starts without its context
      // block rather than failing to launch.
      let warned = false
      const sendToAgent: KnowledgeDeps['sendToAgent'] = (sessionId, text, submit) => {
        const send = ctx.capabilities.get(TERMINAL_SEND_TO_AGENT)
        if (!send) {
          if (!warned) {
            warned = true
            ctx.log.warn('terminal.sendToAgent is unavailable, so this session starts without its context block')
          }
          return
        }
        send(sessionId, text, submit)
      }
      // notes.store, also resolved at call time and for the same reason. Unlike sendToAgent this one
      // doesn't degrade: notes is a `required` plugin, and a notes pane that silently answered "no notes"
      // because a capability was missing would look exactly like data loss.
      const notes = () => ctx.capabilities.require(NOTES_STORE)
      // The bell, through core's own seam. This used to reach for `workflows.notices`, borrowed because
      // the bell had left `ctx.events` in the API-4 batch, and it cost the row its destination: that
      // capability can only say "a run, at this node", so a proposal notice named nothing and clicking
      // it did nothing at all. Two other prices came with the borrow — a node with workflows disabled
      // raised no row, and the row drew as a `gate`, a ban glyph in warn tone for what is a nudge.
      //
      // `source` is core's target kind, so opening the Memory page needs no handler of this plugin's.
      // The row is about however many proposals are waiting rather than one of them, and the page with
      // no project routed lists every one (../client/MemoryCenter.tsx). The per-proposal row in the
      // inbox is the one that highlights a single proposal.
      const notice: KnowledgeDeps['notice'] = (taskId, title) => ctx.events.notice({
        taskId,
        title,
        kind: 'memory-proposal',
        target: { kind: 'source', resourceId: MEMORY_SOURCE_ID },
      })
      const runtime = registerKnowledgeChannel(db, dataDir, ctx.core, { sendToAgent, notes, notice, emit: ctx.events.send })
      const findingsTarget = createMemoryFindingsTarget({
        db, memory: runtime, capabilities: ctx.capabilities, homeDir: homedir(),
        announce: (projectId) => ctx.events.send({ channel: pluginChannel('memory', 'memories-changed'), ...(projectId ? { scope: 'project', projectId } : { scope: 'private', projectId: null }) }),
      })
      // The host qualifies contribution IDs with this plugin owner, producing `memory:change`.
      ctx.extensionPoints.handle(FINDINGS_REVIEW_TARGET, { id: 'change', value: findingsTarget.contribution })
      ctx.extensionPoints.handle(FINDINGS_LEGACY_SOURCE, {
        id: 'memory-proposals',
        value: { version: 1, list: () => runtime.proposals.legacySources() },
      })
      runtime.route.memoryApproveFinding = (id, input) => findingsTarget.approve({ candidateId: id, ...input })
      const legacyProposals = runtime.route.memoryProposals
      const legacyResolve = runtime.route.memoryResolveProposal
      runtime.route.memoryProposals = async (taskId) => {
        const rows = await legacyProposals(taskId) as Array<{ id: string }>
        const lifecycle = ctx.capabilities.get(FINDINGS_LIFECYCLE)
        if (!lifecycle || !(await lifecycle.migrationReport()).cutoverReady) return rows
        const mappings = await Promise.all(rows.map((row) => lifecycle.legacyMapping(row.id)))
        return rows.filter((_row, index) => !mappings[index]?.oneToOne)
      }
      runtime.route.memoryResolveProposal = async (id, approved, edited, deviceId) => {
        const lifecycle = ctx.capabilities.get(FINDINGS_LIFECYCLE)
        const review = ctx.capabilities.get(FINDINGS_REVIEW)
        if (!lifecycle || !review) return legacyResolve(id, approved, edited, deviceId)
        const resolved = await resolveMappedLegacyProposal({ id, approved, edited, deviceId }, {
          migrationReport: () => lifecycle.migrationReport(),
          mapping: (legacyId) => lifecycle.legacyMapping(legacyId),
          dismiss: (legacyId, actorId) => lifecycle.dismissLegacy(legacyId, actorId),
          candidate: (candidateId) => review.candidate(candidateId),
          approve: (input) => findingsTarget.approve(input),
          proposals: runtime.proposals,
        })
        return resolved ?? legacyResolve(id, approved, edited, deviceId)
      }
      // The SQLite table is a derived index. Rebuild it once after migration so a fresh node has a warm
      // index and the project checkout and task-worktree source set is exercised at startup.
      await runtime.reconciled()
      ctx.capabilities.provide(MEMORY_KNOWLEDGE, runtime)
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
      ctx.routes.register(knowledge, { prefix: '', note: 'notes/memory pane' })
      for (const tool of memoryAgentTools(runtime, runtime.proposals, ctx.core)) ctx.tools.register(tool)
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
