import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { Disposable } from '../pluginHost/capabilities'
import { registerRoute } from '../routes/registry'
import type { AppEnv, Principal } from './auth'
import { PHONE_ALLOWED, PHONE_REFUSED, phoneRefusal, phoneRules } from './phoneRules'

const ADMIN = /isn’t available from a phone\. Use Acorn on your computer\.$/
const NEEDS_SHELL = /give this phone shell access\.$/

describe('what no phone may do', () => {
  it('names exactly these families', () => {
    expect([...new Set(PHONE_REFUSED.map((route) => route.family))]).toEqual([
      'Opening a pairing window',
      'Managing devices',
      'Plugin settings',
      'Backup and restore',
      'Security settings',
      'Stopping the Node',
      'Connections',
    ])
  })

  it.each([
    ['POST', '/v1/core/pair/start'],
    ['DELETE', '/v1/core/pair'],
    ['GET', '/v1/core/devices'],
    ['DELETE', '/v1/core/devices/abc'],
    // A phone can't give itself shell access, with it or without it.
    ['PUT', '/v1/core/devices/abc/shell-access'],
    ['PUT', '/v1/core/plugins'],
    ['POST', '/v1/core/plugins/install'],
    ['POST', '/v1/core/plugins/acme/update'],
    ['POST', '/v1/core/plugins/acme/review'],
    ['POST', '/v1/core/plugins/acme/reload'],
    ['PUT', '/v1/core/plugins/acme/development'],
    ['POST', '/v1/core/plugins/acme/input-grant'],
    ['DELETE', '/v1/core/plugins/acme/input-grant'],
    ['PUT', '/v1/core/plugins/acme/model-grant'],
    ['DELETE', '/v1/core/plugins/acme/model-grant'],
    ['PUT', '/v1/core/plugins/acme/skills'],
    ['POST', '/v1/core/plugins/acme/skill-grant'],
    ['POST', '/v1/core/plugins/requests/abc'],
    ['POST', '/v1/core/plugins/acme/cli/sync'],
    ['DELETE', '/v1/core/plugins/acme'],
    ['GET', '/v1/core/backup'],
    ['POST', '/v1/core/backup'],
    ['GET', '/v1/core/security'],
    ['PUT', '/v1/core/security/secret-publication'],
    ['PUT', '/v1/core/node/reach'],
    ['POST', '/v1/core/node/stop'],
    ['POST', '/v1/core/integrations'],
    ['PUT', '/v1/core/integrations/abc'],
    ['PATCH', '/v1/core/integrations/abc'],
    ['DELETE', '/v1/core/integrations/abc'],
  ])('refuses %s %s, even with shell access', (method, path) => {
    expect(phoneRefusal(method, path)).toMatch(ADMIN)
    expect(phoneRefusal(method, path, true)).toMatch(ADMIN)
  })

  it.each([
    ['decoded', '/v1/core/%64evices'],
    ['with repeated slashes', '/v1//core/devices'],
    ['with a trailing slash', '/v1/core/plugins/install/'],
    ['in another case', '/V1/Core/Devices'],
    ['with an encoded plugin path', '/v1/core/plugins/acme/%64evelopment'],
    ['with an encoded slash', '/v1/core/plugins%2Facme%2Fdevelopment'],
    ['with doubled slashes in a plugin path', '/v1/core//plugins//acme//development'],
  ])('refuses a refused path written %s', (_written, path) => {
    expect(phoneRefusal(path.includes('plugins') ? 'put' : 'GET', path, true)).toMatch(ADMIN)
  })

  it('refuses a path that does not decode', () => {
    expect(phoneRefusal('GET', '/v1/core/%E0%A4%A')).toBe('A phone can’t make that request.')
  })
})

