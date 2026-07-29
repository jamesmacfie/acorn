import type { RuntimeBindings } from '../../core/main/bindings'
import { pruneOrphanedGithubMirror } from '../../plugins/github/server/mirrorRetention'
import { protectLegacyHttpStorage } from '../../plugins/http/server/storage'
import { CommandExecutionService } from '../../plugins/terminal/main/executionService'

// Security-sensitive startup reconciliation shared by the utility-service and dev:node composition
// roots. HTTP plaintext migration must succeed before the listener opens. Retention repairs are
// also pre-listener so an expired payload cannot win a race with its first request after boot.
export async function prepareSecurityState(runtime: RuntimeBindings): Promise<CommandExecutionService> {
  const executions = new CommandExecutionService(runtime.DB)
  await protectLegacyHttpStorage(runtime.DB, runtime.SESSION_ENC_KEY)
  await runtime.API_TOKENS.cleanupExpired()
  await executions.cleanupExpired()
  await pruneOrphanedGithubMirror(runtime.DB)
  for (const userId of await runtime.OAUTH_ACCOUNTS.userIds()) {
    if (!(await runtime.API_TOKENS.hasActiveTokens(userId))) await runtime.OAUTH_ACCOUNTS.removeGithub(userId)
  }
  return executions
}
