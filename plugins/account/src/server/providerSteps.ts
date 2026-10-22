import { ProviderOperationError } from '@acorn/plugin-api/node'
import { accountApi } from './accountApi'
import { accountUrl } from './config'

// The steps of the sign-in connection that call the account service (./provider.ts).

// The poll route's answer, as the strings a connection's credentials are.
type Tokens = { accessToken: string; refreshToken: string; expiresIn: string }

// What `normalize` stores, worked out here because it needs the account the service named.
export async function validate(credentials: Record<string, string>) {
  const tokens = credentials as Tokens
  const account = await accountApi(accountUrl()).account(tokens.accessToken)
  return {
    normalized: {
      secret: tokens.accessToken,
      refresh: { refreshToken: tokens.refreshToken, expiresAt: Date.now() + Number(tokens.expiresIn) * 1000 },
      label: account.name,
      account: { id: account.id, label: account.name, type: 'user' as const },
      scopes: [],
      config: {},
      capabilities: {},
    },
  }
}

export async function test(secret: string) {
  try {
    await accountApi(accountUrl()).account(secret)
    return { ok: true as const }
  } catch {
    return { ok: false as const, error: 'provider_needs_auth' as const }
  }
}

// The service rotates the refresh token on every use, so the host stores the new one. A refusal means the
// person must sign in again, and any other failure only fails this request.
export async function refresh(refreshToken: string) {
  try {
    const next = await accountApi(accountUrl()).refresh(refreshToken)
    return {
      secret: next.accessToken,
      refreshToken: next.refreshToken,
      expiresAt: Date.now() + next.expiresIn * 1000,
    }
  } catch (error) {
    const refused = error instanceof Error && 'code' in error && error.code === 'invalid_grant'
    throw new ProviderOperationError(refused ? 'provider_needs_auth' : 'provider_unavailable', refused ? 401 : 502)
  }
}
