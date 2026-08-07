// The memory plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// It did not exist until Phase 3, and the reason is worth keeping: this plugin HAD client code
// (MemorySection, memoryClient) but nothing registrable — its section rendered inside plugins/context's
// pane, which imported the component directly. A ClientPlugin then would have held an empty `init`, which
// phase2-notes.md called out as ceremony rather than a gap. The client context-section registry gave it
// something to register, and registering it is what removed the `context -> memory` boundary edge.
//
// `required: true`, matching the node half — and that is a CORRECTION, not a change of heart. This file
// used to argue the opposite: that a node with memory disabled loses only the add-memory form and the
// proposal queue, which is true and is not the question. The question is whether that state is reachable.
// The node half is `required` (its own file says why: core's context assembler and agent tools resolve
// through it), and Phase 4 made the node the single source of truth for which plugins are off — so the
// node can never report memory as disabled, and a client-side disable was unreachable state whose only
// effect was to make the disable-cycling test walk a case production cannot produce.
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { memoryApi } from './memoryClient'
import MemorySection from './MemorySection'

export const memoryClientPlugin: ClientPlugin = {
  name: 'memory',
  required: true,
  init: (ctx) => {
    // Under the node-side `memory` section, which plugins/memory's own node part registers. Both halves
    // key on the same id, and neither plugin names the other.
    ctx.contextSections.register({ id: 'memory.section', sectionId: 'memory', order: 10, component: MemorySection })
    // The attention inbox's second source. A pending proposal is a state, not an event: the whole point of
    // the human review gate `memory_write` promises is that it sits there until someone decides, so it
    // belongs in "Needs you" rather than in the notice ring where it would scroll away unanswered.
    //
    // No taskId argument — the route answers node-wide for a device caller (it is confined only for a
    // task-scoped agent, which is Phase 3's gate), so this is one request per node.
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
