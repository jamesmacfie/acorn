import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LANGUAGE_IDS } from '@acorn/protocol/languageIds.ts'
import { languageFor, languageForPath } from './language'

// `tsc` proves the map is total over the vocabulary; it cannot prove the packs on the other side of
// it still export what this file imports. A renamed export from a grammar package is a runtime
// `undefined is not a function` in a pane nobody opened during the upgrade, so every entry is built
// here once.
//
// And, since the entries import their grammar rather than holding it, one more thing has to be true:
// no grammar is reachable statically. That is the property the whole split was for — the editor's
// chunk used to be 954,915 bytes because this module imported all seventeen up front, so a pane that
// opens one file downloaded every language the app knows
// (docs/performance.md).

/** Every grammar package the map can reach, from the source rather than from a list kept beside it. */
const SOURCE = readFileSync(new URL('./language.ts', import.meta.url), 'utf8')
const GRAMMAR = /@codemirror\/(?:lang-[a-z+]+|legacy-modes\/mode\/[a-z]+)/g

describe('the language map', () => {
  it('builds a grammar for every published language id', async () => {
    for (const id of LANGUAGE_IDS) expect(await languageFor(id), id).toBeDefined()
  })

  it('resolves a path through the shared extension table', async () => {
    expect(await languageForPath('src/app.tsx')).toBeDefined()
    // Plain text is a real answer, not a missing one: no grammar, and nothing thrown.
    expect(await languageForPath('LICENSE')).toEqual([])
  })

  it('reaches every grammar through a dynamic import and none statically', () => {
    const specifiers = [...new Set(SOURCE.match(GRAMMAR) ?? [])]
    // Anti-vacuity: a broken pattern reads nothing and an empty list satisfies the loop below.
    expect(specifiers.length).toBeGreaterThan(15)
    // A grammar named on a static `import … from` line puts the whole language pack in whichever
    // chunk holds this module, which is one chunk per pane rather than one per file opened.
    const eager = specifiers.filter((specifier) =>
      new RegExp(`^\\s*import[^\\n]*from '${specifier.replace(/[/+]/g, '\\$&')}'`, 'm').test(SOURCE))
    expect(eager, 'these grammars are imported statically and must be dynamic').toEqual([])
  })

  it('serves the four JavaScript dialects from one grammar package', () => {
    // Not four grammars told apart by a package, but one told apart by two flags: opening a `.tsx`
    // file after a `.ts` one costs no second request.
    const dialects = ['typescript:', 'typescriptreact:', 'javascript:', 'javascriptreact:']
    for (const dialect of dialects) {
      const line = SOURCE.split('\n').find((text) => text.trim().startsWith(dialect))
      expect(line, dialect).toContain("@codemirror/lang-javascript")
    }
  })
})
