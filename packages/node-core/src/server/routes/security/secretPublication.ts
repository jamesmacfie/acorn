import type { Context } from 'hono'
import { z } from 'zod'
import { SECRET_PUBLICATION_PREF_KEY, type SecretPublicationState } from '@acorn/protocol/secretChecks.ts'
import { auditActor } from '../../auditRequest'
import { createPrefService, writePreference } from '../../core/prefs'
import { getDb } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { ownerId } from '../../middleware/requireUser'
import { respondError } from '../../respond'
import { SECRET_DETECTOR_VERSION } from '../../secretChecks/detector'
import { allowSecretPublication, secretPublicationDecisions } from '../../secretChecks/gate'

// Settings → Security and backup: the blocking switch and the refused operations waiting for the
// owner (docs/security/secret-publication.md § Policy). Mounted lazily under /security in
// ../../index.ts, so the device-only gate there covers every verb: a task, service, or plugin-frame
// caller can neither change the policy nor allow an exception.

const blockBody = z.object({ block: z.boolean() })
const allowBody = z.object({ decisionId: z.string().regex(/^[a-f0-9]{64}$/) })

const state = async (db: ReturnType<typeof getDb>, userId: string): Promise<SecretPublicationState> => ({
  block: (await createPrefService(db).read(userId, SECRET_PUBLICATION_PREF_KEY)) === 'true',
  detectorVersion: SECRET_DETECTOR_VERSION,
  decisions: secretPublicationDecisions(),
})

export async function readSecretPublication(c: Context<AppEnv>): Promise<Response> {
  return c.json(await state(getDb(c.env), ownerId(c)))
}

export async function writeSecretPublication(c: Context<AppEnv>): Promise<Response> {
  const parsed = blockBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return respondError(c, 400, 'bad_request')
  const db = getDb(c.env)
  writePreference(db, ownerId(c), SECRET_PUBLICATION_PREF_KEY, String(parsed.data.block))
  return c.json(await state(db, ownerId(c)))
}

export async function allowSecretPublicationOnce(c: Context<AppEnv>): Promise<Response> {
  const parsed = allowBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return respondError(c, 400, 'bad_request')
  const db = getDb(c.env)
  if (!allowSecretPublication(db, auditActor(c), parsed.data.decisionId)) {
    return respondError(c, 404, 'decision_expired', ['This check expired. Try the operation again.'])
  }
  return c.json(await state(db, ownerId(c)))
}
