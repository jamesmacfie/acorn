import { describe, expect, it } from 'vitest'
import { pluginBuiltinAllowed } from './nodeBuiltins'

const none = { sockets: false, exec: false }
describe('loaded builtin grants', () => {
  it.each(['dns', 'dns/promises', 'http', 'https', 'net', 'tls', 'http2', 'dgram', 'quic'])('requires sockets for %s and its node spelling', name => {
    for (const spelling of [name, `node:${name}`]) {
      expect(pluginBuiltinAllowed(spelling, none)).toBe(false)
      expect(pluginBuiltinAllowed(spelling, { ...none, sockets: true })).toBe(true)
    }
  })
  it.each(['module', 'vm', 'sqlite', 'worker_threads', 'inspector/promises', 'repl', 'cluster', 'wasi', 'test',
    '_http_client', '_tls_wrap', '_stream_wrap', 'internal/http', 'future_builtin'])('denies privileged or unknown %s even with broad grants', name => {
    for (const spelling of [name, `node:${name}`]) expect(pluginBuiltinAllowed(spelling, { sockets: true, exec: true })).toBe(false)
  })
  it('keeps safe builtin subpaths and the explicit execution grant', () => {
    for (const name of ['assert/strict', 'fs/promises', 'stream/web', 'util/types', 'timers/promises', 'crypto']) {
      expect(pluginBuiltinAllowed(`node:${name}`, none)).toBe(true)
    }
    expect(pluginBuiltinAllowed('child_process', none)).toBe(false)
    expect(pluginBuiltinAllowed('node:child_process', { ...none, exec: true })).toBe(true)
  })
})