describe('what a phone may do without shell access', () => {
  it('names exactly these families of core writes', () => {
    expect([...new Set(PHONE_ALLOWED.map((route) => route.family))]).toEqual([
      'Reading',
      'Pairing',
      'Tasks',
      'Data and dashboards',
      'Dictation',
      'Telemetry',
    ])
  })

  // Each of these runs a program on the Node, or decides what one runs. The plugins' own routes are in
  // apps/node/test/integration/auth/phoneRoutes.test.ts, with the plugins that declare them.
  it.each([
    ['POST', '/v1/core/tasks/abc/renderer-tools/terminal_run'],
    ['POST', '/v1/core/tasks/abc/tools/run_script'],
    ['POST', '/v1/core/tasks/abc/run/web/start'],
    ['POST', '/v1/core/tasks/abc/on-created'],
    ['POST', '/v1/core/tasks/abc/archive'],
    ['POST', '/v1/core/tasks/abc/archive-run'],
    ['POST', '/v1/core/tasks/abc/restore'],
    ['POST', '/v1/core/tasks/abc/config-trust'],
    ['POST', '/v1/core/projects'],
    ['PUT', '/v1/core/projects/abc/config'],
    ['PUT', '/v1/core/projects/abc/run-targets'],
    ['POST', '/v1/core/projects/abc/trust'],
    ['POST', '/v1/core/workspaces'],
    ['PUT', '/v1/core/prefs'],
    ['PUT', '/v1/core/prefs/agents.defaultMode'],
    ['POST', '/v1/core/schedules'],
    ['POST', '/v1/core/schedules/abc/run'],
    ['POST', '/v1/core/nodes/create'],
  ])('refuses %s %s', (method, path) => {
    expect(phoneRefusal(method, path)).toMatch(NEEDS_SHELL)
    expect(phoneRefusal(method, path, true)).toBeNull()
  })

  it('refuses a write nobody named, so a new route needs shell access', () => {
    expect(phoneRefusal('POST', '/v1/p/acme/anything')).toMatch(NEEDS_SHELL)
    expect(phoneRefusal('POST', '/v1/core/something-new')).toMatch(NEEDS_SHELL)
  })

  it('matches an allowed path in the forms the router sees, and nothing longer', () => {
    expect(phoneRefusal('post', '/V1/Core//Tasks/')).toBeNull()
    expect(phoneRefusal('POST', '/v1/core/tasks/abc/links/more')).toMatch(NEEDS_SHELL)
  })

  it.each([
    ['GET', '/v1/node'],
    ['GET', '/v1/core/tasks'],
    ['GET', '/v1/core/plugins'],
    ['GET', '/v1/core/plugins/acme/bundles/abc123'],
    ['HEAD', '/v1/core/plugins/acme/bundles/abc123'],
    ['GET', '/v1/core/node/reach'],
    ['GET', '/v1/p/acme/anything'],
    ['GET', '/v1/core/pair/requests'],
    ['POST', '/v1/core/pair/requests/abc'],
    ['POST', '/v1/core/tasks'],
    ['PATCH', '/v1/core/tasks/abc'],
    ['POST', '/v1/core/dashboards/run'],
  ])('lets %s %s through', (method, path) => {
    expect(phoneRefusal(method, path)).toBeNull()
  })

  describe('a plugin’s routes', () => {
    let release: Disposable[] = []
    afterEach(() => {
      for (const registration of release) registration.dispose()
      release = []
    })
    const router = new Hono<AppEnv>()

    it('lets through the writes a plugin names, and refuses the rest', () => {
      release.push(
        registerRoute({
          plugin: 'acme',
          prefix: '/tasks',
          router,
          phone: ['POST /:taskId/notes', '* /:taskId/files/*'],
        }),
      )
      expect(phoneRefusal('POST', '/v1/p/acme/tasks/abc/notes')).toBeNull()
      expect(phoneRefusal('POST', '/v1/p/acme/tasks/ABC/Notes/')).toBeNull()
      expect(phoneRefusal('DELETE', '/v1/p/acme/tasks/abc/notes')).toMatch(NEEDS_SHELL)
      expect(phoneRefusal('POST', '/v1/p/acme/tasks/abc/notes/more')).toMatch(NEEDS_SHELL)
      expect(phoneRefusal('POST', '/v1/p/acme/tasks/abc/run')).toMatch(NEEDS_SHELL)
      expect(phoneRefusal('PUT', '/v1/p/acme/tasks/abc/files/a/b')).toBeNull()
      expect(phoneRefusal('PUT', '/v1/p/acme/tasks/abc/files')).toMatch(NEEDS_SHELL)
      // Another plugin's namespace isn't covered by these.
      expect(phoneRefusal('POST', '/v1/p/other/tasks/abc/notes')).toMatch(NEEDS_SHELL)
    })

    it('refuses every write under a mount registered as refused, even with shell access', () => {
      release.push(registerRoute({ plugin: 'acme', prefix: '', router, phone: 'refused' }))
      for (const [method, path] of [
        ['PUT', '/v1/p/acme/remote-access'],
        ['POST', '/v1/p/acme/sign-out'],
        ['DELETE', '/v1/p/ACME/links/abc/'],
      ]) {
        expect(phoneRefusal(method, path)).toMatch(ADMIN)
        expect(phoneRefusal(method, path, true)).toMatch(ADMIN)
      }
      expect(phoneRefusal('GET', '/v1/p/acme/state', true)).toBeNull()
      expect(phoneRefusal('POST', '/v1/p/acmex/anything', true)).toBeNull()
    })

    it('refuses even a read through a loopback mount, apart from opening a preview', () => {
      release.push(registerRoute({ plugin: 'acme', prefix: '/tasks/:taskId/proxy', router, loopback: true }))
      expect(phoneRefusal('GET', '/v1/p/acme/tasks/abc/proxy')).toMatch(NEEDS_SHELL)
      expect(phoneRefusal('GET', '/v1/p/acme/tasks/abc/proxy/__open-in-editor')).toMatch(NEEDS_SHELL)
      expect(phoneRefusal('POST', '/v1/p/acme/tasks/abc/proxy/__acorn/open')).toBeNull()
      expect(phoneRefusal('GET', '/v1/p/acme/tasks/abc/proxy/x', true)).toBeNull()
    })
  })
})

