import { describe, expect, it } from 'vitest'
import { LANGUAGE_IDS } from '@acorn/protocol/languageIds.ts'
import { languageFor, languageForPath } from './language'

// `tsc` proves the map is total over the vocabulary; it cannot prove the packs on the other side of
// it still export what this file imports. A renamed export from a grammar package is a runtime
// `undefined is not a function` in a pane nobody opened during the upgrade, so every entry is built
// here once.

describe('the language map', () => {
  it('builds a grammar for every published language id', () => {
    for (const id of LANGUAGE_IDS) expect(languageFor(id), id).toBeDefined()
  })

  it('resolves a path through the shared extension table', () => {
    expect(languageForPath('src/app.tsx')).toBeDefined()
    // Plain text is a real answer, not a missing one: no grammar, and nothing thrown.
    expect(languageForPath('LICENSE')).toEqual([])
  })
})
