import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv, Principal } from '../middleware/auth'
import { PublicApiError } from '../../shared/publicApi/errors'
import type { ApiSettingsController } from '../publicApi/coreSystem'
import { apiSettings, setApiSettingsController } from './apiSettings'

const principal: Principal = { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } }
const view = { enabled: true, port: 4318, effectivePort: 4318, bindAddress: '127.0.0.1:4318', portOverridden: false }

function app() {
  const a = new Hono<AppEnv>()
  a.use('/api/*', async (c, next) => {
    c.set('principal', principal)
    await next()
  })
  a.route('/api/settings/api', apiSettings)
  return a
}

describe('internal /api/settings/api route', () => {
  afterEach(() => setApiSettingsController(null))
  const call = (init?: RequestInit) => app().fetch(new Request('http://acorn.test/api/settings/api', init), {} as Env)

  it('503s when the automation server is not wired (dev:node)', async () => {
    setApiSettingsController(null)
    expect((await call()).status).toBe(503)
  })

  it('reads the current settings', async () => {
    setApiSettingsController({ read: () => view, patch: async () => ({ ...view, rebound: false }) } as ApiSettingsController)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(view)
  })

  it('patches settings and surfaces a controller error status', async () => {
    let patched: unknown = null
    const ctrl: ApiSettingsController = {
      read: () => view,
      patch: async (p) => {
        patched = p
        if (p.port === 4317) throw new PublicApiError('port_in_use', 'in use')
        return { ...view, port: p.port ?? view.port, rebound: true }
      },
    }
    setApiSettingsController(ctrl)

    const ok = await call({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ port: 4319 }) })
    expect(ok.status).toBe(200)
    expect(patched).toEqual({ port: 4319 })
    expect((await ok.json()).rebound).toBe(true)

    const conflict = await call({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ port: 4317 }) })
    expect(conflict.status).toBe(409)

    const bad = await call({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
    expect(bad.status).toBe(400) // refine: at least one field required
  })
})
