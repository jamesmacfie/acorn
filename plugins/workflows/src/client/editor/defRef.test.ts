import { describe, expect, it } from 'vitest'
import { defRefKey, parseDefRef } from './draftStore'

// The address of an open definition, round-tripped. Solid Router hands a path parameter back exactly
// as it sits in the URL, so the `:` that `workflowsSurfacePath` escapes arrives as `%3A`. Reading that
// as nothing opened the whole editor read-only, with no Add, no Save, and a banner calling a fresh row
// a committed file.

describe('a definition reference', () => {
  it('reads the escaped separator a router hands back', () => {
    expect(parseDefRef('db%3Aabc-123')).toEqual({ source: 'database', id: 'abc-123' })
    expect(parseDefRef('repo%3Aship-it')).toEqual({ source: 'repo', id: 'ship-it' })
  })

  it('still reads a key straight from defRefKey, which is not escaped', () => {
    for (const source of ['database', 'repo', 'user'] as const) {
      const ref = { source, id: 'abc-123' }
      expect(parseDefRef(defRefKey(ref))).toEqual(ref)
      expect(parseDefRef(encodeURIComponent(defRefKey(ref)))).toEqual(ref)
    }
  })

  it('answers nothing for an address that names no layer, and does not throw on a bad escape', () => {
    expect(parseDefRef('abc-123')).toBeNull()
    expect(parseDefRef('')).toBeNull()
    expect(parseDefRef(undefined)).toBeNull()
    expect(parseDefRef('%E0%A4%A')).toBeNull()
  })
})
