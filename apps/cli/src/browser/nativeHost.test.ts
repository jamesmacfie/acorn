import { describe, expect, it } from 'vitest'
import { callerRefusal, parseHostArgs } from './nativeHost'

describe('native host caller', () => {
  it('accepts Chrome only for the pinned extension origin', () => {
    expect(callerRefusal('chrome', ['chrome-extension://ciaaplnahgpccadenkacgipmhmpbddjo/'])).toBeNull()
    for (const args of [
      ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],
      ['chrome-extension://ciaaplnahgpccadenkacgipmhmpbddjo/', '--extra'],
      ['/Library/x.json', 'extension@acorn.dev'],
      [],
    ])
      expect(callerRefusal('chrome', args)).toMatch(/not the Acorn extension/)
  })

  it('accepts Firefox only in its registration-path and extension-ID form', () => {
    expect(callerRefusal('firefox', ['/Users/x/NativeMessagingHosts/h.json', 'extension@acorn.dev'])).toBeNull()
    for (const args of [
      ['/Users/x/h.json', 'other@acorn.dev'],
      ['relative.json', 'extension@acorn.dev'],
      ['chrome-extension://ciaaplnahgpccadenkacgipmhmpbddjo/'],
    ])
      expect(callerRefusal('firefox', args)).toMatch(/not the Acorn extension/)
  })

  it('separates its own arguments from the browser arguments', () => {
    expect(parseHostArgs(['--browser', 'firefox', '--bridge-dir', '/b', '--', '/r.json', 'id'])).toEqual({
      browser: 'firefox',
      bridgeDir: '/b',
      callerArgs: ['/r.json', 'id'],
    })
    expect(() => parseHostArgs(['--browser', 'safari', '--bridge-dir', '/b'])).toThrow(/Usage/)
    expect(() => parseHostArgs(['--browser', 'chrome', '--bridge-dir', 'relative'])).toThrow(/Usage/)
  })
})
