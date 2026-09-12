import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { memoryCommands } from './commands'
import { memoryApi } from './memoryClient'
import { activateMemoryNoticeTargets, MEMORY_SOURCE_ID } from './proposalTarget'
import MemorySection from './MemorySection'

const MemoryCenter = lazy(() => import('./MemoryCenter'))

export const memoryClientPlugin: ClientPlugin = {
  name: 'memory',
  required: true,
  init: (ctx) => {
    // Search what this project remembers, and open the proposals waiting for a decision. Both land in
    // the context pane's memory section, which is what this plugin draws (./commands.ts).
    for (const contribution of memoryCommands) ctx.commands.register(contribution)
    // Into the section slot the context pane opens, matched on the node-side `memory` section id, which
    // plugins/memory's own node part registers. Both halves key on that id, and neither plugin imports
    // the other: the host carries the props and mounts the component.
    ctx.extensions.register({
      id: 'memory.section',
      point: 'context:section',
      label: 'Memory proposals and add form',
      order: 10,
      matches: ['memory'],
      component: MemorySection,
    })
    // The Memory page (./MemoryCenter.tsx). On the rail rather than reachable only from a
    // notification: reviewing what a project has learned is something an owner goes and does, and a
    // page you can only arrive at by being interrupted is a page nobody remembers exists.
    ctx.sources.register({
      id: MEMORY_SOURCE_ID,
      order: 70,
      glyph: 'brain',
      label: 'Memory',
      component: MemoryCenter,
      // The accepted list is per project; the proposals are not, and the page says so by drawing them
      // in their own section above it.
      projectScoped: true,
    })
    ctx.attentionSources.register({
      id: 'memory.proposals', order: 20,
      fetch: async (nodeId, signal) => {
        const proposals = await memoryApi().proposals(undefined, { nodeId, signal })
        return proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => ({
          id: `memory.proposals:${proposal.id}`,
          title: `Review memory: ${proposal.name}`,
          detail: proposal.description,
          // `info`, not `warn`: nothing is blocked on this. An unreviewed proposal costs the owner a
          // memory they might have wanted, which is a nudge, not a failure. The glyph carries what it
          // is instead, since every row from this source is the same kind of thing.
          severity: 'info' as const,
          glyph: 'brain',
          at: proposal.createdAt,
          // No `taskId`, though the proposal records one. The row used to carry it, which sent a click
          // to the task and left the reader on whatever pane was open; worse, the task may be archived,
          // and accepting a proposal falls back to the project folder precisely so that still works
          // (../server/knowledgeChannel.ts). The proposal's home is the Memory page.
          //
          // The project instead, so the inbox routes there first: the page scopes both its lists to
          // the routed project, so arriving anywhere else would filter this very proposal out of the
          // page it just opened. An unscoped proposal names none and lands wherever the reader is,
          // which is where it is visible from (../server/agentTools.ts).
          ...(proposal.projectId ? { projectId: proposal.projectId } : {}),
          target: { kind: 'memory-proposal', resourceId: proposal.id },
        }))
      },
    })
  },
  // Not registration: a handler in the notice target table, which is keyed by kind rather than held by
  // a registry (./proposalTarget.ts).
  activate: () => {
    activateMemoryNoticeTargets()
  },
}
