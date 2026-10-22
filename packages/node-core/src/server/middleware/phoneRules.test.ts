import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv, Principal } from './auth'
import { PHONE_REFUSED, phoneRefusal, phoneRules } from './phoneRules'

describe('what a phone device may not do', () => {
  it('names exactly these families', () => {
    expect([...new Set(PHONE_REFUSED.map((route) => route.family))]).toEqual([
      'Opening a pairing window',
      'Managing devices',
      'Plugin settings',
      'Backup and restore',
      'Security settings',
      'Stopping the Node',
    ])
  })

  it.each([
    ['POST', '/v1/core/pair/start'],
    ['DELETE', '/v1/core/pair'],
    ['GET', '/v1/core/devices'],
    ['DELETE', '/v1/core/devices/abc'],
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
  ])('refuses %s %s', (method, path) => {
    expect(phoneRefusal(method, path)).toMatch(/isn’t available from a phone\. Use Acorn on your computer\.$/)
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
    expect(phoneRefusal(path.includes('plugins') ? 'put' : 'GET', path)).not.toBeNull()
  })

  it('refuses a path that does not decode', () => {
    expect(phoneRefusal('GET', '/v1/core/%E0%A4%A')).toBe('A phone can’t make that request.')
  })

  it.each([
    ['GET', '/v1/core/tasks'],
    ['POST', '/v1/core/tasks'],
    ['GET', '/v1/core/plugins'],
    ['GET', '/v1/core/plugins/acme/logs'],
    ['GET', '/v1/core/plugins/acme/bundles/abc123'],
    ['HEAD', '/v1/core/plugins/acme/bundles/abc123'],
    ['GET', '/v1/core/node/reach'],
    ['GET', '/v1/node'],
    // Answering a pairing request is what a phone is for when it is the one device online.
    ['GET', '/v1/core/pair/requests'],
    ['POST', '/v1/core/pair/requests/abc'],
  ])('lets %s %s through', (method, path) => {
    expect(phoneRefusal(method, path)).toBeNull()
  })

  describe('as middleware', () => {
    const appFor = (principal: Principal | null) =>
      new Hono<AppEnv>()
        .use('*', async (c, next) => (c.set('principal', principal), next()))
        .use('*', phoneRules)
        .all('*', (c) => c.text('reached'))
    const phone: Principal = { kind: 'device', userId: 'u', deviceId: 'd', deviceKind: 'phone' }

    it('answers a phone 403 phone_refused, and runs nothing behind it', async () => {
      const response = await appFor(phone).request('/v1/core/devices')
      expect(response.status).toBe(403)
      expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'phone_refused' } })
    })

    it('lets a phone reach what it may', async () => {
      expect(await (await appFor(phone).request('/v1/core/tasks')).text()).toBe('reached')
    })

    it('holds a device that is not a phone to nothing', async () => {
      const desktop: Principal = { kind: 'device', userId: 'u', deviceId: 'd' }
      expect(await (await appFor(desktop).request('/v1/core/devices')).text()).toBe('reached')
    })
  })
})
