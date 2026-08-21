import { Hono } from 'hono'
import { z } from 'zod'
import { acknowledgeRepoConfig, repoConfigTrustReview } from '../../main/repoConfigTrust'
import { auditRequest } from '../auditRequest'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Called directly rather than through a bridge slot. It had one, filled by a wireConfigTrust() in the
// composition roots, but both ends of that indirection were core's: the route is core's, the
// implementation is core's (main/repoConfigTrust.ts), and the handle is core's `c.env.DB`. A bridge
// slot exists so a route handler can reach something it cannot import, a plugin's engine, and
// nothing here was ever a plugin's. Deleting it removes a module-global, a setter, a null-check on
// every request, and a wiring function each composition root had to remember to call.

const ackBody = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) })

export const configTrust = new Hono<AppEnv>()
  .get('/:id/config-trust', async (c) => c.json(await repoConfigTrustReview(getDb(c.env), c.req.param('id'))))
  .post('/:id/config-trust', async (c) => {
    const parsed = ackBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    try {
      // A hash that no longer matches the repo's config means it changed under the owner mid-review, so
      // the acknowledgement is refused rather than recorded against stale content.
      const review = await acknowledgeRepoConfig(getDb(c.env), c.req.param('id'), parsed.data.hash)
      // Recorded after the acknowledgement succeeds, so a rejected hash is not written as a trust
      // decision. This is the one moment the owner says "yes, run this repo's scripts", so security.md
      // § Audit lists it beside pairing. The hash, not the snapshot: the snapshot is the executable
      // content itself, and config_acks already keeps it.
      auditRequest(c, {
        action: 'config.trusted',
        subject: c.req.param('id'),
        details: { hash: parsed.data.hash },
      })
      return c.json(review)
    } catch (error) {
      // The repo's config changed under the owner mid-review. 409, not 500: nothing is wrong with the
      // request, the world moved.
      return respondError(c, 409, 'config-changed', [error instanceof Error ? error.message : 'Repo configuration changed during review.'])
    }
  })
