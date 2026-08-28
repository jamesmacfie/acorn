import { describe, expect, it } from 'vitest'
import { PLUGIN_API_MAJOR, speaksApiVersion } from './pluginApiVersion.ts'

// The compatibility gate four call sites share: two loader paths, the installer, and the client's
// bundle resolution (docs/plugins.md § Activation). A plugin that loads when it should not is a
// `ctx` member that is not a function; one that refuses when it should not is a plugin nobody can
// install.
describe('speaksApiVersion', () => {
  it('matches a single major, and nothing else', () => {
    expect(speaksApiVersion('3', '3')).toBe(true)
    expect(speaksApiVersion('2', '3')).toBe(false)
    expect(speaksApiVersion('30', '3')).toBe(false)
  })

  it('lets one build declare two majors, which is the whole point of the range', () => {
    expect(speaksApiVersion('2 || 3', '2')).toBe(true)
    expect(speaksApiVersion('2 || 3', '3')).toBe(true)
    expect(speaksApiVersion('2 || 3', '4')).toBe(false)
    expect(speaksApiVersion('2||3', '3')).toBe(true)
  })

  it('reads a span inclusively at both ends', () => {
    expect(speaksApiVersion('2-4', '2')).toBe(true)
    expect(speaksApiVersion('2-4', '4')).toBe(true)
    expect(speaksApiVersion('2-4', '5')).toBe(false)
    expect(speaksApiVersion('1 || 3-5', '4')).toBe(true)
  })

  it('reads anything that is not a range as incompatible', () => {
    // A typo has to fail loudly at the manifest rather than silently matching no build. The manifest
    // schema holds the same regex, so this is the second line rather than the first.
    for (const bad of ['', '  ', '^3', '>=2', '3.1', 'three', '3 || ', '-3', '3-']) {
      expect(speaksApiVersion(bad, '3')).toBe(false)
    }
  })

  it('defaults to this build, so a caller cannot compare against the wrong number by omission', () => {
    expect(speaksApiVersion(PLUGIN_API_MAJOR)).toBe(true)
  })
})
