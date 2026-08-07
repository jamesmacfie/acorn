import type { Context } from 'hono'
import { providerCredential } from '@acorn/node-core/server/integrations/credential.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'

export const GITHUB_PROVIDER = 'github'

export async function githubToken(c: Context<AppEnv>): Promise<string> {
  return providerCredential(c, GITHUB_PROVIDER)
}
