import { Hono } from 'hono'
import { z } from 'zod'
import { BridgeError, ownerId, requireDevice, type AppEnv, type CoreServices } from '@acorn/plugin-api/node'
import { gitSettings, writeGitPreference, writeIdentity, AUTO_FETCH_PREF, PULL_POLICY_PREF } from '../settings'

const identity = z.object({ scope: z.enum(['local', 'global']), name: z.string().min(1).max(256), email: z.string().min(1).max(320) }).strict()
const preference = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pull-policy'), value: z.enum(['ff-only', 'rebase']) }).strict(),
  z.object({ kind: z.literal('auto-fetch'), value: z.boolean() }).strict(),
])
export function settingsRoutes(core: Pick<CoreServices, 'git' | 'projects' | 'prefs'>, onAutoFetchChange?: (enabled: boolean) => void) {
  return new Hono<AppEnv>()
    .use('/projects/:projectId/settings', requireDevice)
    .use('/projects/:projectId/settings/*', requireDevice)
    .get('/projects/:projectId/settings', async (c) => c.json(await gitSettings(core, c.req.param('projectId'), ownerId(c))))
    .put('/projects/:projectId/settings/identity', async (c) => {
      const parsed = identity.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid Git identity.')
      return c.json(await writeIdentity(core, c.req.param('projectId'), ownerId(c), parsed.data))
    })
    .put('/projects/:projectId/settings/preference', async (c) => {
      const parsed = preference.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid Git preference.')
      const settings = await writeGitPreference(core, c.req.param('projectId'), ownerId(c), parsed.data.kind === 'pull-policy' ? PULL_POLICY_PREF : AUTO_FETCH_PREF,
        parsed.data.kind === 'pull-policy' ? parsed.data.value : String(parsed.data.value))
      if (parsed.data.kind === 'auto-fetch') onAutoFetchChange?.(parsed.data.value)
      return c.json(settings)
    })
}
