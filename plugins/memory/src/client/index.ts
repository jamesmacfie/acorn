import type { ClientPlugin } from '@acorn/plugin-api/client'
import { memoryCommands } from './commands'
import { memoryApi } from './memoryClient'
import MemorySection from './MemorySection'

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
    ctx.attentionSources.register({
      id: 'memory.proposals', order: 20,
      fetch: async (nodeId, signal) => {
        const proposals = await memoryApi().proposals(undefined, { nodeId, signal })
        return proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => ({
          id: `memory.proposals:${proposal.id}`,
          taskId: proposal.taskId,
          title: `Review memory: ${proposal.name}`,
          detail: proposal.description,
          // `info`, not `warn`: nothing is blocked on this. An unreviewed proposal costs the owner a
          // memory they might have wanted, which is a nudge, not a failure.
          severity: 'info' as const,
          at: proposal.createdAt,
        }))
      },
    })
  },
}
