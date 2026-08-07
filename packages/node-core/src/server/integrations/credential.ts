import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { canUseProviderCredential, ownerId } from '../middleware/requireUser'

export async function providerCredential(c: Context<AppEnv>, providerId: string): Promise<string> {
  if (!canUseProviderCredential(c)) return ''
  const [row] = await getDb(c.env)
    .select({ authRef: schema.integrations.authRef })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, ownerId(c)), eq(schema.integrations.provider, providerId)))
  if (!row) return ''
  // useOptional: "unreadable credential" falls through to '' as well, which keeps the three outcomes
  // converged. The read goes through CoreServices.secrets, so no plugin ever holds SESSION_ENC_KEY.
  return (await c.env.SECRETS.useOptional(row.authRef, `${providerId}: api call`, (value) => value)) ?? ''
}
