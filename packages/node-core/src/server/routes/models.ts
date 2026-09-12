import { Hono } from 'hono'
import type { ModelBackendsResponse } from '@acorn/protocol/modelProviders.ts'
import { createModelService } from '../core/models'
import { getDb } from '../db'
import { harnessBackends } from '../modelProviders/harnessRuntime'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'

// The read half of the model seam: which backends this owner could generate with, and which agent CLI
// declared a one-shot mode but is not installed here.
//
// docs/integrations.md § Model providers refuses a generic core generate route, and still does: that
// would be an unbudgeted proxy to whatever a caller asked for. This is the ids-and-labels projection
// `/v2/core/integrations` already serves for connections, and its consumers are core's own surfaces —
// the onboarding wizard's step, the Settings section, and the project-settings gate that used to count
// connections client-side. A plugin frame keeps the proxy route its own plugin serves, because
// `/v2/core/*` has no bridge scope and minting one would hand every installed plugin the whole roster
// to serve one dropdown.
export const models = new Hono<AppEnv>()
  .get('/backends', async (c) => {
    const service = createModelService(getDb(c.env), c.env.SECRETS)
    // `available` already answers connections-then-installed-harnesses in list order, so the wizard's
    // "not found on this machine" rows are the only thing left to ask for separately.
    const [backends, harnesses] = await Promise.all([service.available(ownerId(c)), harnessBackends()])
    return c.json({
      backends,
      missing: harnesses.missing.map((backend) => ({ id: backend.id, label: backend.label })),
    } satisfies ModelBackendsResponse)
  })
