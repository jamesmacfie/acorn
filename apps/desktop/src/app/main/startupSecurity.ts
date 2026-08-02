import type { RuntimeBindings } from '@acorn/node-core/main/bindings.ts'
import { pruneOrphanedGithubMirror } from '../../plugins/github/server/mirrorRetention'
import { protectLegacyHttpStorage } from '../../plugins/http/server/storage'

// Security-sensitive startup reconciliation shared by the utility-service and dev:node composition
// roots. HTTP plaintext migration must succeed before the listener opens. Retention repairs are
// also pre-listener so an expired payload cannot win a race with its first request after boot.
export async function prepareSecurityState(runtime: RuntimeBindings): Promise<void> {
  await protectLegacyHttpStorage(runtime.DB, runtime.SESSION_ENC_KEY)
  await pruneOrphanedGithubMirror(runtime.DB)
}
