import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { decryptSecret, encryptSecret } from '../session'

// Encrypted upstream GitHub identity (docs/next/api/authentication.md §7). Upserted on every
// successful /auth/callback so a bearer request — which carries no session cookie — can still resolve
// a GitHub credential. The access token is JWE-encrypted at rest with SESSION_ENC_KEY and never
// returned or logged.

export type OauthAccountMetadata = {
  userId: string
  provider: string
  login: string
  name: string
  avatar: string
  scopes: string[]
  updatedAt: number
}

export class OauthAccountService {
  constructor(
    private readonly db: AppDatabase,
    private readonly encKey: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  // Upsert the GitHub account for a login. Rotation (a new callback) replaces the credential.
  async upsertGithub(input: { login: string; accessToken: string; name: string; avatar: string; scopes: string[] }): Promise<void> {
    const encryptedAccessToken = await encryptSecret(input.accessToken, this.encKey)
    const row = {
      userId: input.login,
      provider: 'github' as const,
      encryptedAccessToken,
      login: input.login,
      name: input.name,
      avatar: input.avatar,
      scopesJson: JSON.stringify(input.scopes),
      updatedAt: this.now(),
    }
    await this.db
      .insert(schema.oauthAccounts)
      .values(row)
      .onConflictDoUpdate({
        target: schema.oauthAccounts.userId,
        set: {
          encryptedAccessToken: row.encryptedAccessToken,
          name: row.name,
          avatar: row.avatar,
          scopesJson: row.scopesJson,
          updatedAt: row.updatedAt,
        },
      })
  }

  // Decrypt and return the stored GitHub access token for a user, or null if none/undecryptable.
  async resolveGithubToken(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ enc: schema.oauthAccounts.encryptedAccessToken })
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.userId, userId))
      .limit(1)
    if (!row) return null
    return decryptSecret(row.enc, this.encKey)
  }

  async getMetadata(userId: string): Promise<OauthAccountMetadata | null> {
    const [row] = await this.db.select().from(schema.oauthAccounts).where(eq(schema.oauthAccounts.userId, userId)).limit(1)
    if (!row) return null
    return {
      userId: row.userId,
      provider: row.provider,
      login: row.login,
      name: row.name,
      avatar: row.avatar,
      scopes: JSON.parse(row.scopesJson) as string[],
      updatedAt: row.updatedAt,
    }
  }
}
