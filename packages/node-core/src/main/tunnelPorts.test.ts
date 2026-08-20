import { describe, expect, it } from 'vitest'
import { loopbackPortOf } from './tunnelPorts'

// The allowlist is derived from what the node already resolves for a task, never configured
// (main/tunnelPorts.ts). This is the one piece of it with edges worth pinning: which URLs imply a
// tunnellable port.
describe('loopbackPortOf', () => {
  it('reads the explicit port of a loopback URL', () => {
    expect(loopbackPortOf('http://localhost:5173')).toBe(5173)
    expect(loopbackPortOf('http://127.0.0.1:3000/app')).toBe(3000)
    expect(loopbackPortOf('https://[::1]:8443/')).toBe(8443)
  })

  it('falls back to the scheme default', () => {
    // A dev server on 80 or 443 is unusual but legal, and refusing it would be an arbitrary hole.
    expect(loopbackPortOf('http://localhost')).toBe(80)
    expect(loopbackPortOf('https://localhost')).toBe(443)
  })

  it('is null for a URL that is not loopback', () => {
    // Already reachable from the client, so there's nothing to tunnel, and opening a port to it would be
    // the general proxy docs/api-reference.md § Streams rules out.
    expect(loopbackPortOf('https://staging.example.com:8443')).toBeNull()
    expect(loopbackPortOf('http://192.168.1.20:3000')).toBeNull()
  })

  it('is null for the userinfo disguise', () => {
    // `http://localhost@evil.test` has hostname `evil.test`. The preview URL guard in Electron main
    // refuses the same shape; the allowlist must not be the place that lets it through.
    expect(loopbackPortOf('http://localhost@evil.test:3000/')).toBeNull()
  })

  it('is null for junk, an unknown scheme, and nothing', () => {
    expect(loopbackPortOf('not a url')).toBeNull()
    expect(loopbackPortOf('file:///etc/passwd')).toBeNull()
    expect(loopbackPortOf(undefined)).toBeNull()
    expect(loopbackPortOf(null)).toBeNull()
  })
})
