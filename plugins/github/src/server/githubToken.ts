import type { Context } from 'hono'
import { type AppEnv, providerCredential } from '@acorn/plugin-api/node'

export const GITHUB_PROVIDER = 'github'

export async function githubToken(c: Context<AppEnv>): Promise<string> {
  return providerCredential(c, GITHUB_PROVIDER)
}
