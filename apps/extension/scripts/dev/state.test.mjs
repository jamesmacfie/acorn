import { describe, expect, it } from 'vitest'
import { parseSessionOptions } from './state.mjs'

describe('extension session options', () => {
  it('reads a browser, a session, and an outside Node, skipping the pnpm separator', () => {
    expect(parseSessionOptions(['--', '--browser', 'firefox', '--session', 'check-1', '--node', 'https://n.test:7443/'])).toEqual({
      browser: 'firefox',
      session: 'check-1',
      node: 'https://n.test:7443',
      reuse: false,
      browserBinary: null,
    })
  })

  it('refuses a missing browser, an unsafe session name, and a plain-http Node', () => {
    expect(() => parseSessionOptions(['--session', 'a'])).toThrow(/--browser chrome/)
    expect(() => parseSessionOptions(['--browser', 'chrome', '--session', '../escape'])).toThrow(/Session names/)
    expect(() => parseSessionOptions(['--browser', 'chrome', '--session', 'a', '--node', 'http://n.test'])).toThrow(/https/)
    expect(() => parseSessionOptions(['--browser', 'chrome', '--session', 'a', '--port', '1'])).toThrow(/Unknown option/)
  })
})