describe('as middleware', () => {
  const appFor = (principal: Principal | null) =>
    new Hono<AppEnv>()
      .use('*', async (c, next) => (c.set('principal', principal), next()))
      .use('*', phoneRules)
      .all('*', (c) => c.text('reached'))
  const phone: Principal = { kind: 'device', userId: 'u', deviceId: 'd', deviceKind: 'phone' }
  const refusal = async (response: Response) => ({
    status: response.status,
    body: (await response.json()) as { error: { code: string } },
  })

  it('answers a phone 403 phone_refused, and runs nothing behind it', async () => {
    for (const [method, path] of [
      ['GET', '/v1/core/devices'],
      ['POST', '/v1/p/terminal/sessions'],
    ]) {
      expect(await refusal(await appFor(phone).request(path, { method }))).toMatchObject({
        status: 403,
        body: { error: { code: 'phone_refused' } },
      })
    }
  })

  it('lets a phone reach what it may', async () => {
    expect(await (await appFor(phone).request('/v1/core/tasks')).text()).toBe('reached')
  })

  it('refuses a phone with shell access the settings that decide who can reach the Node', async () => {
    const granted: Principal = { ...phone, shellAccess: true }
    const release = registerRoute({ plugin: 'acme', prefix: '', router: new Hono<AppEnv>(), phone: 'refused' })
    try {
      for (const [method, path] of [
        ['PUT', '/v1/p/acme/remote-access'],
        ['POST', '/v1/core/integrations'],
      ]) {
        expect(await refusal(await appFor(granted).request(path, { method }))).toMatchObject({
          status: 403,
          body: { error: { code: 'phone_refused' } },
        })
      }
    } finally {
      release.dispose()
    }
  })

  it('lets a phone with shell access open a terminal', async () => {
    const granted: Principal = { ...phone, shellAccess: true }
    expect(await (await appFor(granted).request('/v1/p/terminal/sessions', { method: 'POST' })).text()).toBe('reached')
  })

  it('holds a device that is not a phone to nothing', async () => {
    const desktop: Principal = { kind: 'device', userId: 'u', deviceId: 'd' }
    expect(await (await appFor(desktop).request('/v1/core/devices')).text()).toBe('reached')
    expect(await (await appFor(desktop).request('/v1/p/terminal/sessions', { method: 'POST' })).text()).toBe('reached')
  })
})
