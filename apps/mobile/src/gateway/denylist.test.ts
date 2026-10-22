import { describe, expect, it } from 'vitest'
import { DENIED_ROUTES, refusal } from './denylist'

describe('the gateway denylist', () => {
  it('names exactly these families', () => {
    expect([...new Set(DENIED_ROUTES.map((route) => route.family))]).toEqual([
      'Pairing and devices',
      'Plugin settings',
      'Backup and restore',
      'Security settings',
      'Stopping the Node',
    ])
  })

  it.each([
    ['POST', '/v1/pair'],
    ['POST', '/v1/pair/requests'],
    ['POST', '/v1/pair/requests/claim'],
    ['POST', '/v1/core/pair/start'],
    ['DELETE', '/v1/core/pair'],
    ['POST', '/v1/core/pair/requests/abc'],
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
    expect(refusal(method, path)).toMatch(/isn't available from a phone\. Use Acorn on your computer\.$/)
  })

  it.each([
    ['decoded', '/v1/core/%64evices'],
    ['with repeated slashes', '/v1//core/devices'],
    ['with a trailing slash', '/v1/core/plugins/install/'],
    ['in another case', '/V1/Core/Devices'],
    ['with an encoded plugin path', '/v1/core/plugins/acme/%64evelopment'],
    ['with an encoded slash', '/v1/core/plugins%2Facme%2Fdevelopment'],
    ['with doubled slashes in a plugin path', '/v1/core//plugins//acme//development'],
  ])('refuses a denied path written %s', (_written, path) => {
    expect(refusal(path.includes('plugins') ? 'put' : 'GET', path)).not.toBeNull()
  })

  it('refuses a path that does not decode', () => {
    expect(refusal('GET', '/v1/core/%E0%A4%A')).toBe('The gateway refused a path it could not read.')
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
  ])('forwards %s %s', (method, path) => {
    expect(refusal(method, path)).toBeNull()
  })
})
