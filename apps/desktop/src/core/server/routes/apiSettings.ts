import { Hono } from 'hono'
import { PatchApiServerSettingsSchema } from '../../shared/publicApi/core'
import { PublicApiError } from '../../shared/publicApi/errors'
import { bridgeSlot } from '../bridge'
import type { ApiSettingsController } from '../publicApi/coreSystem'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Internal (cookie-auth) view of the machine-scoped API listener settings so the desktop Settings
// page can show/edit enabled + port. The controller is the main-owned AutomationApiServer, wired in
// through this slot at boot (the public /api/v1/settings/api uses the same controller with bearer).
export const apiSettingsSlot = bridgeSlot<ApiSettingsController>()
export const setApiSettingsController = apiSettingsSlot.set

export const apiSettings = new Hono<AppEnv>()
  .get('/', (c) => {
    const ctrl = apiSettingsSlot.get()
    if (!ctrl) return respondError(c, 503, 'capability_unavailable')
    return c.json(ctrl.read())
  })
  .patch('/', async (c) => {
    const ctrl = apiSettingsSlot.get()
    if (!ctrl) return respondError(c, 503, 'capability_unavailable')
    const parsed = PatchApiServerSettingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request', parsed.error.issues.map((i) => i.message))
    try {
      return c.json(await ctrl.patch(parsed.data))
    } catch (e) {
      // The controller throws PublicApiError (setting_overridden / port_in_use); surface its status.
      if (e instanceof PublicApiError) return respondError(c, e.status, e.code, [e.message])
      throw e
    }
  })
