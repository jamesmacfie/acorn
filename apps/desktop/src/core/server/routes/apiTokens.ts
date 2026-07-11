import { Hono } from 'hono'
import { z } from 'zod'
import { ApiScopesSchema, UnixMillisSchema } from '../../shared/publicApi/primitives'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'

// Cookie-authenticated administration of public API bearer tokens (docs/public-api.md
// §4). Mounted on the internal 4317 app under the existing csrf + auth gate — NOT on the public
// listener. A bearer token cannot mint or revoke tokens; issuance stays an interactive ceremony.

const CreateApiTokenSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scopes: ApiScopesSchema,
  expiresAt: UnixMillisSchema.nullable().default(null),
})

export const apiTokens = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = getUser(c)
    const list = await c.env.API_TOKENS.list(user.login)
    return c.json(list)
  })
  .post('/', async (c) => {
    const user = getUser(c)
    const parsed = CreateApiTokenSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    if (parsed.data.expiresAt !== null && parsed.data.expiresAt <= Date.now()) {
      return respondError(c, 400, 'bad_request', ['expiresAt must be in the future'])
    }
    const created = await c.env.API_TOKENS.create({
      userId: user.login,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      expiresAt: parsed.data.expiresAt,
    })
    // The raw token is present ONLY in this response. The client shows it once and never caches it
    // (implementation-plan.md Phase 2 §7).
    return c.json(created, 201)
  })
  .delete('/:id', async (c) => {
    const user = getUser(c)
    const ok = await c.env.API_TOKENS.revoke(user.login, c.req.param('id'))
    if (!ok) return respondError(c, 404, 'not_found')
    return c.body(null, 204)
  })
