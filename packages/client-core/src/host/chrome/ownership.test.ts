import { describe, expect, it } from 'vitest'
import { ownedPluginPath } from './ownership'

describe('a plugin-supplied path', () => {
  it('resolves to the normalized route it names inside the plugin namespace', () => {
    expect(ownedPluginPath('music', '/v1/p/music/art/42?size=2')).toBe('/v1/p/music/art/42?size=2')
    expect(ownedPluginPath('music', '/v1/p/music/x/../art/42')).toBe('/v1/p/music/art/42')
  })

  it('refuses another namespace, another origin, credentials, fragments and encodings that hide one', () => {
    for (const path of [
      '/v1/p/other/art',
      '/v1/p/music/../other/art',
      '/v1/p/musical/art',
      '//example.com/v1/p/music/art',
      'https://example.com/v1/p/music/art',
      '/v1/p/music/art#cover',
      '/v1/p/music\\..\\other',
      '/v1/p/music/art cover',
      'v1/p/music/art',
      42,
    ]) {
      expect(ownedPluginPath('music', path)).toBeNull()
    }
  })
})
