// A waiting gate is a row in the attention inbox, kept until somebody resolves it
// (docs/notifications.md § What a row points at).
//
// Addressed at the node it is passed, never the active one: the inbox fans out over the fleet, and a
// source that read the ambient node would report one node's gates under every card
// (client-core registries/rail/attention.ts).
import type { AttentionItem, AttentionSourceContribution } from '@acorn/plugin-api/client'
import { workflowApi } from '../workflowsClient'

/** The row's identity, built in one place so a refetch re-renders the row instead of replacing it. */
export const gateAttentionItemId = (stepId: string): string => `workflow:gate:${stepId}`

export const workflowsAttentionSource: AttentionSourceContribution = {
  id: 'workflows.gates',
  order: 20,
  fetch: async (nodeId, signal): Promise<AttentionItem[]> => {
    // The merged run list's own route, which maps `gated` onto `waiting`. Steps are read only for the
    // runs that are actually parked, which is almost always none.
    const { runs } = await workflowApi.allRuns({ nodeId, signal })
    const waiting = runs.filter((run) => run.status === 'waiting' && run.taskId)
    const rows: AttentionItem[] = []
    for (const run of waiting) {
      const steps = await workflowApi.steps(run.id, { nodeId, signal }).catch(() => [])
      for (const step of steps) {
        if (step.status !== 'waiting-gate') continue
        rows.push({
          id: gateAttentionItemId(step.id),
          taskId: run.taskId ?? undefined,
          title: `${run.title} needs you: ${step.name}`,
          detail: 'Waiting for a decision',
          glyph: 'hand',
          // `warn`, so it stays: only the owner can lift this one, and an acknowledged gate would
          // still be a gate.
          severity: 'warn',
          // When the wait began, not when the inbox asked, so the row says how long it has been
          // sitting there.
          at: step.updatedAt,
          target: { kind: 'workflow-run', resourceId: run.id, subresourceId: step.id },
        })
      }
    }
    return rows
  },
}
