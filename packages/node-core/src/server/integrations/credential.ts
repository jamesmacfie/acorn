import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { canUseProviderCredential, ownerId } from '../middleware/requireUser'
import { freshConnection } from './connections'

async function readCredential(
  c: Context<AppEnv>,
  providerId: string,
  force: boolean,
  connectionId: string | undefined,
): Promise<string> {
  if (!canUseProviderCredential(c)) return ''
  const db = getDb(c.env)
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, ownerId(c)),
        eq(schema.integrations.provider, providerId),
        connectionId === undefined ? undefined : eq(schema.integrations.id, connectionId),
      ),
    )
  if (!row) return ''
  const fresh = await freshConnection(db, row, c.env.SECRETS, { force })
  if (!fresh) return ''
  // useOptional: "unreadable credential" falls through to '' as well, which keeps the three outcomes
  // converged. The read goes through CoreServices.secrets, so no plugin ever holds SESSION_ENC_KEY.
  return (
    (await c.env.SECRETS.useOptional(fresh.encryptedCredentials, `${providerId}: api call`, (value) => value)) ?? ''
  )
}

/** The owner's credential for a provider, renewed first when it is about to expire. A provider with
 *  several connections names the one it wants. '' when there is none to use. */
export const providerCredential = (c: Context<AppEnv>, providerId: string, connectionId?: string): Promise<string> =>
  readCredential(c, providerId, false, connectionId)

/** A renewed credential, for a caller whose provider just refused the stored one with a `401`. '' when
 *  the provider can't renew it, or refused the renewal and the connection now needs sign-in. */
export const refreshProviderCredential = (
  c: Context<AppEnv>,
  providerId: string,
  connectionId?: string,
): Promise<string> => readCredential(c, providerId, true, connectionId)
