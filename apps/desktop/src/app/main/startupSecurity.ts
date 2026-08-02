import type { RuntimeBindings } from '@acorn/node-core/main/bindings.ts'
import { pruneOrphanedGithubMirror } from '@acorn/plugin-github/server/mirrorRetention.ts'
import { protectLegacyHttpStorage } from '@acorn/plugin-http/server/storage.ts'

// Security-sensitive startup reconciliation shared by the utility-service and dev:node composition
// roots. HTTP plaintext migration must succeed before the listener opens. Retention repairs are
// also pre-listener so an expired payload cannot win a race with its first request after boot.
export async function prepareSecurityState(runtime: RuntimeBindings): Promise<void> {
  await protectLegacyHttpStorage(runtime.DB, runtime.SESSION_ENC_KEY)
  await pruneOrphanedGithubMirror(runtime.DB)
}
