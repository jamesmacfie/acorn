import type { ClientPlugin } from '@acorn/plugin-api/client'
import { memoryApi } from './memoryClient'
import MemorySection from './MemorySection'

export const memoryClientPlugin: ClientPlugin = {
  name: 'memory',
  required: true,
  init: (ctx) => {
    // Under the node-side `memory` section, which plugins/memory's own node part registers. Both halves
    // key on the same id, and neither plugin names the other.
    ctx.contextSections.register({ id: 'memory.section', sectionId: 'memory', order: 10, component: MemorySection })
    ctx.attention.register({
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
