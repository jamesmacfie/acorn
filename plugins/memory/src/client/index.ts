import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { memoryCommands } from './commands'
import { memoryApi } from './memoryClient'
import { activateMemoryNoticeTargets, MEMORY_SOURCE_ID } from './proposalTarget'
import MemorySection from './MemorySection'

const MemoryCenter = lazy(() => import('./MemoryCenter'))

const reviewAttentionTitle = (ready: number, failed: number): string => {
  const readyText = `${ready} memory suggestion${ready === 1 ? '' : 's'} ready`
  const failedText = `${failed} memory review${failed === 1 ? '' : 's'} failed`
  return failed && ready ? `${failedText}; ${readyText}` : failed ? failedText : readyText
}

export const memoryClientPlugin: ClientPlugin = {
  name: 'memory',
  required: true,
  init: (ctx) => {
    // Register Memory search and review commands (./commands.ts).
    for (const contribution of memoryCommands) ctx.commands.register(contribution)
    // Into the section slot the context pane opens, matched on the node-side `memory` section id, which
    // plugins/memory's own node part registers. Both halves key on that id, and neither plugin imports
    // the other: the host carries the props and mounts the component.
    ctx.extensions.register({
      id: 'memory.section',
      point: 'context:section',
      label: 'Memory review and add form',
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
      // The page shows accepted memory and canonical review for the selected project.
      projectScoped: true,
    })
    ctx.attentionSources.register({
      id: 'memory.proposals', order: 20,
      fetch: async (nodeId, signal) => {
        const reviews = await memoryApi().reviewAttention({ nodeId, signal })
        const prepared = reviews.map((review) => ({
          id: `memory.findings:${review.id}`,
          title: reviewAttentionTitle(review.readyCount, review.failedCount),
          detail: review.failedCount
            ? 'Open Memory to retry the failed review.'
            : 'Open Memory to review the proposed changes.',
          severity: review.failedCount ? 'danger' as const : 'info' as const,
          glyph: 'brain',
          at: review.updatedAt,
          ...(review.scope.kind === 'project' ? { projectId: review.scope.projectId } : {}),
          target: { kind: 'findings-bundle', resourceId: review.id },
        }))
        return prepared
      },
    })
  },
  // Not registration: a handler in the notice target table, which is keyed by kind rather than held by
  // a registry (./proposalTarget.ts).
  activate: () => {
    activateMemoryNoticeTargets()
  },
}
