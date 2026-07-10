import { describe, expect, it } from 'vitest'
import { directPreferenceSlices } from './preferenceSlices'
import { persistedFeatureSlices } from './stateSlices'
import { stringifyPersistedValue, utf8Bytes } from './persistedState'

const slices = [...persistedFeatureSlices, ...directPreferenceSlices]

describe('persisted-state descriptor conformance', () => {
  it('has unique identities and bounded, valid descriptor metadata', () => {
    expect(new Set(slices.map((slice) => slice.id)).size).toBe(slices.length)
    expect(new Set(slices.map((slice) => slice.key)).size).toBe(slices.length)
    for (const slice of slices) {
      expect(slice.id).toMatch(/^[a-z0-9.-]+$/)
      expect(slice.version).toBeGreaterThan(0)
      expect(slice.maxBytes).toBeGreaterThan(0)
    }
  })

  for (const slice of slices) {
    it(`${slice.id} tolerates malformed/legacy-shaped input and round-trips its empty value`, () => {
      expect(() => slice.codec.parse('{not-json')).not.toThrow()
      expect(() => slice.codec.parse({ unknown: { future: true } })).not.toThrow()
      const empty = slice.empty('conformance-scope')
      const encoded = stringifyPersistedValue(slice, empty)
      expect(() => slice.codec.parse(encoded)).not.toThrow()
      expect(utf8Bytes(encoded)).toBeLessThanOrEqual(slice.maxBytes!)
      // Oversize payloads are rejected by startupRestore before hydration; codecs must still fail
      // closed rather than throw if called directly by a future migration.
      expect(() => slice.codec.parse('x'.repeat(slice.maxBytes! + 1))).not.toThrow()
    })
  }
})
