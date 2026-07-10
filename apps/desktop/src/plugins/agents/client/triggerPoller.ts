import type { PollerContribution } from '../../../core/client/registries/pollers'
import { workflowApi } from './workflowClient'

// Trigger predicates live with their main-process source/provider contributions. The client poll
// scheduler supplies the app-open, visibility-paused clock; it does not duplicate predicates.
export const workflowTriggerPollerContribution: PollerContribution = {
  id: 'workflows.triggers',
  intervalMs: 30_000,
  requires: 'desktop',
  run: async () => {
    const result = await workflowApi.pollTriggers()
    if (result.errors.length) console.warn('[workflow:triggers]', result.errors.join('; '))
  },
}
