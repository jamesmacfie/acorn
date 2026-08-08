import { describe, expect, it } from 'vitest'
import { defaultDockerPrefs, dockerPrefsSlice, readDockerPrefs } from './dockerPrefs'

describe('docker preferences', () => {
  it('uses defaults when the preference is absent or malformed JSON', () => {
    expect(readDockerPrefs(undefined)).toEqual(defaultDockerPrefs)
    expect(readDockerPrefs({})).toEqual(defaultDockerPrefs)
    expect(readDockerPrefs({ docker_prefs: '{' })).toEqual(defaultDockerPrefs)
  })

  it('merges stored preference values over defaults', () => {
    expect(readDockerPrefs({ docker_prefs: JSON.stringify({ showStopped: false }) })).toEqual({ confirmDestructive: true, showStopped: false })
  })

  it('rejects object-shaped but invalid stored values instead of spreading them into preferences', () => {
    expect(readDockerPrefs({ docker_prefs: JSON.stringify({ showStopped: 'no' }) })).toEqual(defaultDockerPrefs)
    expect(readDockerPrefs({ docker_prefs: JSON.stringify({ confirmDestructive: false, extra: true }) })).toEqual(defaultDockerPrefs)
  })

  it('persists only object-shaped slice values and falls back to an empty object otherwise', () => {
    expect(dockerPrefsSlice.codec.parse(JSON.stringify({ showStopped: false }))).toEqual({ showStopped: false })
    expect(dockerPrefsSlice.codec.parse('[]')).toEqual({})
    expect(dockerPrefsSlice.codec.parse('{')).toEqual({})
    expect(dockerPrefsSlice.empty('')).toEqual({})
  })
})
