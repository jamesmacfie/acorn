import { BridgeError } from '../../core/server/bridge'
import { acknowledgeRepoConfig, repoConfigTrustReview } from '../../core/main/repoConfigTrust'
import type { AppDatabase } from '../../core/server/db'
import { setConfigTrustBridge } from '../../core/server/routes/configTrust'

export function wireConfigTrust(db: AppDatabase): void {
  setConfigTrustBridge({
    review: (taskId) => repoConfigTrustReview(db, taskId),
    acknowledge: async (taskId, hash) => {
      try {
        return await acknowledgeRepoConfig(db, taskId, hash)
      } catch (error) {
        throw new BridgeError(409, 'config-changed', error instanceof Error ? error.message : 'Repo configuration changed during review.')
      }
    },
  })
}
