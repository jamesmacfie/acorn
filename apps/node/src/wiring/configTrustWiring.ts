import { BridgeError } from '@acorn/node-core/server/bridge.ts'
import { acknowledgeRepoConfig, repoConfigTrustReview } from '@acorn/node-core/main/repoConfigTrust.ts'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { setConfigTrustBridge } from '@acorn/node-core/server/routes/configTrust.ts'

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
